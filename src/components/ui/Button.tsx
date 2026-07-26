"use client";
import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

// Shared <Button> primitive (T27/U13, restyled H1.6b for Direction 2a
// "Ticket · Calm" — docs/design/fandex-handoff/03-components.md §7). Kills
// copy-pasted button styling; one place to tune the house button look.
// Provider-colored "Connect" buttons in Settings stay bespoke (source
// identity, U10) — those aren't this.
//
// Variant names are unchanged from the pre-restyle component ("outline" is
// not one of the design's four, but existing call sites use it — kept as a
// bordered/transparent variant distinct from "secondary"'s filled surface).
// Radius is contextual per the design spec ("shape is per placement"), not
// baked into variant: default is rounded (radius-lg/-sm by size), pass
// `pill` for primary CTAs and filter actions that want radius-full.

type Variant = "primary" | "secondary" | "outline" | "danger" | "ghost";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-text-on-accent hover:bg-accent-hover active:bg-accent-active",
  secondary: "bg-surface-elevated border border-border-strong text-text-primary hover:border-neutral-400 active:bg-neutral-750",
  outline: "border border-border-strong text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
  danger: "bg-danger text-neutral-950 hover:bg-danger-hover",
  ghost: "text-text-secondary hover:text-text-primary hover:bg-[rgb(237_231_220_/_0.06)]",
};

const SIZES: Record<Size, string> = {
  sm: "text-label px-3 py-1.5 rounded-sm min-h-[30px]",
  md: "text-label px-4 py-2 rounded-lg min-h-[38px]",
  lg: "text-label-lg px-4 h-11 rounded-lg",
  icon: "w-[38px] h-[38px] rounded-lg justify-center",
};

// Shared class string — also usable on an <a>/<Link> that should look like a
// button (avoids nesting a <button> inside an anchor).
export function buttonClasses(variant: Variant = "secondary", size: Size = "sm", extra = "") {
  const pillOverride = extra.includes("rounded-full") ? "" : "";
  return `inline-flex items-center justify-center gap-1.5 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-w-11 ${VARIANTS[variant]} ${SIZES[size]} ${pillOverride} ${extra}`;
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Force radius-full (primary CTAs, filter/pill actions) instead of the size default. */
  pill?: boolean;
  /** Hides the label, shows a centered spinner; sets aria-busy. Reduced-motion
   *  users get the same element with the spin collapsed by the global rule. */
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "sm", pill = false, loading = false, className = "", disabled, children, ...props },
  ref,
) {
  const radiusOverride = pill ? "!rounded-full" : "";
  return (
    <button
      ref={ref}
      className={buttonClasses(variant, size, `${radiusOverride} ${className}`)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : children}
    </button>
  );
});

export default Button;
