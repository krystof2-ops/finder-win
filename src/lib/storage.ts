import { load, type Store } from "@tauri-apps/plugin-store";

import type { SortDirection, SortKey } from "../format";
import { readThemeMirror, writeThemeMirror, type ThemePreference } from "../theme";
import type { CustomFavorite, RecentEntry, RecentKind, TagColor, TagMap, ViewMode } from "../types";

/**
 * Persistentní nastavení v `settings.json` v app config adresáři.
 *
 * Čtení jde vždycky z in-memory cache a je synchronní — o to tady jde. Kdyby
 * getFavorites() vracelo Promise, každý řádek sidebaru by se plnil přes efekt
 * a při každém přerenderu by problikl prázdný stav. Zápis je async; plugin si
 * ho s autoSave odloží a slije do jednoho zápisu na disk.
 *
 * Komponenty se na cache nevěší napřímo — používají useStorage(), který stojí
 * nad subscribe() níž.
 */

const STORE_FILE = "settings.json";

const KEY_FAVORITES = "favorites";
const KEY_RECENTS = "recents";
const KEY_TAGS = "tags";
const KEY_SHOW_HIDDEN = "showHidden";
const KEY_SIDEBAR_WIDTH = "sidebarWidth";
const KEY_MOTION = "motion";
const KEY_LANGUAGE = "language";
const KEY_THEME = "theme";
const KEY_TERMINAL = "terminal";
const KEY_TABS = "tabs";
const KEY_UPDATES = "updates";
const KEY_SPLIT_RATIO = "splitRatio";
const KEY_COMMAND_USAGE = "commandUsage";

/** Animace: podle systému (omezit animace ve Windows), vždy, nebo nikdy. */
export type MotionPreference = "system" | "on" | "off";

/** Jazyk UI: podle systému, nebo napevno (viz i18n/index.ts). */
export type LanguagePreference = "system" | "en" | "cs";

/** Terminál pro „Otevřít v Terminálu": auto = Windows Terminal, jinak PowerShell. */
export type TerminalPreference = "auto" | "windowsTerminal" | "powershell" | "cmd";
const TERMINALS: TerminalPreference[] = ["auto", "windowsTerminal", "powershell", "cmd"];

/** Jeden panel uložené záložky: složka, zobrazení a řazení. */
export type SavedPanel = { path: string; view: ViewMode; sortKey: SortKey; sortDirection: SortDirection };

/** Záložky z minulého spuštění. Rozdělená záložka má i pravý panel. */
export type SavedTab = SavedPanel & { second?: SavedPanel; activePanel?: 0 | 1 };
export type SavedTabs = { items: SavedTab[]; active: number };

/** Kontrola aktualizací: zapnutá?, kdy naposled (ms) a co našla. */
export type UpdateSettings = {
  check: boolean;
  lastCheck: number;
  latest: { version: string; url: string } | null;
};

/** Rozsah šířky sidebaru při tažení za hranu; dvojklik vrací výchozí. */
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 360;
export const SIDEBAR_DEFAULT = 220;

/** Kolik nedávných se drží na disku. Sidebar jich ukazuje míň. */
export const RECENTS_LIMIT = 20;

export type Snapshot = {
  favorites: CustomFavorite[];
  recents: RecentEntry[];
  tags: TagMap;
  /** null = uživatel přepínač ještě nezměnil, platí nastavení Průzkumníku. */
  showHidden: boolean | null;
  sidebarWidth: number;
  motion: MotionPreference;
  language: LanguagePreference;
  /** Vzhled (menu Více → Vzhled); výchozí podle Windows. */
  theme: ThemePreference;
  /** Menu Více → Terminál. */
  terminal: TerminalPreference;
  tabs: SavedTabs;
  updates: UpdateSettings;
  /** Poměr šířky levého panelu v rozděleném okně (0,25–0,75). */
  splitRatio: number;
  /** Kolikrát se který příkaz spustil — paleta z toho ukazuje nejpoužívanější. */
  commandUsage: Record<string, number>;
};

const EMPTY: Snapshot = {
  favorites: [],
  recents: [],
  tags: {},
  showHidden: null,
  sidebarWidth: SIDEBAR_DEFAULT,
  motion: "system",
  language: "system",
  // Ze zrcadla v localStorage, ať první render nepřeskočí do jiného tématu,
  // než se načte settings.json.
  theme: readThemeMirror(),
  terminal: "auto",
  tabs: { items: [], active: 0 },
  updates: { check: true, lastCheck: 0, latest: null },
  splitRatio: 0.5,
  commandUsage: {},
};

