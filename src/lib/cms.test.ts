import assert from "node:assert/strict";
import test from "node:test";
import { createNextAssistCmsProvider } from "./cms.js";

test("createPost faz POST em <apiUrl>/blog/admin/posts com o idToken e devolve slug/id", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ data: { id: "abc123", slug: "meu-post" } }), { status: 200 });
  };

  const cms = createNextAssistCmsProvider("https://api.test", { fetchImpl: fakeFetch, getIdToken: async () => "token-xyz" });
  const result = await cms.createPost({
    titulo: "T", slug: "meu-post", resumo: "R", conteudo: "<p>c</p>",
    imagemCapa: "https://img.test/x.jpg", autor: "Acme", tags: ["a"],
    publicado: true, metaTitle: "MT", metaDescription: "MD",
  });

  assert.deepEqual(result, { id: "abc123", slug: "meu-post" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.test/blog/admin/posts");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer token-xyz");
});

test("createPost lança erro com a mensagem da API quando a resposta não é ok", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: { message: "slug duplicado" } }), { status: 409 });
  const cms = createNextAssistCmsProvider("https://api.test", { fetchImpl: fakeFetch, getIdToken: async () => "t" });

  await assert.rejects(
    () => cms.createPost({
      titulo: "T", slug: "s", resumo: "R", conteudo: "c", imagemCapa: "i",
      autor: "A", tags: [], publicado: true, metaTitle: "MT", metaDescription: "MD",
    }),
    /slug duplicado/,
  );
});
