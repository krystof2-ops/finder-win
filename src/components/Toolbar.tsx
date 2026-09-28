import { useState } from "react";
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
};

function IconButton({
  Icon,
  label,
  active = false,
  disabled = false,
  onClick,
  onMouseDown,
  iconClassName,
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={label}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(event) => {
        // Tlačítko si fokus nebere — jinak by po kliku přestaly fungovat
        // šipky ve výpisu (column view drží klávesnici na svém kontejneru).
        event.preventDefault();
        onMouseDown?.(event);
      }}
      className={`fw-tool-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-primary ${
        active ? "bg-selected" : "hover:bg-hover"
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
};

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
}: ToolbarProps) {
  // Menu se otevírá pod tlačítkem, proto se pozice bere z jeho rámečku.
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);

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
      shortcut: "Ctrl+H",
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

      {/* Zatím jen vizuální prvky toolbaru — chování k nim zadání neurčuje. */}
      <IconButton Icon={SlidersHorizontal} label="Seřadit" />
      <IconButton Icon={Share} label="Sdílet" />
      <IconButton Icon={Tag} label="Štítky" />

      {/* Přepínání musí běžet na mousedown se stopPropagation: ContextMenu se
          zavírá posluchačem mousedown na window, takže by se na click otevřelo
          znovu hned po zavření a tlačítko by menu nikdy nezavřelo. */}
      <IconButton
        Icon={MoreHorizontal}
        label="Více"
        active={moreMenu !== null}
        onMouseDown={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setMoreMenu((current) => (current ? null : { x: rect.left, y: rect.bottom + 4 }));
        }}
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

      {moreMenu && (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          items={moreItems}
          onClose={() => setMoreMenu(null)}
        />
      )}
    </header>
  );
}
