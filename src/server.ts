import express from "express";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runPipeline, type AgentId, type AgentStatus, type PipelineEvent } from "./pipeline.js";
import { getHistory } from "./history.js";
import { getRuns } from "./runsHistory.js";
import { getPerformance, refreshPerformance } from "./performance.js";
import { config } from "./config.js";
import { getConversionSummary, recordConversion, type ConversionEventName } from "./conversions.js";
import { triggerDailyPostWorkflow } from "./lib/githubDispatch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

// No modo hospedado o servidor não commita o estado de volta pro repo, então
// rodar o pipeline direto aqui geraria post duplicado. Em vez disso:
//  - "local": roda o pipeline neste processo (dev local, npm run office).
//  - "dispatch": dispara a GitHub Action manualmente (workflow_dispatch) —
//    publica e commita normalmente, só que sob demanda em vez de esperar o cron.
//  - "disabled": sem token de disparo configurado, botão fica escondido.
type RunMode = "local" | "dispatch" | "disabled";
const runMode: RunMode =
  config.dataSource !== "github" ? "local" : config.githubDispatchToken ? "dispatch" : "disabled";

const app = express();

// Proteção por senha (Basic Auth). Ativa só se PANEL_PASSWORD estiver definida.
// A rota de ingestão de eventos fica de fora: ela é chamada pela GitHub
// Action (que não tem a senha do painel) e já tem sua própria autenticação
// por token (ver validIngestToken mais abaixo).
if (config.panelPassword) {
  app.use((req, res, next) => {
    if (req.path === "/api/events/ingest") return next();
    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    if (scheme?.toLowerCase() === "basic" && encoded) {
      const credentials = Buffer.from(encoded, "base64").toString("utf8");
      const separator = credentials.indexOf(":");
      const receivedPassword = separator >= 0 ? credentials.slice(separator + 1) : "";
      const received = Buffer.from(receivedPassword);
      const expected = Buffer.from(config.panelPassword);
      if (received.length === expected.length && timingSafeEqual(received, expected)) {
        return next();
      }
    }
    res.set("WWW-Authenticate", 'Basic realm="Escritorio NextAssist"');
    res.status(401).send("Autenticação necessária.");
  });
}

app.use(express.static(path.join(__dirname, "../web/public")));
app.use((req, res, next) => { res.header("Access-Control-Allow-Origin", config.siteBaseUrl); next(); });

app.post("/api/conversions", express.json(), async (req, res) => {
  const allowed: ConversionEventName[] = ["demo_view", "demo_submit", "contact_submit", "whatsapp_click"];
  if (!allowed.includes(req.body?.name)) { res.status(400).json({ error: "Evento inválido" }); return; }
  const campaign = String(req.body.campaign ?? "").slice(0, 80);
  const content = String(req.body.content ?? "").slice(0, 80);
  const utmValue = /^[a-z0-9-]*$/;
  if (!utmValue.test(campaign) || !utmValue.test(content)) {
    res.status(400).json({ error: "Parâmetros UTM inválidos" });
    return;
  }
  await recordConversion({ name: req.body.name, path: String(req.body.path ?? "").slice(0, 200), source: String(req.body.source ?? "").slice(0, 80), medium: String(req.body.medium ?? "").slice(0, 80), campaign, content });
  res.status(204).end();
});

app.get("/api/conversions", async (_req, res) => res.json(await getConversionSummary()));

let running = false;
let lastEvents: PipelineEvent[] = [];
const clients = new Set<express.Response>();

function broadcast(event: PipelineEvent) {
  lastEvents.push(event);
  if (lastEvents.length > 50) lastEvents = lastEvents.slice(-50);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(payload);
}

app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  clients.add(res);
  // Manda o histórico recente pra quem acabou de conectar não ver a tela vazia.
  for (const event of lastEvents) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  req.on("close", () => clients.delete(res));
});

app.get("/api/status", (_req, res) => {
  res.json({ running, lastEvents, runMode });
});

const AGENT_IDS: AgentId[] = [
  "pesquisa-mercado",
  "pesquisa-pauta",
  "redator",
  "editor-seo",
  "publicador",
  "instagram",
  "indexador",
];
const AGENT_STATUSES: AgentStatus[] = ["idle", "working", "done", "error"];

