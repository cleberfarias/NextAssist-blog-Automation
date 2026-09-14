import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./mergeWorkspaceState.js";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/**
 * Simula o cenário real do Bug 2: um ref remoto (commitado) e um working tree
 * local com mudanças não commitadas para o mesmo workspace — exatamente o
 * que o workflow tem em mãos depois de rodar o pipeline e antes de publicar.
 */
test("run() reconcilia working tree local contra uma ref remota via git real, sem rebase", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "merge-workspace-state-"));
  const originalCwd = process.cwd();
  try {
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);

    const wsDir = join(dir, "workspaces", "testws");
    mkdirSync(wsDir, { recursive: true });

    const remoteRunsHistory = [
      { id: "r-remote", origem: "action", iniciadoEm: "2026-01-01T00:00:00.000Z", finalizadoEm: "2026-01-01T00:05:00.000Z", tema: null, status: "publicado", slug: "remote-slug", erro: null, eventos: [] },
    ];
    const remoteReelState = {
      updatedAt: "2026-01-01T00:00:00.000Z",
      entries: [{ id: "testws:remote-slug", workspaceId: "testws", slug: "remote-slug", title: "Remote", blogUrl: "https://x.test/remote-slug", caption: "c", provider: "heygen-api", avatarId: "a", voiceId: "v", status: "pending_approval", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", audit: [] }],
    };
    writeFileSync(join(wsDir, "runs-history.json"), JSON.stringify(remoteRunsHistory));
    writeFileSync(join(wsDir, "reel-state.json"), JSON.stringify(remoteReelState));
    writeFileSync(join(wsDir, "content-calendar.json"), JSON.stringify({ topicos: [{ tema: "remote-tema", palavraChaveAlvo: "x", publicado: true, publicadoEm: "2026-01-01T00:00:00.000Z" }] }));
    writeFileSync(join(wsDir, "content-registry.json"), JSON.stringify([]));
    writeFileSync(join(wsDir, "post-history.json"), JSON.stringify([{ tema: "remote-tema", titulo: "Remote", slug: "remote-slug", publicadoEm: "2026-01-01T00:00:00.000Z" }]));
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "estado remoto"]);

    // Working tree local: a MESMA execução avançou o reel remoto (rendering -> pending_approval
    // já estava lá) e um workflow concorrente produziu um run e um tópico NOVOS, sem pull antes.
    const localRunsHistory = [
      { id: "r-local", origem: "action", iniciadoEm: "2026-01-02T00:00:00.000Z", finalizadoEm: "2026-01-02T00:05:00.000Z", tema: null, status: "publicado", slug: "local-slug", erro: null, eventos: [] },
    ];
    const localReelState = {
      updatedAt: "2026-01-02T00:00:00.000Z",
      entries: [{ id: "testws:remote-slug", workspaceId: "testws", slug: "remote-slug", title: "Remote", blogUrl: "https://x.test/remote-slug", caption: "c", provider: "heygen-api", avatarId: "a", voiceId: "v", status: "rendering", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", audit: [] }],
    };
    writeFileSync(join(wsDir, "runs-history.json"), JSON.stringify(localRunsHistory));
    writeFileSync(join(wsDir, "reel-state.json"), JSON.stringify(localReelState));
    writeFileSync(join(wsDir, "content-calendar.json"), JSON.stringify({ topicos: [{ tema: "local-tema", palavraChaveAlvo: "y", publicado: true, publicadoEm: "2026-01-02T00:00:00.000Z" }] }));
    writeFileSync(join(wsDir, "content-registry.json"), JSON.stringify([]));
    writeFileSync(join(wsDir, "post-history.json"), JSON.stringify([{ tema: "local-tema", titulo: "Local", slug: "local-slug", publicadoEm: "2026-01-02T00:00:00.000Z" }]));

    process.chdir(dir);
    run("testws", "HEAD");
    process.chdir(originalCwd);

    const mergedRuns = JSON.parse(readFileSync(join(wsDir, "runs-history.json"), "utf-8"));
    const mergedReelState = JSON.parse(readFileSync(join(wsDir, "reel-state.json"), "utf-8"));
    const mergedCalendar = JSON.parse(readFileSync(join(wsDir, "content-calendar.json"), "utf-8"));
    const mergedHistory = JSON.parse(readFileSync(join(wsDir, "post-history.json"), "utf-8"));

    // runs: os dois lados preservados, nenhum perdido.
    assert.deepEqual(mergedRuns.map((r: { id: string }) => r.id).sort(), ["r-local", "r-remote"]);
    // reel: pending_approval (remoto) nunca regride para rendering (local mais novo, mas mais atrás no progresso).
    assert.equal(mergedReelState.entries[0].status, "pending_approval");
    // calendário: os dois tópicos preservados.
    assert.deepEqual(mergedCalendar.topicos.map((t: { tema: string }) => t.tema).sort(), ["local-tema", "remote-tema"]);
    // histórico de posts: os dois posts preservados.
    assert.deepEqual(mergedHistory.map((h: { slug: string }) => h.slug).sort(), ["local-slug", "remote-slug"]);
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run() não falha quando o workspace não existe ainda na ref remota (workspace novo)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "merge-workspace-state-new-"));
  const originalCwd = process.cwd();
  try {
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);
    writeFileSync(join(dir, "README.md"), "placeholder");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "init sem o workspace"]);

    const wsDir = join(dir, "workspaces", "novo");
    mkdirSync(wsDir, { recursive: true });
    writeFileSync(join(wsDir, "runs-history.json"), JSON.stringify([]));
    writeFileSync(join(wsDir, "reel-state.json"), JSON.stringify({ updatedAt: "x", entries: [] }));
    writeFileSync(join(wsDir, "content-calendar.json"), JSON.stringify({ topicos: [] }));
    writeFileSync(join(wsDir, "content-registry.json"), JSON.stringify([]));
    writeFileSync(join(wsDir, "post-history.json"), JSON.stringify([]));

    process.chdir(dir);
    assert.doesNotThrow(() => run("novo", "HEAD"));
    process.chdir(originalCwd);
  } finally {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
