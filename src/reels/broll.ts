/**
 * Catálogo dos vídeos de B-roll reais do NextAssist já armazenados como
 * assets na HeyGen — confirmado por chamada real e somente-leitura
 * (`get_asset`) a cada `assetId` antes de qualquer implementação, não
 * inferido. Usado pelo Studio multi-cena (`studioScenes.ts`) para intercalar
 * o avatar com telas reais do produto, seguindo o padrão do vídeo de
 * referência `b01f896ff2834a4f1d4b7e5a07e3d02d`.
 */
export interface BrollAsset {
  assetId: string;
  label: string;
  keywords: string[];
}

export const NEXTASSIST_BROLL: readonly BrollAsset[] = [
  { assetId: "4beb92ff4a39403389f636f2963c5e88", label: "Simulação RR Info", keywords: ["simulação", "sistema", "rr info", "plataforma"] },
  { assetId: "ed6e56e360f94998ba68c704b2316aaf", label: "Salvando a OS", keywords: ["ordem de serviço", "os", "salvar", "salvando"] },
  { assetId: "eb2eeff63cce403e889e6daa852b2055", label: "Aprovação de manutenção", keywords: ["aprovação", "aprovar", "manutenção", "orçamento"] },
  { assetId: "dde5b26d17bb44fbacbf81e280f53dce", label: "Cadastrar produto", keywords: ["produto", "cadastrar", "cadastro", "estoque", "peça", "peças"] },
  { assetId: "d44b64c94aee4a59b0e3604171a7257a", label: "Em análise manutenção", keywords: ["análise", "manutenção", "diagnóstico", "avaliação"] },
  { assetId: "a57085f1b24243079df14ec23f6b13bf", label: "Cadastrando cliente", keywords: ["cliente", "cadastro", "cadastrando", "atendimento"] },
  { assetId: "8d08e75c81d34ea3b066d2db18ed72c5", label: "Fechamento de OS", keywords: ["fechamento", "fechar", "entrega", "os", "ordem de serviço"] },
] as const;

/**
 * Escolhe 4 assets distintos do catálogo, pontuando por overlap de palavra
 * entre título/tags do post e as keywords de cada asset. 100% determinístico:
 * mesmo post sempre produz a mesma seleção, na mesma ordem — sem
 * aleatoriedade, mesmo quando nenhum asset tem relevância (cai no desempate
 * fixo pela ordem do catálogo).
 */
export function selectBrollForPost(post: { titulo: string; tags: string[] }): BrollAsset[] {
  const haystack = `${post.titulo} ${post.tags.join(" ")}`.toLowerCase();
  const scored = NEXTASSIST_BROLL.map((asset, index) => ({
    asset,
    index,
    score: asset.keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword.toLowerCase()) ? 1 : 0), 0),
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, 4).map((entry) => entry.asset);
}
