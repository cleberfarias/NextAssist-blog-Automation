import { useState } from "react";
import { PerformancePanel } from "../dashboard/PerformancePanel";
import { AttributionPanel } from "../dashboard/AttributionPanel";
import { SalesPanel } from "../dashboard/SalesPanel";
import { ConversionPanel } from "../dashboard/ConversionPanel";
import { AnalyticsOverviewTab } from "./relatorios/AnalyticsOverviewTab";

type Tab = "visao-geral" | "trafego" | "conteudo" | "leads" | "conversoes";
const TABS: { id: Tab; label: string }[] = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "trafego", label: "Tráfego" },
  { id: "conteudo", label: "Conteúdo" },
  { id: "leads", label: "Leads" },
  { id: "conversoes", label: "Conversões" },
];

export function RelatoriosPage() {
  const [tab, setTab] = useState<Tab>("visao-geral");

  return (
    <div className="p-6 text-primary">
      <h1 className="text-xl font-semibold">Relatórios</h1>

      <div role="tablist" className="mb-4 mt-4 flex flex-wrap gap-2 border-b border-border" aria-label="Seções de relatórios">
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

      {tab === "visao-geral" ? <AnalyticsOverviewTab /> : null}
      {tab === "trafego" ? <PerformancePanel /> : null}
      {tab === "conteudo" ? <AttributionPanel /> : null}
      {tab === "leads" ? <SalesPanel /> : null}
      {tab === "conversoes" ? <ConversionPanel /> : null}
    </div>
  );
}
