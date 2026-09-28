import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Folder } from "lucide-react";

import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { ContextMenu, type MenuItem } from "./ContextMenu";
import { fileVisual, sidebarIcon, sidebarIconColor } from "./icons";
import { openDevice, openInExplorer, openTerminal, parentPath } from "../fileops";
import { formatRelative } from "../format";
import { isTypingTarget } from "../lib/dom";
import { endDrag, getDrag, startDrag, useDrag } from "../lib/dnd";
import * as storage from "../lib/storage";
import { TAG_COLORS, TAG_HEX, TAG_LABEL } from "../lib/tags";
import { useStorage } from "../lib/useStorage";
import type {
  CustomFavorite,
  FavoriteEntry,
  FavoriteSection,
  RecentEntry,
  RecentKind,
  TagColor,
} from "../types";

/** Nedávných se ukládá 20, ale sidebar by z nich neúměrně narostl. */
const RECENTS_SHOWN = 10;

/** Klíče sekcí pro sbalení. Sekce od backendu mají klíč `system:<název>`. */
const CUSTOM_ID = "custom";
const RECENTS_ID = "recents";
const TAGS_ID = "tags";

type SidebarProps = {
  sections: FavoriteSection[];
  currentPath: string | null;
  windowFocused: boolean;
  onNavigate: (path: string) => void;
  /** Otevře soubor v systému (klik na nedávný soubor). */
  onOpenFile: (path: string, name: string) => void;
  /** Naviguje do rodičovské složky a označí v ní tuhle položku. */
  onReveal: (path: string) => void;
  activeTag: TagColor | null;
  onSelectTag: (color: TagColor) => void;
};

/* -------------------------- sdílené stavební díly -------------------------- */

/**
 * "iCloud" má v Finderu i v nadpisu malé úvodní i, což by `text-transform`
 * zahodilo — proto se velká písmena dělají v JS a ne v CSS.
 */
function sectionHeading(label: string): string {
  return label === "iCloud" ? "iCLOUD" : label.toUpperCase();
}

/** Sbalené sekce přežijí restart. Jde o pohodlí jednoho uživatele, ne o data,
 *  takže stačí localStorage stejně jako u tématu. */
const COLLAPSED_KEY = "finder-sidebar-collapsed";

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(ids: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Bez úložiště se sbalení prostě nezapamatuje.
  }
}

/** Nadpis a pravý klik na něj — sdílí ho všechny sekce. */
type HeadingControl = {
  collapsed: boolean;
  onToggle: () => void;
  onContextMenu: (x: number, y: number) => void;
};

