import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorkspace, listWorkspaces, saveWorkspace } from "./workspace.js";

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

const heygenWorkspace = {
  ...baseWorkspace,
  channels: { ...baseWorkspace.channels, instagram: true },
  integrations: {
    ...baseWorkspace.integrations,
    instagram: { apiVersion: "v21.0" },
    heygen: { transport: "mcp", mcpUrl: "https://mcp.heygen.com/mcp/v1/", auth: "oauth" },
  },
  videoStrategy: {
    provider: "heygen-mcp",
    avatarId: "avatar-cleber",
    voiceId: "voz-dinamica",
    brandKitId: "brand-kit",
    format: "9:16",
    music: true,
    musicVolume: 0.12,
    requiresApproval: true,
    fallback: "none",
  },
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

test("videoStrategy HeyGen MCP válido exige OAuth, avatar, voz e fallback none", async () => {
  const root = await makeFixtureRoot({ acme: heygenWorkspace });
  const workspace = await loadWorkspace("acme", root);
  assert.equal(workspace.integrations.heygen?.auth, "oauth");
  assert.equal(workspace.videoStrategy?.provider, "heygen-mcp");
  assert.equal(workspace.videoStrategy?.fallback, "none");
});

test("videoStrategy HeyGen MCP rejeita fallback diferente de none", async () => {
  const root = await makeFixtureRoot({
    acme: { ...heygenWorkspace, videoStrategy: { ...heygenWorkspace.videoStrategy, fallback: "veo" } },
  });
  await assert.rejects(() => loadWorkspace("acme", root), /videoStrategy\.fallback.*none/);
});

test("workspace híbrido aceita nome do secret runtime e providers explícitos", async () => {
  const root = await makeFixtureRoot({
    acme: { ...heygenWorkspace,
      videoStrategy: { ...heygenWorkspace.videoStrategy, provider: "heygen-api", runtimeProviders: { interactive: "heygen-mcp", headless: "heygen-api" } },
      secrets: { required: ["OPENAI_API_KEY"], optional: ["HEYGEN_API_KEY"] } },
  });
  const workspace = await loadWorkspace("acme", root);
  assert.equal(workspace.videoStrategy?.provider, "heygen-api");
  assert.deepEqual(workspace.videoStrategy?.runtimeProviders, { interactive: "heygen-mcp", headless: "heygen-api" });
  assert.deepEqual(workspace.secrets.optional, ["HEYGEN_API_KEY"]);
});

test("workspace rejeita provider headless desconhecido", async () => {
  const root = await makeFixtureRoot({ acme: { ...heygenWorkspace,
    videoStrategy: { ...heygenWorkspace.videoStrategy, runtimeProviders: { headless: "automatic" } } } });
  await assert.rejects(() => loadWorkspace("acme", root), /runtimeProviders.headless/);
});

test("workspace não permite desativar aprovação de vídeo", async () => {
  const root = await makeFixtureRoot({ acme: { ...heygenWorkspace,
    videoStrategy: { ...heygenWorkspace.videoStrategy, requiresApproval: false } } });
  await assert.rejects(() => loadWorkspace("acme", root), /requiresApproval.*true/);
});

test("workspace continua rejeitando fallback REST implícito por secret", async () => {
  const root = await makeFixtureRoot({ acme: { ...heygenWorkspace,
    secrets: { required: [], optional: ["HEYGEN_REST_FALLBACK"] } } });
  await assert.rejects(() => loadWorkspace("acme", root), /HEYGEN_REST_FALLBACK/);
});

test("saveWorkspace mescla uma atualização parcial de uma seção aninhada, preservando os campos irmãos não tocados", async () => {
  const root = await makeFixtureRoot({ acme: baseWorkspace });
  const updated = await saveWorkspace("acme", { brand: { description: "Nova descrição real" } }, root);
  assert.equal(updated.brand.description, "Nova descrição real");
  assert.equal(updated.brand.name, "Acme"); // campo irmão preservado
  assert.equal(updated.brand.toneOfVoice, "t");
});

test("saveWorkspace mescla dois níveis de profundidade sem apagar o resto da subseção", async () => {
  const withSearchConsole = {
    ...heygenWorkspace,
    integrations: { ...heygenWorkspace.integrations, searchConsole: { siteUrl: "sc-domain:a.test", sitemapUrl: "https://a.test/sitemap.xml" } },
  };
  const root = await makeFixtureRoot({ acme: withSearchConsole });
  const patched = await saveWorkspace("acme", { integrations: { searchConsole: { siteUrl: "sc-domain:b.test" } } }, root);
  assert.equal(patched.integrations.searchConsole?.siteUrl, "sc-domain:b.test");
  assert.equal(patched.integrations.searchConsole?.sitemapUrl, "https://a.test/sitemap.xml"); // preservado, não sobrescrito
  assert.equal(patched.integrations.cms.apiUrl, heygenWorkspace.integrations.cms.apiUrl); // seção irmã intacta
});

test("saveWorkspace grava de fato no workspace.json, persistindo entre leituras", async () => {
  const root = await makeFixtureRoot({ acme: baseWorkspace });
  await saveWorkspace("acme", { goals: { monthlyCustomerTarget: 10 } }, root);
  const reloaded = await loadWorkspace("acme", root);
  assert.equal(reloaded.goals.monthlyCustomerTarget, 10);
  const raw = JSON.parse(await readFile(new URL("acme/workspace.json", root), "utf-8"));
  assert.equal(raw.goals.monthlyCustomerTarget, 10);
});

test("saveWorkspace ignora silenciosamente tentativas de mudar id ou secrets", async () => {
  const root = await makeFixtureRoot({ acme: baseWorkspace });
  const updated = await saveWorkspace("acme", { id: "outro-id", secrets: { required: [] } } as never, root);
  assert.equal(updated.id, "acme");
  assert.deepEqual(updated.secrets.required, ["OPENAI_API_KEY"]);
});

test("saveWorkspace rejeita uma atualização que deixaria o workspace inválido, sem gravar nada", async () => {
  const root = await makeFixtureRoot({ acme: baseWorkspace });
  await assert.rejects(() => saveWorkspace("acme", { goals: { primary: "world-domination" } }, root), /goals\.primary/);
  const reloaded = await loadWorkspace("acme", root);
  assert.equal(reloaded.goals.primary, "leads"); // nada foi gravado
});
