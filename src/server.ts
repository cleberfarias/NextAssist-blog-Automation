// src/server.ts
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runPipeline, type AgentId, type AgentStatus, type PipelineEvent } from "./pipeline.js";
import { getHistory } from "./history.js";
import { getRuns } from "./runsHistory.js";
import { getPerformance, refreshPerformance } from "./performance.js";
import { computeAttribution } from "./attribution.js";
import { config } from "./config.js";
import { getConversionSummary, recordConversion, type ConversionEventName } from "./conversions.js";
import { triggerDailyPostWorkflow } from "./lib/githubDispatch.js";
import { listWorkspaces, loadWorkspace, type MarketingWorkspace } from "./workspace.js";
import { EnvSecretProvider } from "./lib/secrets.js";
import { buildWorkspaceContext, type WorkspaceContext } from "./context.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;
const secrets = new EnvSecretProvider();

type RunMode = "local" | "dispatch" | "disabled";
const runMode: RunMode =
  config.dataSource !== "github" ? "local" : config.githubDispatchToken ? "dispatch" : "disabled";

interface WorkspaceRuntimeState {
  running: boolean;
  lastEvents: PipelineEvent[];
  clients: Set<express.Response>;
  dispatching: boolean;
  refreshingPerf: boolean;
}

const runtimeStates = new Map<string, WorkspaceRuntimeState>();

function getRuntimeState(workspaceId: string): WorkspaceRuntimeState {
  let state = runtimeStates.get(workspaceId);
  if (!state) {
    state = { running: false, lastEvents: [], clients: new Set(), dispatching: false, refreshingPerf: false };
    runtimeStates.set(workspaceId, state);
  }
  return state;
}

function broadcast(workspaceId: string, event: PipelineEvent) {
  const state = getRuntimeState(workspaceId);
  state.lastEvents.push(event);
  if (state.lastEvents.length > 50) state.lastEvents = state.lastEvents.slice(-50);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of state.clients) res.write(payload);
}

/**
 * Express 4 não captura rejeições de handlers async — sem isto, um erro (ex:
 * workspace inexistente) deixaria o cliente pendurado e viraria unhandled
 * rejection no processo.
 */
function asyncHandler(fn: (req: express.Request, res: express.Response) => Promise<void>) {
  return (req: express.Request, res: express.Response) => {
    fn(req, res).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Erro na rota:", message);
      if (!res.headersSent) res.status(500).json({ error: message });
    });
  };
}

async function contextFor(workspaceId: string): Promise<WorkspaceContext> {
  const workspace = await loadWorkspace(workspaceId);
  // Nenhuma rota que usa contextFor chama runAgent (o pipeline monta o próprio
  // contexto em pipeline.ts), então o painel não precisa de chave de IA.
  return buildWorkspaceContext(workspace, secrets, { requireAiProvider: false });
}

function requireWorkspaceId(req: express.Request, res: express.Response): string | null {
  const workspaceId = String(req.query.workspace ?? "");
  if (!workspaceId) {
    res.status(400).json({ error: "Parâmetro ?workspace= é obrigatório." });
    return null;
  }
  return workspaceId;
}

const app = express();

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
    res.set("WWW-Authenticate", 'Basic realm="Escritorio"');
    res.status(401).send("Autenticação necessária.");
  });
}

app.use(express.static(path.join(__dirname, "../web/public")));

/**
 * CORS por allowlist: só ecoa `Access-Control-Allow-Origin` quando o
 * `Origin` da requisição bate com o `integrations.siteUrl` de algum
 * workspace ativo (é assim que o site público de cada cliente chama
 * `POST /api/conversions`). `*` abriria todas as rotas — incluindo
 * `/api/run`, `/api/performance/refresh` e o histórico/uso de IA — a
 * qualquer origem; combinado com Basic Auth (cujas credenciais o browser
 * reenvia automaticamente para o mesmo host), isso é uma superfície de
 * CSRF real, não só teórica.
 */
app.use((req, res, next) => {
  const origin = req.header("origin");
  if (!origin) { next(); return; }
  listWorkspaces()
    .then((workspaces) => {
      if (workspaces.some((w) => w.integrations.siteUrl === origin)) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Vary", "Origin");
      }
      next();
    })
    .catch(next);
});

app.get("/api/workspaces", asyncHandler(async (_req, res) => {
  const workspaces = await listWorkspaces();
  res.json(workspaces.map((w: MarketingWorkspace) => ({ id: w.id, name: w.name })));
}));

