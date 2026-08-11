import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { ColumnView } from "./components/ColumnView";
import { IconDefs } from "./components/icons";
import { IconView } from "./components/IconView";
import { ListView } from "./components/ListView";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { Toolbar } from "./components/Toolbar";
import { breadcrumbs, sortEntries, type SortDirection, type SortKey } from "./format";
import { INITIAL_NAV, navReducer } from "./navigation";
import { applyTheme, readStoredTheme } from "./theme";
import type { FavoriteSection, FileEntry, Theme, ViewMode } from "./types";

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-secondary">
      {children}
    </div>
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
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [freeSpace, setFreeSpace] = useState<number | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("icon");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [query, setQuery] = useState("");

  // Rozlišuje odpovědi z rychle po sobě jdoucích navigací, ať nepřepíšou tu poslední.
  const requestId = useRef(0);

  const navigate = useCallback((path: string) => dispatch({ type: "go", path }), []);

  useEffect(() => applyTheme(theme), [theme]);

  // Vybraný řádek musí zešednout, když okno není aktivní — jako v macOS.
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

  useEffect(() => {
    if (nav.current === null) return;

    const id = ++requestId.current;
    const path = nav.current;

    setLoading(true);
    setError(null);
    setNotice(null);
    setSelected(null);
    setQuery("");

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

    // Volné místo je jen doplňková informace — když selže, status bar ho vynechá.
    invoke<number>("get_disk_free_space", { path })
      .then((bytes) => {
        if (requestId.current === id) setFreeSpace(bytes);
      })
      .catch(() => {
        if (requestId.current === id) setFreeSpace(null);
      });
  }, [nav.current]);

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
      : entries;

    return sortEntries(filtered, sortKey, sortDirection);
  }, [entries, query, sortKey, sortDirection]);

  const open = useCallback(
    (entry: FileEntry) => {
      setSelected(entry);
      if (entry.is_dir) {
        navigate(entry.path);
        return;
      }
      invoke("open_file", { path: entry.path }).catch((err: unknown) =>
        setNotice(`Soubor se nepodařilo otevřít — ${String(err)}`),
      );
    },
    [navigate],
  );

  const sortBy = useCallback((key: SortKey) => {
    setSortKey((currentKey) => {
      setSortDirection((currentDirection) =>
        currentKey === key ? (currentDirection === "asc" ? "desc" : "asc") : "asc",
      );
      return key;
    });
  }, []);

  const crumbs = nav.current ? breadcrumbs(nav.current) : [];
  const folderName = crumbs.length > 0 ? crumbs[crumbs.length - 1].label : "Finder";

  function renderContent() {
    if (nav.current === null) return <Placeholder>Začni výběrem složky vlevo.</Placeholder>;
    if (viewMode === "column") return <ColumnView />;
    if (loading) return <Placeholder>Načítám…</Placeholder>;
    if (error) return <Placeholder>Složku se nepodařilo otevřít — {error}</Placeholder>;
    if (visibleEntries.length === 0) {
      return (
        <Placeholder>
          {query ? "Nic neodpovídá hledání." : "Tato složka je prázdná."}
        </Placeholder>
      );
    }

    if (viewMode === "list") {
      return (
        <ListView
          entries={visibleEntries}
          selectedPath={selected?.path ?? null}
          windowFocused={windowFocused}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={sortBy}
          onSelect={setSelected}
          onOpen={open}
        />
      );
    }

    return (
      <IconView
        entries={visibleEntries}
        selectedPath={selected?.path ?? null}
        windowFocused={windowFocused}
        onSelect={setSelected}
        onOpen={open}
      />
    );
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
            onViewModeChange={setViewMode}
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            query={query}
            onQueryChange={setQuery}
          />

          {notice && (
            <div className="shrink-0 border-b border-line px-3 py-1.5 text-[12px] text-secondary">
              {notice}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">{renderContent()}</div>
        </main>
      </div>

      <StatusBar
        path={nav.current}
        itemCount={visibleEntries.length}
        freeSpace={freeSpace}
        onNavigate={navigate}
      />
    </div>
  );
}
