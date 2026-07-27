import { config } from "../config.js";
import { getBlogAdminIdToken } from "../lib/firebaseAuth.js";

interface AdminPost {
  id: string;
  slug: string;
}

const updates = [
  {
    slug: "garantia-conserto-celular-o-que-a-lei-exige",
    metaTitle: "Garantia de Conserto de Celular: os 90 Dias que Você Precisa Cumprir",
    metaDescription:
      "O CDC exige garantia de 90 dias em conserto de celular. Veja o que é obrigatório, o que não é coberto e como estruturar isso na sua assistência sem prejuízo.",
  },
  {
    slug: "como-abrir-uma-assistencia-tecnica-de-celular-guia-completo-2026",
    metaTitle: "Como Abrir uma Assistência Técnica de Celular em 2026: Passo a Passo e Custos",
    metaDescription:
      "Quanto custa abrir uma assistência técnica de celular, o que é obrigatório por lei e os erros mais caros de quem está começando. Guia completo 2026.",
  },
] as const;

async function request<T>(
  path: string,
  idToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.blogApiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method ?? "GET"} ${path} falhou (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}

const idToken = await getBlogAdminIdToken();
const list = await request<{ data: AdminPost[] }>("/blog/admin/posts", idToken);

for (const update of updates) {
  const post = list.data.find((candidate) => candidate.slug === update.slug);
  if (!post) {
    throw new Error(`Post não encontrado: ${update.slug}`);
  }

  await request(`/blog/admin/posts/${encodeURIComponent(post.id)}`, idToken, {
    method: "PUT",
    body: JSON.stringify({
      metaTitle: update.metaTitle,
      metaDescription: update.metaDescription,
    }),
  });
  console.log(`SEO atualizado: ${update.slug}`);
}
