"use client";

// Shared <Chip> primitive (T27/U13, restyled H1.6b) — the pill-shaped filter
// toggle used across SubBar (All / type / source / hide-rated). `color`
// defaults to the accent gold; pass a media/source color for color-coded
// chips, and `dot` for the leading identity dot.

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** Active accent color (border/fill/text). Defaults to the brass accent. */
  color?: string;
  /** Leading dot color; omit for no dot. */
  dot?: string;
}

export default function Chip({ active = false, color = "#C8A24B", dot, className = "", children, ...props }: ChipProps) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 text-label px-3 py-1.5 rounded-full border transition-colors min-h-[30px] ${className}`}
      style={{
        borderColor: active ? color : "transparent",
        background: active ? `${color}24` : "var(--color-surface-elevated)",
        color: active ? color : "var(--color-text-secondary)",
      }}
      {...props}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot }} />}
      {children}
    </button>
  );
}
