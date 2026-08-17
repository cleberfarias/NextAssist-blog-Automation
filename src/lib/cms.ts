export interface CreatePostInput {
  titulo: string;
  slug: string;
  resumo: string;
  conteudo: string;
  imagemCapa: string;
  autor: string;
  tags: string[];
  publicado: boolean;
  metaTitle: string;
  metaDescription: string;
}

export interface PostResult {
  id: string;
  slug: string;
}

/** Abstração de CMS: cada provider (NextAssist, WordPress, ...) implementa isto. */
export interface CmsProvider {
  createPost(input: CreatePostInput): Promise<PostResult>;
}

interface NextAssistCmsOptions {
  fetchImpl?: typeof fetch;
  getIdToken: () => Promise<string>;
}

/**
 * Único provider implementado nesta fase: publica no CMS próprio do
 * NextAssist. `getIdToken` é injetado (em vez de importado direto de
 * `firebaseAuth.ts`) para manter este módulo sem dependência de `config.ts`.
 */
export function createNextAssistCmsProvider(apiUrl: string, options: NextAssistCmsOptions): CmsProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async createPost(input: CreatePostInput): Promise<PostResult> {
      const idToken = await options.getIdToken();
      const res = await fetchImpl(`${apiUrl}/blog/admin/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(`Falha ao publicar post: ${err?.error?.message ?? res.statusText}`);
      }

      const data = (await res.json()) as { data: { id: string; slug: string } };
      return { id: data.data.id, slug: data.data.slug };
    },
  };
}
