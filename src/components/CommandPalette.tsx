import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, FileSearch, Search, Zap } from "lucide-react";

import { FolderIcon, folderDisplayName } from "./icons";
import type { Command } from "../commands";
import { breadcrumbs } from "../format";
import { useT } from "../i18n";
import { TAG_COLORS, TAG_HEX, tagLabel } from "../lib/tags";
import type { TagColor } from "../types";

/**
 * Paleta příkazů (Ctrl+K), jako Spotlight / Raycast: složky, akce a štítky
 * v jednom seznamu. Hledání je vlastní fuzzy shoda — žádná knihovna.
 */

/** Složka nabízená paletou a odkud se vzala. */
export type PaletteFolder = { path: string; source: "favorite" | "recent" | "tab" | "subfolder" };

type Category = "all" | "folders" | "actions" | "tags";
const CATEGORIES: Category[] = ["all", "folders", "actions", "tags"];

type Result = {
  key: string;
  category: Exclude<Category, "all"> | "files";
  title: string;
  detail?: string;
  shortcut?: string;
  icon: React.ReactNode;
  score: number;
  run: () => void;
};

type CommandPaletteProps = {
  commands: Command[];
  folders: PaletteFolder[];
  /** Nedávné složky pro prázdné pole (nejnovější první). */
  recentFolders: string[];
  /** Kolikrát se který příkaz spustil (settings.json). */
  usage: Record<string, number>;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
  /** Text, který vypadá jako cesta (C:\…, \\server, ~) — přímý skok. */
  onGoToPath: (text: string) => void;
  onSelectTag: (color: TagColor) => void;
  /** Enter bez výsledku: rekurzivní hledání souborů v aktuální složce. */
  onSearchFiles: (query: string) => void;
  onRunCommand: (command: Command) => void;
};

/* ----------------------------- fuzzy scorer ------------------------------ */

/** Bez diakritiky a velikosti písmen — „cerv" najde „Červený". */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Skóre shody, nebo null. Písmena dotazu musí jít v textu po sobě (s mezerami
 * mezi nimi). Body za souvislé úseky, za začátky slov a za shodu od začátku;
 * kratší text a dřívější první shoda vyhrávají.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = normalize(query).replace(/\s+/g, "");
  if (needle === "") return 0;
  const haystack = normalize(text);

  let score = 0;
  let from = 0;
  let previous = -2;
  let first = -1;
  for (const char of needle) {
    const found = haystack.indexOf(char, from);
    if (found < 0) return null;
    if (first < 0) first = found;
    score += 1;
    if (found === previous + 1) score += 4;
    if (found === 0 || /[\s\\/._\-:]/.test(haystack[found - 1])) score += 6;
    previous = found;
    from = found + 1;
  }
  if (haystack.startsWith(needle)) score += 10;
  return score - first * 0.1 - (haystack.length - needle.length) * 0.02;
}

/** Text, který chce rovnou na cestu: C:\…, C:/…, \\server\share, ~ */
function looksLikePath(text: string): boolean {
  return /^([a-z]:([\\/]|$)|\\\\|~([\\/]|$))/i.test(text.trim());
}

function folderTitle(path: string): string {
  const crumbs = breadcrumbs(path);
  const last = crumbs[crumbs.length - 1];
  return last ? folderDisplayName(last.path, last.label) : path;
}

/* ------------------------------- komponenta ------------------------------- */

