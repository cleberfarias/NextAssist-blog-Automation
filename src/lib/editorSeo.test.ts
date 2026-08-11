import assert from "node:assert/strict";
import test from "node:test";
import { ensureTrackedCtas, type FinalPost } from "../agents/editorSeo.js";

test("completa CTAs ausentes sem nova chamada de IA", () => {
  const post = { slug: "artigo-teste", conteudo: '<p>Conteúdo <a href="/#funcionalidades">Funcionalidades</a></p>' } as FinalPost;
  const result = ensureTrackedCtas(post);
  assert.match(result.conteudo, /utm_content=cta-inline/);
  assert.match(result.conteudo, /utm_content=cta-final/);
  assert.equal(ensureTrackedCtas(result), result);
});
