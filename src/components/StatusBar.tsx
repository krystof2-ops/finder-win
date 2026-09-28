import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { breadcrumbs, formatFreeSpace, formatItemCount } from "../format";
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
      await invoke("list_dir", { path: target });
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
  filtered,
  selectedCount,
  freeSpace,
  onNavigate,
  editing,
  onEditingChange,
  onContextMenu,
}: StatusBarProps) {
  const crumbs = path ? breadcrumbs(path) : [];

  return (
    // 22 px, 11 px písmo; drobky s › a podtržením při najetí, vpravo počty.
    <footer
      onContextMenu={(event) => {
        // V editaci cesty zůstává menu webview — kvůli Vložit.
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        onContextMenu(event.clientX, event.clientY);
      }}
      className="surface flex h-[22px] shrink-0 items-center justify-between gap-4 border-t border-line bg-toolbar px-3 text-[11px] text-secondary">
      {editing ? (
        <PathInput
          initial={path ?? ""}
          onNavigate={onNavigate}
          onDone={() => onEditingChange(false)}
        />
      ) : (
        <div className="flex min-w-0 items-center">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path} className="flex min-w-0 items-center">
              {index > 0 && <span className="px-1 opacity-60">›</span>}
              <button
                type="button"
                onClick={() => onNavigate(crumb.path)}
                className="truncate rounded px-0.5 underline-offset-2 transition-colors duration-100 hover:text-primary hover:underline"
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="shrink-0 whitespace-nowrap tabular-nums">
        {path &&
          (selectedCount > 0
            ? `Vybráno ${selectedCount} z ${itemCount}`
            : filtered
              ? `${itemCount} z ${totalCount} (filtr)`
              : formatItemCount(itemCount))}
        {path && freeSpace !== null && `, ${formatFreeSpace(freeSpace)}`}
      </div>
    </footer>
  );
}
