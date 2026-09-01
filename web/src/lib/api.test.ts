import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiGet, apiPost, ApiError } from "./api";

describe("apiGet", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends ?workspace= when provided", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ hello: "world" }) });

    await apiGet("/api/history", "acme");

    const calledUrl = mockFetch.mock.calls[0][0] as URL;
    expect(calledUrl.toString()).toContain("workspace=acme");
  });

  it("forwards the AbortSignal to fetch", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const controller = new AbortController();

    await apiGet("/api/history", "acme", controller.signal);

    const options = mockFetch.mock.calls[0][1] as RequestInit;
    expect(options.signal).toBe(controller.signal);
  });

  it("throws ApiError when the response is not ok", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(apiGet("/api/history")).rejects.toBeInstanceOf(ApiError);
  });

  it("throws ApiError with the generic API message when no fallbackMessage is given", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(apiGet("/api/history")).rejects.toThrow("API 500: /api/history");
  });

  it("throws ApiError with the given fallbackMessage when the response is not ok", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(
      apiGet("/api/history", undefined, undefined, "Não foi possível carregar os posts publicados."),
    ).rejects.toThrow("Não foi possível carregar os posts publicados.");
  });
});

describe("apiPost", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a JSON POST and returns parsed data on success", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const result = await apiPost<{ ok: boolean }>("/api/run", { workspaceId: "acme" });

    expect(result).toEqual({ ok: true });
    const options = mockFetch.mock.calls[0][1] as RequestInit;
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({ workspaceId: "acme" });
  });

  it("throws ApiError with the server-provided message on failure", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "já rodando" }) });

    await expect(apiPost("/api/run", {})).rejects.toThrow("já rodando");
  });

  it("falls back to the given fallbackMessage when the server sends no error field", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(apiPost("/api/run", {}, undefined, "Não foi possível disparar a execução.")).rejects.toThrow(
      "Não foi possível disparar a execução.",
    );
  });

  it("prefers the server-provided error over fallbackMessage", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "já rodando" }) });

    await expect(apiPost("/api/run", {}, undefined, "fallback")).rejects.toThrow("já rodando");
  });
});
