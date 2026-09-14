import assert from "node:assert/strict";
import test from "node:test";
import { NEXTASSIST_BROLL, selectBrollForPost } from "./broll.js";

const KNOWN_ASSET_IDS = [
  "4beb92ff4a39403389f636f2963c5e88",
  "ed6e56e360f94998ba68c704b2316aaf",
  "eb2eeff63cce403e889e6daa852b2055",
  "dde5b26d17bb44fbacbf81e280f53dce",
  "d44b64c94aee4a59b0e3604171a7257a",
  "a57085f1b24243079df14ec23f6b13bf",
  "8d08e75c81d34ea3b066d2db18ed72c5",
];

test("catálogo tem exatamente os 7 assets reais confirmados via get_asset, nenhum inventado", () => {
  assert.deepEqual(NEXTASSIST_BROLL.map((a) => a.assetId).sort(), [...KNOWN_ASSET_IDS].sort());
});

test("selectBrollForPost sempre retorna 4 assets distintos", () => {
  const result = selectBrollForPost({ titulo: "Qualquer coisa genérica", tags: [] });
  assert.equal(result.length, 4);
  assert.equal(new Set(result.map((a) => a.assetId)).size, 4);
});

test("selectBrollForPost é determinístico — mesma entrada, mesma saída sempre", () => {
  const post = { titulo: "Como organizar a ordem de serviço da sua assistência", tags: ["ordem de serviço", "gestão"] };
  const first = selectBrollForPost(post);
  const second = selectBrollForPost(post);
  assert.deepEqual(first.map((a) => a.assetId), second.map((a) => a.assetId));
});

test("selectBrollForPost prioriza assets cujas keywords batem com o tema do post", () => {
  const result = selectBrollForPost({
    titulo: "Como fazer o fechamento da ordem de serviço sem perder cliente",
    tags: ["fechamento de os", "cliente"],
  });
  const ids = result.map((a) => a.assetId);
  // "fechamento de OS" e "cadastrando cliente" têm match direto de keyword — devem entrar entre os 4 escolhidos.
  assert.ok(ids.includes("8d08e75c81d34ea3b066d2db18ed72c5"), "esperava o asset de fechamento de OS entre os selecionados");
  assert.ok(ids.includes("a57085f1b24243079df14ec23f6b13bf"), "esperava o asset de cadastro de cliente entre os selecionados");
});

test("selectBrollForPost sem nenhum match relevante ainda completa com 4 assets do catálogo, sem aleatoriedade", () => {
  const post = { titulo: "xyz completamente fora do domínio", tags: ["abc123"] };
  const first = selectBrollForPost(post);
  const second = selectBrollForPost(post);
  assert.equal(first.length, 4);
  assert.deepEqual(first.map((a) => a.assetId), second.map((a) => a.assetId));
});
