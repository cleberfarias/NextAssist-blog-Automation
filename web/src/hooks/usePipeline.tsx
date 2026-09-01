import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiGet, apiPost } from "../lib/api";
import { useWorkspace } from "./useWorkspace";
import { useToast } from "../components/ui/Toast";
import type { AgentId, PipelineEvent, RunRecord, StatusResponse } from "../types/api";

interface PipelineContextValue {
  runMode: StatusResponse["runMode"];
  running: boolean;
  desks: Partial<Record<AgentId, PipelineEvent>>;
  topicLine: string;
  refreshToken: number;
  runBlog: () => Promise<void>;
  runInstagram: () => Promise<void>;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function PipelineProvider({ children }: { children: ReactNode }) {
  const { workspace } = useWorkspace();
  const { showToast } = useToast();
  const [runMode, setRunMode] = useState<StatusResponse["runMode"]>("local");
  const [running, setRunning] = useState(false);
  const [desks, setDesks] = useState<Partial<Record<AgentId, PipelineEvent>>>({});
  const [topicLine, setTopicLine] = useState("Aguardando o próximo tema...");
  const [refreshToken, setRefreshToken] = useState(0);
  const runningRef = useRef(running);
  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  // Painel hospedado: recarrega periodicamente (Histórico/Execuções/Consumo)
  // para pegar publicações feitas pela GitHub Action sem precisar dar refresh.
  useEffect(() => {
    const interval = setInterval(() => setRefreshToken((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Estado inicial (status + últimos eventos) para o workspace selecionado.
  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<StatusResponse>("/api/status", workspace, controller.signal)
      .then((status) => {
        setRunMode(status.runMode);
        setRunning(status.running);
        setDesks((prev) => {
          const next = { ...prev };
          for (const event of status.lastEvents) next[event.agent] = event;
          return next;
        });
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error");
      });
    return () => controller.abort();
  }, [workspace]);

  // Hidrata mesas e tema a partir da última execução registrada. O estado em
  // memória de /api/status (lastEvents) some a cada restart do processo (Cloud
  // Run reinicia com frequência), então sem isto o escritório volta a mostrar
  // "tudo ocioso" mesmo já tendo rodado antes. Só aplica se nada ao vivo (SSE
  // ou uma execução em andamento) já tiver preenchido esse estado.
  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    apiGet<RunRecord[]>("/api/runs", workspace, controller.signal)
      .then((runs) => {
        const latest = runs[0];
        if (!latest || runningRef.current) return;
        setDesks((prev) => {
          const hasLiveData = Object.values(prev).some((event) => event && event.status !== "idle");
          if (hasLiveData) return prev;
          const seeded: Partial<Record<AgentId, PipelineEvent>> = { ...prev };
          for (const ev of latest.eventos ?? []) seeded[ev.agent] = ev;
          return seeded;
        });
        if (latest.tema) {
          setTopicLine((prev) => (prev === "Aguardando o próximo tema..." ? `Último tema: ${latest.tema}` : prev));
        }
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") showToast((err as Error).message, "error");
      });
    return () => controller.abort();
  }, [workspace]);

  // SSE ao vivo — reconecta sempre que o workspace muda, fechando a conexão anterior.
  useEffect(() => {
    if (!workspace) return;
    const url = new URL("/api/events", window.location.origin);
    url.searchParams.set("workspace", workspace);
    const source = new EventSource(url.toString());

    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as PipelineEvent;
      setDesks((prev) => ({ ...prev, [event.agent]: event }));
      if (event.tema) setTopicLine(`Tema de hoje: ${event.tema}`);

      if (event.agent === "publicador" && event.status === "done") {
        showToast("Post publicado com sucesso! 🎉", "success");
      }
      if (event.agent === "instagram" && event.status === "done" && !/ignorado/.test(event.message ?? "")) {
        showToast("Publicado no Instagram com sucesso! 📸", "success");
      }
      if (event.agent === "indexador" && event.status === "done") {
        setRunning(false);
        setRefreshToken((t) => t + 1);
      }
      if (event.status === "error") {
        showToast(`Não foi possível concluir ${event.agent}: ${event.message ?? "Tente novamente."}`, "error");
        setRunning(false);
        setRefreshToken((t) => t + 1);
      }
    };

    return () => source.close();
  }, [workspace]);

  const runBlog = async () => {
    if (runMode === "dispatch") {
      setRunning(true);
      try {
        await apiPost("/api/run", { workspaceId: workspace }, undefined, "Não foi possível disparar a execução.");
        showToast(
          "Execução disparada no GitHub Actions — acompanhe pela aba Actions do repositório; a lista de execuções deste painel atualiza sozinha quando terminar.",
          "success",
        );
      } catch (err) {
        showToast((err as Error).message, "error");
      } finally {
        // O servidor devolve 409 a um segundo disparo dentro de 60s — mantém o
        // botão desabilitado por esse período em vez de liberar de imediato.
        setTimeout(() => setRunning(false), 60_000);
      }
      return;
    }

    setRunning(true);
    try {
      await apiPost("/api/run", { workspaceId: workspace });
    } catch (err) {
      setRunning(false);
      showToast((err as Error).message, "error");
    }
  };

  const runInstagram = async () => {
    try {
      await apiPost("/api/run", { workspaceId: workspace, channel: "instagram" });
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  const value = useMemo(
    () => ({ runMode, running, desks, topicLine, refreshToken, runBlog, runInstagram }),
    [runMode, running, desks, topicLine, refreshToken, workspace],
  );

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}

export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline precisa estar dentro de um PipelineProvider.");
  return ctx;
}
