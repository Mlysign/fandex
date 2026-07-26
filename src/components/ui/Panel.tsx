// <Panel> — the elevated-surface container used everywhere (filter panels,
// stat cards, list-row groups, sheet bodies). 03-components.md's "panel"
// primitive: --color-surface-elevated, 1px --color-border, --radius-lg.
export default function Panel({
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-surface-elevated border border-border rounded-lg ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
