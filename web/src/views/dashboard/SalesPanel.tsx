import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet, apiPost } from "../../lib/api";
import { formatDateTime } from "../../lib/formatters";
import { LEAD_TABS, LEAD_STATUS_LABEL, LEAD_STATUS_COLOR, leadStatus, filterLeadsByTab, leadDisplayName, leadInterest, leadLastActivityAt, type LeadTab } from "./leadStatus";
import type { SalesDashboardResponse, SalesEntry, SalesReviewStatus } from "../../types/api";

function signalLabel(name: string): string {
  const labels: Record<string, string> = {
    site_visit: "visitou o site",
    pricing_view: "viu preços",
    trial_started: "iniciou trial",
    signup_completed: "concluiu cadastro",
    first_order_created: "criou primeira OS",
    subscription_started: "assinou",
    whatsapp_click: "clicou no WhatsApp",
    contact_submit: "enviou contato",
  };
  return labels[name] ?? name;
}

function reviewLabel(status?: SalesReviewStatus): string {
  if (status === "approved") return "Aprovado";
  if (status === "rejected") return "Descartado";
  return "Pendente de aprovação";
}

interface ReviewControlsProps {
  workspace: string;
  entry: SalesEntry;
  onSaved: () => Promise<void>;
}

function ReviewControls({ workspace, entry, onSaved }: ReviewControlsProps) {
  const baseSubject = entry.review?.subject ?? entry.outreach?.subject ?? "";
  const baseMessage = entry.review?.message ?? entry.outreach?.message ?? "";
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(baseSubject);
  const [message, setMessage] = useState(baseMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setSubject(baseSubject);
      setMessage(baseMessage);
    }
  }, [baseSubject, baseMessage, editing]);

  if (!entry.outreach) return null;

  async function submit(status: SalesReviewStatus, persistText = false) {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/sales/review", {
        workspaceId: workspace,
        leadId: entry.lead.leadId,
        status,
        ...(persistText ? { subject, message } : {}),
      });
      setEditing(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const status = entry.review?.status;
  const displaySubject = entry.review?.subject ?? entry.outreach.subject;
  const displayMessage = entry.review?.message ?? entry.outreach.message;

  return (
    <div className="rounded-md border border-border bg-app p-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm text-primary">Rascunho de contato ({entry.outreach.channel})</strong>
        <span className="text-xs text-secondary">{reviewLabel(status)}</span>
      </div>
      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          {entry.outreach.channel === "email" ? (
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Assunto"
              disabled={busy}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-primary"
            />
          ) : null}
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-primary"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => void submit("pending", true)} disabled={busy || !message.trim()} className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">Salvar edição</button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary disabled:opacity-50">Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          {displaySubject ? <strong className="text-sm text-primary">{displaySubject}</strong> : null}
          <p className="mt-1 text-sm text-secondary">{displayMessage}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setEditing(true)} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary disabled:opacity-50">Editar</button>
            <button type="button" onClick={() => void submit("approved", true)} disabled={busy || status === "approved"} className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">Aprovar</button>
            <button type="button" onClick={() => void submit("rejected", true)} disabled={busy || status === "rejected"} className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary disabled:opacity-50">Descartar</button>
          </div>
        </div>
      )}
      {error ? <p className="mt-2 text-sm text-status-error">{error}</p> : null}
    </div>
  );
}

