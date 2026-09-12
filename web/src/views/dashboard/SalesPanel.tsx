import { useEffect, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { apiGet, apiPost } from "../../lib/api";
import { formatDateTime, nf } from "../../lib/formatters";
import type { SalesDashboardResponse, SalesEntry, SalesReviewStatus } from "../../types/api";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}

function intentLabel(intent: SalesEntry["assessment"]["intent"]): string {
  if (intent === "high") return "Quente";
  if (intent === "medium") return "Médio";
  if (intent === "customer") return "Cliente";
  return "Baixo";
}

function reviewLabel(status?: SalesReviewStatus): string {
  if (status === "approved") return "Aprovado";
  if (status === "rejected") return "Descartado";
  return "Pendente de aprovação";
}

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

  if (!entry.outreach) return <>—</>;

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
    <details open={editing}>
      <summary>{reviewLabel(status)}</summary>
      {editing ? (
        <div className="sales-review-editor">
          {entry.outreach.channel === "email" ? (
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Assunto"
              disabled={busy}
            />
          ) : null}
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={5}
            disabled={busy}
          />
          <div className="sales-review-actions">
            <button type="button" onClick={() => void submit("pending", true)} disabled={busy || !message.trim()}>
              Salvar edição
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy}>Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="sales-review-preview">
          {displaySubject ? <strong>{displaySubject}</strong> : null}
          <p>{displayMessage}</p>
          <div className="sales-review-actions">
            <button type="button" onClick={() => setEditing(true)} disabled={busy}>Editar</button>
            <button type="button" onClick={() => void submit("approved", true)} disabled={busy || status === "approved"}>
              Aprovar
            </button>
            <button type="button" onClick={() => void submit("rejected", true)} disabled={busy || status === "rejected"}>
              Descartar
            </button>
          </div>
        </div>
      )}
      {error ? <p className="error-text">{error}</p> : null}
    </details>
  );
}

export function SalesPanel() {
  const { workspace } = useWorkspace();
  const [data, setData] = useState<SalesDashboardResponse | null>(null);

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

  if (!data || !workspace) {
    return (
      <section className="usage-panel sales-panel">
        <div className="usage-header">
          <div><h2>Sales Agent</h2><p>Leads priorizados pelo Harness a partir do funil real.</p></div>
          <span>Aguardando dados</span>
        </div>
      </section>
    );
  }

  const priority = [...data.entries]
    .filter((entry) => entry.assessment.intent !== "low")
    .sort((a, b) => b.assessment.score - a.assessment.score)
    .slice(0, 12);

  return (
    <section className="usage-panel sales-panel">
      <div className="usage-header">
        <div><h2>Sales Agent</h2><p>Leads reais classificados por intenção. Aprovar autoriza a próxima etapa, mas ainda não envia mensagem.</p></div>
        <span>{data.updatedAt ? `Atualizado ${formatDateTime(data.updatedAt)}` : "Sem execução salva"}</span>
      </div>

      <div className="kpi-row">
        <Kpi label="Leads" value={nf.format(data.summary.total)} />
        <Kpi label="Quentes" value={nf.format(data.summary.hot)} />
        <Kpi label="Médios" value={nf.format(data.summary.medium)} />
        <Kpi label="Clientes" value={nf.format(data.summary.customers)} />
        <Kpi label="Rascunhos p/ aprovação" value={nf.format(data.summary.draftsPendingApproval)} />
      </div>

      {priority.length === 0 ? (
        <p className="empty-state">Nenhum lead médio ou quente encontrado no último processamento.</p>
      ) : (
        <div className="perf-table-wrap">
          <table>
            <thead>
              <tr><th>Lead</th><th>Score</th><th>Intenção</th><th>Sinais</th><th>Próxima ação</th><th>Rascunho IA</th></tr>
            </thead>
            <tbody>
              {priority.map((entry) => (
                <tr key={entry.lead.leadId}>
                  <td>
                    <strong>{entry.lead.userId ?? entry.lead.anonymousId ?? entry.lead.leadId}</strong>
                    {entry.lead.source ? <div className="muted">Origem: {entry.lead.source}</div> : null}
                  </td>
                  <td><strong>{entry.assessment.score}/100</strong></td>
                  <td>{intentLabel(entry.assessment.intent)}</td>
                  <td>{entry.lead.signals.slice(-4).map((signal) => signalLabel(signal.name)).join(" · ") || "—"}</td>
                  <td>{entry.assessment.nextAction.replaceAll("_", " ")}</td>
                  <td>
                    <ReviewControls workspace={workspace} entry={entry} onSaved={() => load()} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
