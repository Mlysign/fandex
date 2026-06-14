"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format, parseISO } from "date-fns";
import { MediaType } from "@/types";
import { SOURCE_COLORS } from "@/lib/constants";
import { TypeBadge } from "@/components/Badges";

export interface TooltipItem {
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  type: string;
  platformSources?: string[];
}

function SourceDots({ sources }: { sources: string[] }) {
  return (
    <div className="flex items-center gap-1">
      {sources.map((s) => (
        <span key={s} className="w-2 h-2 rounded-full" style={{ background: SOURCE_COLORS[s] ?? "#666" }} />
      ))}
    </div>
  );
}

interface TooltipProps {
  item: TooltipItem;
  anchor: HTMLElement;
}

export default function Tooltip({ item, anchor }: TooltipProps) {
  // Compute position once at mount from the anchor's viewport rect.
  // Using createPortal means we render into document.body — no scroll
  // containers in the way — so plain viewport coords are correct.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const w = 260;

  useEffect(() => {
    const rect = anchor.getBoundingClientRect();
    let left = rect.right + 12;
    if (left + w > window.innerWidth) left = rect.left - w - 12;
    const top = Math.min(rect.top, window.innerHeight - 240);
    setPos({ top, left });
  }, [anchor]);

  if (!pos) return null;

  const tooltip = (
    <div
      className="fixed z-[9999] bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden pointer-events-none"
      style={{ top: pos.top, left: pos.left, width: w }}
    >
      {item.posterUrl && (
        <img src={item.posterUrl} alt={item.title} className="w-full h-32 object-cover" />
      )}
      <div className="p-3 space-y-1.5">
        <p className="font-semibold text-sm">{item.title}</p>
        <p className="text-xs text-neutral-400">
          {item.releaseDate ? format(parseISO(item.releaseDate), "MMM d, yyyy") : "TBA"}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <TypeBadge type={item.type as MediaType} />
          {item.platformSources && <SourceDots sources={item.platformSources} />}
        </div>
      </div>
    </div>
  );

  return createPortal(tooltip, document.body);
}