function validIngestToken(req: express.Request): boolean {
  if (!config.panelIngestToken) return false;
  const received = Buffer.from(String(req.header("X-Panel-Ingest-Token") ?? ""));
  const expected = Buffer.from(config.panelIngestToken);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Recebe eventos do pipeline rodando numa GitHub Action (fora deste
 * processo) e os retransmite via SSE — pra o escritório do painel hospedado
 * acender as mesas em tempo real mesmo quando quem publicou foi a Action
 * (cron automático ou disparo manual), não este servidor.
 */
app.post("/api/events/ingest", express.json(), (req, res) => {
  if (!validIngestToken(req)) {
    res.status(401).json({ error: "Token de ingestão inválido." });
    return;
  }

  const body = req.body ?? {};
  if (
    !AGENT_IDS.includes(body.agent) ||
    !AGENT_STATUSES.includes(body.status) ||
    typeof body.timestamp !== "string"
  ) {
    res.status(400).json({ error: "Evento inválido." });
    return;
  }

  const event: PipelineEvent = {
    agent: body.agent,
    status: body.status,
    timestamp: body.timestamp,
    ...(typeof body.message === "string" ? { message: body.message } : {}),
    ...(typeof body.tema === "string" ? { tema: body.tema } : {}),
  };

  if (event.agent === "pesquisa-mercado" && event.status === "working") running = true;
  if (event.status === "error" || (event.agent === "indexador" && event.status === "done")) {
    running = false;
  }

  broadcast(event);
  res.status(204).end();
});

let dispatching = false;

app.post("/api/run", express.json(), async (_req, res) => {
  if (runMode === "disabled") {
    res.status(403).json({ error: "Execução manual desabilitada neste ambiente — a publicação roda pela GitHub Action." });
    return;
  }

  if (runMode === "dispatch") {
    if (dispatching) {
      res.status(409).json({ error: "Já disparei uma execução há pouco — aguarde." });
      return;
    }
    dispatching = true;
    // Cooldown curto só pra evitar clique duplo; a Action em si tem sua
    // própria trava de concorrência (não roda duas ao mesmo tempo).
    setTimeout(() => { dispatching = false; }, 60_000);
    try {
      await triggerDailyPostWorkflow();
      res.json({ ok: true, mode: "dispatch" });
    } catch (err) {
      dispatching = false;
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
    return;
  }

  // runMode === "local"
  if (running) {
    res.status(409).json({ error: "O pipeline já está rodando." });
    return;
  }
  running = true;
  res.json({ ok: true, mode: "local" });

  try {
    await runPipeline(broadcast);
  } catch {
    // O erro já foi transmitido como evento "error" pelo broadcast.
  } finally {
    running = false;
  }
});

app.get("/api/history", async (_req, res) => {
  res.json(await getHistory());
});

app.get("/api/runs", async (_req, res) => {
  res.json(await getRuns());
});

app.get("/api/usage", async (_req, res) => {
  const runs = await getRuns();
  const tracked = runs.filter((run) => run.usage);
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const published = tracked.filter((run) => run.status === "publicado");
  const monthRuns = tracked.filter(
    (run) => new Date(run.finalizadoEm || run.iniciadoEm).getTime() >= monthStart,
  );
  const sum = (
    items: typeof tracked,
    field: "estimatedUsd" | "inputTokens" | "outputTokens" | "webSearchRequests",
  ) => items.reduce((total, run) => total + (run.usage?.[field] ?? 0), 0);

  res.json({
    trackedRuns: tracked.length,
    month: {
      estimatedUsd: sum(monthRuns, "estimatedUsd"),
      inputTokens: sum(monthRuns, "inputTokens"),
      outputTokens: sum(monthRuns, "outputTokens"),
      webSearchRequests: sum(monthRuns, "webSearchRequests"),
    },
    total: {
      estimatedUsd: sum(tracked, "estimatedUsd"),
      inputTokens: sum(tracked, "inputTokens"),
      outputTokens: sum(tracked, "outputTokens"),
      webSearchRequests: sum(tracked, "webSearchRequests"),
    },
    averagePublishedUsd: published.length
      ? sum(published, "estimatedUsd") / published.length
      : 0,
  });
});

app.get("/api/performance", async (_req, res) => {
  res.json(await getPerformance());
});

let refreshingPerf = false;
app.post("/api/performance/refresh", express.json(), async (req, res) => {
  if (refreshingPerf) {
    res.status(409).json({ error: "Já estou atualizando as métricas." });
    return;
  }
  refreshingPerf = true;
  try {
    const report = await refreshPerformance(req.body?.inicio, req.body?.fim);
    res.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const invalidPeriod =
      message.includes("data inicial") ||
      message.includes("data final") ||
      message.includes("formato AAAA-MM-DD");
    res.status(invalidPeriod ? 400 : 500).json({ error: message });
  } finally {
    refreshingPerf = false;
  }
});

app.listen(PORT, () => {
  console.log(`Escritório rodando em http://localhost:${PORT}`);
});