export const SPLIT_RATIO_MIN = 0.25;
export const SPLIT_RATIO_MAX = 0.75;

export function clampSplitRatio(value: number): number {
  return Number.isFinite(value) ? Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value)) : 0.5;
}

function clampSidebar(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
}

let store: Store | null = null;
let cache: Snapshot = EMPTY;
let loading: Promise<void> | null = null;

/* ------------------------------- odběratelé -------------------------------- */

const listeners = new Set<() => void>();

/** Kontrakt useSyncExternalStore — identita snapshotu se mění jen při zápisu. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): Snapshot {
  return cache;
}

function commit(next: Partial<Snapshot>): void {
  cache = { ...cache, ...next };
  for (const listener of listeners) listener();
}

/* ---------------------------------- chyby ---------------------------------- */

/** Co se nepovedlo — text k tomu dodá App přes i18n (storage na i18n
 *  nezávisí, i18n naopak čte jazyk odsud). */
export type StorageErrorKind = "load" | "save";

type ErrorListener = (kind: StorageErrorKind, detail: string) => void;

const errorListeners = new Set<ErrorListener>();

/** Chyby zápisu na disk — App je ukáže v toastu, jinak by zmizely v konzoli
 *  a uživatel by se o ztracených oblíbených dozvěděl až po restartu. */
export function onError(listener: ErrorListener): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

function reportError(kind: StorageErrorKind, err: unknown): void {
  console.error(`storage: ${kind} failed`, err);
  for (const listener of errorListeners) listener(kind, String(err));
}

/* --------------------------------- init ------------------------------------ */

/** settings.json je obyčejný soubor na disku — uživatel do něj může sáhnout. */
function sanitizeFavorites(value: unknown): CustomFavorite[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item): CustomFavorite[] => {
    if (typeof item !== "object" || item === null) return [];

    const { label, path, icon, type } = item as Record<string, unknown>;
    if (typeof path !== "string" || path === "") return [];

    return [
      {
        path,
        label: typeof label === "string" && label !== "" ? label : lastSegment(path),
        icon: typeof icon === "string" && icon !== "" ? icon : "Folder",
        // Chybějící pole = zápis od starší verze, kdy sem směly jen složky.
        type: type === "file" ? "file" : "folder",
      },
    ];
  });
}

function sanitizeRecents(value: unknown): RecentEntry[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((item): RecentEntry[] => {
      if (typeof item !== "object" || item === null) return [];

      const record = item as Record<string, unknown>;
      const path = record.path;
      if (typeof path !== "string" || path === "") return [];

      return [
        {
          path,
          name: typeof record.name === "string" && record.name !== "" ? record.name : lastSegment(path),
          type: record.type === "folder" ? "folder" : "file",
          opened_at: typeof record.opened_at === "number" ? record.opened_at : 0,
        },
      ];
    })
    .slice(0, RECENTS_LIMIT);
}

function sanitizeTags(value: unknown): TagMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const result: TagMap = {};
  for (const [path, colors] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(colors)) continue;

    const valid = colors.filter(isTagColor);
    if (valid.length === 0) continue;

    // Starší verze klíčovaly tagy cestou tak, jak přišla ("C:\Users" i
    // "c:\users"). Normalizací se můžou dva klíče slít — barvy se sjednotí.
    const key = pathKey(path);
    result[key] = orderColors([...(result[key] ?? []), ...valid]);
  }

  return result;
}

function sanitizeTabs(value: unknown): SavedTabs {
  if (typeof value !== "object" || value === null) return EMPTY.tabs;
  const { items, active } = value as Record<string, unknown>;
  if (!Array.isArray(items)) return EMPTY.tabs;

  const panel = (value: unknown): SavedPanel | null => {
    if (typeof value !== "object" || value === null) return null;
    const { path, view, sortKey, sortDirection } = value as Record<string, unknown>;
    if (typeof path !== "string" || path === "") return null;
    return {
      path,
      view: view === "list" || view === "column" ? view : "icon",
      // Chybí u záložek uložených starší verzí — výchozí řazení.
      sortKey: sortKey === "modified" || sortKey === "size" || sortKey === "kind" ? sortKey : "name",
      sortDirection: sortDirection === "desc" ? "desc" : "asc",
    };
  };

  const valid = items.flatMap((item): SavedTab[] => {
    const first = panel(item);
    if (first === null) return [];
    const record = item as Record<string, unknown>;
    const second = panel(record.second);
    if (second === null) return [first];
    return [{ ...first, second, activePanel: record.activePanel === 1 ? 1 : 0 }];
  });
  const index = typeof active === "number" && Number.isInteger(active) ? active : 0;
  return { items: valid, active: Math.min(Math.max(index, 0), Math.max(valid.length - 1, 0)) };
}

