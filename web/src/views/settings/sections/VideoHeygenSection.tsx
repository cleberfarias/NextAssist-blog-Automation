import { SelectField, ToggleField, ReadOnlyField } from "../FormFields";
import type { WorkspaceConfig } from "../../../types/api";

const FORMAT_OPTIONS = [
  { value: "9:16" as const, label: "9:16 (vertical, Reels)" },
  { value: "16:9" as const, label: "16:9 (horizontal)" },
];

export function VideoHeygenSection({ draft, update }: { draft: WorkspaceConfig; update: (patch: Record<string, unknown>) => void }) {
  if (!draft.videoStrategy) {
    return (
      <div className="max-w-xl">
        <h2 className="text-sm font-semibold text-primary">Vídeo / HeyGen</h2>
        <p className="mt-3 text-sm text-secondary">Geração de vídeo ainda não configurada para este workspace.</p>
      </div>
    );
  }
  const { videoStrategy } = draft;

  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-sm font-semibold text-primary">Vídeo / HeyGen</h2>
      <ReadOnlyField label="Provider" value={videoStrategy.provider === "heygen-mcp" ? "HeyGen (MCP/OAuth)" : "HeyGen (API)"} />
      <ReadOnlyField label="Avatar" value={videoStrategy.avatarId} />
      <ReadOnlyField label="Voz" value={videoStrategy.voiceId} />
      {videoStrategy.brandKitId ? <ReadOnlyField label="Brand kit" value={videoStrategy.brandKitId} /> : null}
      <p className="text-xs text-secondary">Avatar, voz e brand kit são geridos direto no HeyGen — mudar o ID aqui poderia quebrar a geração de Reels, por isso ficam só como leitura.</p>

      <SelectField label="Formato" value={videoStrategy.format} options={FORMAT_OPTIONS} onChange={(format) => update({ videoStrategy: { format } })} />
      <ToggleField label="Trilha sonora" checked={videoStrategy.music} onChange={(music) => update({ videoStrategy: { music } })} />
      <ReadOnlyField label="Aprovação antes de publicar" value="Sempre exigida — não pode ser desativada" />
    </div>
  );
}
