import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { ColumnView } from "./components/ColumnView";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { IconDefs } from "./components/icons";
import { PropertiesDialog } from "./components/PropertiesDialog";
import { IconView } from "./components/IconView";
import { ListView } from "./components/ListView";
import { QuickLook } from "./components/QuickLook";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { Toolbar } from "./components/Toolbar";
import { useColumns } from "./columns";
import {
  copyPath,
  duplicatePath,
  movePath,
  moveToTrash,
  openInExplorer,
  parentPath,
  renamePath,
} from "./fileops";
import { breadcrumbs, sortEntries, type SortDirection, type SortKey } from "./format";
import { INITIAL_NAV, navReducer } from "./navigation";
import { applyTheme, readStoredTheme } from "./theme";
import type { Clipboard, FavoriteSection, FileEntry, Theme, ViewMode } from "./types";

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-secondary">
      {children}
    </div>
  );
}

/** Zkratky se nesmí spouštět, když uživatel píše do pole. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (element === null) return false;
  return (
    element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [windowFocused, setWindowFocused] = useState(true);

  const [sections, setSections] = useState<FavoriteSection[]>([]);
  const [nav, dispatch] = useReducer(navReducer, INITIAL_NAV);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [freeSpace, setFreeSpace] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Aktivní položka řídí operace pro jednu položku (přejmenování, Quick Look,
  // vlastnosti); selection drží celý výběr pro hromadné operace.
  const [active, setActive] = useState<FileEntry | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pathEditing, setPathEditing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry } | null>(null);
  const [propertiesFor, setPropertiesFor] = useState<FileEntry | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("icon");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [query, setQuery] = useState("");
  const [quickLookOpen, setQuickLookOpen] = useState(false);

  const requestId = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const navigate = useCallback((path: string) => dispatch({ type: "go", path }), []);
  const columnsApi = useColumns(nav.current, viewMode === "column");

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    const onFocus = () => setWindowFocused(true);
    const onBlur = () => setWindowFocused(false);

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    invoke<FavoriteSection[]>("get_favorites")
      .then((result) => {
        setSections(result);
        const first = result[0]?.items[0];
        if (first) dispatch({ type: "go", path: first.path });
      })
      .catch((err: unknown) => setError(String(err)));
  }, []);

  // Reset stavu patří k navigaci, ne k přenačtení — jinak by refresh
  // po každé operaci shodil výběr i rozepsané hledání.
  useEffect(() => {
    setSelection(new Set());
    setActive(null);
    setQuery("");
    setRenamingPath(null);
    setPathEditing(false);
  }, [nav.current]);

  useEffect(() => {
    if (nav.current === null) return;

    const id = ++requestId.current;
    const path = nav.current;

    setLoading(true);
    setError(null);

    invoke<FileEntry[]>("list_dir", { path })
      .then((result) => {
        if (requestId.current !== id) return;
        setEntries(result);
      })
      .catch((err: unknown) => {
        if (requestId.current !== id) return;
        setEntries([]);
        setError(String(err));
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });

    invoke<number>("get_disk_free_space", { path })
      .then((bytes) => {
        if (requestId.current === id) setFreeSpace(bytes);
      })
      .catch(() => {
        if (requestId.current === id) setFreeSpace(null);
      });
  }, [nav.current, refreshToken]);

  const sortedEntries = useMemo(
    () => sortEntries(entries, sortKey, sortDirection),
    [entries, sortKey, sortDirection],
  );

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sortedEntries;
    return sortedEntries.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [sortedEntries, query]);

  /* ------------------------------ výběr ---------------------------------- */

  const focusedColumn = columnsApi.columns[columnsApi.focusedIndex];
  const columnSelected =
    focusedColumn?.entries.find((entry) => entry.path === focusedColumn.selectedPath) ?? null;

  const isColumnView = viewMode === "column";
  const currentDir = isColumnView ? columnsApi.activePath : nav.current;

  const selectEntry = useCallback((entry: FileEntry) => {
    setActive(entry);
    setSelection(new Set([entry.path]));
  }, []);

  /** Položky, na které míří operace — v column view vždy jen ta zaměřená. */
  const targetEntries = useMemo((): FileEntry[] => {
    if (isColumnView) return columnSelected ? [columnSelected] : [];
    return visibleEntries.filter((entry) => selection.has(entry.path));
  }, [isColumnView, columnSelected, visibleEntries, selection]);

  const activeEntry = isColumnView ? columnSelected : active;

  /* ---------------------------- operace ---------------------------------- */

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
    columnsApi.refresh();
  }, [columnsApi]);

  const openFile = useCallback((entry: FileEntry) => {
    invoke("open_file", { path: entry.path }).catch((err: unknown) =>
      setNotice(`Soubor se nepodařilo otevřít — ${String(err)}`),
    );
  }, []);

  const open = useCallback(
    (entry: FileEntry) => {
      selectEntry(entry);
      if (entry.is_dir) navigate(entry.path);
      else openFile(entry);
    },
    [navigate, openFile, selectEntry],
  );

  /** Společné ošetření chyb + refresh po každé mutující operaci. */
  const runOperation = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      try {
        setNotice(null);
        await action();
        refresh();
      } catch (err: unknown) {
        setNotice(`${label} — ${String(err)}`);
      }
    },
    [refresh],
  );

  const submitRename = useCallback(
    (entry: FileEntry, name: string) => {
      setRenamingPath(null);
      if (name.trim() === entry.name) return;
      void runOperation("Přejmenování selhalo", () => renamePath(entry.path, name.trim()));
    },
    [runOperation],
  );

  const deleteTargets = useCallback(() => {
    if (targetEntries.length === 0) return;
    void runOperation("Smazání selhalo", async () => {
      for (const entry of targetEntries) await moveToTrash(entry.path);
    });
  }, [targetEntries, runOperation]);

  const duplicateActive = useCallback(() => {
    if (!activeEntry) return;
    void runOperation("Duplikace selhala", () => duplicatePath(activeEntry.path));
  }, [activeEntry, runOperation]);

  const copyToClipboard = useCallback(
    (mode: "copy" | "cut") => {
      if (targetEntries.length === 0) return;
      setClipboard({ paths: targetEntries.map((entry) => entry.path), mode });
    },
    [targetEntries],
  );

  const paste = useCallback(() => {
    if (!clipboard || currentDir === null) return;
    const target = currentDir;
    const { paths, mode } = clipboard;

    void runOperation("Vložení selhalo", async () => {
      for (const path of paths) {
        if (mode === "copy") await copyPath(path, target);
        else await movePath(path, target);
      }
      // Vyjmuté položky se dají vložit jen jednou.
      if (mode === "cut") setClipboard(null);
    });
  }, [clipboard, currentDir, runOperation]);

  const goToParent = useCallback(() => {
    if (currentDir === null) return;
    const parent = parentPath(currentDir);
    if (parent !== null) navigate(parent);
  }, [currentDir, navigate]);

  const selectAll = useCallback(() => {
    if (isColumnView) return;
    setSelection(new Set(visibleEntries.map((entry) => entry.path)));
    if (visibleEntries.length > 0) setActive(visibleEntries[0]);
  }, [isColumnView, visibleEntries]);

  /* --------------------------- klávesové zkratky -------------------------- */

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Modal si klávesy obsluhuje sám.
      if (quickLookOpen) return;
      if (isTypingTarget(event.target)) return;

      const ctrl = event.ctrlKey || event.metaKey;

      if (ctrl) {
        switch (event.key.toLowerCase()) {
          case "arrowup":
            event.preventDefault();
            goToParent();
            return;
          case "arrowdown":
            event.preventDefault();
            if (activeEntry) open(activeEntry);
            return;
          case "l":
            event.preventDefault();
            setPathEditing(true);
            return;
          case "f":
            event.preventDefault();
            searchRef.current?.focus();
            searchRef.current?.select();
            return;
          case "c":
            event.preventDefault();
            copyToClipboard("copy");
            return;
          case "x":
            event.preventDefault();
            copyToClipboard("cut");
            return;
          case "v":
            event.preventDefault();
            paste();
            return;
          case "d":
            event.preventDefault();
            duplicateActive();
            return;
          case "a":
            event.preventDefault();
            selectAll();
            return;
          case "r":
            event.preventDefault();
            refresh();
            return;
          default:
            return;
        }
      }

      switch (event.key) {
        case "F5":
          event.preventDefault();
          refresh();
          break;
        case "F2":
          event.preventDefault();
          if (activeEntry) setRenamingPath(activeEntry.path);
          break;
        case "Delete":
          event.preventDefault();
          deleteTargets();
          break;
        case " ":
          if (activeEntry && !activeEntry.is_dir) {
            event.preventDefault();
            setQuickLookOpen(true);
          }
          break;
        case "Enter":
          // V column view má Enter vlastní obsluhu na jeho kontejneru.
          if (isColumnView) break;
          event.preventDefault();
          if (activeEntry) open(activeEntry);
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    quickLookOpen,
    isColumnView,
    activeEntry,
    goToParent,
    open,
    copyToClipboard,
    paste,
    duplicateActive,
    selectAll,
    refresh,
    deleteTargets,
  ]);

  /* ----------------------------- view mode -------------------------------- */

  const changeViewMode = useCallback(
    (mode: ViewMode) => {
      const { activePath } = columnsApi;
      if (viewMode === "column" && mode !== "column" && activePath && activePath !== nav.current) {
        navigate(activePath);
      }
      setViewMode(mode);
    },
    [viewMode, columnsApi, nav.current, navigate],
  );

  const sortBy = useCallback((key: SortKey) => {
    setSortKey((currentKey) => {
      setSortDirection((currentDirection) =>
        currentKey === key ? (currentDirection === "asc" ? "desc" : "asc") : "asc",
      );
      return key;
    });
  }, []);

  const cutPaths = useMemo(
    () => new Set(clipboard?.mode === "cut" ? clipboard.paths : []),
    [clipboard],
  );

  /* ---------------------------- context menu ------------------------------ */

  const openContextMenu = useCallback((entry: FileEntry, x: number, y: number) => {
    setMenu({ x, y, entry });
  }, []);

  const menuItems = useMemo((): MenuItem[] => {
    if (menu === null) return [];
    const { entry } = menu;
    const single = targetEntries.length <= 1;

    return [
      { type: "item", label: "Otevřít", shortcut: "Enter", onSelect: () => open(entry) },
      {
        type: "item",
        label: "Otevřít v Průzkumníku",
        disabled: !single,
        onSelect: () => {
          void runOperation("Průzkumníka se nepodařilo otevřít", () => openInExplorer(entry.path));
        },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Přejmenovat",
        shortcut: "F2",
        onSelect: () => setRenamingPath(entry.path),
      },
      { type: "item", label: "Duplikovat", shortcut: "Ctrl+D", onSelect: duplicateActive },
      {
        type: "item",
        label: "Kopírovat cestu",
        onSelect: () => {
          writeText(entry.path).catch((err: unknown) =>
            setNotice(`Cestu se nepodařilo zkopírovat — ${String(err)}`),
          );
        },
      },
      { type: "separator" },
      {
        type: "item",
        label: "Kopírovat",
        shortcut: "Ctrl+C",
        onSelect: () => copyToClipboard("copy"),
      },
      { type: "item", label: "Vyjmout", shortcut: "Ctrl+X", onSelect: () => copyToClipboard("cut") },
      {
        type: "item",
        label: "Vložit",
        shortcut: "Ctrl+V",
        disabled: clipboard === null,
        onSelect: paste,
      },
      { type: "separator" },
      {
        type: "item",
        label: "Smazat",
        shortcut: "Delete",
        danger: true,
        onSelect: deleteTargets,
      },
      { type: "separator" },
      { type: "item", label: "Vlastnosti", onSelect: () => setPropertiesFor(entry) },
    ];
  }, [
    menu,
    targetEntries.length,
    clipboard,
    open,
    runOperation,
    duplicateActive,
    copyToClipboard,
    paste,
    deleteTargets,
  ]);

  const crumbs = nav.current ? breadcrumbs(nav.current) : [];
  const folderName = crumbs.length > 0 ? crumbs[crumbs.length - 1].label : "Finder";

  // Status bar i Quick Look musí počítat s tím, co je opravdu vidět —
  // v column view tedy se zaměřeným sloupcem, ne s obsahem nav.current.
  const needle = query.trim().toLowerCase();

  const columnEntries = focusedColumn?.entries ?? [];
  const visibleColumnEntries = needle
    ? columnEntries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : columnEntries;

  const previewEntries = isColumnView ? visibleColumnEntries : visibleEntries;
  const statusVisibleCount = isColumnView ? visibleColumnEntries.length : visibleEntries.length;
  const statusTotalCount = isColumnView ? columnEntries.length : sortedEntries.length;

  function renderContent() {
    if (nav.current === null) return <Placeholder>Začni výběrem složky vlevo.</Placeholder>;

    if (isColumnView) {
      return (
        <ColumnView
          api={columnsApi}
          windowFocused={windowFocused}
          onOpenFile={openFile}
          cutPaths={cutPaths}
          renamingPath={renamingPath}
          onRenameSubmit={submitRename}
          onRenameCancel={() => setRenamingPath(null)}
          onContextMenu={openContextMenu}
          query={query}
        />
      );
    }

    if (loading) return <Placeholder>Načítám…</Placeholder>;
    if (error) return <Placeholder>Složku se nepodařilo otevřít — {error}</Placeholder>;
    if (visibleEntries.length === 0) {
      return (
        <Placeholder>
          {query ? "Nic neodpovídá hledání." : "Tato složka je prázdná."}
        </Placeholder>
      );
    }

    const shared = {
      entries: visibleEntries,
      selectedPaths: selection,
      cutPaths,
      windowFocused,
      renamingPath,
      onRenameSubmit: submitRename,
      onRenameCancel: () => setRenamingPath(null),
      onSelect: selectEntry,
      onOpen: open,
      onContextMenu: openContextMenu,
    };

    if (viewMode === "list") {
      return (
        <ListView
          {...shared}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={sortBy}
        />
      );
    }

    return <IconView {...shared} />;
  }

  return (
    <div className="surface flex h-screen w-screen flex-col overflow-hidden bg-window text-primary">
      <IconDefs />
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          sections={sections}
          currentPath={nav.current}
          windowFocused={windowFocused}
          onNavigate={navigate}
        />

        <main className="surface flex min-w-0 flex-1 flex-col bg-main">
          <Toolbar
            folderName={folderName}
            canGoBack={nav.back.length > 0}
            canGoForward={nav.forward.length > 0}
            onBack={() => dispatch({ type: "back" })}
            onForward={() => dispatch({ type: "forward" })}
            viewMode={viewMode}
            onViewModeChange={changeViewMode}
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            query={query}
            onQueryChange={setQuery}
            searchRef={searchRef}
          />

          {notice && (
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5 text-[12px] text-secondary">
              <span className="min-w-0 flex-1 truncate">{notice}</span>
              <button type="button" onClick={() => setNotice(null)} className="shrink-0 underline">
                skrýt
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">{renderContent()}</div>
        </main>
      </div>

      <StatusBar
        path={nav.current}
        itemCount={statusVisibleCount}
        totalCount={statusTotalCount}
        filtered={needle.length > 0}
        freeSpace={freeSpace}
        onNavigate={navigate}
        editing={pathEditing}
        onEditingChange={setPathEditing}
      />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}

      {propertiesFor && (
        <PropertiesDialog entry={propertiesFor} onClose={() => setPropertiesFor(null)} />
      )}

      {quickLookOpen && activeEntry && !activeEntry.is_dir && (
        <QuickLook
          entries={previewEntries}
          entry={activeEntry}
          onClose={() => setQuickLookOpen(false)}
          onOpenFile={openFile}
        />
      )}
    </div>
  );
}
