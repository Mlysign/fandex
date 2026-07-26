"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { X } from "lucide-react";

// Lightweight global toast (T27/U5) — surfaces the rate/wishlist/sync failures
// that `useQuickActions` previously swallowed silently. Mounted once via
// AppProviders in the root layout; any client component calls `useToast()`.

export type ToastType = "error" | "success" | "info";
interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastApi {
  toast: (message: string, type?: ToastType) => void;
}

// Default no-op so `useToast()` is safe even outside a provider (e.g. tests).
const ToastContext = createContext<ToastApi>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const STYLES: Record<ToastType, string> = {
  error: "bg-danger-subtle border-danger text-danger",
  success: "bg-success-subtle border-success text-success",
  info: "bg-surface-overlay border-border text-text-primary",
};

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, type === "error" ? 5000 : 3000);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-[calc(100vw-2rem)] w-80 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2 border rounded-xl px-4 py-3 text-body-sm shadow-lg backdrop-blur ${STYLES[t.type]}`}
          >
            <span className="flex-1 leading-snug">{t.message}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="opacity-60 hover:opacity-100 transition-opacity shrink-0">
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
