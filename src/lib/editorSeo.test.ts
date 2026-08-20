import assert from "node:assert/strict";
import test from "node:test";
import { ensureTrackedCtas, type FinalPost } from "../agents/editorSeo.js";

test("completa CTAs ausentes sem nova chamada de IA — utm_content é o contentId (slug), cta_id identifica a posição", () => {
  const post = { slug: "artigo-teste", conteudo: '<p>Conteúdo <a href="/#funcionalidades">Funcionalidades</a></p>' } as FinalPost;
  const result = ensureTrackedCtas(post);
  assert.match(result.conteudo, /utm_content=artigo-teste/);
  assert.match(result.conteudo, /utm_campaign=sem-campanha/);
  assert.match(result.conteudo, /cta_id=cta-inline/);
  assert.match(result.conteudo, /cta_id=cta-final/);
  assert.equal(ensureTrackedCtas(result), result);
});

test("usa campaignId quando informado", () => {
  const post = { slug: "artigo-teste", conteudo: "<p>Conteúdo</p>" } as FinalPost;
  const result = ensureTrackedCtas(post, { campaignId: "serie-precificacao-2026-08" });
  assert.match(result.conteudo, /utm_campaign=serie-precificacao-2026-08/);
  assert.match(result.conteudo, /utm_content=artigo-teste/);
});
