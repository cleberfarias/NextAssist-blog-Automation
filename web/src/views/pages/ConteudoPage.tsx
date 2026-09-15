import { useState } from "react";
import { useAgentData } from "../../hooks/useAgentOperations";
import type { CalendarTopic, ReelDashboardResponse } from "../../types/api";
import { ContentCalendarTab } from "./conteudo/ContentCalendarTab";
import { IdeiasTab } from "./conteudo/IdeiasTab";
import { RoteirosTab } from "./conteudo/RoteirosTab";
import { BibliotecaTab } from "./conteudo/BibliotecaTab";

type Tab = "calendario" | "ideias" | "roteiros" | "biblioteca";

const TABS: { id: Tab; label: string }[] = [
  { id: "calendario", label: "Calendário" },
  { id: "ideias", label: "Ideias" },
  { id: "roteiros", label: "Roteiros" },
  { id: "biblioteca", label: "Biblioteca" },
];

export function ConteudoPage() {
  const [tab, setTab] = useState<Tab>("calendario");

  const topics = useAgentData<CalendarTopic[]>("/api/content-calendar");
  const reelsData = useAgentData<ReelDashboardResponse>("/api/reels");
  const loading = topics === null && reelsData === null;
  const reels = reelsData?.entries ?? [];

  return (
    <div className="p-6 text-primary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Conteúdo</h1>
          <p className="text-sm text-secondary">Planejamento e produção de conteúdo</p>
        </div>
      </div>

      <div role="tablist" className="mb-4 mt-4 flex gap-2 border-b border-border" aria-label="Seções de conteúdo">
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

      {tab === "calendario" ? <ContentCalendarTab topics={topics ?? []} reels={reels} loading={loading} /> : null}
      {tab === "ideias" ? <IdeiasTab topics={topics ?? []} loading={loading} /> : null}
      {tab === "roteiros" ? <RoteirosTab reels={reels} loading={loading} /> : null}
      {tab === "biblioteca" ? <BibliotecaTab topics={topics ?? []} reels={reels} loading={loading} /> : null}
    </div>
  );
}
