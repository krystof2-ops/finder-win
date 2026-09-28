import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  LayoutGrid,
  List,
  Moon,
  MoreHorizontal,
  Search,
  Share,
  SlidersHorizontal,
  Sun,
  Tag,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { ContextMenu, type MenuItem } from "./ContextMenu";
import type { Theme, ViewMode } from "../types";

type IconButtonProps = {
  Icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Tlačítka otevírající menu potřebují mousedown — viz komentář u "Více". */
  onMouseDown?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Třída na samotnou ikonu, kvůli animaci uvnitř nehybného tlačítka. */
  iconClassName?: string;
  /** Vypnuté tlačítko s vysvětlením v tooltipu ("Vyberte soubor"). Obyčejné
   *  `disabled` by tooltip nedovolilo — vypnutý button nedostává myš. */
  unavailable?: string;
};

function IconButton({
  Icon,
  label,
  active = false,
  disabled = false,
  onClick,
  onMouseDown,
  iconClassName,
  unavailable,
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={unavailable !== undefined || undefined}
      data-tooltip={unavailable ?? label}
      disabled={disabled}
      onClick={unavailable === undefined ? onClick : undefined}
      onMouseDown={(event) => {
        // Tlačítko si fokus nebere — jinak by po kliku přestaly fungovat
        // šipky ve výpisu (column view drží klávesnici na svém kontejneru).
        event.preventDefault();
        if (unavailable === undefined) onMouseDown?.(event);
      }}
      className={`fw-tool-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-primary ${
        unavailable !== undefined ? "opacity-35" : active ? "bg-selected" : "hover:bg-hover"
      } disabled:pointer-events-none disabled:opacity-35`}
    >
      <Icon size={16} strokeWidth={1.75} className={iconClassName} />
    </button>
  );
}

type ToolbarProps = {
  folderName: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  theme: Theme;
  onToggleTheme: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Enter v poli — filtr aktuální složky se povýší na rekurzivní hledání. */
  onSearchSubmit: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onRefresh: () => void;
  onGoToParent: () => void;
  canGoToParent: boolean;
  /** About dialog drží App, aby byl stav modálů na jednom místě — globální
   *  zkratky se pod otevřeným dialogem musí vypnout. */
  onShowAbout: () => void;
  showHidden: boolean;
  onToggleHidden: () => void;
  /** Položky menu Seřadit / Sdílet / Štítky — sestavuje je App, zná výběr. */
  sortItems: MenuItem[];
  shareItems: MenuItem[];
  /** null = nic není vybrané, tlačítko Štítky je vypnuté. */
  tagItems: MenuItem[] | null;
  /** Otevřené menu musí App znát kvůli globálním zkratkám (modalOpen). */
  onMenuOpenChange: (open: boolean) => void;
};

type ToolbarMenu = "sort" | "share" | "tags" | "more";

