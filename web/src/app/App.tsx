import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { WorkspaceProvider } from "../hooks/useWorkspace";
import { PipelineProvider } from "../hooks/usePipeline";
import { ToastProvider } from "../components/ui/Toast";
import { Sidebar } from "../components/layout/Sidebar";
import { Topbar } from "../components/layout/Topbar";
import { ConfigView } from "../views/settings/ConfigView";
import { ReelApprovalPanel } from "../views/dashboard/ReelApprovalPanel";
import { HistoryPanel } from "../views/dashboard/HistoryPanel";
import { SalesPanel } from "../views/dashboard/SalesPanel";
import { ReelDetailPage } from "../views/reels/ReelDetailPage";
import { ConteudoPage } from "../views/pages/ConteudoPage";
import { RelatoriosPage } from "../views/pages/RelatoriosPage";
import { DashboardPage } from "../views/pages/DashboardPage";
import { AgentesPage } from "../views/pages/AgentesPage";
import { AgenteDetailPage } from "../views/pages/AgenteDetailPage";

function Placeholder({ testId, title }: { testId: string; title: string }) {
  return <div data-testid={testId} className="p-6 text-primary"><h1 className="text-xl font-semibold">{title}</h1></div>;
}

export default function App() {
  return (
    <WorkspaceProvider>
      <ToastProvider>
        <PipelineProvider>
          <BrowserRouter>
            <div className="app-shell flex min-h-screen bg-app">
              <Sidebar />
              <div className="app-main flex-1">
                <Topbar />
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/agentes" element={<AgentesPage />} />
                  <Route path="/agentes/:agentId" element={<AgenteDetailPage />} />
                  <Route path="/conteudo" element={<ConteudoPage />} />
                  <Route path="/reels" element={<ReelApprovalPanel />} />
                  <Route path="/reels/:id" element={<ReelDetailPage />} />
                  <Route path="/blog" element={<HistoryPanel />} />
                  <Route path="/leads" element={<SalesPanel />} />
                  <Route path="/clientes" element={<SalesPanel filterIntent="customer" />} />
                  <Route path="/relatorios" element={<RelatoriosPage />} />
                  <Route path="/configuracoes" element={<ConfigView />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </div>
          </BrowserRouter>
        </PipelineProvider>
      </ToastProvider>
    </WorkspaceProvider>
  );
}
