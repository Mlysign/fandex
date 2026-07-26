"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";

// Styled confirm dialog (T27/U11, restyled H1.6b onto the shared <Sheet>
// primitive — focus trap + Escape + return-focus now come from there) —
// replaces the blocking native `confirm()` (settings disconnect) with an
// in-app modal in the house style. Promise-based:
// `const ok = await confirm({ title, message, danger: true })`.

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export default function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
    // opts stays set — Sheet keeps rendering the closing dialog's content
    // through its exit transition; the next confirm() overwrites it before
    // it's shown again.
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Sheet open={open} onClose={() => close(false)} title={opts?.title ?? "Confirm"} className="p-5 sm:p-6">
        {opts && (
          <div className="space-y-4">
            <h3 className="font-serif text-serif-md text-text-primary">{opts.title}</h3>
            {opts.message && <p className="text-body-sm text-text-secondary leading-relaxed">{opts.message}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost" onClick={() => close(false)}>
                {opts.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={opts.danger ? "danger" : "primary"}
                autoFocus
                onClick={() => close(true)}
              >
                {opts.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </ConfirmContext.Provider>
  );
}
