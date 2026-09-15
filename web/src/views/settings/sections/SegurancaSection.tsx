import { ReadOnlyField } from "../FormFields";
import type { WorkspaceConfig } from "../../../types/api";

export function SegurancaSection({ draft }: { draft: WorkspaceConfig }) {
  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-sm font-semibold text-primary">Segurança</h2>
      <ReadOnlyField label="Credenciais obrigatórias" value={`${draft.secrets.required.length} chave(s) — configuradas via variável de ambiente do servidor`} />
      <ReadOnlyField label="Credenciais opcionais" value={`${draft.secrets.optional?.length ?? 0} chave(s)`} />
      {draft.videoStrategy ? (
        <ReadOnlyField label="Publicação de Reels" value="Todo vídeo gerado passa por aprovação humana antes de ir ao ar — exigido pelo sistema, não pode ser desativado." />
      ) : null}
      <ReadOnlyField label="Modo de autonomia atual" value={draft.autonomy.mode} />
      <p className="text-xs text-secondary">
        Para ver quais credenciais estão configuradas ou faltando, acesse a aba Integrações.
      </p>
    </div>
  );
}
