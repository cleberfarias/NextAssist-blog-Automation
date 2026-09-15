import { useWorkspace } from "../../hooks/useWorkspace";
import { usePipeline } from "../../hooks/usePipeline";

export function Topbar() {
  const { workspace, workspaces, setWorkspace, loading } = useWorkspace();
  const { runMode, running, topicLine, runBlog, runInstagram } = usePipeline();

  return (
    <header className="topbar flex items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3">
      <div className="brand flex items-center gap-3">
        <span className="brand-logo text-2xl" aria-hidden="true">🏢</span>
        <div>
          <h1 className="text-base font-semibold text-primary">Escritório NextAssist</h1>
          <p id="topic-line" className="text-xs text-secondary">{topicLine}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-xs text-status-ok">
          <span className="h-2 w-2 rounded-full bg-status-ok" aria-hidden="true" />
          Sistema operacional
        </span>
        <select
          aria-label="Workspace"
          value={workspace}
          disabled={loading}
          onChange={(e) => setWorkspace(e.target.value)}
          className="rounded-md border border-border bg-app px-2 py-1 text-sm text-primary"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <div className="pipeline-actions flex gap-2" aria-label="Frentes de conteúdo">
          {runMode !== "disabled" && (
            <button id="run-blog-btn" onClick={() => void runBlog()} disabled={running} className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {running ? "⏳ Blog rodando..." : "▶ Rodar blog"}
            </button>
          )}
          <button className="secondary rounded-md border border-border px-3 py-1.5 text-sm text-primary" onClick={() => void runInstagram()}>📸 Rodar Instagram</button>
        </div>
      </div>
    </header>
  );
}