export function Toolbar({
  folderName,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  viewMode,
  onViewModeChange,
  theme,
  onToggleTheme,
  query,
  onQueryChange,
  onSearchSubmit,
  searchRef,
  onRefresh,
  onGoToParent,
  canGoToParent,
  onShowAbout,
  showHidden,
  onToggleHidden,
  sortItems,
  shareItems,
  tagItems,
  onMenuOpenChange,
}: ToolbarProps) {
  // Otevřené může být jen jedno menu. Pozice se bere z rámečku tlačítka.
  const [menu, setMenu] = useState<{ kind: ToolbarMenu; x: number; y: number } | null>(null);

  useEffect(() => onMenuOpenChange(menu !== null), [menu, onMenuOpenChange]);

  /**
   * Přepínání musí běžet na mousedown se stopPropagation: ContextMenu se
   * zavírá posluchačem mousedown na window, takže by se na click otevřelo
   * znovu hned po zavření a tlačítko by menu nikdy nezavřelo.
   */
  function toggleMenu(kind: ToolbarMenu) {
    return (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu((current) =>
        current?.kind === kind ? null : { kind, x: rect.left, y: rect.bottom + 4 },
      );
    };
  }

  const moreItems: MenuItem[] = [
    { type: "item", label: "Aktualizovat", shortcut: "F5", onSelect: onRefresh },
    {
      type: "item",
      label: "Nadřazená složka",
      shortcut: "Ctrl+↑",
      disabled: !canGoToParent,
      onSelect: onGoToParent,
    },
    {
      type: "item",
      label: "Zobrazit skryté soubory",
      shortcut: "Ctrl+Shift+.",
      checked: showHidden,
      onSelect: onToggleHidden,
    },
    { type: "separator" },
    { type: "item", label: "O aplikaci Finder-Win", onSelect: onShowAbout },
  ];

  return (
    <header
      className="surface flex h-10 shrink-0 items-center gap-2 border-b border-line bg-toolbar px-3"
      style={{ backdropFilter: "blur(20px)" }}
    >
      <div className="flex shrink-0 items-center gap-1">
        <IconButton Icon={ChevronLeft} label="Zpět" disabled={!canGoBack} onClick={onBack} />
        <IconButton
          Icon={ChevronRight}
          label="Vpřed"
          disabled={!canGoForward}
          onClick={onForward}
        />
      </div>

      <h1 className="ml-3 truncate text-[15px] font-semibold text-primary">{folderName}</h1>

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          Icon={LayoutGrid}
          label="Zobrazit jako ikony"
          active={viewMode === "icon"}
          onClick={() => onViewModeChange("icon")}
        />
        <IconButton
          Icon={List}
          label="Zobrazit jako seznam"
          active={viewMode === "list"}
          onClick={() => onViewModeChange("list")}
        />
        <IconButton
          Icon={Columns3}
          label="Zobrazit jako sloupce"
          active={viewMode === "column"}
          onClick={() => onViewModeChange("column")}
        />
      </div>

      <IconButton
        Icon={SlidersHorizontal}
        label="Seřadit"
        active={menu?.kind === "sort"}
        onMouseDown={toggleMenu("sort")}
      />
      <IconButton
        Icon={Share}
        label="Sdílet"
        active={menu?.kind === "share"}
        onMouseDown={toggleMenu("share")}
      />
      <IconButton
        Icon={Tag}
        label="Štítky"
        active={menu?.kind === "tags"}
        unavailable={tagItems === null ? "Vyberte soubor" : undefined}
        onMouseDown={toggleMenu("tags")}
      />
      <IconButton
        Icon={MoreHorizontal}
        label="Více"
        active={menu?.kind === "more"}
        onMouseDown={toggleMenu("more")}
      />

      <IconButton
        Icon={theme === "dark" ? Sun : Moon}
        label={theme === "dark" ? "Světlý režim" : "Tmavý režim"}
        onClick={onToggleTheme}
        iconClassName="fw-theme-spin"
      />

      <div className="fw-search group flex h-7 w-[180px] shrink-0 items-center gap-1.5 rounded-md bg-hover px-2.5 py-1 focus-within:w-[240px]">
        <Search size={14} strokeWidth={2} className="shrink-0 text-secondary" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              onQueryChange("");
              event.currentTarget.blur();
            }
            if (event.key === "Enter") {
              event.preventDefault();
              onSearchSubmit();
            }
          }}
          placeholder="Hledat"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-secondary"
          style={{ userSelect: "text" }}
        />

        {query.length > 0 && (
          <button
            type="button"
            aria-label="Zrušit hledání"
            onClick={() => {
              onQueryChange("");
              searchRef.current?.focus();
            }}
            className="shrink-0 text-secondary transition-colors duration-100 hover:text-primary"
          >
            <XCircle size={14} strokeWidth={2} />
          </button>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            menu.kind === "sort"
              ? sortItems
              : menu.kind === "share"
                ? shareItems
                : menu.kind === "tags"
                  ? (tagItems ?? [])
                  : moreItems
          }
          onClose={() => setMenu(null)}
        />
      )}
    </header>
  );
}
