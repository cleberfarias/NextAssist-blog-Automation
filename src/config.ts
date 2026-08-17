// src/config.ts
import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

export const config = {
  // De onde o painel lê os arquivos de estado (histórico, execuções):
  //  - "local": lê do disco (rodando na sua máquina após um git pull)
  //  - "github": busca os arquivos crus do repositório (painel hospedado,
  //    que não recebe os commits da Action diretamente)
  dataSource: (process.env.DATA_SOURCE ?? "local") as "local" | "github",
  githubRepo: process.env.GITHUB_REPO ?? "cleberfarias/NextAssist-blog-Automation",
  githubBranch: process.env.GITHUB_BRANCH ?? "main",
  githubToken: process.env.PANEL_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? "",
  // Token separado, só com permissão de disparar Actions (actions:write).
  // Usado pelo botão "Rodar pipeline agora" do painel hospedado.
  githubDispatchToken: process.env.GITHUB_DISPATCH_TOKEN ?? "",
  // Senha do painel (Basic Auth). Vazio = sem proteção (ok localmente).
  panelPassword: process.env.PANEL_PASSWORD ?? "",
  // URL/token do endpoint de ingestão de eventos do painel hospedado (usado
  // pela Action pra empurrar o progresso do pipeline em tempo real).
  panelIngestUrl: process.env.PANEL_INGEST_URL ?? "",
  panelIngestToken: process.env.PANEL_INGEST_TOKEN ?? "",
};

export { required };