function sanitizeUsage(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [id, count] of Object.entries(value as Record<string, unknown>)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) result[id] = Math.floor(count);
  }
  return result;
}

function sanitizeUpdates(value: unknown): UpdateSettings {
  if (typeof value !== "object" || value === null) return EMPTY.updates;
  const { check, lastCheck, latest } = value as Record<string, unknown>;
  const found = latest as Record<string, unknown> | null | undefined;
  return {
    check: typeof check === "boolean" ? check : true,
    // Čas z budoucnosti (ručně upravený soubor, posunuté hodiny) by kontrolu
    // zablokoval navždy — takový se zahodí.
    lastCheck: typeof lastCheck === "number" && Number.isFinite(lastCheck) && lastCheck <= Date.now() ? lastCheck : 0,
    latest:
      found && typeof found.version === "string" && typeof found.url === "string"
        ? { version: found.version, url: found.url }
        : null,
  };
}

/**
 * Otevře store a naplní cache. Opakovaná volání sdílí jeden běh, takže je
 * jedno, kolik komponent si o init řekne.
 */
export function init(): Promise<void> {
  if (loading) return loading;

  loading = (async () => {
    store = await load(STORE_FILE, { autoSave: 200 });

    const [favorites, recents, tags, showHidden, sidebarWidth, motion, language, theme, terminal, tabs, updates, splitRatio, usage] =
      await Promise.all([
        store.get<unknown>(KEY_FAVORITES),
        store.get<unknown>(KEY_RECENTS),
        store.get<unknown>(KEY_TAGS),
        store.get<unknown>(KEY_SHOW_HIDDEN),
        store.get<unknown>(KEY_SIDEBAR_WIDTH),
        store.get<unknown>(KEY_MOTION),
        store.get<unknown>(KEY_LANGUAGE),
        store.get<unknown>(KEY_THEME),
        store.get<unknown>(KEY_TERMINAL),
        store.get<unknown>(KEY_TABS),
        store.get<unknown>(KEY_UPDATES),
        store.get<unknown>(KEY_SPLIT_RATIO),
        store.get<unknown>(KEY_COMMAND_USAGE),
      ]);

    commit({
      favorites: sanitizeFavorites(favorites),
      recents: sanitizeRecents(recents),
      tags: sanitizeTags(tags),
      showHidden: typeof showHidden === "boolean" ? showHidden : null,
      sidebarWidth: typeof sidebarWidth === "number" ? clampSidebar(sidebarWidth) : SIDEBAR_DEFAULT,
      motion: motion === "on" || motion === "off" ? motion : "system",
      language: language === "en" || language === "cs" ? language : "system",
      // Bez klíče v souboru (verze do 1.3 ukládaly jen do localStorage)
      // platí zrcadlo — uživatel o zvolený tmavý režim nepřijde.
      theme: theme === "light" || theme === "dark" || theme === "system" ? theme : readThemeMirror(),
      terminal: TERMINALS.find((option) => option === terminal) ?? "auto",
      tabs: sanitizeTabs(tabs),
      updates: sanitizeUpdates(updates),
      splitRatio: typeof splitRatio === "number" ? clampSplitRatio(splitRatio) : 0.5,
      commandUsage: sanitizeUsage(usage),
    });
    // Zrcadlo pro první render drží krok se souborem (i po smazání dat WebView2).
    writeThemeMirror(cache.theme);
  })().catch((err: unknown) => {
    // Rozbité nastavení nesmí shodit aplikaci — pojede se s prázdným.
    reportError("load", err);
  });

  return loading;
}

/** Cache je aktualizovaná už před voláním; tady se jen dopisuje na disk. */
async function persist(key: string, value: unknown): Promise<void> {
  // Zápis může přijít dřív, než doběhne init — pak by se bez čekání ztratil.
  await init();
  if (store === null) return;

  try {
    await store.set(key, value);
  } catch (err: unknown) {
    reportError("save", err);
  }
}

