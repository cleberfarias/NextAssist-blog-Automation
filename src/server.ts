import express from "express";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runPipeline, type PipelineEvent } from "./pipeline.js";
import { getHistory } from "./history.js";
import { getRuns } from "./runsHistory.js";
import { getPerformance, refreshPerformance } from "./performance.js";
import { config } from "./config.js";
import { getConversionSummary, recordConversion, type ConversionEventName } from "./conversions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

// No modo hospedado, a publicação deve passar só pela Action para evitar
// posts duplicados; por isso o botão manual fica desligado.
const runEnabled = config.dataSource !== "github";

const app = express();

// Proteção por senha (Basic Auth). Ativa só se PANEL_PASSWORD estiver definida.
if (config.panelPassword) {
  app.use((req, res, next) => {
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
  await recordConversion({ name: req.body.name, path: String(req.body.path ?? "").slice(0, 200), source: String(req.body.source ?? "").slice(0, 80), medium: String(req.body.medium ?? "").slice(0, 80), campaign: String(req.body.campaign ?? "").slice(0, 80), content: String(req.body.content ?? "").slice(0, 80) });
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
  res.json({ running, lastEvents, runEnabled });
});

app.post("/api/run", express.json(), async (_req, res) => {
  if (!runEnabled) {
    res.status(403).json({ error: "Execução manual desabilitada neste ambiente — a publicação roda pela GitHub Action." });
    return;
  }
  if (running) {
    res.status(409).json({ error: "O pipeline já está rodando." });
    return;
  }
  running = true;
  res.json({ ok: true });

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
