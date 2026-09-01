import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet, apiPost } from "../lib/api";
import { useWorkspace } from "./useWorkspace";
import { useToast } from "../components/ui/Toast";
import type { AgentId, PipelineEvent, StatusResponse } from "../types/api";

interface PipelineContextValue {
  runMode: StatusResponse["runMode"];
  running: boolean;
  desks: Partial<Record<AgentId, PipelineEvent>>;
  topicLine: string;
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
      }
      if (event.status === "error") {
        showToast(`Não foi possível concluir ${event.agent}: ${event.message ?? "Tente novamente."}`, "error");
        setRunning(false);
      }
    };

    return () => source.close();
  }, [workspace]);

  const runBlog = async () => {
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
    () => ({ runMode, running, desks, topicLine, runBlog, runInstagram }),
    [runMode, running, desks, topicLine, workspace],
  );

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}

export function usePipeline(): PipelineContextValue {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline precisa estar dentro de um PipelineProvider.");
  return ctx;
}