/* ---------------------------- skryté soubory -------------------------------- */

export async function setShowHidden(value: boolean): Promise<void> {
  commit({ showHidden: value });
  await persist(KEY_SHOW_HIDDEN, value);
}

/* ---------------------------- šířka sidebaru -------------------------------- */

/** Během tažení se jen překresluje (persist = false), na disk až na konci. */
export async function setSidebarWidth(width: number, persistNow = true): Promise<void> {
  commit({ sidebarWidth: clampSidebar(width) });
  if (persistNow) await persist(KEY_SIDEBAR_WIDTH, cache.sidebarWidth);
}

/* -------------------------------- animace ----------------------------------- */

export async function setMotion(value: MotionPreference): Promise<void> {
  commit({ motion: value });
  await persist(KEY_MOTION, value);
}

/* --------------------------------- jazyk ------------------------------------ */

export async function setLanguage(value: LanguagePreference): Promise<void> {
  commit({ language: value });
  await persist(KEY_LANGUAGE, value);
}

/* --------------------------------- vzhled ----------------------------------- */

export async function setTheme(value: ThemePreference): Promise<void> {
  commit({ theme: value });
  writeThemeMirror(value);
  await persist(KEY_THEME, value);
}

/* -------------------------------- terminál ---------------------------------- */

export async function setTerminal(value: TerminalPreference): Promise<void> {
  commit({ terminal: value });
  await persist(KEY_TERMINAL, value);
}

/* -------------------------------- záložky ----------------------------------- */

export async function setSavedTabs(value: SavedTabs): Promise<void> {
  commit({ tabs: value });
  await persist(KEY_TABS, value);
}

/* ---------------------------- paleta příkazů --------------------------------- */

/** Jedno spuštění příkazu navíc — zápis na disk slije autoSave pluginu. */
export async function countCommand(id: string): Promise<void> {
  const usage = { ...cache.commandUsage, [id]: (cache.commandUsage[id] ?? 0) + 1 };
  commit({ commandUsage: usage });
  await persist(KEY_COMMAND_USAGE, usage);
}

/* ---------------------------- rozdělené okno --------------------------------- */

/** Během tažení dělicí čáry se jen překresluje (persist = false), na disk až na konci. */
export async function setSplitRatio(value: number, persistNow = true): Promise<void> {
  commit({ splitRatio: clampSplitRatio(value) });
  if (persistNow) await persist(KEY_SPLIT_RATIO, cache.splitRatio);
}

/* ----------------------------- aktualizace ---------------------------------- */

export async function setUpdates(value: Partial<UpdateSettings>): Promise<void> {
  commit({ updates: { ...cache.updates, ...value } });
  await persist(KEY_UPDATES, cache.updates);
}

/* ------------------------------- oblíbené ---------------------------------- */

export async function setFavorites(items: CustomFavorite[]): Promise<void> {
  commit({ favorites: items });
  await persist(KEY_FAVORITES, items);
}

/**
 * Duplicitní cesta se ignoruje — dvakrát tatáž složka v sidebaru nedává smysl.
 * `index` je místo, kam ukazoval drop indikátor; bez něj se přidává na konec.
 */
export async function addFavorite(item: CustomFavorite, index?: number): Promise<boolean> {
  if (cache.favorites.some((favorite) => samePath(favorite.path, item.path))) return false;

  const items = [...cache.favorites];
  const at = index === undefined ? items.length : Math.max(0, Math.min(index, items.length));
  items.splice(at, 0, item);

  await setFavorites(items);
  return true;
}

export async function removeFavorite(path: string): Promise<void> {
  await setFavorites(cache.favorites.filter((favorite) => !samePath(favorite.path, path)));
}

/** Mění se jen popisek, cesta zůstává — proto ne rename_path na disku. */
export async function renameFavorite(path: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (trimmed === "") return;

  await setFavorites(
    cache.favorites.map((favorite) =>
      samePath(favorite.path, path) ? { ...favorite, label: trimmed } : favorite,
    ),
  );
}

/**
 * Přesun v rámci sekce. `to` je pozice mezi řádky, kterou ukazoval drop
 * indikátor — tedy index *před* vyjmutím taženého prvku.
 */
