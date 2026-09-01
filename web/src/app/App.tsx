import { useState } from "react";
import { WorkspaceProvider } from "../hooks/useWorkspace";
import { ToastProvider } from "../components/ui/Toast";
import { Sidebar } from "../components/layout/Sidebar";
import { Topbar } from "../components/layout/Topbar";
import { PainelView } from "../views/dashboard/PainelView";
import { ConfigView } from "../views/settings/ConfigView";

type View = "painel" | "config";

export default function App() {
  const [view, setView] = useState<View>("painel");

  return (
    <WorkspaceProvider>
      <ToastProvider>
        <div className="app-shell">
          <Sidebar active={view} onSelect={setView} />
          <div className="app-main">
            <Topbar />
            {view === "painel" ? <PainelView /> : <ConfigView />}
          </div>
        </div>
      </ToastProvider>
    </WorkspaceProvider>
  );
}
