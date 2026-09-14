// src/scripts/mergeWorkspaceState.ts
//
// Reconcilia os JSONs de estado de um workspace (working tree local) contra
// a versão mais recente de uma ref git remota, usando as regras determinísticas
// de workspaceStateMerge.ts, e sobrescreve os arquivos locais com o resultado.
// Não faz git add/commit/push — isso fica no workflow, que pode chamar este
// script de novo (fetch -> merge -> push) se o remoto mudar entre as duas
// pontas, sem nunca usar rebase nem resolver por --ours/--theirs.
//
// Uso: npx tsx src/scripts/mergeWorkspaceState.ts <workspaceId> <remoteRef>
// Ex.: npx tsx src/scripts/mergeWorkspaceState.ts nextassist origin/feat/agent-harness
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { mergeWorkspaceState, type WorkspaceStateFiles } from "./workspaceStateMerge.js";

const FILES: Record<keyof WorkspaceStateFiles, string> = {
  contentCalendar: "content-calendar.json",
  contentRegistry: "content-registry.json",
  postHistory: "post-history.json",
  runsHistory: "runs-history.json",
  reelState: "reel-state.json",
};

function readLocalJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function readRemoteJson(ref: string, path: string): unknown {
  try {
    const raw = execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf-8" });
    return JSON.parse(raw);
  } catch {
    // Arquivo não existe nessa ref (workspace novo) ou a ref não tem esse
    // caminho ainda — trata como ausente, nunca derruba a reconciliação.
    return null;
  }
}

export function run(workspaceId: string, remoteRef: string): void {
  const dir = `workspaces/${workspaceId}`;
  const remote: WorkspaceStateFiles = {};
  const local: WorkspaceStateFiles = {};
  for (const [key, file] of Object.entries(FILES) as [keyof WorkspaceStateFiles, string][]) {
    remote[key] = readRemoteJson(remoteRef, `${dir}/${file}`) as never;
    local[key] = readLocalJson(`${dir}/${file}`) as never;
  }

  const merged = mergeWorkspaceState(remote, local);
  for (const [key, file] of Object.entries(FILES) as [keyof WorkspaceStateFiles, string][]) {
    writeFileSync(`${dir}/${file}`, `${JSON.stringify(merged[key], null, 2)}\n`);
  }
  console.log(`Estado de "${workspaceId}" reconciliado contra ${remoteRef}.`);
}

// Só dispara a CLI quando este arquivo é o entry point (evita rodar ao ser
// importado pelo teste, que só quer a função `run`).
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const [workspaceId, remoteRef] = process.argv.slice(2);
  if (!workspaceId || !remoteRef) {
    console.error("Uso: mergeWorkspaceState.ts <workspaceId> <remoteRef>");
    process.exit(1);
  }
  run(workspaceId, remoteRef);
}