export async function moveFavorite(from: number, to: number): Promise<void> {
  const items = [...cache.favorites];
  if (from < 0 || from >= items.length) return;

  const [moved] = items.splice(from, 1);
  const target = to > from ? to - 1 : to;
  items.splice(Math.max(0, Math.min(target, items.length)), 0, moved);

  await setFavorites(items);
}

/* -------------------------------- nedávné ---------------------------------- */

/**
 * Nejnovější první. Když už cesta v seznamu je, jen se vytáhne nahoru
 * s novým časem — jinak by pár často otvíraných souborů seznam zaplevelilo.
 */
export async function addRecent(path: string, name: string, type: RecentKind): Promise<void> {
  const entry: RecentEntry = { path, name, type, opened_at: Date.now() };
  const rest = cache.recents.filter((recent) => !samePath(recent.path, path));

  commit({ recents: [entry, ...rest].slice(0, RECENTS_LIMIT) });
  await persist(KEY_RECENTS, cache.recents);
}

export async function removeRecent(path: string): Promise<void> {
  commit({ recents: cache.recents.filter((recent) => !samePath(recent.path, path)) });
  await persist(KEY_RECENTS, cache.recents);
}

export async function clearRecents(): Promise<void> {
  commit({ recents: [] });
  await persist(KEY_RECENTS, []);
}

/* ---------------------------------- tagy ----------------------------------- */

export async function setTags(map: TagMap): Promise<void> {
  commit({ tags: map });
  await persist(KEY_TAGS, map);
}

/** Přidá barvu, nebo ji odebere, když už tam je. S posledním tagem mizí i klíč. */
export async function toggleTag(path: string, color: TagColor): Promise<void> {
  const key = pathKey(path);
  const current = cache.tags[key] ?? [];
  const next = current.includes(color)
    ? current.filter((existing) => existing !== color)
    : orderColors([...current, color]);

  const map = { ...cache.tags };
  if (next.length === 0) delete map[key];
  else map[key] = next;

  await setTags(map);
}

/** Nastaví (on) nebo sundá barvu u všech cest naráz — jeden zápis na disk. */
export async function setTag(paths: string[], color: TagColor, on: boolean): Promise<void> {
  const map = { ...cache.tags };

  for (const path of paths) {
    const key = pathKey(path);
    const current = map[key] ?? [];
    const next = on
      ? orderColors([...current.filter((existing) => existing !== color), color])
      : current.filter((existing) => existing !== color);

    if (next.length === 0) delete map[key];
    else map[key] = next;
  }

  await setTags(map);
}

/** Nastaví položkám přesně dané barvy (prázdné pole = žádné) — pro Zpět / Znovu. */
export async function setTagsOf(colorsByPath: Record<string, TagColor[]>): Promise<void> {
  const map = { ...cache.tags };
  for (const [path, colors] of Object.entries(colorsByPath)) {
    const key = pathKey(path);
    if (colors.length === 0) delete map[key];
    else map[key] = orderColors(colors);
  }
  await setTags(map);
}

/** Sundá z položky všechny barvy naráz — po jedné by to bylo až sedm kliků. */
export async function clearTags(path: string): Promise<void> {
  const key = pathKey(path);
  if (!(key in cache.tags)) return;

  const map = { ...cache.tags };
  delete map[key];
  await setTags(map);
}

/** Sundá jednu barvu ze všech položek — z menu sekce TAGY v sidebaru. */
export async function removeTagEverywhere(color: TagColor): Promise<void> {
  const map: TagMap = {};
  let changed = false;

  for (const [path, colors] of Object.entries(cache.tags)) {
    const next = colors.filter((existing) => existing !== color);
    if (next.length !== colors.length) changed = true;
    if (next.length > 0) map[path] = next;
  }

  if (changed) await setTags(map);
}

/** Tyhle cesty zmizely mimo naši aplikaci — zahodit, ať tag view nelže. */
export async function pruneTags(paths: Iterable<string>): Promise<void> {
  const map = { ...cache.tags };
  let changed = false;

  for (const path of paths) {
    const key = pathKey(path);
    if (key in map) {
      delete map[key];
      changed = true;
    }
  }

  if (changed) await setTags(map);
}

/* ------------------------ přejmenování a přesuny --------------------------- */

