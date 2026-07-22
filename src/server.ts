import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runPipeline, type PipelineEvent } from "./pipeline.js";
import { getHistory } from "./history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

const app = express();
app.use(express.static(path.join(__dirname, "../web/public")));

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
  res.json({ running, lastEvents });
});

app.post("/api/run", express.json(), async (_req, res) => {
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

app.listen(PORT, () => {
  console.log(`Escritório rodando em http://localhost:${PORT}`);
});
