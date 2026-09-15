import { useEffect, useState } from "react";
import { useWorkspace } from "../../../hooks/useWorkspace";
import { apiGet } from "../../../lib/api";
import { TextField } from "../FormFields";
import type { WorkspaceConfig, SecretStatus } from "../../../types/api";

function SecretRow({ status }: { status: SecretStatus }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border py-2 text-sm first:border-t-0">
      <span className="text-primary">
        {status.key}
        {status.required ? <span className="ml-2 text-[10px] text-secondary">obrigatória</span> : <span className="ml-2 text-[10px] text-secondary">opcional</span>}
      </span>
      <span className={`flex items-center gap-1.5 text-xs font-semibold ${status.configured ? "text-status-ok" : "text-status-error"}`}>
        <span className={`h-2 w-2 rounded-full ${status.configured ? "bg-status-ok" : "bg-status-error"}`} aria-hidden="true" />
        {status.configured ? "Configurada" : "Faltando"}
      </span>
    </div>
  );
}

export function IntegracoesSection({ draft, update }: { draft: WorkspaceConfig; update: (patch: Record<string, unknown>) => void }) {
  const { workspace } = useWorkspace();
  const [secretsStatus, setSecretsStatus] = useState<SecretStatus[] | null>(null);
  const envPrefix = workspace ? workspace.toUpperCase().replace(/-/g, "_") : "SEU_WORKSPACE";

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<SecretStatus[]>("/api/workspace/secrets-status", workspace, controller.signal)
      .then(setSecretsStatus)
      .catch((err) => { if ((err as Error).name !== "AbortError") setSecretsStatus(null); });
    return () => controller.abort();
  }, [workspace]);

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-primary">Chaves de API e credenciais</h2>
        <p className="mt-1 text-xs text-secondary">
          Chaves de API não ficam neste formulário — são configuradas como variável de ambiente do servidor
          (ex: <code className="text-accent">{envPrefix}_OPENAI_API_KEY</code>). Aqui você só confere se cada uma já está configurada.
        </p>
        {!secretsStatus ? (
          <p className="mt-3 text-sm text-secondary">Aguardando dados</p>
        ) : (
          <div className="mt-3 rounded-lg border border-border bg-surface p-3">
            {secretsStatus.map((s) => <SecretRow key={s.key} status={s} />)}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-primary">URLs de integração</h2>
        <TextField label="URL da API do CMS" value={draft.integrations.cms.apiUrl} onChange={(apiUrl) => update({ integrations: { cms: { apiUrl } } })} />
        <TextField
          label="Google Search Console — propriedade"
          placeholder="sc-domain:seusite.com.br"
          value={draft.integrations.searchConsole?.siteUrl ?? ""}
          onChange={(siteUrl) => update({ integrations: { searchConsole: { siteUrl } } })}
        />
        <TextField
          label="Google Search Console — sitemap"
          type="url"
          value={draft.integrations.searchConsole?.sitemapUrl ?? ""}
          onChange={(sitemapUrl) => update({ integrations: { searchConsole: { sitemapUrl } } })}
        />
      </div>
    </div>
  );
}
