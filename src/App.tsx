import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";

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
import { TagView } from "./components/TagView";
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
import * as storage from "./lib/storage";
import { TAG_LABEL } from "./lib/tags";
import { useStorage } from "./lib/useStorage";
import { INITIAL_NAV, navReducer } from "./navigation";
import { applyTheme, readStoredTheme } from "./theme";
import type { Clipboard, FavoriteSection, FileEntry, TagColor, Theme, ViewMode } from "./types";

/** Jak dlouho hláška zůstane, než sama odjede. Musí sedět s fw-toast-out. */
const TOAST_VISIBLE_MS = 2000;
const TOAST_EXIT_MS = 240;

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
  /** Hláška ještě visí, ale už odjíždí dolů. */
  const [noticeClosing, setNoticeClosing] = useState(false);
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

  // Tag view je samostatný režim hlavního panelu — nesouvisí s nav.current,
  // proto vlastní stav a ne další ViewMode.
  const [tagFilter, setTagFilter] = useState<TagColor | null>(null);
  const [tagCount, setTagCount] = useState(0);
  /** Co má "Zobrazit ve složce" označit, až dorazí výpis složky `dir`. */
  const [pendingSelect, setPendingSelect] = useState<{ dir: string; path: string } | null>(null);
  /** Složka, ke které patří obsah `entries`. Ne totéž co nav.current — ten se
   *  změní hned, kdežto entries dojedou až po odpovědi backendu. */
  const [loadedPath, setLoadedPath] = useState<string | null>(null);

  const { tags } = useStorage();

  const [viewMode, setViewMode] = useState<ViewMode>("icon");
  /** Krátká fáze, kdy starý obsah dohasíná, než se vymění za nový. */
  const [viewSwapping, setViewSwapping] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [query, setQuery] = useState("");
  const [quickLookOpen, setQuickLookOpen] = useState(false);

  const requestId = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const viewSwapTimer = useRef<number | null>(null);

  // Každý přechod do složky opouští tag view — jinak by sidebar zvýrazňoval
  // barvu, jejíž výsledky už nikdo nevidí.
  const navigate = useCallback((path: string) => {
    setTagFilter(null);
    dispatch({ type: "go", path });
  }, []);

  const goBack = useCallback(() => {
    setTagFilter(null);
    dispatch({ type: "back" });
  }, []);

  const goForward = useCallback(() => {
    setTagFilter(null);
    dispatch({ type: "forward" });
  }, []);

  const columnsApi = useColumns(nav.current, viewMode === "column");

  // Persistentní nastavení se načte jednou; do té doby jedou sekce prázdné.
  useEffect(() => {
    void storage.init();
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  // Hláška se sama sveze dolů po dvou sekundách. Oba časovače visí na `notice`,
  // takže nová hláška ty staré zruší a odpočet začne znovu.
  useEffect(() => {
    if (notice === null) return;

    setNoticeClosing(false);
    const startExit = window.setTimeout(() => setNoticeClosing(true), TOAST_VISIBLE_MS);
    const remove = window.setTimeout(
      () => setNotice(null),
      TOAST_VISIBLE_MS + TOAST_EXIT_MS,
    );

    return () => {
      window.clearTimeout(startExit);
      window.clearTimeout(remove);
    };
  }, [notice]);

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
        setLoadedPath(path);
      })
      .catch((err: unknown) => {
        if (requestId.current !== id) return;
        setEntries([]);
        // I neúspěch je "dojeto" — jinak by čekající výběr visel navždy.
        setLoadedPath(path);
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

  /** Jediná cesta k otevření souboru — proto se nedávné zapisují právě tady. */
  const openFile = useCallback((entry: FileEntry) => {
    void storage.addRecent(entry.path, entry.name, "file");

    invoke("open_file", { path: entry.path }).catch((err: unknown) =>
      setNotice(`Soubor se nepodařilo otevřít — ${String(err)}`),
    );
  }, []);

  const open = useCallback(
    (entry: FileEntry) => {
      selectEntry(entry);

      if (entry.is_dir) {
        void storage.addRecent(entry.path, entry.name, "folder");
        navigate(entry.path);
      } else {
        openFile(entry);
      }
    },
    [navigate, openFile, selectEntry],
  );

  /** Sidebar volá s holou cestou — nedávné o FileEntry nevědí. */
  const openRecentFile = useCallback(
    (path: string, name: string) => {
      openFile({
        name,
        path,
        is_dir: false,
        size: 0,
        modified: 0,
        created: 0,
        extension: null,
      });
    },
    [openFile],
  );

  /** Skočí do nadřazené složky a označí v ní danou položku. */
  const reveal = useCallback(
    (path: string) => {
      const parent = parentPath(path);
      if (parent === null) return;

      navigate(parent);
      setPendingSelect({ dir: parent, path });
    },
    [navigate],
  );

  // Čeká se na výpis *té* složky, do které se odkrývá. Na `loading` se spolehnout
  // nedá — v prvním průchodu efektů je ještě false z předchozí složky.
  useEffect(() => {
    if (pendingSelect === null || loadedPath !== pendingSelect.dir) return;

    const found = entries.find((entry) => entry.path === pendingSelect.path);
    if (found) {
      setActive(found);
      setSelection(new Set([found.path]));

      // Ve stovkách položek by označení zůstalo mimo obrazovku. Řádek se hledá
      // přes data-path, ať se kvůli jednomu doscrollování netahá ref přes obě views.
      const target = found.path;
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-path="${CSS.escape(target)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    }
    // Zahazuje se i když se položka nenašla, ať požadavek nevisí dál.
    setPendingSelect(null);
  }, [entries, loadedPath, pendingSelect]);

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
      // Tag view nemá výběr v hlavním panelu — zkratky by mířily na položky
      // podkladové složky, které uživatel nevidí. Nejnebezpečnější je Delete.
      if (tagFilter !== null) return;
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
    tagFilter,
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

  /* -------------------------- boční tlačítka myši ------------------------- */

  // MB4/MB5 = zpět/vpřed v historii, přesně jako šipky v toolbaru.
  //
  // Posluchače běží v capture fázi. React má delegaci až na kontejneru a Quick
  // Look si v onMouseDown volá stopPropagation, takže v bubble fázi by událost
  // do window vůbec nedorazila.
  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (event.button !== 3 && event.button !== 4) return;
      // Quick Look si boční tlačítka obsluhuje sám — přepíná jimi soubory.
      if (quickLookOpen) return;
      if (isTypingTarget(event.target)) return;

      event.preventDefault();
      if (event.button === 3) goBack();
      else goForward();
    }

    // Bez tohohle by webview na boční tlačítka odnavigovalo vlastní historii
    // a odešlo pryč ze stránky aplikace. Ruší se proto vždy, i v Quick Look.
    function swallow(event: MouseEvent) {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    }

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", swallow, true);
    window.addEventListener("auxclick", swallow, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", swallow, true);
      window.removeEventListener("auxclick", swallow, true);
    };
  }, [quickLookOpen, goBack, goForward]);

  /* ----------------------------- view mode -------------------------------- */

  const changeViewMode = useCallback(
    (mode: ViewMode) => {
      if (mode === viewMode) return;

      const { activePath } = columnsApi;
      const swap = () => {
        if (viewMode === "column" && mode !== "column" && activePath && activePath !== nav.current) {
          navigate(activePath);
        }
        setViewMode(mode);
        setViewSwapping(false);
      };

      // Obsah nejdřív dohasne, teprve pak se vymění — bez toho by nové view
      // skočilo doprostřed animace a cross-fade by nebyl vidět.
      setViewSwapping(true);
      if (viewSwapTimer.current !== null) window.clearTimeout(viewSwapTimer.current);
      viewSwapTimer.current = window.setTimeout(swap, 120);
    },
    [viewMode, columnsApi, nav.current, navigate],
  );

  useEffect(
    () => () => {
      if (viewSwapTimer.current !== null) window.clearTimeout(viewSwapTimer.current);
    },
    [],
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
      {
        type: "tags",
        label: "Tagy",
        active: tags[entry.path] ?? [],
        onToggle: (color) => void storage.toggleTag(entry.path, color),
      },
      { type: "separator" },
      { type: "item", label: "Vlastnosti", onSelect: () => setPropertiesFor(entry) },
    ];
  }, [
    menu,
    tags,
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
  const folderName =
    tagFilter !== null
      ? TAG_LABEL[tagFilter]
      : crumbs.length > 0
        ? crumbs[crumbs.length - 1].label
        : "Finder";

  // Status bar i Quick Look musí počítat s tím, co je opravdu vidět —
  // v column view tedy se zaměřeným sloupcem, ne s obsahem nav.current.
  const needle = query.trim().toLowerCase();

  const columnEntries = focusedColumn?.entries ?? [];
  const visibleColumnEntries = needle
    ? columnEntries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : columnEntries;

  const previewEntries = isColumnView ? visibleColumnEntries : visibleEntries;

  const inTagView = tagFilter !== null;
  const statusVisibleCount = inTagView
    ? tagCount
    : isColumnView
      ? visibleColumnEntries.length
      : visibleEntries.length;
  const statusTotalCount = inTagView
    ? tagCount
    : isColumnView
      ? columnEntries.length
      : sortedEntries.length;

  function renderContent() {
    if (tagFilter !== null) {
      return (
        <TagView
          color={tagFilter}
          windowFocused={windowFocused}
          onReveal={reveal}
          onOpen={openFile}
          onCountChange={setTagCount}
        />
      );
    }

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
          tags={tags}
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
      tags,
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
          onOpenFile={openRecentFile}
          onReveal={reveal}
          activeTag={tagFilter}
          onSelectTag={setTagFilter}
        />

        <main className="surface flex min-w-0 flex-1 flex-col bg-main">
          <Toolbar
            folderName={folderName}
            canGoBack={nav.back.length > 0}
            canGoForward={nav.forward.length > 0}
            onBack={goBack}
            onForward={goForward}
            viewMode={viewMode}
            onViewModeChange={changeViewMode}
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            query={query}
            onQueryChange={setQuery}
            searchRef={searchRef}
            onRefresh={refresh}
            onGoToParent={goToParent}
            canGoToParent={currentDir !== null && parentPath(currentDir) !== null}
          />

          {/* key vynutí remount při změně view, čímž se přehraje fw-view-swap.
              Během dohasínání key ještě drží starou hodnotu. */}
          <div
            key={viewMode}
            data-view={viewMode}
            className={`min-h-0 flex-1 overflow-auto ${
              viewSwapping ? "fw-view-out" : "fw-view-swap"
            }`}
          >
            {renderContent()}
          </div>
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

      {/* Hláška plave nad status barem. Vnější obal centruje, vnitřní animuje —
          keyframes přepisují transform, takže by centrování translateX sežraly. */}
      {notice && (
        <div
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
          style={{ bottom: 32 }}
        >
          <div
            className={`pointer-events-auto flex max-w-[70%] items-center gap-3 rounded-lg px-3 py-2 text-[12px] ${
              noticeClosing ? "fw-toast-out" : "fw-toast-in"
            }`}
            style={{
              background: "var(--bg-toolbar)",
              border: "1px solid var(--border)",
              boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
              backdropFilter: "blur(20px)",
            }}
          >
            <span className="min-w-0 flex-1 text-primary">{notice}</span>
            <button
              type="button"
              aria-label="Zavřít"
              onClick={() => setNoticeClosing(true)}
              className="shrink-0 text-secondary transition-colors duration-100 hover:text-primary"
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}

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
