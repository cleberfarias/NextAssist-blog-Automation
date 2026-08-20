// src/lib/marketingDirector.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseContentOpportunities } from "./marketingDirector.js";

test("aceita um array válido de oportunidades", () => {
  const raw = [
    { tema: "T", palavraChaveAlvo: "k", reason: "r", priority: "high", source: "search-console" },
  ];
  const result = parseContentOpportunities(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].tema, "T");
});

test("array vazio é válido (nenhuma oportunidade identificada)", () => {
  assert.deepEqual(parseContentOpportunities([]), []);
});

test("descarta itens com priority ou source fora do enum, mantendo os válidos", () => {
  const raw = [
    { tema: "T1", palavraChaveAlvo: "k1", reason: "r", priority: "urgent", source: "other" },
    { tema: "T2", palavraChaveAlvo: "k2", reason: "r", priority: "high", source: "made-up" },
    { tema: "T3", palavraChaveAlvo: "k3", reason: "r", priority: "low", source: "content-gap" },
  ];
  const result = parseContentOpportunities(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].tema, "T3");
});

test("descarta itens com tema ou palavraChaveAlvo vazios/ausentes", () => {
  const raw = [
    { tema: "", palavraChaveAlvo: "k", reason: "r", priority: "high", source: "other" },
    { palavraChaveAlvo: "k", reason: "r", priority: "high", source: "other" },
    { tema: "T", palavraChaveAlvo: "k", reason: "r", priority: "high", source: "other" },
  ];
  const result = parseContentOpportunities(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].tema, "T");
});

test("lança erro quando a resposta não é um array", () => {
  assert.throws(() => parseContentOpportunities({ tema: "T" }), /lista de oportunidades/);
});

test("lança erro quando uma lista não vazia não tem nenhum item válido", () => {
  assert.throws(
    () => parseContentOpportunities([{ tema: "", palavraChaveAlvo: "k", reason: "r", priority: "high", source: "other" }]),
    /nenhuma/i,
  );
});

import { buildPrompt, SYSTEM_TEMPLATE } from "./marketingDirector.js";
import { MIN_TRIALS_FOR_RATE } from "../attribution.js";

const baseWorkspace = {
  id: "acme", name: "Acme", active: true,
  brand: { name: "Acme", description: "d", toneOfVoice: "t", targetAudience: [], competitors: [], forbiddenTerms: [] },
  goals: { primary: "leads" as const },
  channels: { blog: true, instagram: false, linkedin: false },
  integrations: { siteUrl: "https://acme.test", cms: { provider: "nextassist" as const, apiUrl: "https://api.acme.test" } },
  autonomy: { mode: "copilot" as const },
  secrets: { required: [] },
};

test("buildPrompt prioriza clientes > ativados > trials > visitas", () => {
  const ctx = { workspace: baseWorkspace } as any;
  const prompt = buildPrompt(
    ctx,
    { count: 5, existingThemes: [], existingKeywords: [], publishedTitles: [] },
    null,
    {
      rows: [
        { contentId: "post-a", campaignId: null, tema: "Precificação", channel: "blog", formato: "blog", funnelStage: "fundo", visits: 240, trials: 21, signups: 18, activated: 13, customers: 4, visitToTrialRate: 0.09, trialToActivationRate: 0.62, activationToCustomerRate: 0.31, rateReliable: true },
        { contentId: "post-b", campaignId: null, tema: "Agência com IA", channel: "instagram", formato: "instagram-reel", funnelStage: "topo", visits: 1800, trials: 7, signups: 1, activated: 1, customers: 0, visitToTrialRate: 0.003, trialToActivationRate: 0.2, activationToCustomerRate: 0, rateReliable: true },
      ],
      unattributedEvents: 0,
    },
    [],
  );
  assert.match(prompt, /clientes/i);
  assert.match(prompt, /post-a/);
  const posA = prompt.indexOf("post-a");
  const posB = prompt.indexOf("post-b");
  assert.ok(posA < posB, "post-a (4 clientes) deve aparecer antes de post-b (0 clientes) na lista priorizada");
});

test("SYSTEM_TEMPLATE cita MIN_TRIALS_FOR_RATE deterministicamente — o LLM é instruído, não adivinha", () => {
  const ctx = { workspace: baseWorkspace } as any;
  const system = SYSTEM_TEMPLATE(ctx);
  assert.match(system, new RegExp(`${MIN_TRIALS_FOR_RATE}`), "o valor numérico precisa aparecer no texto que vai pro LLM");
  assert.match(system, /amostra insuficiente/i, "a regra de confiabilidade precisa estar em linguagem explícita, não implícita");
});