function SectionHeading({
  children,
  control,
}: {
  children: React.ReactNode;
  control: HeadingControl;
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-expanded={!control.collapsed}
      onClick={control.onToggle}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        control.onContextMenu(event.clientX, event.clientY);
      }}
      className="fw-section-heading group flex cursor-default items-center px-4 pt-1.5 pb-1 text-[11px] font-semibold text-section"
      style={{ letterSpacing: "0.5px" }}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {/* Jako ve Finderu: šipka se ukáže až při najetí, sbalená sekce ji má pořád. */}
      <ChevronDown
        size={12}
        strokeWidth={2.5}
        className={`shrink-0 transition-[transform,opacity] duration-150 ${
          control.collapsed ? "-rotate-90 opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      />
    </div>
  );
}

/** Společný vzhled všech řádků sidebaru, ať už jde o složku, tag nebo nedávný soubor. */
const ROW_CLASS =
  "fw-sidebar-row mx-1.5 flex h-[26px] items-center gap-2 rounded-md px-3 py-1 text-left text-[13px] text-primary";

/**
 * Hover posun i podbarvení řeší .fw-sidebar-row v CSS — jen tam jde napsat
 * "posuň při hoveru, ale ne když je řádek aktivní" bez druhé sady tříd.
 */
function rowStateClass(active: boolean, windowFocused: boolean): string {
  if (!active) return "";
  return windowFocused ? "is-active" : "is-active-dim";
}

/** Ikona aktivního řádku se o kus zesvětlí, ať výběr čte i bez pozadí. */
function iconColor(base: string, active: boolean): string {
  return active ? `color-mix(in srgb, ${base} 85%, white)` : base;
}

/** Vodorovná linka ukazující, kam se přetahovaná položka vloží. */
function DropLine() {
  return (
    <div
      className="pointer-events-none mx-1.5"
      style={{ height: 0, borderTop: "2px solid var(--accent)" }}
    />
  );
}

/** Popisek se edituje volně — na rozdíl od názvu souboru ho Windows neomezují. */
function LabelInput({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submit() {
    if (finished.current) return;
    finished.current = true;
    const trimmed = value.trim();
    if (trimmed === "") onCancel();
    else onSubmit(trimmed);
  }

  function cancel() {
    if (finished.current) return;
    finished.current = true;
    onCancel();
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={submit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          submit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      className="min-w-0 flex-1 rounded-sm px-1 text-[13px] text-primary outline-none"
      style={{
        background: "var(--bg-main)",
        border: "1px solid var(--accent)",
        userSelect: "text",
      }}
    />
  );
}

/* --------------------------- MOJE OBLÍBENÉ -------------------------------- */

type CustomFavoritesProps = {
  items: CustomFavorite[];
  currentPath: string | null;
  windowFocused: boolean;
  onActivate: (item: CustomFavorite) => void;
  onContextMenu: (item: CustomFavorite, index: number, x: number, y: number) => void;
  renamingPath: string | null;
  onRenameSubmit: (path: string, label: string) => void;
  onRenameCancel: () => void;
  heading: HeadingControl;
};

function CustomFavorites({
  items,
  currentPath,
  windowFocused,
  onActivate,
  onContextMenu,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  heading,
}: CustomFavoritesProps) {
  const drag = useDrag();
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Soubor i složka sem smí, ale co už v seznamu je, se podruhé nepřidává.
  const accepts =
    drag !== null &&
    (drag.kind === "favorite" ||
      !items.some((item) => storage.samePath(item.path, drag.path)));

  // Prázdná sekce se odhalí jen na dobu tažení, aby bylo kam pustit první složku.
  const visible = items.length > 0 || (accepts && drag?.kind === "entry");
  if (!visible) return null;

  function positionFor(event: React.DragEvent, index: number): number {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 ? index + 1 : index;
  }

  /** Řádek zná přesnou pozici, proto bublinu zastaví — jinak by ji obal přepsal. */
  function allowAtRow(event: React.DragEvent, index: number) {
    if (!accepts) return;
    event.stopPropagation();
    // Bez preventDefault prohlížeč drop vůbec nepustí — tím se odmítají soubory.
    event.preventDefault();
    event.dataTransfer.dropEffect = drag?.kind === "favorite" ? "move" : "copy";
    setDropIndex(index);
  }

  /** Nadpis a volné místo pod řádky: doplní pozici, jen když ji nikdo neurčil. */
  function allowInSection(event: React.DragEvent) {
    if (!accepts) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = drag?.kind === "favorite" ? "move" : "copy";
    setDropIndex((current) => current ?? items.length);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();

    const payload = getDrag();
    const target = dropIndex ?? items.length;
    setDropIndex(null);
    endDrag();

    if (payload === null) return;

    if (payload.kind === "favorite") {
      void storage.moveFavorite(payload.index, target);
      return;
    }

    void storage.addFavorite(
      {
        label: payload.name,
        path: payload.path,
        icon: "Folder",
        type: payload.isDir ? "folder" : "file",
      },
      target,
    );
  }

  return (
    <div
      onDragOver={allowInSection}
      onDragLeave={(event) => {
        // Přechod mezi řádky uvnitř sekce se za odchod nepočítá.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null);
      }}
      onDrop={handleDrop}
    >
      <SectionHeading control={heading}>MOJE OBLÍBENÉ</SectionHeading>

      {/* Sbalená sekce se během tažení otevře — jinak by nebylo kam pustit. */}
      {(!heading.collapsed || accepts) && (
        <nav className="flex flex-col pb-0.5">
          {items.map((item, index) => {
            // Soubor v sidebaru nikdy "nejsme uvnitř" — zvýrazňují se jen složky.
            const isActive =
              item.type === "folder" &&
              currentPath !== null &&
              storage.samePath(item.path, currentPath);
            const isRenaming = item.path === renamingPath;

            return (
              <div key={item.path}>
                {dropIndex === index && <DropLine />}

                <div
                  role="button"
                  tabIndex={0}
                  data-tooltip={item.path}
                  draggable={!isRenaming}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    setDropIndex(null);
                    startDrag({ kind: "favorite", path: item.path, index }, event.dataTransfer);
                  }}
                  onDragEnd={() => {
                    setDropIndex(null);
                    endDrag();
                  }}
                  onDragOver={(event) => allowAtRow(event, positionFor(event, index))}
                  onClick={() => !isRenaming && onActivate(item)}
                  onContextMenu={(event) => {
                    if (isTypingTarget(event.target)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu(item, index, event.clientX, event.clientY);
                  }}
                  className={`${ROW_CLASS} ${rowStateClass(isActive && !isRenaming, windowFocused)}`}
                >
                  <EntryIcon
                    name={item.label}
                    path={item.path}
                    type={item.type}
                    active={isActive}
                    folderIcon={item.icon}
                  />

                  {isRenaming ? (
                    <LabelInput
                      initial={item.label}
                      onSubmit={(label) => onRenameSubmit(item.path, label)}
                      onCancel={onRenameCancel}
                    />
                  ) : (
                    <span className="truncate">{item.label}</span>
                  )}
                </div>
              </div>
            );
          })}

          {dropIndex === items.length && <DropLine />}

          {items.length === 0 && (
            <div className="mx-1.5 px-3 py-1 text-[12px] text-secondary italic">
              Přetáhni sem složku nebo soubor
            </div>
          )}
        </nav>
      )}
    </div>
  );
}

/* ------------------------------- NEDÁVNÉ ---------------------------------- */

/**
 * Ikona řádku, který může být soubor i složka — tak vypadají nedávné
 * i oblíbené. `folderIcon` nechává vlastní oblíbené použít ikonu ze
 * settings.json, nedávné vždycky kreslí prostou složku.
 */
function EntryIcon({
  name,
  path,
  type,
  active,
  folderIcon,
}: {
  name: string;
  path: string;
  type: RecentKind;
  active: boolean;
  folderIcon?: string;
}) {
  if (type === "folder") {
    const Icon = folderIcon === undefined ? Folder : sidebarIcon(folderIcon);

    return (
      <Icon
        size={16}
        strokeWidth={1.75}
        className="fw-sidebar-icon shrink-0"
        color={iconColor("var(--accent)", active)}
      />
    );
  }

  const extension = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : null;

  const { Icon, tint } = fileVisual({
    name,
    path,
    is_dir: false,
    size: 0,
    modified: 0,
    created: 0,
    extension,
    hidden: false,
  });

  return (
    <Icon
      size={16}
      strokeWidth={1.75}
      className="fw-sidebar-icon shrink-0"
      color={iconColor(tint, active)}
    />
  );
}

type RecentsProps = {
  items: RecentEntry[];
  currentPath: string | null;
  windowFocused: boolean;
  onActivate: (entry: RecentEntry) => void;
  onContextMenu: (entry: RecentEntry, x: number, y: number) => void;
  heading: HeadingControl;
};

function Recents({
  items,
  currentPath,
  windowFocused,
  onActivate,
  onContextMenu,
  heading,
}: RecentsProps) {
  const shown = items.slice(0, RECENTS_SHOWN);

  return (
    <div>
      <SectionHeading control={heading}>NEDÁVNÉ</SectionHeading>

      {!heading.collapsed && (
        <nav className="flex flex-col pb-0.5">
          {shown.length === 0 && (
            <div className="mx-1.5 px-3 py-1 text-[12px] text-secondary italic">Zatím nic</div>
          )}

          {shown.map((entry) => {
            const isActive =
              entry.type === "folder" &&
              currentPath !== null &&
              storage.samePath(entry.path, currentPath);

            return (
              <button
                key={entry.path}
                type="button"
                data-tooltip={entry.path}
                onClick={() => onActivate(entry)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onContextMenu(entry, event.clientX, event.clientY);
                }}
                className={`${ROW_CLASS} ${rowStateClass(isActive, windowFocused)}`}
              >
                <EntryIcon
                  name={entry.name}
                  path={entry.path}
                  type={entry.type}
                  active={isActive}
                />
                {/* min-w-0 musí být, jinak se flex položka odmítne zkrátit pod obsah. */}
                <span className="min-w-0 truncate" style={{ maxWidth: 160 }}>
                  {entry.name}
                </span>
                <span className="ml-auto shrink-0 pl-1 text-[11px] text-secondary">
                  {formatRelative(entry.opened_at)}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

/* --------------------------------- TAGY ----------------------------------- */

type TagsSectionProps = {
  counts: Map<TagColor, number>;
  activeTag: TagColor | null;
  windowFocused: boolean;
  onSelectTag: (color: TagColor) => void;
  onContextMenu: (color: TagColor, x: number, y: number) => void;
  heading: HeadingControl;
};

function TagsSection({
  counts,
  activeTag,
  windowFocused,
  onSelectTag,
  onContextMenu,
  heading,
}: TagsSectionProps) {
  // Jen barvy, které se opravdu používají — prázdná sekce se schová celá.
  const used = TAG_COLORS.filter((color) => (counts.get(color) ?? 0) > 0);
  if (used.length === 0) return null;

  return (
    <div>
      <SectionHeading control={heading}>TAGY</SectionHeading>

      {!heading.collapsed && (
        <nav className="flex flex-col pb-0.5">
          {used.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onSelectTag(color)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onContextMenu(color, event.clientX, event.clientY);
              }}
              className={`${ROW_CLASS} ${rowStateClass(activeTag === color, windowFocused)}`}
            >
              <span
                className="shrink-0 rounded-full"
                style={{
                  width: 12,
                  height: 12,
                  backgroundColor: TAG_HEX[color],
                  boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
                }}
              />
              <span className="truncate">{TAG_LABEL[color]}</span>
              <span className="ml-auto shrink-0 pl-1 text-[11px] text-secondary">
                {counts.get(color)}
              </span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

/* -------------------------------- sidebar --------------------------------- */

type SidebarMenu =
  | { kind: "favorite"; x: number; y: number; item: CustomFavorite; index: number }
  | { kind: "recent"; x: number; y: number; entry: RecentEntry }
  /** Položka ze sekcí od backendu (Downloads, iCloud, Zařízení …). */
  | { kind: "section"; x: number; y: number; item: FavoriteEntry }
  | { kind: "tag"; x: number; y: number; color: TagColor }
  /** Nadpis sekce — sbalit/rozbalit, u Nedávných i vymazat. */
  | { kind: "heading"; x: number; y: number; id: string }
  /** Prázdný stav nebo volná plocha pod poslední sekcí. */
  | { kind: "background"; x: number; y: number };

export function Sidebar({
  sections,
  currentPath,
  windowFocused,
  onNavigate,
  onOpenFile,
  onReveal,
  activeTag,
  onSelectTag,
}: SidebarProps) {
  const { favorites, recents, tags } = useStorage();

  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pathTip, setPathTip] = useState<{ x: number; y: number; path: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);

  function toggleSection(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeCollapsed(next);
      return next;
    });
  }

  function headingFor(id: string): HeadingControl {
    return {
      collapsed: collapsed.has(id),
      onToggle: () => toggleSection(id),
      onContextMenu: (x, y) => setMenu({ kind: "heading", id, x, y }),
    };
  }

  const tagCounts = useMemo(() => {
    const counts = new Map<TagColor, number>();
    for (const colors of Object.values(tags)) {
      for (const color of colors) counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    return counts;
  }, [tags]);

  // Bublina s cestou zmizí sama, ať po ní uživatel nemusí klikat.
  useEffect(() => {
    if (pathTip === null) return;
    const timer = window.setTimeout(() => setPathTip(null), 4000);
    return () => window.clearTimeout(timer);
  }, [pathTip]);

  function activateRecent(entry: RecentEntry) {
    if (entry.type === "folder") onNavigate(entry.path);
    else onOpenFile(entry.path, entry.name);
  }

  function activateFavorite(item: CustomFavorite) {
    if (item.type === "folder") onNavigate(item.path);
    else onOpenFile(item.path, item.label);
  }

  const menuItems = useMemo((): MenuItem[] => {
    if (menu === null) return [];

    const reveal = (path: string): MenuItem => ({
      type: "item",
      label: "Otevřít v Průzkumníku",
      onSelect: () => {
        void openInExplorer(path).catch(() => undefined);
      },
    });

    const terminal = (path: string): MenuItem => ({
      type: "item",
      label: "Otevřít v Terminálu",
      onSelect: () => {
        void openTerminal(path).catch(() => undefined);
      },
    });

    const copyPathItem = (path: string): MenuItem => ({
      type: "item",
      label: "Kopírovat cestu",
      onSelect: () => {
        void writeText(path).catch(() => undefined);
      },
    });

    const showPath = (path: string): MenuItem => ({
      type: "item",
      label: "Zobrazit cestu",
      onSelect: () => setPathTip({ x: menu.x, y: menu.y, path }),
    });

    const isFavorite = (path: string): boolean =>
      favorites.some((favorite) => storage.samePath(favorite.path, path));

    /** Přepínač "Přidat / Odebrat z oblíbených" — stejný text i chování všude. */
    const toggleFavorite = (path: string, label: string, kind: RecentKind): MenuItem => {
      const present = isFavorite(path);

      return {
        type: "item",
        label: present ? "Odebrat z oblíbených" : "Přidat do oblíbených",
        onSelect: () => {
          if (present) void storage.removeFavorite(path);
          else void storage.addFavorite({ label, path, icon: "Folder", type: kind });
        },
      };
    };

    if (menu.kind === "heading") {
      const { id } = menu;
      const isCollapsed = collapsed.has(id);
      const items: MenuItem[] = [
        {
          type: "item",
          label: isCollapsed ? "Rozbalit sekci" : "Sbalit sekci",
          onSelect: () => toggleSection(id),
        },
      ];

      if (id === RECENTS_ID) {
        items.push(
          { type: "separator" },
          {
            type: "item",
            label: "Vymazat nedávné",
            disabled: recents.length === 0,
            danger: true,
            onSelect: () => void storage.clearRecents(),
          },
        );
      }

      return items;
    }

    // Prázdné stavy a plocha pod poslední sekcí. Bez tohohle
    // tam pravý klik neudělal vůbec nic — menu webview je globálně potlačené.
    if (menu.kind === "background") {
      const canAdd = currentPath !== null && !isFavorite(currentPath);

      return [
        {
          type: "item",
          label: canAdd
            ? "Přidat aktuální složku do oblíbených"
            : "Aktuální složka už je v oblíbených",
          disabled: !canAdd,
          onSelect: () => {
            if (currentPath === null) return;
            void storage.addFavorite({
              label: storage.lastSegment(currentPath),
              path: currentPath,
              icon: "Folder",
              type: "folder",
            });
          },
        },
        { type: "separator" },
        {
          type: "item",
          label: "Vymazat všechny nedávné",
          disabled: recents.length === 0,
          danger: true,
          onSelect: () => void storage.clearRecents(),
        },
      ];
    }

    if (menu.kind === "tag") {
      const { color } = menu;

      return [
        { type: "item", label: "Otevřít", onSelect: () => onSelectTag(color) },
        { type: "separator" },
        {
          type: "item",
          label: `Odebrat štítek ${TAG_LABEL[color].toLowerCase()} ze všech položek`,
          danger: true,
          onSelect: () => void storage.removeTagEverywhere(color),
        },
      ];
    }

    // Sekce od backendu se nedají přejmenovat ani odebrat — nejsou naše. Zbytek
    // nabídky ale smí být stejný jako u vlastních oblíbených; bez toho na nich
    // pravý klik vytáhl menu webview.
    if (menu.kind === "section") {
      const { item } = menu;

      // Telefon nemá cestu, se kterou by šlo cokoli dalšího dělat.
      if (item.external) {
        return [
          {
            type: "item",
            label: "Otevřít v Průzkumníku",
            onSelect: () => void openDevice(item.path).catch(() => undefined),
          },
        ];
      }

      return [
        { type: "item", label: "Otevřít", onSelect: () => onNavigate(item.path) },
        { type: "separator" },
        reveal(item.path),
        terminal(item.path),
        { type: "separator" },
        toggleFavorite(item.path, item.label, "folder"),
        copyPathItem(item.path),
        showPath(item.path),
      ];
    }

    if (menu.kind === "favorite") {
      const { item } = menu;

      return [
        { type: "item", label: "Otevřít", onSelect: () => activateFavorite(item) },
        { type: "separator" },
        {
          type: "item",
          label: "Přejmenovat",
          onSelect: () => setRenamingPath(item.path),
        },
        {
          type: "item",
          label: "Odebrat z oblíbených",
          danger: true,
          onSelect: () => void storage.removeFavorite(item.path),
        },
        { type: "separator" },
        reveal(item.path),
        {
          type: "item",
          label: "Zobrazit ve složce",
          // U kořene disku není kam odkrývat.
          disabled: parentPath(item.path) === null,
          onSelect: () => onReveal(item.path),
        },
        // U souboru by terminál otevřel jeho složku — matoucí, radši ho vynech.
        ...(item.type === "folder" ? [terminal(item.path)] : []),
        copyPathItem(item.path),
        showPath(item.path),
      ];
    }

    const { entry } = menu;

    return [
      { type: "item", label: "Otevřít", onSelect: () => activateRecent(entry) },
      reveal(entry.path),
      {
        type: "item",
        label: "Zobrazit ve složce",
        // U kořene disku není kam odkrývat.
        disabled: parentPath(entry.path) === null,
        onSelect: () => onReveal(entry.path),
      },
      copyPathItem(entry.path),
      { type: "separator" },
      toggleFavorite(entry.path, entry.name, entry.type),
      {
        type: "item",
        label: "Odebrat z nedávných",
        onSelect: () => void storage.removeRecent(entry.path),
      },
      {
        type: "item",
        label: "Vymazat všechny nedávné",
        danger: true,
        onSelect: () => void storage.clearRecents(),
      },
    ];
    // toggleSection jen zapisuje do stavu, jeho identita na výsledek nemá vliv.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, favorites, recents, collapsed, currentPath, onNavigate, onReveal, onOpenFile, onSelectTag]);

  return (
    <aside
      // Menu volné plochy visí na celém sloupci: nadpisy sekcí, prázdné stavy
      // i prostor pod poslední sekcí patří jemu. Řádky si událost zastaví samy.
      onContextMenu={(event) => {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        setMenu({ kind: "background", x: event.clientX, y: event.clientY });
      }}
      className="surface flex w-[220px] shrink-0 flex-col overflow-y-auto bg-sidebar pt-2"
      style={{ backdropFilter: "blur(20px)" }}
    >
      <CustomFavorites
        items={favorites}
        currentPath={currentPath}
        windowFocused={windowFocused}
        onActivate={activateFavorite}
        onContextMenu={(item, index, x, y) => setMenu({ kind: "favorite", item, index, x, y })}
        renamingPath={renamingPath}
        onRenameSubmit={(path, label) => {
          setRenamingPath(null);
          void storage.renameFavorite(path, label);
        }}
        onRenameCancel={() => setRenamingPath(null)}
        heading={headingFor(CUSTOM_ID)}
      />

      <Recents
        items={recents}
        currentPath={currentPath}
        windowFocused={windowFocused}
        onActivate={activateRecent}
        onContextMenu={(entry, x, y) => setMenu({ kind: "recent", entry, x, y })}
        heading={headingFor(RECENTS_ID)}
      />

      {sections.map((section) => {
        const heading = headingFor(`system:${section.label}`);

        return (
          <div key={section.label}>
            <SectionHeading control={heading}>{sectionHeading(section.label)}</SectionHeading>

            {!heading.collapsed && (
              <nav className="flex flex-col pb-0.5">
                {section.items.map((item) => {
                  const Icon = sidebarIcon(item.icon_name);
                  const isActive =
                    !item.external && currentPath !== null && storage.samePath(item.path, currentPath);

                  return (
                    <button
                      key={`${section.label}/${item.path}`}
                      type="button"
                      // Shellová cesta telefonu ("::{20D04FE0…}\\?\usb#…") nikomu nic neřekne.
                      data-tooltip={item.external ? "Otevře se v Průzkumníku" : item.path}
                      onClick={() => {
                        if (item.external) void openDevice(item.path).catch(() => undefined);
                        else onNavigate(item.path);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setMenu({ kind: "section", item, x: event.clientX, y: event.clientY });
                      }}
                      className={`${ROW_CLASS} ${rowStateClass(isActive, windowFocused)}`}
                    >
                      <Icon
                        size={16}
                        strokeWidth={1.75}
                        className="fw-sidebar-icon shrink-0"
                        color={iconColor(sidebarIconColor(section.label, item.label), isActive)}
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
        );
      })}

      <TagsSection
        counts={tagCounts}
        activeTag={activeTag}
        windowFocused={windowFocused}
        onSelectTag={onSelectTag}
        onContextMenu={(color, x, y) => setMenu({ kind: "tag", color, x, y })}
        heading={headingFor(TAGS_ID)}
      />

      {/* Roztáhne se přes zbytek sloupce, aby pravý klik dole padl do sidebaru
          a ne mimo něj. */}
      <div className="min-h-[8px] flex-1 shrink-0" />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {pathTip && (
        <div
          className="fixed z-50 max-w-[320px] rounded-md px-2.5 py-1.5 font-mono text-[11px] break-all text-primary"
          style={{
            left: Math.min(pathTip.x, window.innerWidth - 340),
            top: pathTip.y + 6,
            background: "var(--bg-toolbar)",
            border: "1px solid var(--border)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            backdropFilter: "blur(20px)",
          }}
        >
          {pathTip.path}
        </div>
      )}
    </aside>
  );
}