/** `path` je `root` sám, nebo leží pod ním. Vrací zbytek za rootem, jinak null. */
function relativeTo(path: string, root: string): string | null {
  // Stejné úpravy jako pathKey, jen bez změny velikosti písmen — zbytek cesty
  // si tak drží původní podobu ("\Fotky\Léto.jpg").
  const normalized = path.replace(/\//g, "\\").replace(/\\+$/, "");
  const key = pathKey(path);
  const rootKey = pathKey(root);
  if (key === rootKey) return "";

  const prefix = rootKey.endsWith("\\") ? rootKey : `${rootKey}\\`;
  if (!key.startsWith(prefix)) return null;
  return normalized.slice(prefix.length - 1);
}

/**
 * Položka `from` se přejmenovala nebo přesunula na `to`. Tagy, oblíbené
 * i nedávné na ni (a u složky na všechno pod ní) se překlíčují — jinak by tag
 * tiše zmizel a oblíbená položka ukazovala na neexistující cestu.
 */
export async function remapPath(from: string, to: string): Promise<void> {
  const moved = (path: string): string | null => {
    const rest = relativeTo(path, from);
    return rest === null ? null : `${to}${rest}`;
  };

  // Tagy — klíče jsou normalizované, nová cesta taky.
  let tagsChanged = false;
  const tags: TagMap = {};
  for (const [key, colors] of Object.entries(cache.tags)) {
    const next = moved(key);
    if (next !== null) tagsChanged = true;
    const target = next === null ? key : pathKey(next);
    tags[target] = orderColors([...(tags[target] ?? []), ...colors]);
  }

  // Oblíbené — popisek se mění jen když byl automatický (= název položky).
  let favoritesChanged = false;
  const favorites = cache.favorites.map((favorite) => {
    const next = moved(favorite.path);
    if (next === null) return favorite;
    favoritesChanged = true;
    const autoLabel = favorite.label === lastSegment(favorite.path);
    return { ...favorite, path: next, label: autoLabel ? lastSegment(next) : favorite.label };
  });

  let recentsChanged = false;
  const recents = cache.recents.map((recent) => {
    const next = moved(recent.path);
    if (next === null) return recent;
    recentsChanged = true;
    return { ...recent, path: next, name: lastSegment(next) };
  });

  if (tagsChanged) await setTags(tags);
  if (favoritesChanged) await setFavorites(favorites);
  if (recentsChanged) {
    commit({ recents });
    await persist(KEY_RECENTS, recents);
  }
}

/** Kopie (duplikace, Kopírovat + Vložit) si nese tagy originálu, jako ve Finderu. */
export async function copyTags(from: string, to: string): Promise<void> {
  const additions: TagMap = {};
  for (const [key, colors] of Object.entries(cache.tags)) {
    const rest = relativeTo(key, from);
    if (rest !== null) additions[pathKey(`${to}${rest}`)] = colors;
  }
  if (Object.keys(additions).length > 0) await setTags({ ...cache.tags, ...additions });
}

/* -------------------------------- pomocné ---------------------------------- */

/** Pořadí jako v paletě — puntíky u souboru tak vypadají stejně napříč views. */
export const TAG_COLORS: readonly TagColor[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "grey",
];

function isTagColor(value: unknown): value is TagColor {
  return typeof value === "string" && (TAG_COLORS as readonly string[]).includes(value);
}

function orderColors(colors: TagColor[]): TagColor[] {
  return TAG_COLORS.filter((color) => colors.includes(color));
}

/**
 * Jednotný klíč cesty: malá písmena, zpětná lomítka, bez lomítka na konci
 * (kromě kořene disku). Windows velikost písmen nerozlišuje — ručně zadané
 * "c:\users\…" musí najít tytéž tagy jako "C:\Users\…" z výpisu.
 */
export function pathKey(path: string): string {
  const key = path.replace(/\//g, "\\").toLowerCase();
  if (/^[a-z]:\\?$/.test(key)) return `${key.slice(0, 2)}\\`;
  return key.replace(/\\+$/, "");
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

const NO_TAGS: TagColor[] = [];

/** Barvy položky. Vždy přes tuhle funkci — mapa je klíčovaná pathKey(). */
export function tagsOf(tags: TagMap, path: string): TagColor[] {
  return tags[pathKey(path)] ?? NO_TAGS;
}

/** "C:\\Users\\jane\\Downloads" → "Downloads"; kořen disku vrátí "C:". */
export function lastSegment(path: string): string {
  const parts = path.split("\\").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
