import { useEffect, useRef, useState } from "react";
import { invoke } from "../fileops";
import { folderDisplayName } from "./icons";
import { breadcrumbs, formatFreeSpace, formatItemCount } from "../format";
import { useT } from "../i18n";
import { isTypingTarget } from "../lib/dom";

/**
 * Vlastní komponenta schválně: mountuje se až ve chvíli editace, takže
 * useState dostane cestu hned při prvním renderu. Kdyby se hodnota
 * dosazovala efektem, select() by proběhl nad starou hodnotou a následný
 * re-render řízeného inputu by výběr zahodil (kurzor by skončil na konci).
 */
function PathInput({
  initial,
  onNavigate,
  onDone,
}: {
  initial: string;
  onNavigate: (path: string) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function submit() {
    const target = draft.trim();
    if (target.length === 0) {
      finished.current = true;
      onDone();
      return;
    }

    // Navigovat se dá jen tam, kam jde vypsat obsah — jinak zůstane input otevřený.
    try {
      await invoke("can_list_dir", { path: target });
      finished.current = true;
      onDone();
      onNavigate(target);
    } catch {
      setInvalid(true);
      inputRef.current?.focus();
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      spellCheck={false}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          void submit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          finished.current = true;
          onDone();
        }
      }}
      onBlur={() => {
        // Neplatnou cestu držíme otevřenou, ať uživatel nepřijde o rozepsané.
        if (!finished.current && !invalid) onDone();
      }}
      className="min-w-0 flex-1 rounded-sm px-1 text-[11px] text-primary outline-none"
      style={{
        background: "var(--bg-main)",
        border: `1px solid ${invalid ? "var(--danger)" : "var(--accent)"}`,
        userSelect: "text",
      }}
    />
  );
}

type StatusBarProps = {
  path: string | null;
  /** Počet po filtru. */
  itemCount: number;
  /** Počet ve složce bez filtru. */
  totalCount: number;
  /** Velká složka se ještě dočítá — kolik položek zatím dorazilo. */
  streamingCount?: number | null;
  filtered: boolean;
  /** Kolik položek je vybraných; 0 = ukazuje se jen počet. */
  selectedCount: number;
  freeSpace: number | null;
  onNavigate: (path: string) => void;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Pravý klik kamkoliv do lišty mimo editaci cesty. */
  onContextMenu: (x: number, y: number) => void;
};

export function StatusBar({
  path,
  itemCount,
  totalCount,
  streamingCount = null,
  filtered,
  selectedCount,
  freeSpace,
  onNavigate,
  editing,
  onEditingChange,
  onContextMenu,
}: StatusBarProps) {
  const t = useT();
  const crumbs = path ? breadcrumbs(path) : [];

  // Jeden řetězec: dva textové uzly vedle sebe (počet + volné místo) by při
  // změně počtu posunuly ten druhý — layout shift.
  const counts = path
    ? streamingCount !== null
      ? t("status.loading", { count: streamingCount })
      : selectedCount > 0
        ? t("status.selected", { selected: selectedCount, count: itemCount })
        : filtered
          ? t("status.filtered", { shown: itemCount, count: totalCount })
          : formatItemCount(itemCount)
    : "";
  const summary = path && freeSpace !== null ? `${counts}, ${formatFreeSpace(freeSpace)}` : counts;

  return (
    // 22 px, 11 px písmo; drobky s › a podtržením při najetí, vpravo počty.
    <footer
      onContextMenu={(event) => {
        // V editaci cesty zůstává menu webview — kvůli Vložit.
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        onContextMenu(event.clientX, event.clientY);
      }}
      className="flex h-[22px] shrink-0 items-center justify-between gap-4 border-t border-line bg-toolbar px-3 text-[11px] text-secondary">
      {editing ? (
        <PathInput
          initial={path ?? ""}
          onNavigate={onNavigate}
          onDone={() => onEditingChange(false)}
        />
      ) : (
        // key: jiná cesta = nové drobky. Přeskládání starých uzlů by se
        // počítalo jako posun obsahu (layout shift).
        <div key={path ?? ""} className="flex min-w-0 items-center">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path} className="flex min-w-0 items-center">
              {index > 0 && <span className="px-1 opacity-60">›</span>}
              <button
                type="button"
                onClick={() => onNavigate(crumb.path)}
                className="truncate rounded px-0.5 underline-offset-2 hover:text-primary hover:underline"
              >
                {folderDisplayName(crumb.path, crumb.label)}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Pevná šířka: počty se při výběru mění ("Vybráno 1 z 2000") a pružný
          blok by pokaždé posunul a přezkrátil drobky vlevo (layout shift).
          300 px unese i nejdelší anglickou variantu
          ("1,234 of 12,345 (filtered), 85.9 GB available"). */}
      <div className="w-[300px] shrink-0 overflow-hidden text-right whitespace-nowrap tabular-nums">
        {/* key: nový uzel pro nový text. Přepsaný text zarovnaný vpravo by
            se posunul (jiná šířka) a hlásil se jako layout shift. */}
        <span key={summary}>{summary}</span>
      </div>
    </footer>
  );
}
