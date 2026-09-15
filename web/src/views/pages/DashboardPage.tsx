import { Link } from "react-router-dom";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useAgentData } from "../../hooks/useAgentOperations";
import { nf } from "../../lib/formatters";
import type { ReelDashboardResponse, SalesDashboardResponse, RevenueDashboardResponse } from "../../types/api";
import { AgentDepartmentTabs } from "./dashboard/AgentDepartmentTabs";
import { ActivityFeed } from "./dashboard/ActivityFeed";

function KpiCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-secondary">
        <span aria-hidden="true">{icon}</span>
        <span className="text-sm">{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold text-primary">{value}</div>
    </div>
  );
}

function Goal({ label, current, target }: { label: string; current: number | null | undefined; target: number | null | undefined }) {
  if (current == null || target == null) {
    return (
      <div>
        <div className="flex justify-between text-sm"><span className="text-primary">{label}</span><span className="text-secondary">Meta não configurada</span></div>
      </div>
    );
  }
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm"><span className="text-primary">{label}</span><span className="text-secondary">{current} / {target} · {pct}%</span></div>
      <div className="mt-1 h-2 rounded-full bg-app"><div className="h-2 rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function DashboardPage() {
  const { workspace, workspaces } = useWorkspace();
  const workspaceName = workspaces.find((w) => w.id === workspace)?.name ?? workspace;

  const reels = useAgentData<ReelDashboardResponse>("/api/reels");
  const sales = useAgentData<SalesDashboardResponse>("/api/sales");
  const revenue = useAgentData<RevenueDashboardResponse>("/api/revenue");

  const now = new Date();
  const dateLabel = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const timeLabel = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="p-6 text-primary">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-secondary">Seus agentes de IA trabalhando pelo crescimento do {workspaceName}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-secondary">{dateLabel} · {timeLabel}</span>
          <Link to="/conteudo" className="rounded-md bg-accent px-3 py-1.5 text-sm text-white">+ Novo conteúdo</Link>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon="🧲" label="Leads gerados" value={sales ? nf.format(sales.summary.total) : "—"} />
        <KpiCard icon="🙋" label="Novos clientes" value={revenue ? nf.format(revenue.snapshot.customers) : "—"} />
        <KpiCard icon="💵" label="Receita estimada" value="Dados ainda não disponíveis" />
        <KpiCard icon="🎬" label="Reels publicados" value={reels ? nf.format(reels.summary.published) : "—"} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><AgentDepartmentTabs /></div>
        <ActivityFeed />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-dashed border-border bg-surface/50 p-4 text-sm text-secondary lg:col-span-2">
          <h2 className="mb-1 font-semibold text-primary">📊 Progresso semanal e próximas ações</h2>
          <p>Em breve — assim que tivermos agregação histórica por dia e prazos reais configurados.</p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold">Metas do mês</h2>
          <div className="space-y-3">
            <Goal label="Novos clientes" current={revenue?.snapshot.customers} target={revenue?.monthlyCustomerTarget} />
            <Goal label="Reels publicados" current={null} target={null} />
            <Goal label="Leads gerados" current={null} target={null} />
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-lg border border-border bg-surface p-4 text-sm italic text-secondary">
        "Automatizar hoje para crescer amanhã." — {workspaceName}
      </section>
    </div>
  );
}
