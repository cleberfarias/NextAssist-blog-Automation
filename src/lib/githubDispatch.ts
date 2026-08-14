import { config } from "../config.js";

const WORKFLOW_FILE = "daily-post.yml";

/**
 * Dispara manualmente o workflow diário do GitHub Actions
 * (`.github/workflows/daily-post.yml`, `workflow_dispatch`). Usado pelo
 * botão "Rodar pipeline agora" do painel hospedado: em vez de rodar o
 * pipeline no próprio servidor (que não commita o estado de volta), aciona
 * a mesma automação de sempre, que publica e commita normalmente.
 */
export async function triggerDailyPostWorkflow(): Promise<void> {
  if (!config.githubDispatchToken) {
    throw new Error("GITHUB_DISPATCH_TOKEN não configurada — necessária para disparar a Action.");
  }

  const res = await fetch(
    `https://api.github.com/repos/${config.githubRepo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.githubDispatchToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: config.githubBranch }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Falha ao disparar a GitHub Action: HTTP ${res.status} ${detail}`);
  }
}
