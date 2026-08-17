// src/lib/text.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeText, jaccardSimilarity } from "./text.js";

test("normalizeText remove acentos, baixa a caixa e tira espaços nas pontas", () => {
  assert.equal(normalizeText("  Atendimento via WhatsApp  "), "atendimento via whatsapp");
  assert.equal(normalizeText("Programação e Gestão"), "programacao e gestao");
});

test("jaccardSimilarity é 1 para textos idênticos após normalização", () => {
  assert.equal(jaccardSimilarity("Estoque de Celular", "estoque de   celular"), 1);
});

test("jaccardSimilarity é 0 quando não há nenhum termo em comum", () => {
  assert.equal(jaccardSimilarity("Estoque de celular", "Marketing digital hoje"), 0);
});

test("jaccardSimilarity fica alta para reformulações do mesmo tema", () => {
  const score = jaccardSimilarity(
    "Atendimento via WhatsApp: como organizar o fluxo sem perder cliente",
    "Como organizar o atendimento via WhatsApp sem perder cliente",
  );
  assert.ok(score >= 0.6, `esperado >= 0.6, recebido ${score}`);
});

test("jaccardSimilarity com string vazia é 0", () => {
  assert.equal(jaccardSimilarity("", "qualquer coisa"), 0);
  assert.equal(jaccardSimilarity("qualquer coisa", ""), 0);
});
