import { SelectField, NumberField } from "../FormFields";
import type { WorkspaceConfig } from "../../../types/api";

const AUTONOMY_OPTIONS = [
  { value: "copilot" as const, label: "Copiloto — sugere, você aprova cada etapa" },
  { value: "semi-autonomous" as const, label: "Semiautônomo — executa sozinho, aprova pontos críticos" },
  { value: "autonomous" as const, label: "Autônomo — executa sozinho" },
];

const FALLBACK_OPTIONS = [
  { value: "none" as const, label: "Nenhum" },
  { value: "openai" as const, label: "OpenAI" },
  { value: "anthropic" as const, label: "Anthropic" },
];

export function AgentesSection({ draft, update }: { draft: WorkspaceConfig; update: (patch: Record<string, unknown>) => void }) {
  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-sm font-semibold text-primary">Agentes</h2>
      <SelectField
        label="Modo de autonomia"
        value={draft.autonomy.mode}
        options={AUTONOMY_OPTIONS}
        onChange={(mode) => update({ autonomy: { mode } })}
      />
      <SelectField
        label="Provider de IA de fallback"
        value={draft.aiFallbackProvider ?? "none"}
        options={FALLBACK_OPTIONS}
        onChange={(aiFallbackProvider) => update({ aiFallbackProvider })}
      />
      {draft.contentStrategy ? (
        <>
          <NumberField
            label="Mínimo de pautas pendentes no backlog"
            min={1}
            value={draft.contentStrategy.minimumPendingTopics}
            onChange={(minimumPendingTopics) => update({ contentStrategy: { minimumPendingTopics } })}
          />
          <NumberField
            label="Pautas geradas ao reabastecer o backlog"
            min={1}
            value={draft.contentStrategy.replenishAmount}
            onChange={(replenishAmount) => update({ contentStrategy: { replenishAmount } })}
          />
        </>
      ) : (
        <p className="text-sm text-secondary">Estratégia de conteúdo ainda não configurada para este workspace.</p>
      )}
    </div>
  );
}
