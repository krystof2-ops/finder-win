import type { LucideIcon } from "lucide-react";

type EmptyStateProps = {
  Icon: LucideIcon;
  title: string;
  hint?: string;
};

/**
 * Prázdná plocha s vysvětlením — prázdná složka, hledání bez výsledků, štítek
 * bez položek, filtr bez shody. Uprostřed plochy, tlumeně, ať neruší.
 */
export function EmptyState({ Icon, title, hint }: EmptyStateProps) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center">
      <Icon size={40} strokeWidth={1.25} className="text-secondary opacity-50" aria-hidden />
      <p className="text-[13px] text-primary">{title}</p>
      {hint && <p className="max-w-[320px] text-[12px] text-secondary">{hint}</p>}
    </div>
  );
}
