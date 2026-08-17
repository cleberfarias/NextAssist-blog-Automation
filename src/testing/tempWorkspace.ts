// src/testing/tempWorkspace.ts
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface TempWorkspace {
  root: URL;
  cleanup: () => Promise<void>;
}

/**
 * Cria um diretório temporário `<tmp>/<id>/` com os arquivos JSON informados
 * (ex: `{ "content-calendar.json": { topicos: [...] } }`), no formato que
 * `buildWorkspaceContext({ workspacesRoot })` espera. Usado pelos testes que
 * precisam de leitura/escrita real em disco sem tocar nos workspaces reais
 * do repositório.
 */
export async function createTempWorkspace(id: string, files: Record<string, unknown> = {}): Promise<TempWorkspace> {
  const base = await mkdtemp(join(tmpdir(), "nextassist-test-"));
  const workspaceDir = join(base, id);
  await mkdir(workspaceDir, { recursive: true });
  for (const [fileName, content] of Object.entries(files)) {
    await writeFile(join(workspaceDir, fileName), `${JSON.stringify(content, null, 2)}\n`);
  }
  const root = new URL(`${pathToFileURL(base).href}/`);
  return { root, cleanup: () => rm(base, { recursive: true, force: true }) };
}
