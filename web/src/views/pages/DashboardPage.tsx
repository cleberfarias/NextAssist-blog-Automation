import { RevenuePanel } from "../dashboard/RevenuePanel";
import { LiveStatus } from "../dashboard/LiveStatus";
import { PlayerDock } from "../dashboard/PlayerDock";

export function DashboardPage() {
  return (
    <div className="p-6 text-primary">
      <section className="channel-overview grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="Frentes editoriais">
        <article className="channel-card rounded-lg border border-border bg-surface p-4"><span className="channel-icon text-2xl">📝</span><div><strong>Frente Blog</strong><p className="text-sm text-secondary">SEO, artigo, capa, publicação e indexação.</p></div></article>
        <article className="channel-card rounded-lg border border-border bg-surface p-4"><span className="channel-icon text-2xl">📸</span><div><strong>Frente Instagram</strong><p className="text-sm text-secondary">Reels, bastidores, dicas rápidas e conteúdo interativo.</p></div></article>
        <article className="channel-card rounded-lg border border-border bg-surface p-4"><span className="channel-icon text-2xl">💼</span><div><strong>Frente Vendas</strong><p className="text-sm text-secondary">Leads, intenção comercial, abordagem e aprovação humana.</p></div></article>
      </section>

      <div className="mt-6"><RevenuePanel /></div>
      <div className="mt-6"><PlayerDock /></div>
      <div className="mt-6"><LiveStatus /></div>
    </div>
  );
}
