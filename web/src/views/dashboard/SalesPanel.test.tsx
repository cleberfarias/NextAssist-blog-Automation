import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { SalesPanel } from "./SalesPanel";

const RESPONSE = {
  updatedAt: "2026-09-15T00:00:00.000Z",
  summary: { total: 2, hot: 1, medium: 1, customers: 1, draftsPendingApproval: 0 },
  entries: [
    { lead: { leadId: "l1", userId: "Lead Quente", signals: [{ name: "pricing_view", createdAt: "2026-09-14T00:00:00.000Z" }] }, assessment: { leadId: "l1", score: 90, intent: "high", nextAction: "invite_trial", reasons: [] } },
    { lead: { leadId: "l2", userId: "Cliente Atual", signals: [] }, assessment: { leadId: "l2", score: 100, intent: "customer", nextAction: "customer_success", reasons: [] } },
  ],
};

function stubFetch(response: unknown) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
    if (url.includes("/api/sales")) return Promise.resolve({ ok: true, json: async () => response });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }));
}

describe("SalesPanel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("filterIntent='customer' segue o mesmo padrão de Leads (mesmas abas), mas só com dados reais de clientes convertidos", async () => {
    stubFetch(RESPONSE);
    render(<WorkspaceProvider><SalesPanel filterIntent="customer" /></WorkspaceProvider>);

    expect(await screen.findByText("Cliente Atual")).toBeInTheDocument();
    expect(screen.queryByText("Lead Quente")).not.toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Quentes" })).toBeInTheDocument();

    // A aba Quentes não teria conteúdo real aqui — só clientes convertidos entram nesta tela.
    await userEvent.click(screen.getByRole("tab", { name: "Quentes" }));
    expect(await screen.findByText("Nenhum lead nesta categoria.")).toBeInTheDocument();
  });

  it("/leads (sem filtro) mostra todos os leads reais com status e interesse derivados dos dados reais", async () => {
    stubFetch(RESPONSE);
    render(<WorkspaceProvider><SalesPanel /></WorkspaceProvider>);

    expect(await screen.findByText("Lead Quente")).toBeInTheDocument();
    expect(screen.getByText("Cliente Atual")).toBeInTheDocument();
    expect(screen.getByText("Quente")).toBeInTheDocument();
    expect(screen.getByText("Convertido")).toBeInTheDocument();
    // Interesse real: último sinal do lead quente foi "pricing_view".
    expect(screen.getByText("Preços")).toBeInTheDocument();
  });

  it("aba Quentes filtra pra mostrar só leads com intenção alta", async () => {
    stubFetch(RESPONSE);
    render(<WorkspaceProvider><SalesPanel /></WorkspaceProvider>);
    await screen.findByText("Lead Quente");

    await userEvent.click(screen.getByRole("tab", { name: "Quentes" }));
    expect(await screen.findByText("Lead Quente")).toBeInTheDocument();
    expect(screen.queryByText("Cliente Atual")).not.toBeInTheDocument();
  });

  it("clicar numa linha com rascunho de contato expande a revisão real (Aprovar/Descartar)", async () => {
    stubFetch({
      updatedAt: "2026-09-15T00:00:00.000Z",
      summary: { total: 1, hot: 1, medium: 0, customers: 0, draftsPendingApproval: 1 },
      entries: [{
        lead: { leadId: "l1", userId: "Lead Quente", signals: [] },
        assessment: { leadId: "l1", score: 90, intent: "high", nextAction: "invite_trial", reasons: [] },
        outreach: { leadId: "l1", channel: "email", subject: "Assunto real", message: "Mensagem real de contato", rationale: "r", requiresHumanApproval: true },
      }],
    });
    render(<WorkspaceProvider><SalesPanel /></WorkspaceProvider>);
    await screen.findByText("Lead Quente");

    expect(screen.queryByText("Mensagem real de contato")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Lead Quente"));
    expect(await screen.findByText("Mensagem real de contato")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeInTheDocument();
  });
});
