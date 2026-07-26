// <Eyebrow> — not a component in 03-components.md, a text style: mono
// --text-eyebrow UPPERCASE, accent (section eyebrows) or secondary tone.
export default function Eyebrow({
  tone = "accent",
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "accent" | "secondary" }) {
  return (
    <span
      className={`font-mono text-eyebrow uppercase ${tone === "accent" ? "text-accent" : "text-text-secondary"} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
