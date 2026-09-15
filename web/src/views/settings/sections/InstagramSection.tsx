import { ToggleField, NumberField, CheckboxGroup, ReadOnlyField } from "../FormFields";
import type { WorkspaceConfig } from "../../../types/api";

const FORMAT_OPTIONS = [
  { value: "reel", label: "Reel" },
  { value: "carrossel", label: "Carrossel" },
  { value: "story", label: "Story" },
];

export function InstagramSection({ draft, update }: { draft: WorkspaceConfig; update: (patch: Record<string, unknown>) => void }) {
  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-sm font-semibold text-primary">Instagram</h2>
      <ToggleField label="Canal do Instagram ativo" checked={draft.channels.instagram} onChange={(instagram) => update({ channels: { instagram } })} />

      {draft.instagramStrategy ? (
        <>
          <NumberField
            label="Frequência de posts por semana"
            min={1}
            value={draft.instagramStrategy.frequencyPerWeek}
            onChange={(frequencyPerWeek) => update({ instagramStrategy: { frequencyPerWeek } })}
          />
          <CheckboxGroup
            label="Formatos preferidos"
            options={FORMAT_OPTIONS}
            selected={draft.instagramStrategy.preferredFormats}
            onChange={(preferredFormats) => update({ instagramStrategy: { preferredFormats } })}
          />
        </>
      ) : (
        <p className="text-sm text-secondary">Estratégia de Instagram ainda não configurada para este workspace.</p>
      )}

      {draft.integrations.instagram ? (
        <ReadOnlyField label="Versão da API do Instagram" value={draft.integrations.instagram.apiVersion} />
      ) : null}
    </div>
  );
}
