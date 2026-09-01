import { useWorkspace } from "../../hooks/useWorkspace";
import { usePipeline } from "../../hooks/usePipeline";

export function Topbar() {
  const { workspace, workspaces, setWorkspace, loading } = useWorkspace();
  const { runMode, running, topicLine, runBlog, runInstagram } = usePipeline();

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-logo">🏢</span>
        <div>
          <h1>Escritório NextAssist</h1>
          <p id="topic-line">{topicLine}</p>
        </div>
      </div>
      <select
        aria-label="Workspace"
        value={workspace}
        disabled={loading}
        onChange={(e) => setWorkspace(e.target.value)}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>{w.name}</option>
        ))}
      </select>
      <div className="pipeline-actions" aria-label="Frentes de conteúdo">
        {runMode !== "disabled" && (
          <button onClick={() => void runBlog()} disabled={running}>
            {running ? "⏳ Blog rodando..." : "▶ Rodar blog"}
          </button>
        )}
        <button className="secondary" onClick={() => void runInstagram()}>📸 Rodar Instagram</button>
      </div>
    </header>
  );
}