export function CommandPalette({
  commands,
  folders,
  recentFolders,
  usage,
  onClose,
  onOpenFolder,
  onGoToPath,
  onSelectTag,
  onSearchFiles,
  onRunCommand,
}: CommandPaletteProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const sourceLabel: Record<PaletteFolder["source"], string> = {
    favorite: t("palette.sourceFavorite"),
    recent: t("palette.sourceRecent"),
    tab: t("palette.sourceTab"),
    subfolder: t("palette.sourceSubfolder"),
  };

  const results = useMemo((): Result[] => {
    const text = query.trim();
    const all: Result[] = [];

    const folderResult = (path: string, source: PaletteFolder["source"], score: number): Result => ({
      key: `folder:${path}`,
      category: "folders",
      title: folderTitle(path),
      detail: `${sourceLabel[source]} · ${path}`,
      icon: <FolderIcon size={16} />,
      score,
      run: () => onOpenFolder(path),
    });
    const commandResult = (command: Command, score: number): Result => ({
      key: `command:${command.id}`,
      category: "actions",
      title: command.title,
      shortcut: command.shortcut,
      icon: <Zap size={15} strokeWidth={1.75} className="text-secondary" />,
      score,
      run: () => onRunCommand(command),
    });

    // Prázdné pole: nedávné složky a nejpoužívanější akce.
    if (text === "") {
      if (category === "all" || category === "folders") {
        recentFolders.slice(0, 6).forEach((path, index) => all.push(folderResult(path, "recent", 100 - index)));
      }
      if (category === "all" || category === "actions") {
        [...commands]
          .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))
          .slice(0, category === "actions" ? commands.length : 5)
          .forEach((command, index) => all.push(commandResult(command, 50 - index)));
      }
      if (category === "tags") {
        TAG_COLORS.forEach((color, index) => all.push(tagResult(color, 10 - index)));
      }
      return all;
    }

    function tagResult(color: TagColor, score: number): Result {
      return {
        key: `tag:${color}`,
        category: "tags",
        title: tagLabel(color),
        detail: t("palette.tagDetail"),
        icon: <span className="block h-2.5 w-2.5 rounded-full" style={{ background: TAG_HEX[color] }} />,
        score,
        run: () => onSelectTag(color),
      };
    }

    // „tag:červ" — jen štítky.
    const tagQuery = /^tags?:\s*(.*)$/i.exec(text);
    if (tagQuery) {
      for (const color of TAG_COLORS) {
        const score = Math.max(fuzzyScore(tagQuery[1], tagLabel(color)) ?? -1, fuzzyScore(tagQuery[1], color) ?? -1);
        if (score >= 0) all.push(tagResult(color, score));
      }
      return all.sort((a, b) => b.score - a.score);
    }

    if (looksLikePath(text) && (category === "all" || category === "folders")) {
      all.push({
        key: "goto",
        category: "folders",
        title: t("palette.goTo", { path: text }),
        icon: <CornerDownLeft size={15} strokeWidth={1.75} className="text-secondary" />,
        score: 1000,
        run: () => onGoToPath(text),
      });
    }

    if (category === "all" || category === "folders") {
      const seen = new Set<string>();
      for (const folder of folders) {
        const key = folder.path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const score = Math.max(fuzzyScore(text, folderTitle(folder.path)) ?? -1, (fuzzyScore(text, folder.path) ?? -1) - 5);
        if (score >= 0) all.push(folderResult(folder.path, folder.source, score));
      }
    }
    if (category === "all" || category === "actions") {
      for (const command of commands) {
        const score = fuzzyScore(text, command.title);
        // Častěji používané akce mírně dopředu.
        if (score !== null) all.push(commandResult(command, score + Math.min(usage[command.id] ?? 0, 20) * 0.2));
      }
    }
    if (category === "all" || category === "tags") {
      for (const color of TAG_COLORS) {
        const score = fuzzyScore(text, tagLabel(color));
        if (score !== null) all.push(tagResult(color, score - 2));
      }
    }

    all.sort((a, b) => b.score - a.score);
    const limited = all.slice(0, 40);
    // Vždy jako poslední: hledat soubory tímhle textem v aktuální složce.
    if (category === "all" && !looksLikePath(text)) {
      limited.push({
        key: "files",
        category: "files",
        title: t("palette.searchFiles", { query: text }),
        icon: <FileSearch size={15} strokeWidth={1.75} className="text-secondary" />,
        score: -1,
        run: () => onSearchFiles(text),
      });
    }
    return limited;
    // sourceLabel a t závisí jen na jazyce, ten se během otevřené palety nemění.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, category, commands, folders, recentFolders, usage]);

  useEffect(() => setSelected(0), [query, category]);

  // Vybraný řádek vždy v zorném poli.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function choose(result: Result | undefined) {
    if (!result) {
      // Enter bez výsledku: soubory tímhle textem.
      if (query.trim() !== "") {
        onClose();
        onSearchFiles(query.trim());
      }
      return;
    }
    onClose();
    result.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // Klávesy palety nesmí propadnout do globálních zkratek.
    event.stopPropagation();
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        onClose();
        break;
      case "ArrowDown":
        event.preventDefault();
        setSelected((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelected((index) => Math.max(index - 1, 0));
        break;
      case "Enter":
        event.preventDefault();
        // Ctrl+Enter: rovnou hledání souborů tímhle textem, ať je nahoře cokoli.
        if (event.ctrlKey && query.trim() !== "") {
          onClose();
          onSearchFiles(query.trim());
          break;
        }
        // Během skládání znaku (IME) Enter patří editoru, ne paletě.
        if (event.nativeEvent.isComposing) break;
        choose(results[selected]);
        break;
      case "k":
      case "K":
        // Ctrl+K paletu i zavírá — jako ve VS Code nebo Raycastu.
        if (event.ctrlKey) {
          event.preventDefault();
          onClose();
        }
        break;
      case "Tab": {
        event.preventDefault();
        const step = event.shiftKey ? -1 : 1;
        setCategory((current) => CATEGORIES[(CATEGORIES.indexOf(current) + step + CATEGORIES.length) % CATEGORIES.length]);
        break;
      }
    }
  }

  const categoryLabel: Record<Category, string> = {
    all: t("palette.all"),
    folders: t("palette.folders"),
    actions: t("palette.actions"),
    tags: t("palette.tags"),
  };

  return (
    <div className="fw-palette-backdrop" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("command.palette")}
        className="fw-palette fw-popover"
        onMouseDown={(event) => {
          event.stopPropagation();
          // Fokus zůstává v poli — jinak by klik na okraj seznamu nebo na
          // posuvník poslal klávesy (šipky, Escape) mimo paletu.
          if (event.target !== inputRef.current) event.preventDefault();
        }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <Search size={16} strokeWidth={2} className="shrink-0 text-secondary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("palette.placeholder")}
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="fw-palette-results"
            aria-activedescendant={results[selected] ? `fw-palette-${selected}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-primary outline-none placeholder:text-secondary"
            style={{ userSelect: "text" }}
          />
        </div>

        <div className="flex gap-1 border-y border-line px-3 py-1.5" role="tablist">
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={category === item}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setCategory(item)}
              className={`rounded-md px-2 py-0.5 text-[12px] ${
                category === item ? "bg-selected text-primary" : "text-secondary hover:bg-hover"
              }`}
            >
              {categoryLabel[item]}
            </button>
          ))}
          <span className="ml-auto self-center text-[11px] text-secondary">{t("palette.hints")}</span>
        </div>

        <div ref={listRef} id="fw-palette-results" role="listbox" className="fw-scroll max-h-[360px] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-secondary">{t("palette.noResults")}</div>
          ) : (
            results.map((result, index) => (
              <div
                key={result.key}
                id={`fw-palette-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === selected}
                onMouseMove={() => setSelected(index)}
                onClick={() => choose(result)}
                className={`flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-1.5 ${
                  index === selected ? "bg-selected" : ""
                }`}
              >
                <span className="flex w-4 shrink-0 items-center justify-center">{result.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-primary">{result.title}</span>
                  {result.detail && <span className="block truncate text-[11px] text-secondary">{result.detail}</span>}
                </span>
                {result.shortcut && <span className="shrink-0 text-[11px] text-secondary">{result.shortcut}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
