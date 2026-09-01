import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet } from "../lib/api";
import type { WorkspaceSummary } from "../types/api";

const STORAGE_KEY = "office.workspaceId";

interface WorkspaceContextValue {
  workspace: string;
  workspaces: WorkspaceSummary[];
  setWorkspace: (id: string) => void;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function readInitialWorkspaceId(): string {
  const fromUrl = new URL(window.location.href).searchParams.get("workspace");
  return fromUrl || localStorage.getItem(STORAGE_KEY) || "";
}

function persistWorkspaceId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", id);
  window.history.replaceState({}, "", url);
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspace, setWorkspaceState] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    apiGet<WorkspaceSummary[]>("/api/workspaces", undefined, controller.signal)
      .then((list) => {
        setWorkspaces(list);
        const requested = readInitialWorkspaceId();
        const initial = list.some((w) => w.id === requested) ? requested : (list[0]?.id ?? "");
        setWorkspaceState(initial);
        if (initial) persistWorkspaceId(initial);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") throw err;
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const setWorkspace = (id: string) => {
    persistWorkspaceId(id);
    setWorkspaceState(id);
  };

  const value = useMemo(
    () => ({ workspace, workspaces, setWorkspace, loading }),
    [workspace, workspaces, loading],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace precisa estar dentro de um WorkspaceProvider.");
  return ctx;
}
