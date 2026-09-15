import type { RunRecord, CalendarTopic, AgentId } from "../../../types/api";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface PipelineStats {
  pendingContent: number;
  completedLast7Days: number;
  avgDurationMinutes: number | null;
  publishRate: number | null;
  stageCounts: Record<AgentId, number>;
}

const EMPTY_STAGE_COUNTS: Record<AgentId, number> = {
  "marketing-director": 0, "pesquisa-mercado": 0, "pesquisa-pauta": 0, redator: 0,
  "editor-seo": 0, publicador: 0, instagram: 0, indexador: 0,
};

/** Puro — nenhum número aqui é inventado, tudo deriva de runs/tópicos reais. */
export function computePipelineStats(runs: RunRecord[], topics: CalendarTopic[], now: Date): PipelineStats {
  const cutoff = now.getTime() - SEVEN_DAYS_MS;
  const recentRuns = runs.filter((r) => new Date(r.finalizadoEm || r.iniciadoEm).getTime() >= cutoff);

  const pendingContent = topics.filter((t) => !t.publicado).length;
  const completedLast7Days = recentRuns.filter((r) => r.status === "publicado").length;

  const durations = recentRuns
    .filter((r) => r.iniciadoEm && r.finalizadoEm)
    .map((r) => (new Date(r.finalizadoEm).getTime() - new Date(r.iniciadoEm).getTime()) / 60_000)
    .filter((min) => Number.isFinite(min) && min >= 0);
  const avgDurationMinutes = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const publishRate = recentRuns.length ? Math.round((completedLast7Days / recentRuns.length) * 100) : null;

  const stageCounts = { ...EMPTY_STAGE_COUNTS };
  for (const run of recentRuns) {
    for (const event of run.eventos ?? []) {
      if (event.status === "done" && event.agent in stageCounts) stageCounts[event.agent] += 1;
    }
  }

  return { pendingContent, completedLast7Days, avgDurationMinutes, publishRate, stageCounts };
}
