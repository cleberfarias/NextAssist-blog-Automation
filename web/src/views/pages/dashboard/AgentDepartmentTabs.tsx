import { useState } from "react";
import { AgentOfficeCanvas } from "./AgentOfficeCanvas";
import { ContentPipelineBoard } from "./ContentPipelineBoard";

type Department = "office" | "content";

const TABS: { id: Department; label: string }[] = [
  { id: "office", label: "Agent Office · 5 agentes" },
  { id: "content", label: "Equipe de conteúdo · 8 agentes" },
];

/**
 * Dois "departamentos" do mesmo escritório, cada um seu canvas: o Agent
 * Office (5 agentes de negócio, sobre a foto real) e a Equipe de conteúdo
 * (os 8 estágios do pipeline de blog, mesas com balão de fala — já existia
 * como LiveStatus, reaproveitado sem alteração).
 */
export function AgentDepartmentTabs() {
  const [department, setDepartment] = useState<Department>("office");

  return (
    <div>
      <div role="tablist" className="mb-3 flex gap-2" aria-label="Departamentos">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={department === t.id}
            className={`rounded-full px-3 py-1.5 text-sm ${department === t.id ? "bg-accent text-white" : "border border-border bg-surface text-secondary hover:text-primary"}`}
            onClick={() => setDepartment(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {department === "office" ? <AgentOfficeCanvas /> : <ContentPipelineBoard />}
    </div>
  );
}