app.post("/api/conversions", express.json(), asyncHandler(async (req, res) => {
  // Única rota que assume um default em vez de exigir workspaceId: o frontend do
  // site público (outro repositório) já postava aqui antes do multi-workspace e
  // não conhece o parâmetro — exigi-lo quebraria o rastreio de conversões ao vivo.
  const workspaceId = String(req.body?.workspaceId ?? "nextassist");
  const allowed: ConversionEventName[] = [
    "page_view", "cta_click",
    "demo_view", "demo_submit", "contact_submit", "whatsapp_click",
    "trial_started", "signup_completed",
    "first_customer_created", "first_device_linked", "first_order_created",
    "returning_user", "subscription_started",
  ];
  if (!allowed.includes(req.body?.name)) { res.status(400).json({ error: "Evento inválido" }); return; }
  const campaign = String(req.body.campaign ?? "").slice(0, 80);
  const content = String(req.body.content ?? "").slice(0, 80);
  const ctaId = String(req.body.ctaId ?? "").slice(0, 80);
  const utmValue = /^[a-z0-9-]*$/;
  if (!utmValue.test(campaign) || !utmValue.test(content) || !utmValue.test(ctaId)) {
    res.status(400).json({ error: "Parâmetros UTM inválidos" });
    return;
  }
  // anonymousId/userId são opacos (gerados pelo site/produto) — só limitamos o
  // tamanho para não deixar o arquivo de eventos crescer sem controle.
  const anonymousId = String(req.body.anonymousId ?? "").slice(0, 100);
  const userId = String(req.body.userId ?? "").slice(0, 100);
  const ctx = await contextFor(workspaceId);
  await recordConversion(ctx, {
    name: req.body.name,
    path: String(req.body.path ?? "").slice(0, 200),
    source: String(req.body.source ?? "").slice(0, 80),
    medium: String(req.body.medium ?? "").slice(0, 80),
    campaign, content,
    ...(ctaId ? { ctaId } : {}),
    ...(anonymousId ? { anonymousId } : {}),
    ...(userId ? { userId } : {}),
  });
  res.status(204).end();
}));

app.get("/api/conversions", asyncHandler(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const ctx = await contextFor(workspaceId);
  res.json(await getConversionSummary(ctx));
}));

app.get("/api/events", (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const state = getRuntimeState(workspaceId);
  state.clients.add(res);
  for (const event of state.lastEvents) res.write(`data: ${JSON.stringify(event)}\n\n`);
  req.on("close", () => state.clients.delete(res));
});

app.get("/api/status", (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const state = getRuntimeState(workspaceId);
  res.json({ running: state.running, lastEvents: state.lastEvents, runMode });
});

const AGENT_IDS: AgentId[] = ["marketing-director", "pesquisa-mercado", "pesquisa-pauta", "redator", "editor-seo", "publicador", "instagram", "indexador"];
const AGENT_STATUSES: AgentStatus[] = ["idle", "working", "done", "error"];

