import { useEffect, useMemo, useRef, useState } from "react";
import { Folder } from "lucide-react";

import { ContextMenu, type MenuItem } from "./ContextMenu";
import { fileVisual, sidebarIcon, sidebarIconColor } from "./icons";
import { openInExplorer, parentPath } from "../fileops";
import { formatRelative } from "../format";
import { endDrag, getDrag, startDrag, useDrag } from "../lib/dnd";
import * as storage from "../lib/storage";
import { TAG_COLORS, TAG_HEX, TAG_LABEL } from "../lib/tags";
import { useStorage } from "../lib/useStorage";
import type { CustomFavorite, FavoriteSection, RecentEntry, TagColor } from "../types";

/** Nedávných se ukládá 20, ale sidebar by z nich neúměrně narostl. */
const RECENTS_SHOWN = 10;

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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="fw-section-heading px-4 pt-1.5 pb-1 text-[11px] font-semibold text-section"
      style={{ letterSpacing: "0.5px" }}
    >
      {children}
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
  onNavigate: (path: string) => void;
  onContextMenu: (item: CustomFavorite, index: number, x: number, y: number) => void;
  renamingPath: string | null;
  onRenameSubmit: (path: string, label: string) => void;
  onRenameCancel: () => void;
};

function CustomFavorites({
  items,
  currentPath,
  windowFocused,
  onNavigate,
  onContextMenu,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
}: CustomFavoritesProps) {
  const drag = useDrag();
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Soubory sem nepatří; složka, která už v seznamu je, taky ne.
  const accepts =
    drag !== null &&
    (drag.kind === "favorite" ||
      (drag.isDir && !items.some((item) => storage.samePath(item.path, drag.path))));

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

    if (!payload.isDir) return;
    void storage.addFavorite(
      { label: payload.name, path: payload.path, icon: "Folder" },
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
      <SectionHeading>MOJE OBLÍBENÉ</SectionHeading>

      <nav className="flex flex-col pb-0.5">
        {items.map((item, index) => {
          const Icon = sidebarIcon(item.icon);
          const isActive = item.path === currentPath;
          const isRenaming = item.path === renamingPath;

          return (
            <div key={item.path}>
              {dropIndex === index && <DropLine />}

              <div
                role="button"
                tabIndex={0}
                title={item.path}
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
                onClick={() => !isRenaming && onNavigate(item.path)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onContextMenu(item, index, event.clientX, event.clientY);
                }}
                className={`${ROW_CLASS} ${rowStateClass(isActive && !isRenaming, windowFocused)}`}
              >
                <Icon
                  size={16}
                  strokeWidth={1.75}
                  className="fw-sidebar-icon shrink-0"
                  color={iconColor("var(--accent)", isActive)}
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
            Přetáhni sem složku
          </div>
        )}
      </nav>
    </div>
  );
}

/* ------------------------------- NEDÁVNÉ ---------------------------------- */

function RecentIcon({ entry, active }: { entry: RecentEntry; active: boolean }) {
  if (entry.type === "folder") {
    return (
      <Folder
        size={16}
        strokeWidth={1.75}
        className="fw-sidebar-icon shrink-0"
        color={iconColor("var(--accent)", active)}
      />
    );
  }

  const extension = entry.name.includes(".")
    ? entry.name.slice(entry.name.lastIndexOf(".") + 1).toLowerCase()
    : null;

  const { Icon, tint } = fileVisual({
    name: entry.name,
    path: entry.path,
    is_dir: false,
    size: 0,
    modified: 0,
    created: 0,
    extension,
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
};

function Recents({ items, currentPath, windowFocused, onActivate, onContextMenu }: RecentsProps) {
  const shown = items.slice(0, RECENTS_SHOWN);

  return (
    <div>
      <SectionHeading>NEDÁVNÉ</SectionHeading>

      <nav className="flex flex-col pb-0.5">
        {shown.length === 0 && (
          <div className="mx-1.5 px-3 py-1 text-[12px] text-secondary italic">Zatím nic</div>
        )}

        {shown.map((entry) => {
          const isActive = entry.type === "folder" && entry.path === currentPath;

          return (
            <button
              key={entry.path}
              type="button"
              title={entry.path}
              onClick={() => onActivate(entry)}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu(entry, event.clientX, event.clientY);
              }}
              className={`${ROW_CLASS} ${rowStateClass(isActive, windowFocused)}`}
            >
              <RecentIcon entry={entry} active={isActive} />
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
    </div>
  );
}

/* --------------------------------- TAGY ----------------------------------- */

type TagsSectionProps = {
  counts: Map<TagColor, number>;
  activeTag: TagColor | null;
  windowFocused: boolean;
  onSelectTag: (color: TagColor) => void;
};

function TagsSection({ counts, activeTag, windowFocused, onSelectTag }: TagsSectionProps) {
  // Jen barvy, které se opravdu používají — prázdná sekce se schová celá.
  const used = TAG_COLORS.filter((color) => (counts.get(color) ?? 0) > 0);
  if (used.length === 0) return null;

  return (
    <div>
      <SectionHeading>TAGY</SectionHeading>

      <nav className="flex flex-col pb-0.5">
        {used.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onSelectTag(color)}
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
    </div>
  );
}

/* -------------------------------- sidebar --------------------------------- */

type SidebarMenu =
  | { kind: "favorite"; x: number; y: number; item: CustomFavorite; index: number }
  | { kind: "recent"; x: number; y: number; entry: RecentEntry };

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

  const menuItems = useMemo((): MenuItem[] => {
    if (menu === null) return [];

    const reveal = (path: string): MenuItem => ({
      type: "item",
      label: "Otevřít v Průzkumníku",
      onSelect: () => {
        void openInExplorer(path).catch(() => undefined);
      },
    });

    if (menu.kind === "favorite") {
      const { item } = menu;

      return [
        { type: "item", label: "Otevřít", onSelect: () => onNavigate(item.path) },
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
          label: "Zobrazit cestu",
          onSelect: () => setPathTip({ x: menu.x, y: menu.y, path: item.path }),
        },
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
      { type: "separator" },
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
  }, [menu, onNavigate, onReveal, onOpenFile]);

  return (
    <aside
      className="surface flex w-[220px] shrink-0 flex-col overflow-y-auto bg-sidebar pt-2"
      style={{ backdropFilter: "blur(20px)" }}
    >
      <CustomFavorites
        items={favorites}
        currentPath={currentPath}
        windowFocused={windowFocused}
        onNavigate={onNavigate}
        onContextMenu={(item, index, x, y) => setMenu({ kind: "favorite", item, index, x, y })}
        renamingPath={renamingPath}
        onRenameSubmit={(path, label) => {
          setRenamingPath(null);
          void storage.renameFavorite(path, label);
        }}
        onRenameCancel={() => setRenamingPath(null)}
      />

      <Recents
        items={recents}
        currentPath={currentPath}
        windowFocused={windowFocused}
        onActivate={activateRecent}
        onContextMenu={(entry, x, y) => setMenu({ kind: "recent", entry, x, y })}
      />

      {sections.map((section) => (
        <div key={section.label}>
          <SectionHeading>{sectionHeading(section.label)}</SectionHeading>

          <nav className="flex flex-col pb-0.5">
            {section.items.map((item) => {
              const Icon = sidebarIcon(item.icon_name);
              const isActive = item.path === currentPath;

              return (
                <button
                  key={`${section.label}/${item.path}`}
                  type="button"
                  title={item.path}
                  onClick={() => onNavigate(item.path)}
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
        </div>
      ))}

      <TagsSection
        counts={tagCounts}
        activeTag={activeTag}
        windowFocused={windowFocused}
        onSelectTag={onSelectTag}
      />

      <div className="h-2 shrink-0" />

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
