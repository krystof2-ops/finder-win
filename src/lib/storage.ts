import { load, type Store } from "@tauri-apps/plugin-store";

import type { CustomFavorite, RecentEntry, RecentKind, TagColor, TagMap } from "../types";

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

/** Kolik nedávných se drží na disku. Sidebar jich ukazuje míň. */
export const RECENTS_LIMIT = 20;

export type Snapshot = {
  favorites: CustomFavorite[];
  recents: RecentEntry[];
  tags: TagMap;
};

const EMPTY: Snapshot = { favorites: [], recents: [], tags: {} };

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
    if (valid.length > 0) result[path] = orderColors(valid);
  }

  return result;
}

/**
 * Otevře store a naplní cache. Opakovaná volání sdílí jeden běh, takže je
 * jedno, kolik komponent si o init řekne.
 */
export function init(): Promise<void> {
  if (loading) return loading;

  loading = (async () => {
    store = await load(STORE_FILE, { autoSave: 200 });

    const [favorites, recents, tags] = await Promise.all([
      store.get<unknown>(KEY_FAVORITES),
      store.get<unknown>(KEY_RECENTS),
      store.get<unknown>(KEY_TAGS),
    ]);

    commit({
      favorites: sanitizeFavorites(favorites),
      recents: sanitizeRecents(recents),
      tags: sanitizeTags(tags),
    });
  })().catch((err: unknown) => {
    // Rozbité nastavení nesmí shodit aplikaci — pojede se s prázdným.
    console.error("storage: init selhal", err);
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
    console.error(`storage: zápis "${key}" selhal`, err);
  }
}

/* ------------------------------- oblíbené ---------------------------------- */

export function getFavorites(): CustomFavorite[] {
  return cache.favorites;
}

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

export function getRecents(): RecentEntry[] {
  return cache.recents;
}

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

export function getTags(): TagMap {
  return cache.tags;
}

export async function setTags(map: TagMap): Promise<void> {
  commit({ tags: map });
  await persist(KEY_TAGS, map);
}

/** Přidá barvu, nebo ji odebere, když už tam je. S posledním tagem mizí i klíč. */
export async function toggleTag(path: string, color: TagColor): Promise<void> {
  const current = cache.tags[path] ?? [];
  const next = current.includes(color)
    ? current.filter((existing) => existing !== color)
    : orderColors([...current, color]);

  const map = { ...cache.tags };
  if (next.length === 0) delete map[path];
  else map[path] = next;

  await setTags(map);
}

/** Sundá z položky všechny barvy naráz — po jedné by to bylo až sedm kliků. */
export async function clearTags(path: string): Promise<void> {
  if (!(path in cache.tags)) return;

  const map = { ...cache.tags };
  delete map[path];
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
    if (path in map) {
      delete map[path];
      changed = true;
    }
  }

  if (changed) await setTags(map);
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

/** Windows cesty nerozlišují velikost písmen, porovnání se tomu musí přizpůsobit. */
export function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** "C:\\Users\\jane\\Downloads" → "Downloads"; kořen disku vrátí "C:". */
export function lastSegment(path: string): string {
  const parts = path.split("\\").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
