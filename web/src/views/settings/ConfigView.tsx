import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useToast } from "../../components/ui/Toast";
import { apiGet, apiPatch } from "../../lib/api";
import { deepMerge } from "../../lib/deepMerge";
import { WorkspaceSection } from "./sections/WorkspaceSection";
import { IntegracoesSection } from "./sections/IntegracoesSection";
import { AgentesSection } from "./sections/AgentesSection";
import { NotificacoesSection } from "./sections/NotificacoesSection";
import { VideoHeygenSection } from "./sections/VideoHeygenSection";
import { InstagramSection } from "./sections/InstagramSection";
import { SegurancaSection } from "./sections/SegurancaSection";
import type { WorkspaceConfig } from "../../types/api";

type Section = "workspace" | "integracoes" | "agentes" | "notificacoes" | "video-heygen" | "instagram" | "seguranca";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "integracoes", label: "Integrações" },
  { id: "agentes", label: "Agentes" },
  { id: "notificacoes", label: "Notificações" },
  { id: "video-heygen", label: "Vídeo/HeyGen" },
  { id: "instagram", label: "Instagram" },
  { id: "seguranca", label: "Segurança" },
];

export function ConfigView() {
  const { workspace } = useWorkspace();
  const { showToast } = useToast();
  const [section, setSection] = useState<Section>("workspace");
  const [saved, setSaved] = useState<WorkspaceConfig | null>(null);
  const [draft, setDraft] = useState<WorkspaceConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<WorkspaceConfig>("/api/workspace", workspace, controller.signal, "Não foi possível carregar as configurações.")
      .then((data) => { setSaved(data); setDraft(data); })
      .catch((err) => { if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error"); });
    return () => controller.abort();
  }, [workspace, showToast]);

  function update(patch: Record<string, unknown>) {
    setDraft((prev) => (prev ? deepMerge(prev, patch) : prev));
  }

  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));

  async function save() {
    if (!workspace || !draft) return;
    setSaving(true);
    try {
      const updated = await apiPatch<WorkspaceConfig>("/api/workspace", { workspaceId: workspace, updates: draft }, undefined, "Não foi possível salvar as configurações.");
      setSaved(updated);
      setDraft(updated);
      showToast("Configurações salvas.", "success");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 text-primary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Configurações</h1>
          <p className="text-sm text-secondary">Ajuste seu workspace e integrações</p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>

      {!draft ? (
        <p className="mt-6 text-sm text-secondary">Aguardando dados</p>
      ) : (
        <div className="mt-6 flex flex-col gap-6 sm:flex-row">
          <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto sm:w-44 sm:flex-col" aria-label="Seções de configurações">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-current={section === s.id}
                onClick={() => setSection(s.id)}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-left text-sm ${section === s.id ? "bg-accent text-white" : "text-secondary hover:bg-surface hover:text-primary"}`}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1">
            {section === "workspace" ? <WorkspaceSection draft={draft} update={update} /> : null}
            {section === "integracoes" ? <IntegracoesSection draft={draft} update={update} /> : null}
            {section === "agentes" ? <AgentesSection draft={draft} update={update} /> : null}
            {section === "notificacoes" ? <NotificacoesSection /> : null}
            {section === "video-heygen" ? <VideoHeygenSection draft={draft} update={update} /> : null}
            {section === "instagram" ? <InstagramSection draft={draft} update={update} /> : null}
            {section === "seguranca" ? <SegurancaSection draft={draft} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}
