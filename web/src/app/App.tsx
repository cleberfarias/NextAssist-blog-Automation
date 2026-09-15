import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { WorkspaceProvider } from "../hooks/useWorkspace";
import { PipelineProvider } from "../hooks/usePipeline";
import { ToastProvider } from "../components/ui/Toast";
import { Sidebar } from "../components/layout/Sidebar";
import { Topbar } from "../components/layout/Topbar";
import { ConfigView } from "../views/settings/ConfigView";

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
                  <Route path="/" element={<Placeholder testId="page-dashboard" title="Dashboard" />} />
                  <Route path="/agentes" element={<Placeholder testId="page-agentes" title="Agentes (IA)" />} />
                  <Route path="/agentes/:agentId" element={<Placeholder testId="page-agente-detalhe" title="Agente" />} />
                  <Route path="/conteudo" element={<Placeholder testId="page-conteudo" title="Conteúdo" />} />
                  <Route path="/reels" element={<Placeholder testId="page-reels" title="Reels" />} />
                  <Route path="/reels/:id" element={<Placeholder testId="page-reel-detalhe" title="Reel" />} />
                  <Route path="/blog" element={<Placeholder testId="page-blog" title="Blog" />} />
                  <Route path="/leads" element={<Placeholder testId="page-leads" title="Leads" />} />
                  <Route path="/clientes" element={<Placeholder testId="page-clientes" title="Clientes" />} />
                  <Route path="/relatorios" element={<Placeholder testId="page-relatorios" title="Relatórios" />} />
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
