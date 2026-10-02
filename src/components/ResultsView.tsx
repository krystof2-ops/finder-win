import { useEffect, useMemo } from "react";

import { EmptyState } from "./EmptyState";
import { SmallEntryIcon } from "./icons";
import { TagDots } from "./TagDots";
import { entryOpacity, formatModified, sortEntries } from "../format";
import { parentPath, relativeParent } from "../fileops";
import { useT } from "../i18n";
import { tagsOf } from "../lib/storage";
import { useStorage } from "../lib/useStorage";
import type { FileEntry } from "../types";

/** Sloupec s puntíky, Název, Kde je, Datum úpravy. */
const GRID_TEMPLATE = "24px minmax(0, 1fr) minmax(0, 1.2fr) 140px";

type ResultsViewProps = {
  entries: FileEntry[];
  /** První načtení — dokud nic nedorazilo, ukazuje se "Načítám…". */
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  /** Prázdný stav — ikona, nadpis a nápověda. */
  empty: React.ComponentProps<typeof EmptyState>;
  /** Kořen hledání. Se ním je "Kde je" relativně k němu, bez něj plná cesta. */
  root?: string;
  /** Patička pod výsledky ("Zobrazeno prvních 500 výsledků."). */
  footer?: React.ReactNode;
  windowFocused: boolean;
  /** Výběr drží App — potřebuje ho pro Ctrl+C a kontextové menu. */
  selectedPath: string | null;
  onSelectionChange: (entry: FileEntry | null) => void;
  /** Dvojklik — složka se otevře, soubor spustí výchozí aplikací. */
  onOpen: (entry: FileEntry) => void;
  /** Pravý klik — stejné menu jako u běžné položky (včetně Zobrazit ve složce). */
  onContextMenu: (entry: FileEntry, x: number, y: number) => void;
  /** Ať status bar hlásí počet výsledků, ne obsah podkladové složky. */
  onCountChange: (count: number) => void;
};

/**
 * Seznam položek z různých složek — výsledky hledání i tag view. Chová se jako
 * Finder: jeden klik vybere, dvojklik otevře. Odkrytí v nadřazené složce je
 * v kontextovém menu (dřív to dělal jeden klik a dvojklik byl nedosažitelný).
 */
export function ResultsView({
  entries,
  loading,
  loadingMessage,
  error,
  empty,
  root,
  footer,
  windowFocused,
  selectedPath,
  onSelectionChange,
  onOpen,
  onContextMenu,
  onCountChange,
}: ResultsViewProps) {
  const t = useT();
  const { tags } = useStorage();
  const selected = selectedPath;

  // Stejné řazení jako hlavní výpis — složky první, pak přirozeně podle názvu.
  const sorted = useMemo(() => sortEntries(entries, "name", "asc"), [entries]);

  useEffect(() => {
    onCountChange(sorted.length);
  }, [sorted.length, onCountChange]);

  if (loading && entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-[13px] text-secondary">
        {loadingMessage}
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-secondary">
        {error}
      </div>
    );
  }

  if (sorted.length === 0) return <EmptyState {...empty} />;

  const selectedClass = windowFocused ? "bg-selected" : "bg-selected-inactive";

  /** ↑↓ Home End: posun výběru s fokusem, řádek se vždy doscrolluje do obrazu. */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const current = sorted.findIndex((entry) => entry.path === selected);
    let index: number;
    switch (event.key) {
      case "ArrowDown":
        index = current < 0 ? 0 : current + 1;
        break;
      case "ArrowUp":
        index = current < 0 ? sorted.length - 1 : current - 1;
        break;
      case "Home":
        index = 0;
        break;
      case "End":
        index = sorted.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const next = sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
    onSelectionChange(next);
    const row = event.currentTarget.querySelector<HTMLElement>(`[data-path="${CSS.escape(next.path)}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="min-w-0" role="listbox" aria-label={t("results.label")} onKeyDown={handleKeyDown}>
      <div
        className="sticky top-0 z-10 grid h-6 items-center gap-3 border-b border-line bg-toolbar px-3 text-[11px] font-medium text-secondary"
        style={{ gridTemplateColumns: GRID_TEMPLATE, backdropFilter: "blur(20px)" }}
      >
        <span aria-hidden />
        <span className="truncate">{t("sort.name")}</span>
        <span className="truncate">{t("results.where")}</span>
        <span className="truncate">{t("sort.modified")}</span>
      </div>

      {sorted.map((entry) => {
        const isSelected = entry.path === selected;
        const where =
          root === undefined ? (parentPath(entry.path) ?? entry.path) : relativeParent(entry.path, root);

        return (
          <div
            key={entry.path}
            role="option"
            aria-selected={isSelected}
            tabIndex={0}
            data-path={entry.path}
            data-tooltip={entry.path}
            onClick={() => onSelectionChange(entry)}
            // Fokus z klávesnice (Tab, šipka z pole hledání) vybírá taky.
            onFocus={() => onSelectionChange(entry)}
            onDoubleClick={() => onOpen(entry)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(entry);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelectionChange(entry);
              onContextMenu(entry, event.clientX, event.clientY);
            }}
            className={`fw-row fw-result-row grid h-6 items-center gap-3 px-3 text-[13px] text-primary ${
              isSelected ? selectedClass : "hover:bg-hover"
            }`}
            style={{ gridTemplateColumns: GRID_TEMPLATE, opacity: entryOpacity(entry, false) }}
          >
            <span className="flex items-center">
              <TagDots colors={tagsOf(tags, entry.path)} size={8} />
            </span>

            <div className="flex min-w-0 items-center gap-2">
              <SmallEntryIcon entry={entry} />
              <span className="truncate">{entry.name}</span>
            </div>

            {/* Prázdné "kde" ve výsledcích hledání = přímo v prohledávané složce. */}
            <span className="truncate text-secondary">{where === "" ? "—" : where}</span>
            <span className="truncate text-secondary">{formatModified(entry.modified)}</span>
          </div>
        );
      })}

      {footer}
    </div>
  );
}
