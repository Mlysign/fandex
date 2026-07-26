import { User } from "lucide-react";
import Image from "next/image";

// <Avatar> — 03-components.md §10. Circle, radius-full, surface-elevated,
// 1px border. Sizes: 34 (nav), 64 (cast/people rail), 84 (person facet
// header). Fallback: User icon or initials in serif.
export default function Avatar({
  src,
  name,
  size = 34,
  className = "",
}: {
  src?: string | null;
  name?: string;
  size?: 34 | 64 | 84;
  className?: string;
}) {
  const initial = name?.trim()?.[0]?.toUpperCase();
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 rounded-full bg-surface-elevated border border-border overflow-hidden ${className}`}
      style={{ width: size, height: size }}
    >
      {src ? (
        <Image src={src} alt={name ?? ""} width={size} height={size} className="w-full h-full object-cover" />
      ) : initial ? (
        <span className="font-serif text-text-primary" style={{ fontSize: size * 0.4 }} aria-hidden>
          {initial}
        </span>
      ) : (
        <User className="text-text-muted" style={{ width: size * 0.5, height: size * 0.5 }} aria-hidden />
      )}
    </span>
  );
}
