import { Link } from "react-router-dom";
import { formatDateTime } from "../../../lib/formatters";
import { REEL_STATUS_LABEL } from "../../../lib/reelStatus";
import type { ReelListEntry } from "../../../types/api";

export function RoteirosTab({ reels, loading }: { reels: ReelListEntry[]; loading: boolean }) {
  if (loading) return <p className="mt-6 text-sm text-secondary">Aguardando dados</p>;
  if (reels.length === 0) return <p className="mt-6 text-sm text-secondary">Nenhum roteiro de Reel foi gerado ainda.</p>;

  return (
    <div className="mt-4 space-y-3">
      {reels.map((reel) => (
        <Link key={reel.id} to={`/reels/${reel.id}`} className="block rounded-lg border border-border bg-surface p-3 hover:border-accent">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm text-primary">{reel.title}</strong>
            <span className="rounded-full bg-reel/15 px-2 py-0.5 text-[10px] text-reel">{REEL_STATUS_LABEL[reel.status]}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-secondary">{reel.caption}</p>
          <p className="mt-2 text-[11px] text-secondary">{formatDateTime(reel.updatedAt)}</p>
        </Link>
      ))}
    </div>
  );
}
