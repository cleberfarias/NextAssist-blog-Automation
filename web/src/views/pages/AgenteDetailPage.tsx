import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { RunsPanel } from "../dashboard/RunsPanel";
import { SalesPanel } from "../dashboard/SalesPanel";
import { RevenuePanel } from "../dashboard/RevenuePanel";
import { ReelApprovalPanel } from "../dashboard/ReelApprovalPanel";
import type { OfficeAgentId } from "./AgentesPage";

const TITLES: Record<OfficeAgentId, string> = {
  social: "Social Agent", analytics: "Analytics Agent", sales: "Sales Agent",
  finance: "Finance Agent", revenue: "Revenue Director",
};

type Tab = "visao-geral" | "detalhes" | "historico" | "acoes";
const TABS: { id: Tab; label: string }[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "detalhes", label: "Detalhes técnicos" },
  { id: "historico", label: "Histórico" },
  { id: "acoes", label: "Ações" },
];

function VisaoGeral({ agentId }: { agentId: OfficeAgentId }) {
  if (agentId === "sales") return <SalesPanel />;
  if (agentId === "revenue") return <RevenuePanel />;
  if (agentId === "social") return <ReelApprovalPanel />;
  return <p className="text-secondary">Sem painel detalhado para este agente ainda — veja o card em <Link className="text-accent" to="/agentes">Agentes (IA)</Link>.</p>;
}

export function AgenteDetailPage() {
  const { agentId } = useParams<{ agentId: OfficeAgentId }>();
  const [tab, setTab] = useState<Tab>("visao-geral");
  const id = (agentId ?? "sales") as OfficeAgentId;

  return (
    <div className="p-6 text-primary">
      <h1 className="mb-4 text-xl font-semibold">{TITLES[id] ?? id}</h1>

      <div role="tablist" className="mb-4 flex gap-2 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`px-3 py-2 text-sm ${tab === t.id ? "border-b-2 border-accent text-primary" : "text-secondary"}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "visao-geral" && <VisaoGeral agentId={id} />}
      {tab === "detalhes" && <p className="text-sm text-secondary">Detalhes técnicos completos ficam disponíveis na aba Visão geral por enquanto — um payload bruto dedicado fica para uma iteração futura.</p>}
      {tab === "historico" && <RunsPanel />}
      {tab === "acoes" && (
        <p className="text-sm text-secondary">
          Sem ações automatizadas para este agente nesta versão.
          {id === "social" ? <> Para aprovar/rejeitar/publicar Reels, use <Link className="text-accent" to="/reels">Reels</Link>.</> : null}
        </p>
      )}
    </div>
  );
}
