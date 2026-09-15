import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceProvider } from "../../hooks/useWorkspace";
import { ToastProvider } from "../../components/ui/Toast";
import { ConfigView } from "./ConfigView";
import type { WorkspaceConfig } from "../../types/api";

const WORKSPACE: WorkspaceConfig = {
  id: "nextassist", name: "NextAssist", active: true,
  brand: {
    name: "NextAssist",
    description: "Sistema de gestão para assistências técnicas de celular no Brasil.",
    toneOfVoice: "Direto e prático", targetAudience: [], competitors: [],
  },
  goals: { primary: "sales", monthlyCustomerTarget: 10 },
  channels: { blog: true, instagram: true, linkedin: false },
  integrations: {
    siteUrl: "https://www.nextassist-app.com.br",
    cms: { provider: "nextassist", apiUrl: "https://api.nextassist.test" },
    searchConsole: { siteUrl: "sc-domain:nextassist-app.com.br", sitemapUrl: "https://www.nextassist-app.com.br/sitemap.xml" },
    instagram: { apiVersion: "v21.0" },
  },
  autonomy: { mode: "semi-autonomous" },
  aiFallbackProvider: "none",
  contentStrategy: { minimumPendingTopics: 5, replenishAmount: 15 },
  instagramStrategy: { frequencyPerWeek: 5, pillars: ["dor operacional", "demonstração do produto", "bastidores", "educação prática", "prova social"], preferredFormats: ["reel", "carrossel", "story"] },
  videoStrategy: { provider: "heygen-mcp", avatarId: "avatar-1", voiceId: "voz-1", brandKitId: "kit-1", format: "9:16", music: true, musicVolume: 0.12, requiresApproval: true, fallback: "none" },
  secrets: { required: ["OPENAI_API_KEY", "FIREBASE_WEB_API_KEY"], optional: ["HEYGEN_API_KEY"] },
};

const SECRETS_STATUS = [
  { key: "OPENAI_API_KEY", required: true, configured: true },
  { key: "FIREBASE_WEB_API_KEY", required: true, configured: false },
  { key: "HEYGEN_API_KEY", required: false, configured: false },
];

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => [{ id: "nextassist", name: "NextAssist" }] });
    if (url.includes("/api/workspace/secrets-status")) return Promise.resolve({ ok: true, json: async () => SECRETS_STATUS });
    if (init?.method === "PATCH" && url.includes("/api/workspace")) {
      const body = JSON.parse(String(init.body));
      return Promise.resolve({ ok: true, json: async () => ({ ...WORKSPACE, ...body.updates, brand: { ...WORKSPACE.brand, ...body.updates.brand } }) });
    }
    if (url.includes("/api/workspace")) return Promise.resolve({ ok: true, json: async () => WORKSPACE });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }));
}

describe("ConfigView", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra os campos reais do workspace na aba Workspace, com os 5 pilares reais marcados", async () => {
    stubFetch();
    render(<WorkspaceProvider><ToastProvider><ConfigView /></ToastProvider></WorkspaceProvider>);

    expect(await screen.findByDisplayValue("NextAssist")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Sistema de gestão para assistências técnicas de celular no Brasil.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://www.nextassist-app.com.br")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Dor operacional" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Prova social" })).toBeChecked();
  });

  it("o botão Salvar alterações começa desabilitado e liga quando um campo real muda", async () => {
    stubFetch();
    render(<WorkspaceProvider><ToastProvider><ConfigView /></ToastProvider></WorkspaceProvider>);
    await screen.findByDisplayValue("NextAssist");

    const saveButton = screen.getByRole("button", { name: "Salvar alterações" });
    expect(saveButton).toBeDisabled();

    await userEvent.clear(screen.getByDisplayValue("10"));
    await userEvent.type(screen.getByLabelText("Meta de clientes/mês"), "20");

    expect(saveButton).toBeEnabled();
  });

  it("clicar em Salvar alterações envia um PATCH real com as mudanças e mostra sucesso", async () => {
    stubFetch();
    render(<WorkspaceProvider><ToastProvider><ConfigView /></ToastProvider></WorkspaceProvider>);
    await screen.findByDisplayValue("NextAssist");

    await userEvent.clear(screen.getByLabelText("Meta de clientes/mês"));
    await userEvent.type(screen.getByLabelText("Meta de clientes/mês"), "20");
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByText("Configurações salvas.")).toBeInTheDocument();
    const fetchMock = vi.mocked(fetch);
    const patchCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH");
    expect(patchCall).toBeDefined();
    const body = JSON.parse(String((patchCall?.[1] as RequestInit).body));
    expect(body.workspaceId).toBe("nextassist");
    expect(body.updates.goals.monthlyCustomerTarget).toBe(20);
  });

  it("aba Integrações mostra o status real das credenciais, sem nenhum campo de valor de chave", async () => {
    stubFetch();
    render(<WorkspaceProvider><ToastProvider><ConfigView /></ToastProvider></WorkspaceProvider>);
    await screen.findByDisplayValue("NextAssist");

    await userEvent.click(screen.getByRole("button", { name: "Integrações" }));

    expect(await screen.findByText("OPENAI_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("Configurada")).toBeInTheDocument();
    expect(screen.getByText("FIREBASE_WEB_API_KEY")).toBeInTheDocument();
    expect(screen.getAllByText("Faltando").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/senha|api key|chave/i)).not.toBeInTheDocument();
  });
});
