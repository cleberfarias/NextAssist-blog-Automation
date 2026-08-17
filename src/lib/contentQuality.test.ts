import assert from "node:assert/strict";
import test from "node:test";
import type { FinalPost } from "../agents/editorSeo.js";
import { validateFinalPost } from "./contentQuality.js";

function validPost(overrides: Partial<FinalPost> = {}): FinalPost {
  return {
    titulo: "Sistema para assistência técnica: como escolher",
    slug: "sistema-assistencia-tecnica",
    resumo: "Veja como escolher um sistema para assistência técnica e organizar ordens de serviço, estoque e atendimento sem depender de planilhas.",
    conteudo: [
      '<p>Um sistema para assistência técnica reduz retrabalho.</p>',
      '<a href="/blog/controle-estoque">Veja como controlar o estoque</a>',
      '<a href="/#funcionalidades">Conheça as funcionalidades</a>',
      '<a href="/demo?utm_source=blog&utm_medium=article&utm_campaign=sistema-assistencia-tecnica&utm_content=cta-inline">Teste grátis por 7 dias</a>',
      '<p>Organize sua operação e acompanhe cada aparelho.</p>',
      '<a href="/demo?utm_source=blog&utm_medium=article&utm_campaign=sistema-assistencia-tecnica&utm_content=cta-final">Comece seu teste grátis</a>',
    ].join(""),
    tags: ["assistência técnica", "gestão"],
    metaTitle: "Sistema para assistência técnica: como escolher",
    metaDescription: "Veja como escolher um sistema para assistência técnica e organizar ordens de serviço, estoque e atendimento sem depender de planilhas.",
    ...overrides,
  };
}

test("aceita CTAs com campanha do artigo e posições distintas", () => {
  assert.doesNotThrow(() =>
    validateFinalPost(validPost(), ["controle-estoque"], {
      palavraChaveAlvo: "sistema para assistência técnica",
      demoPath: "/demo",
    }),
  );
});

test("rejeita CTAs sem atribuição individual", () => {
  const conteudo = validPost().conteudo.replaceAll("cta-final", "cta-inline");
  assert.throws(
    () =>
      validateFinalPost(validPost({ conteudo }), ["controle-estoque"], {
        palavraChaveAlvo: "sistema para assistência técnica",
        demoPath: "/demo",
      }),
    /CTAs precisam identificar posições diferentes/,
  );
});

test("só exige requiredLinks quando o workspace declara a lista", () => {
  const conteudo = validPost().conteudo.replace('<a href="/#funcionalidades">Conheça as funcionalidades</a>', "");
  const options = { palavraChaveAlvo: "sistema para assistência técnica", demoPath: "/demo" };
  assert.doesNotThrow(() => validateFinalPost(validPost({ conteudo }), ["controle-estoque"], options));
  assert.throws(
    () =>
      validateFinalPost(validPost({ conteudo }), ["controle-estoque"], {
        ...options,
        requiredLinks: ["/#funcionalidades"],
      }),
    /precisa conter link para "\/#funcionalidades"/,
  );
});

test("rejeita post que não usa a palavra-chave no título ou meta description", () => {
  assert.throws(
    () =>
      validateFinalPost(
        validPost({
          titulo: "Como organizar melhor sua empresa hoje",
          metaDescription: "Aprenda formas práticas de organizar sua operação, reduzir retrabalho e atender melhor os clientes todos os dias da semana.",
        }),
        ["controle-estoque"],
        { palavraChaveAlvo: "sistema para assistência técnica", demoPath: "/demo" },
      ),
    /palavra-chave alvo/,
  );
});
