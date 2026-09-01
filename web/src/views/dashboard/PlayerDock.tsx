import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet } from "../../lib/api";
import { nf } from "../../lib/formatters";
import type { HistoryEntry, InstagramPerformance } from "../../types/api";

export function PlayerDock() {
  const { workspace } = useWorkspace();
  const [blogCount, setBlogCount] = useState<number | null>(null);
  const [igCount, setIgCount] = useState<number | null>(null);
  const [igReach, setIgReach] = useState<number | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<HistoryEntry[]>("/api/history", workspace, controller.signal)
      .then((entries) => setBlogCount(entries.length))
      .catch((err) => { if ((err as Error).name !== "AbortError") setBlogCount(null); });
    return () => controller.abort();
  }, [workspace]);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<InstagramPerformance[]>("/api/instagram-performance", workspace, controller.signal)
      .then((items) => {
        setIgCount(items.length);
        setIgReach(items.reduce((sum, item) => sum + (item.reach || 0), 0));
      })
      .catch((err) => { if ((err as Error).name !== "AbortError") { setIgCount(null); setIgReach(null); } });
    return () => controller.abort();
  }, [workspace]);

  return (
    <aside className="player-dock" aria-label="Seu espaço e relatórios">
      <button className="player-avatar" aria-label="Abrir meus relatórios">
        <span className="player-status"></span>
        <span className="player-face">👨🏻‍💻</span>
        <strong>Cleber</strong>
        <small>seu espaço</small>
      </button>
      <div className="player-reports">
        <div className="reports-heading">
          <span>📊</span>
          <div><strong>Meus relatórios</strong><small>visão geral da operação</small></div>
        </div>
        <div className="report-grid">
          <div><span>Blog</span><strong>{blogCount !== null ? nf.format(blogCount) : "—"}</strong><small>publicações</small></div>
          <div><span>Instagram</span><strong>{igCount !== null ? nf.format(igCount) : "—"}</strong><small>Reels</small></div>
          <div><span>Alcance</span><strong>{igReach !== null ? nf.format(igReach) : "—"}</strong><small>Instagram</small></div>
          <div><span>Leads</span><strong>—</strong><small>conversões</small></div>
        </div>
        <p className="reports-hint">Passe o mouse no seu personagem para consultar os números.</p>
      </div>
    </aside>
  );
}
