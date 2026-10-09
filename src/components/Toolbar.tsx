import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Columns3,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Search,
  Share,
  SlidersHorizontal,
  Tag,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { ContextMenu, type MenuItem } from "./ContextMenu";
import type { CommandId, Command, Commands } from "../commands";
import { useT, type MessageKey } from "../i18n";
import type { ViewMode } from "../types";

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
const VIEW_SEGMENTS: { mode: ViewMode; label: MessageKey; Icon: LucideIcon }[] = [
  { mode: "icon", label: "toolbar.viewAsIcons", Icon: LayoutGrid },
  { mode: "list", label: "toolbar.viewAsList", Icon: List },
  { mode: "column", label: "toolbar.viewAsColumns", Icon: Columns3 },
];

/** Jeden segmented control místo tří samostatných tlačítek, jako ve Finderu.
 *  Vyzdvižený segment se mezi pozicemi posouvá transformací. */
function ViewSwitcher({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const t = useT();
  const index = VIEW_SEGMENTS.findIndex((segment) => segment.mode === mode);

  return (
    <div className="fw-segmented shrink-0" role="radiogroup" aria-label={t("toolbar.view")}>
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
          aria-label={t(label)}
          data-tooltip={t(label)}
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
  /** Skutečná cesta pro tooltip záhlaví; null v tag view a výsledcích hledání. */
  folderPath: string | null;
  /** Malá ikona před názvem — stejná jako u složky v sidebaru. */
  folderIcon: React.ReactNode;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Enter v poli — filtr aktuální složky se povýší na rekurzivní hledání. */
  onSearchSubmit: () => void;
  /** ↓ v poli hledání — přesun do výsledků. */
  onSearchArrowDown: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  /** Položky menu Seřadit / Sdílet / Štítky — sestavuje je App, zná výběr. */
  sortItems: MenuItem[];
  shareItems: MenuItem[];
  /** null = nic není vybrané, tlačítko Štítky je vypnuté. */
  tagItems: MenuItem[] | null;
  /** Menu tlačítka Nový (Složka, Textový dokument, typy z registru); null = nejde (tag view, hledání). */
  newItems: MenuItem[] | null;
  /** Zvýšení čísla otevře menu Nový — příkaz newItem z palety a klávesnice. */
  newMenuRequest: number;
  /** Registr příkazů (commands.ts) — tlačítka i menu Více z něj berou akce,
   *  stav i zkratky, takže se s klávesnicí a paletou nerozejdou. */
  commands: Commands;
  /** Otevřené menu musí App znát kvůli globálním zkratkám (modalOpen). */
  onMenuOpenChange: (open: boolean) => void;
};

/** Položka menu z příkazu registru — název, zkratka a stav z jednoho místa. */
export function commandMenuItem(command: Command, label?: string): MenuItem & { type: "item" } {
  return {
    type: "item",
    label: label ?? command.title,
    shortcut: command.shortcut,
    disabled: !command.enabled,
    checked: command.checked,
    onSelect: command.run,
  };
}

type ToolbarMenu = "new" | "sort" | "share" | "tags" | "more";

export function Toolbar({
  folderName,
  folderPath,
  folderIcon,
  viewMode,
  onViewModeChange,
  query,
  onQueryChange,
  onSearchSubmit,
  onSearchArrowDown,
  searchRef,
  sortItems,
  shareItems,
  tagItems,
  newItems,
  newMenuRequest,
  commands,
  onMenuOpenChange,
}: ToolbarProps) {
  const t = useT();
  // Otevřené může být jen jedno menu. Pozice se bere z rámečku tlačítka.
  const [menu, setMenu] = useState<{ kind: ToolbarMenu; x: number; y: number } | null>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);

  // Příkaz newItem (paleta) otevře menu Nový pod tlačítkem. Pamatuje si
  // zpracovanou hodnotu, ať se menu po remountu neotevře samo.
  const handledNewRequest = useRef(newMenuRequest);
  useEffect(() => {
    const button = newButtonRef.current;
    if (newMenuRequest === handledNewRequest.current || !button) return;
    handledNewRequest.current = newMenuRequest;
    const rect = button.getBoundingClientRect();
    setMenu({ kind: "new", x: rect.left, y: rect.bottom + 4 });
  }, [newMenuRequest]);

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

  const item = (id: CommandId, label?: string) => commandMenuItem(commands[id], label);

  const moreItems: MenuItem[] = [
    item("undo"),
    item("redo"),
    { type: "separator" },
    item("newTab"),
    item("toggleSplit"),
    item("palette"),
    item("refresh"),
    item("goParent"),
    item("toggleHidden"),
    {
      type: "submenu",
      label: t("appearance.menu"),
      items: [
        item("themeLight", t("appearance.light")),
        item("themeDark", t("appearance.dark")),
        item("themeSystem", t("appearance.system")),
      ],
    },
    {
      type: "submenu",
      label: t("toolbar.animations"),
      items: [
        item("motionSystem", t("motion.system")),
        item("motionOn", t("motion.on")),
        item("motionOff", t("motion.off")),
      ],
    },
    {
      type: "submenu",
      label: t("terminal.menu"),
      items: [
        item("terminalAuto", t("terminal.auto")),
        item("terminalWindows", t("terminal.windowsTerminal")),
        item("terminalPwsh", t("terminal.pwsh")),
        item("terminalPowerShell", t("terminal.powershell")),
        item("terminalCmd", t("terminal.cmd")),
      ],
    },
    {
      type: "submenu",
      label: t("language.menu"),
      items: [
        item("languageSystem", t("language.system")),
        item("languageEnglish", t("language.english")),
        item("languageCzech", t("language.czech")),
      ],
    },
    { type: "separator" },
    ...(__STORE__ ? [] : [item("checkUpdates")]),
    item("about"),
  ];

  return (
    // Skupiny s mezerou 12 px: [zpět/vpřed] [název] … [zobrazení] [seřadit]
    // [sdílet, štítky] [rozdělit] [více] [hledání]. Nová záložka je + v liště
    // záložek, vzhled v menu Více.
    <header className="fw-toolbar flex h-10 shrink-0 items-center gap-3 px-3">
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          Icon={ChevronLeft}
          label={t("toolbar.back")}
          disabled={!commands.goBack.enabled}
          onClick={commands.goBack.run}
        />
        <IconButton
          Icon={ChevronRight}
          label={t("toolbar.forward")}
          disabled={!commands.goForward.enabled}
          onClick={commands.goForward.run}
        />
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex shrink-0 items-center" aria-hidden>
          {folderIcon}
        </span>
        <h1
          className="truncate text-[15px] font-semibold text-primary"
          data-tooltip={folderPath ?? undefined}
        >
          {folderName}
        </h1>
      </div>

      <div className="flex-1" />

      {/* + Nový jako v Průzkumníku; na úzkém toolbaru jen ikona (index.css). */}
      <button
        ref={newButtonRef}
        type="button"
        aria-label={t("menu.new")}
        data-tooltip={t("menu.new")}
        data-fw-menu-trigger
        disabled={newItems === null}
        onMouseDown={(event) => {
          event.preventDefault();
          toggleMenu("new")(event);
        }}
        className={`fw-tool-btn fw-new-btn ${menu?.kind === "new" ? "bg-selected" : "hover:bg-hover"} disabled:pointer-events-none disabled:opacity-35`}
      >
        <Plus size={16} strokeWidth={1.75} />
        <span className="fw-new-label">{t("menu.new")}</span>
      </button>

      <ViewSwitcher mode={viewMode} onChange={onViewModeChange} />

      <IconButton
        Icon={SlidersHorizontal}
        label={t("toolbar.sort")}
        secondary
        active={menu?.kind === "sort"}
        menuTrigger
        onMouseDown={toggleMenu("sort")}
      />

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton
          Icon={Share}
          label={t("toolbar.share")}
          secondary
          active={menu?.kind === "share"}
          menuTrigger
          onMouseDown={toggleMenu("share")}
        />
        <IconButton
          Icon={Tag}
          label={t("toolbar.tags")}
          secondary
          active={menu?.kind === "tags"}
          unavailable={tagItems === null ? t("toolbar.tagsUnavailable") : undefined}
          menuTrigger
          onMouseDown={toggleMenu("tags")}
        />
      </div>

      <IconButton
        Icon={Columns2}
        label={t("split.toggleWithShortcut")}
        secondary
        active={commands.toggleSplit.checked}
        onClick={commands.toggleSplit.run}
      />

      <IconButton
        Icon={MoreHorizontal}
        label={t("toolbar.more")}
        secondary
        active={menu?.kind === "more"}
        menuTrigger
        onMouseDown={toggleMenu("more")}
      />

      <div className="fw-search shrink-0">
        <div className="fw-search-bg" aria-hidden />
        <div className="fw-search-content">
          <Search size={14} strokeWidth={2} className="shrink-0 text-secondary" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              // Ctrl+zkratky (nová záložka, paleta…) propustí dál — handler aplikace
              // v textovém poli pustí jen ty globální, Ctrl+A apod. patří poli.
              if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
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
            placeholder={t("toolbar.search")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-secondary"
            style={{ userSelect: "text" }}
          />
        </div>

        {query.length > 0 && (
          <button
            type="button"
            aria-label={t("toolbar.clearSearch")}
            onClick={() => {
              onQueryChange("");
              searchRef.current?.focus();
            }}
            className="fw-search-clear text-secondary hover:text-primary"
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
            menu.kind === "new"
              ? (newItems ?? [])
              : menu.kind === "sort"
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
