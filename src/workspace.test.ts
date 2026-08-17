import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorkspace, listWorkspaces } from "./workspace.js";

async function makeFixtureRoot(workspaces: Record<string, object | null>): Promise<URL> {
  const dir = await mkdtemp(path.join(tmpdir(), "workspaces-"));
  for (const [id, contents] of Object.entries(workspaces)) {
    const wsDir = path.join(dir, id);
    await mkdir(wsDir, { recursive: true });
    if (contents) {
      await writeFile(path.join(wsDir, "workspace.json"), JSON.stringify(contents, null, 2));
    }
  }
  return pathToFileURL(dir + path.sep);
}

const baseWorkspace = {
  id: "acme",
  name: "Acme Inc",
  active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [] },
  goals: { primary: "leads" },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist", apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" },
  secrets: { required: ["OPENAI_API_KEY"] },
};

test("loadWorkspace lê e valida o workspace.json pelo id da pasta", async () => {
  const root = await makeFixtureRoot({ acme: baseWorkspace });
  const workspace = await loadWorkspace("acme", root);
  assert.equal(workspace.name, "Acme Inc");
  assert.deepEqual(workspace.secrets.required, ["OPENAI_API_KEY"]);
});

test("loadWorkspace lança erro claro se o workspace não existe", async () => {
  const root = await makeFixtureRoot({});
  await assert.rejects(() => loadWorkspace("ghost", root), /não encontrado/);
});

test("loadWorkspace lança erro se o id do arquivo não bate com a pasta", async () => {
  const root = await makeFixtureRoot({ acme: { ...baseWorkspace, id: "outro-id" } });
  await assert.rejects(() => loadWorkspace("acme", root), /precisa bater/);
});

test("listWorkspaces devolve só os workspaces ativos", async () => {
  const root = await makeFixtureRoot({
    acme: baseWorkspace,
    inactive: { ...baseWorkspace, id: "inactive", active: false },
  });
  const workspaces = await listWorkspaces(root);
  assert.deepEqual(workspaces.map((w) => w.id), ["acme"]);
});

test("loadWorkspace rejeita workspace.json com campo obrigatório ausente, apontando o campo", async () => {
  const { channels: _channels, ...semChannels } = baseWorkspace;
  const root = await makeFixtureRoot({ acme: semChannels });
  await assert.rejects(() => loadWorkspace("acme", root), /"channels" precisa ser objeto/);
});

test("loadWorkspace rejeita goals.primary fora do enum permitido", async () => {
  const root = await makeFixtureRoot({
    acme: { ...baseWorkspace, goals: { primary: "world-domination" } },
  });
  await assert.rejects(() => loadWorkspace("acme", root), /"goals\.primary" precisa ser um de/);
});

test("listWorkspaces ignora um workspace inválido (loga o erro) sem derrubar os outros", async () => {
  const root = await makeFixtureRoot({
    acme: baseWorkspace,
    quebrado: { ...baseWorkspace, id: "quebrado", active: true, secrets: { required: "não-é-array" } },
  });
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => { logged.push(String(args[0])); };
  try {
    const workspaces = await listWorkspaces(root);
    assert.deepEqual(workspaces.map((w) => w.id), ["acme"]);
    assert.ok(logged.some((line) => line.includes("quebrado") && line.includes("secrets.required")));
  } finally {
    console.error = originalError;
  }
});

test("contentStrategy é opcional — workspace sem o campo carrega normalmente", async () => {
  const root = await makeFixtureRoot({ acme: baseWorkspace });
  const workspace = await loadWorkspace("acme", root);
  assert.equal(workspace.contentStrategy, undefined);
});

test("contentStrategy inválido (minimumPendingTopics não numérico) falha ao carregar", async () => {
  const root = await makeFixtureRoot({
    acme: { ...baseWorkspace, contentStrategy: { minimumPendingTopics: "cinco", replenishAmount: 15 } },
  });
  await assert.rejects(
    () => loadWorkspace("acme", root),
    /contentStrategy\.minimumPendingTopics.*inteiro positivo/,
  );
});

test("contentStrategy válido é aceito e exposto no workspace carregado", async () => {
  const root = await makeFixtureRoot({
    acme: { ...baseWorkspace, contentStrategy: { minimumPendingTopics: 5, replenishAmount: 15 } },
  });
  const workspace = await loadWorkspace("acme", root);
  assert.deepEqual(workspace.contentStrategy, { minimumPendingTopics: 5, replenishAmount: 15 });
});
