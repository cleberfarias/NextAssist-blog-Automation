import { TextField, TextAreaField, NumberField, CheckboxGroup } from "../FormFields";
import type { WorkspaceConfig } from "../../../types/api";

const PILLAR_OPTIONS = [
  { value: "dor operacional", label: "Dor operacional" },
  { value: "demonstração do produto", label: "Demonstração do produto" },
  { value: "bastidores", label: "Bastidores" },
  { value: "educação prática", label: "Educação prática" },
  { value: "prova social", label: "Prova social" },
];

export function WorkspaceSection({ draft, update }: { draft: WorkspaceConfig; update: (patch: Record<string, unknown>) => void }) {
  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-sm font-semibold text-primary">Workspace</h2>
      <TextField label="Nome" value={draft.brand.name} onChange={(name) => update({ brand: { name } })} />
      <TextAreaField label="Descrição" value={draft.brand.description} onChange={(description) => update({ brand: { description } })} />
      <TextField label="Site" type="url" value={draft.integrations.siteUrl} onChange={(siteUrl) => update({ integrations: { siteUrl } })} />
      <NumberField
        label="Meta de clientes/mês"
        min={0}
        value={draft.goals.monthlyCustomerTarget}
        onChange={(monthlyCustomerTarget) => update({ goals: { monthlyCustomerTarget } })}
      />
      <CheckboxGroup
        label="Pilares de conteúdo"
        options={PILLAR_OPTIONS}
        selected={draft.instagramStrategy?.pillars ?? []}
        onChange={(pillars) => update({ instagramStrategy: { pillars } })}
      />
    </div>
  );
}
