import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type ToastType = "info" | "success" | "error";

interface ToastState {
  text: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (text: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((text: string, type: ToastType = "info") => {
    setToast({ text, type });
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className={`toast ${toast?.type ?? ""} ${toast ? "" : "hidden"}`}>{toast?.text}</div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa estar dentro de um ToastProvider.");
  return ctx;
}
