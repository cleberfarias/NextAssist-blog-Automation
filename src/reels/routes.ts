import { Router } from "express";
import type { WorkspaceContext } from "../context.js";
import { publishReelToInstagram } from "../lib/instagram.js";
import { getReelState, findReel } from "./state.js";
import { publishApprovedInstagramReel, reviewInstagramReel } from "./publisher.js";

export interface ReelRoutesOptions {
  contextFor(workspaceId: string): Promise<WorkspaceContext>;
}

function bodyWorkspaceId(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  return String((body as { workspaceId?: unknown }).workspaceId ?? "").trim();
}

function bodyReelId(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  return String((body as { reelId?: unknown }).reelId ?? "").trim().slice(0, 240);
}

export function createReelRoutes(options: ReelRoutesOptions): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const workspaceId = String(req.query.workspace ?? "").trim();
      if (!workspaceId) {
        res.status(400).json({ error: "Parâmetro ?workspace= é obrigatório." });
        return;
      }
      const report = await getReelState(await options.contextFor(workspaceId));
      const entries = report?.entries ?? [];
      res.json({
        updatedAt: report?.updatedAt ?? null,
        summary: {
          total: entries.length,
          pendingApproval: entries.filter((entry) => entry.status === "pending_approval").length,
          approved: entries.filter((entry) => entry.status === "approved").length,
          published: entries.filter((entry) => entry.status === "published").length,
          failed: entries.filter((entry) => entry.status === "failed").length,
        },
        entries,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const workspaceId = String(req.query.workspace ?? "").trim();
      if (!workspaceId) {
        res.status(400).json({ error: "Parâmetro ?workspace= é obrigatório." });
        return;
      }
      const record = await findReel(await options.contextFor(workspaceId), req.params.id);
      if (!record) {
        res.status(404).json({ error: "Reel não encontrado." });
        return;
      }
      res.json(record);
    } catch (err) {
      next(err);
    }
  });

  router.post("/review", async (req, res, next) => {
    try {
      const workspaceId = bodyWorkspaceId(req.body);
      const reelId = bodyReelId(req.body);
      const decision = req.body?.decision;
      if (!workspaceId || !reelId) {
        res.status(400).json({ error: "workspaceId e reelId são obrigatórios." });
        return;
      }
      if (decision !== "approved" && decision !== "rejected") {
        res.status(400).json({ error: "decision precisa ser approved ou rejected." });
        return;
      }
      const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : undefined;
      const entry = await reviewInstagramReel(await options.contextFor(workspaceId), reelId, decision, note);
      res.json({ ok: true, entry });
    } catch (err) {
      next(err);
    }
  });

  router.post("/publish", async (req, res, next) => {
    try {
      const workspaceId = bodyWorkspaceId(req.body);
      const reelId = bodyReelId(req.body);
      if (!workspaceId || !reelId) {
        res.status(400).json({ error: "workspaceId e reelId são obrigatórios." });
        return;
      }
      const ctx = await options.contextFor(workspaceId);
      const entry = await publishApprovedInstagramReel(ctx, reelId, {
        publish: ({ videoUrl, caption }) => publishReelToInstagram(ctx, videoUrl, caption),
      });
      res.json({ ok: true, entry });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
