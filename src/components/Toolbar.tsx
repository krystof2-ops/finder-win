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
  /** Vedlejší nástroj: menší tlumená ikona (15 px, tah 1.5). */
  secondary?: boolean;
  /** Otevírá menu — kontextové menu ho při kliknutí mimo sebe nechá být. */
  menuTrigger?: boolean;
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
  secondary = false,
  menuTrigger = false,
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={unavailable !== undefined || undefined}
      data-tooltip={unavailable ?? label}
      data-fw-menu-trigger={menuTrigger || undefined}
      disabled={disabled}
      onClick={unavailable === undefined ? onClick : undefined}
      onMouseDown={(event) => {
        // Tlačítko si fokus nebere — jinak by po kliku přestaly fungovat
        // šipky ve výpisu (column view drží klávesnici na svém kontejneru).
        event.preventDefault();
        if (unavailable === undefined) onMouseDown?.(event);
      }}
      className={`fw-tool-btn flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
        secondary ? "fw-tool-secondary" : "text-primary"
      } ${
        unavailable !== undefined ? "opacity-35" : active ? "bg-selected" : "hover:bg-hover"
      } disabled:pointer-events-none disabled:opacity-35`}
    >
      <Icon
        size={secondary ? 15 : 16}
        strokeWidth={secondary ? 1.5 : 1.75}
        className={iconClassName}
      />
    </button>
  );
}

/** Pořadí segmentů přepínače zobrazení. */
const VIEW_SEGMENTS: { mode: ViewMode; label: string; Icon: LucideIcon }[] = [
  { mode: "icon", label: "Zobrazit jako ikony", Icon: LayoutGrid },
  { mode: "list", label: "Zobrazit jako seznam", Icon: List },
  { mode: "column", label: "Zobrazit jako sloupce", Icon: Columns3 },
];

/** Jeden segmented control místo tří samostatných tlačítek, jako ve Finderu.
 *  Vyzdvižený segment se mezi pozicemi posouvá transformací. */
function ViewSwitcher({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const index = VIEW_SEGMENTS.findIndex((segment) => segment.mode === mode);

  return (
    <div className="fw-segmented shrink-0" role="radiogroup" aria-label="Zobrazení">
      <span
        aria-hidden
        className="fw-segment-thumb"
        style={{ width: 30, transform: `translateX(${index * 30}px)` }}
      />
      {VIEW_SEGMENTS.map(({ mode: segment, label, Icon }) => (
        <button
          key={segment}
          type="button"
          role="radio"
          aria-checked={segment === mode}
          aria-label={label}
          data-tooltip={label}
          // Jako ostatní tlačítka toolbaru si fokus nebere (šipky ve výpisu).
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange(segment)}
          className="fw-segment"
        >
          <Icon size={15} strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}

type ToolbarProps = {
  folderName: string;
  /** Malá ikona před názvem — stejná jako u složky v sidebaru. */
  folderIcon: React.ReactNode;
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
  /** ↓ v poli hledání — přesun do výsledků. */
  onSearchArrowDown: () => void;
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
  folderIcon,
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
  onSearchArrowDown,
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
    // Skupiny s mezerou 12 px: [zpět/vpřed] [název] … [zobrazení] [seřadit]
    // [sdílet, štítky] [více] [téma] [hledání].
    <header className="fw-toolbar flex h-10 shrink-0 items-center gap-3 px-3">
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton Icon={ChevronLeft} label="Zpět" disabled={!canGoBack} onClick={onBack} />
        <IconButton
          Icon={ChevronRight}
          label="Vpřed"
          disabled={!canGoForward}
          onClick={onForward}
        />
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex shrink-0 items-center" aria-hidden>
          {folderIcon}
        </span>
        <h1 className="truncate text-[15px] font-semibold text-primary">{folderName}</h1>
      </div>

      <div className="flex-1" />

      <ViewSwitcher mode={viewMode} onChange={onViewModeChange} />

      <IconButton
        Icon={SlidersHorizontal}
        label="Seřadit"
        secondary
        active={menu?.kind === "sort"}
        menuTrigger
        onMouseDown={toggleMenu("sort")}
      />

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          Icon={Share}
          label="Sdílet"
          secondary
          active={menu?.kind === "share"}
          menuTrigger
        onMouseDown={toggleMenu("share")}
        />
        <IconButton
          Icon={Tag}
          label="Štítky"
          secondary
          active={menu?.kind === "tags"}
          unavailable={tagItems === null ? "Vyberte soubor" : undefined}
          menuTrigger
        onMouseDown={toggleMenu("tags")}
        />
      </div>

      <IconButton
        Icon={MoreHorizontal}
        label="Více"
        secondary
        active={menu?.kind === "more"}
        menuTrigger
        onMouseDown={toggleMenu("more")}
      />

      <IconButton
        Icon={theme === "dark" ? Sun : Moon}
        label={theme === "dark" ? "Světlý režim" : "Tmavý režim"}
        secondary
        onClick={onToggleTheme}
        iconClassName="fw-theme-spin"
      />

      <div className="fw-search group flex shrink-0 items-center gap-1.5 bg-hover px-2.5">
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
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onSearchArrowDown();
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
          triggerSelector="[data-fw-menu-trigger]"
        />
      )}
    </header>
  );
}
