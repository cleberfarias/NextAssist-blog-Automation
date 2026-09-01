import { LiveStatus } from "./LiveStatus";
import { PlayerDock } from "./PlayerDock";
import { HistoryPanel } from "./HistoryPanel";
import { RunsPanel } from "./RunsPanel";
import { UsagePanel } from "./UsagePanel";
import { ConversionPanel } from "./ConversionPanel";
import { AttributionPanel } from "./AttributionPanel";
import { PerformancePanel } from "./PerformancePanel";
import { InstagramPerformancePanel } from "./InstagramPerformancePanel";

export function PainelView() {
  return (
    <>
      <section className="channel-overview" aria-label="Frentes editoriais">
        <article className="channel-card"><span className="channel-icon">📝</span><div><strong>Frente Blog</strong><p>SEO, artigo, capa, publicação e indexação.</p></div></article>
        <article className="channel-card"><span className="channel-icon">📸</span><div><strong>Frente Instagram</strong><p>Reels, bastidores, dicas rápidas e conteúdo interativo.</p></div></article>
      </section>

      <PlayerDock />
      <LiveStatus />
      <HistoryPanel />
      <RunsPanel />
      <UsagePanel />
      <ConversionPanel />
      <AttributionPanel />
      <PerformancePanel />
      <InstagramPerformancePanel />
    </>
  );
}
