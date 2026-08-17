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
