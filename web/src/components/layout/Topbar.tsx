import { useWorkspace } from "../../hooks/useWorkspace";

export function Topbar() {
  const { workspace, workspaces, setWorkspace, loading } = useWorkspace();

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-logo">🏢</span>
        <div>
          <h1>Escritório NextAssist</h1>
          <p id="topic-line">Aguardando o próximo tema...</p>
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
    </header>
  );
}