function LeadRow({ entry, workspace, expanded, onToggle, onSaved }: {
  entry: SalesEntry;
  workspace: string;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => Promise<void>;
}) {
  const status = leadStatus(entry);
  const color = LEAD_STATUS_COLOR[status];
  const interest = leadInterest(entry);
  const lastActivity = leadLastActivityAt(entry);
  const hasDetail = entry.lead.signals.length > 0 || Boolean(entry.outreach);

  return (
    <>
      <tr className={hasDetail ? "cursor-pointer hover:bg-app" : ""} onClick={hasDetail ? onToggle : undefined}>
        <td><strong>{leadDisplayName(entry)}</strong></td>
        <td>{entry.lead.source ?? "—"}</td>
        <td>{interest ?? "—"}</td>
        <td>
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${color.dot}`} aria-hidden="true" />
            <span className={color.text}>{LEAD_STATUS_LABEL[status]}</span>
          </span>
        </td>
        <td>{lastActivity ? formatDateTime(lastActivity) : "—"}</td>
      </tr>
      {expanded && hasDetail ? (
        <tr>
          <td colSpan={5}>
            <div className="flex flex-col gap-3 py-2">
              <div className="flex flex-wrap gap-4 text-xs text-secondary">
                <span>Score: <strong className="text-primary">{entry.assessment.score}/100</strong></span>
                <span>Próxima ação: <strong className="text-primary">{entry.assessment.nextAction.split("_").join(" ")}</strong></span>
                {entry.lead.signals.length > 0 ? (
                  <span>Sinais: {entry.lead.signals.slice(-4).map((s) => signalLabel(s.name)).join(" · ")}</span>
                ) : null}
              </div>
              {entry.outreach ? <ReviewControls workspace={workspace} entry={entry} onSaved={onSaved} /> : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function SalesPanel({ filterIntent }: { filterIntent?: "customer" } = {}) {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<SalesDashboardResponse | null>(null);
  const [tab, setTab] = useState<LeadTab>("todos");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    if (!workspace) return;
    try {
      setData(await apiGet<SalesDashboardResponse>("/api/sales", workspace, signal));
    } catch (err) {
      if ((err as Error).name !== "AbortError") setData(null);
    }
  }

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [workspace]);

  const title = filterIntent === "customer" ? "Clientes" : "Leads";
  const subtitle = filterIntent === "customer" ? "Clientes convertidos a partir de leads reais." : "Oportunidades identificadas pelos agentes.";

  if (!data || !workspace) {
    return (
      <div className="p-6 text-primary">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-secondary">{subtitle}</p>
        <p className="mt-6 text-sm text-secondary">Aguardando dados</p>
      </div>
    );
  }

  const byIntent = filterIntent
    ? data.entries.filter((entry) => entry.assessment.intent === filterIntent)
    : data.entries;
  const visible = [...(filterIntent ? byIntent : filterLeadsByTab(byIntent, tab))].sort((a, b) => b.assessment.score - a.assessment.score);

  return (
    <div className="p-6 text-primary">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-secondary">{subtitle}</p>

      {filterIntent ? null : (
        <div role="tablist" className="mb-4 mt-4 flex flex-wrap gap-2 border-b border-border" aria-label="Filtro de leads">
          {LEAD_TABS.map((t) => (
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
      )}

      {visible.length === 0 ? (
        <p className={filterIntent ? "mt-6 text-sm text-secondary" : "mt-4 text-sm text-secondary"}>Nenhum lead nesta categoria.</p>
      ) : (
        <div className={filterIntent ? "mt-6 overflow-x-auto" : "mt-4 overflow-x-auto"}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-secondary">
                <th className="pb-2 pr-4 font-semibold">Nome</th>
                <th className="pb-2 pr-4 font-semibold">Origem</th>
                <th className="pb-2 pr-4 font-semibold">Interesse</th>
                <th className="pb-2 pr-4 font-semibold">Status</th>
                <th className="pb-2 font-semibold">Data</th>
              </tr>
            </thead>
            <tbody className="[&_td]:border-b [&_td]:border-border [&_td]:py-2 [&_td]:pr-4">
              {visible.map((entry) => (
                <LeadRow
                  key={entry.lead.leadId}
                  entry={entry}
                  workspace={workspace}
                  expanded={expandedId === entry.lead.leadId}
                  onToggle={() => setExpandedId((id) => (id === entry.lead.leadId ? null : entry.lead.leadId))}
                  onSaved={() => load()}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
