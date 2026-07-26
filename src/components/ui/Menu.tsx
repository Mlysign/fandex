"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";

// <Menu> — 03-components.md §11. Self-contained trigger + popover: renders
// its own button (so callers don't have to wire open state) and dismisses on
// outside click or Escape, returning focus to the trigger. Used by Sort,
// filter overflow, card overflow (MoreVertical) — those specific instances
// are H1.6d wiring; this is the shared shell.

export interface MenuItem {
  key: string;
  label: React.ReactNode;
  onSelect: () => void;
  selected?: boolean;
  disabled?: boolean;
}

export interface MenuProps {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu"; ref: React.Ref<HTMLButtonElement> }) => React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  label?: string;
}

export default function Menu({ trigger, items, align = "left", label }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      {trigger({
        onClick: () => setOpen((v) => !v),
        "aria-expanded": open,
        "aria-haspopup": "menu",
        ref: triggerRef,
      })}
      {open && (
        <div
          role="menu"
          id={menuId}
          aria-label={label}
          className={`absolute z-30 mt-1.5 min-w-[180px] py-1 bg-surface-overlay border border-border rounded-lg shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="w-full min-h-11 flex items-center gap-2 px-3 text-body-sm text-left text-text-primary hover:bg-[rgb(237_231_220_/_0.06)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Check className={`w-3.5 h-3.5 shrink-0 text-accent ${item.selected ? "opacity-100" : "opacity-0"}`} aria-hidden />
              <span className="flex-1">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
