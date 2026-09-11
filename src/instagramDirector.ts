import { extractJson, runAgent } from "./lib/anthropic.js";
import { computeAttribution } from "./attribution.js";
import { getInstagramPerformance } from "./instagramPerformance.js";
import { addInstagramTopics, countPendingInstagramTopics, getAllInstagramTopics, type InstagramTopic } from "./instagramCalendar.js";
import { normalizeText, jaccardSimilarity } from "./lib/text.js";
import { emit, type OnEvent } from "./pipelineEvents.js";
import type { WorkspaceContext } from "./context.js";

interface ProposedTopic {
  tema: string;
  pilar: string;
  formato: "reel";
  motivo: string;
}

const MIN_PENDING = 5;
const REPLENISH = 10;
const SIMILARITY = 0.58;

function slug(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export async function ensureInstagramBacklog(ctx: WorkspaceContext, onEvent?: OnEvent): Promise<number> {
  const pending = await countPendingInstagramTopics(ctx);
  if (pending >= MIN_PENDING) return 0;

  emit(onEvent, { agent: "marketing-director", status: "working", message: `Instagram com ${pending} pauta(s) pendente(s) — analisando o que gera venda e engajamento.` });

  const [topics, performance, attribution] = await Promise.all([
    getAllInstagramTopics(ctx),
    getInstagramPerformance(ctx),
    computeAttribution(ctx),
  ]);

  const instagramAttribution = attribution.rows
    .filter((row) => row.channel === "instagram")
    .sort((a, b) => b.customers - a.customers || b.activated - a.activated || b.trials - a.trials)
    .slice(0, 10);

  const engagement = [...performance]
    .sort((a, b) => (b.comments * 4 + b.shares * 3 + b.saved * 2 + b.likes) - (a.comments * 4 + a.shares * 3 + a.saved * 2 + a.likes))
    .slice(0, 10);

  const system = `Você é o Marketing Director de Instagram do ${ctx.workspace.brand.name}.
Produto: ${ctx.workspace.brand.description}
Público: ${ctx.workspace.brand.targetAudience.join(", ")}
Objetivo: vender o NextAssist, começando por 10 clientes reais.
Crie pautas para Reels que gerem conversa comercial com donos de assistência técnica.
Priorize nesta ordem: clientes pagos > ativações > trials > comentários/compartilhamentos/salvamentos > alcance.
Não copie temas existentes. Não crie conteúdo genérico de empreendedorismo, programação ou IA.
Use dores concretas: OS, estoque, peças, prazo, cliente cobrando status, financeiro, margem, garantia, organização da bancada e gestão da equipe.
Misture cinco pilares: dor operacional, demonstração do produto, prova social, objeções de compra e educação prática.
Responda SOMENTE JSON: [{"tema":"...","pilar":"...","formato":"reel","motivo":"..."}].`;

  const prompt = `Gere até ${REPLENISH} próximas pautas.

Já usadas:
${topics.map((t) => `- ${t.tema} [${t.pilar}]`).join("\n") || "(nenhuma)"}

Resultados comerciais dos conteúdos de Instagram:
${instagramAttribution.map((r) => `- ${r.tema}: ${r.customers} cliente(s), ${r.activated} ativado(s), ${r.trials} trial(s), ${r.visits} visita(s)`).join("\n") || "(ainda sem conversões atribuídas)"}

Engajamento dos Reels:
${engagement.map((r) => `- ${r.tema}: ${r.comments} comentários, ${r.shares} compartilhamentos, ${r.saved} salvamentos, ${r.likes} curtidas, alcance ${r.reach}`).join("\n") || "(ainda sem métricas)"}

Quando não houver dados suficientes, explore dores diferentes para aprender mais rápido. Quando houver vencedor comercial, crie variações do ângulo sem repetir o mesmo gancho.`;

  const proposed = extractJson<ProposedTopic[]>(await runAgent(ctx, { system, prompt, maxTokens: 2500 }));
  if (!Array.isArray(proposed)) throw new Error("Marketing Director do Instagram retornou formato inválido.");

  const accepted: InstagramTopic[] = [];
  for (const item of proposed) {
    if (!item?.tema?.trim() || item.formato !== "reel" || !item.pilar?.trim()) continue;
    const duplicate = topics.some((t) => jaccardSimilarity(t.tema, item.tema) >= SIMILARITY)
      || accepted.some((t) => jaccardSimilarity(t.tema, item.tema) >= SIMILARITY);
    if (duplicate) continue;
    const baseId = slug(item.tema) || `reel-${Date.now()}`;
    accepted.push({ id: baseId, tema: item.tema.trim(), pilar: item.pilar.trim(), formato: "reel", publicado: false, criadoEm: new Date().toISOString() });
    if (accepted.length >= REPLENISH) break;
  }

  await addInstagramTopics(ctx, accepted);
  emit(onEvent, { agent: "marketing-director", status: "done", message: `${accepted.length} nova(s) pauta(s) comerciais adicionada(s) ao Instagram.` });
  return accepted.length;
}