function validIngestToken(req: express.Request): boolean {
  if (!config.panelIngestToken) return false;
  const received = Buffer.from(String(req.header("X-Panel-Ingest-Token") ?? ""));
  const expected = Buffer.from(config.panelIngestToken);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

app.post("/api/events/ingest", express.json(), (req, res) => {
  if (!validIngestToken(req)) { res.status(401).json({ error: "Token de ingestão inválido." }); return; }

  const body = req.body ?? {};
  const workspaceId = String(body.workspaceId ?? "");
  if (!workspaceId || !AGENT_IDS.includes(body.agent) || !AGENT_STATUSES.includes(body.status) || typeof body.timestamp !== "string") {
    res.status(400).json({ error: "Evento inválido." });
    return;
  }

  const event: PipelineEvent = {
    agent: body.agent, status: body.status, timestamp: body.timestamp,
    ...(typeof body.message === "string" ? { message: body.message } : {}),
    ...(typeof body.tema === "string" ? { tema: body.tema } : {}),
  };

  const state = getRuntimeState(workspaceId);
  if (event.agent === "pesquisa-mercado" && event.status === "working") state.running = true;
  if (event.status === "error" || (event.agent === "indexador" && event.status === "done")) state.running = false;

  broadcast(workspaceId, event);
  res.status(204).end();
});

app.post("/api/run", express.json(), asyncHandler(async (req, res) => {
  const workspaceId = String(req.body?.workspaceId ?? "");
  if (!workspaceId) { res.status(400).json({ error: "workspaceId é obrigatório." }); return; }
  const state = getRuntimeState(workspaceId);

  if (runMode === "disabled") {
    res.status(403).json({ error: "Execução manual desabilitada neste ambiente — a publicação roda pela GitHub Action." });
    return;
  }

  if (runMode === "dispatch") {
    if (state.dispatching) { res.status(409).json({ error: "Já disparei uma execução há pouco — aguarde." }); return; }
    state.dispatching = true;
    setTimeout(() => { state.dispatching = false; }, 60_000);
    try {
      await triggerDailyPostWorkflow(workspaceId);
      res.json({ ok: true, mode: "dispatch" });
    } catch (err) {
      state.dispatching = false;
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (state.running) { res.status(409).json({ error: "O pipeline já está rodando." }); return; }
  state.running = true;
  res.json({ ok: true, mode: "local" });

  try {
    // Ao contrário de contextFor() (rotas somente-leitura), rodar o pipeline
    // de verdade precisa de um provider de IA — contexto próprio, com as
    // exigências padrão (requireAiProvider: true).
    const workspace = await loadWorkspace(workspaceId);
    const runCtx = await buildWorkspaceContext(workspace, secrets);
    await runPipeline(runCtx, (event) => broadcast(workspaceId, event));
  } catch {
    // erro já foi transmitido como evento "error" pelo broadcast
  } finally {
    state.running = false;
  }
}));

app.get("/api/history", asyncHandler(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  res.json(await getHistory(await contextFor(workspaceId)));
}));

app.get("/api/runs", asyncHandler(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  res.json(await getRuns(await contextFor(workspaceId)));
}));

app.get("/api/usage", asyncHandler(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const runs = await getRuns(await contextFor(workspaceId));
  const tracked = runs.filter((run) => run.usage);
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const published = tracked.filter((run) => run.status === "publicado");
  const monthRuns = tracked.filter((run) => new Date(run.finalizadoEm || run.iniciadoEm).getTime() >= monthStart);
  const sum = (items: typeof tracked, field: "estimatedUsd" | "inputTokens" | "outputTokens" | "webSearchRequests") =>
    items.reduce((total, run) => total + (run.usage?.[field] ?? 0), 0);

  res.json({
    trackedRuns: tracked.length,
    month: { estimatedUsd: sum(monthRuns, "estimatedUsd"), inputTokens: sum(monthRuns, "inputTokens"), outputTokens: sum(monthRuns, "outputTokens"), webSearchRequests: sum(monthRuns, "webSearchRequests") },
    total: { estimatedUsd: sum(tracked, "estimatedUsd"), inputTokens: sum(tracked, "inputTokens"), outputTokens: sum(tracked, "outputTokens"), webSearchRequests: sum(tracked, "webSearchRequests") },
    averagePublishedUsd: published.length ? sum(published, "estimatedUsd") / published.length : 0,
  });
}));

app.get("/api/performance", asyncHandler(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  res.json(await getPerformance(await contextFor(workspaceId)));
}));

app.get("/api/attribution", asyncHandler(async (req, res) => {
  const workspaceId = requireWorkspaceId(req, res);
  if (!workspaceId) return;
  const ctx = await contextFor(workspaceId);
  res.json(await computeAttribution(ctx));
}));

app.post("/api/performance/refresh", express.json(), asyncHandler(async (req, res) => {
  const workspaceId = String(req.body?.workspaceId ?? "");
  if (!workspaceId) { res.status(400).json({ error: "workspaceId é obrigatório." }); return; }
  const state = getRuntimeState(workspaceId);
  if (state.refreshingPerf) { res.status(409).json({ error: "Já estou atualizando as métricas." }); return; }
  state.refreshingPerf = true;
  try {
    const ctx = await contextFor(workspaceId);
    const report = await refreshPerformance(ctx, req.body?.inicio, req.body?.fim);
    res.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const invalidPeriod = message.includes("data inicial") || message.includes("data final") || message.includes("formato AAAA-MM-DD");
    res.status(invalidPeriod ? 400 : 500).json({ error: message });
  } finally {
    state.refreshingPerf = false;
  }
}));

app.listen(PORT, () => {
  console.log(`Escritório rodando em http://localhost:${PORT}`);
});
