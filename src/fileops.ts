import { Channel, invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";

import { joinPath, splitPath } from "./format";
import { errorText, isMessageKey, t, type Params } from "./i18n";
import type { FileEntry, FileProperties, FolderStats, OpResult, StatResult } from "./types";

/* ------------------------------ chyby backendu ------------------------------ */

/** Chyba z Rustu (AppError): klíč do slovníku a parametry, i vnořené chyby. */
type BackendError = { key: string; args?: Record<string, string | number | BackendError> };

function isBackendError(value: unknown): value is BackendError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key?: unknown }).key === "string"
  );
}

/**
 * Jediné místo, kde se chyba z backendu mění na text — v jazyce UI v okamžiku
 * chyby. Neznámý klíč (novější backend) projde aspoň s parametry.
 */
export function localizeError(err: unknown): string {
  if (!isBackendError(err)) return errorText(err);

  const params: Params = {};
  for (const [name, value] of Object.entries(err.args ?? {})) {
    params[name] = typeof value === "object" ? localizeError(value) : value;
  }

  if (isMessageKey(err.key)) return t(err.key, params);
  return [err.key, ...Object.values(params)].join(" ");
}

/**
 * invoke() se srozumitelnou chybou: místo objektu `{ key, args }` odmítne
 * přeloženým textem, takže volající dál dělají jen `String(err)`.
 */
export async function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (err: unknown) {
    throw localizeError(err);
  }
}

/* Tenké typované obálky nad Tauri commandy.
   Tauri převádí snake_case parametry na camelCase, proto toName / toDir. */

export function renamePath(from: string, toName: string): Promise<string> {
  return invoke<string>("rename_path", { from, toName });
}

/** Celý výběr do koše jedním voláním. */
export function moveToTrash(paths: string[]): Promise<void> {
  return invoke<void>("move_to_trash", { paths });
}

/** Smaže se některá z cest trvale? (Svazek bez Koše — flashka, síť.) */
export function trashIsPermanent(paths: string[]): Promise<boolean> {
  return invoke<boolean>("trash_is_permanent", { paths });
}

/** Co dělat s kolizí jména v cíli: ponechat obě, nahradit (složku sloučit), přeskočit. */
export type OnConflict = "rename" | "replace" | "skip";

/* Při „ponechat obě" a duplikaci dostane kopie slovo v jazyce UI:
   „Foto (kopie).jpg" / „Photo (copy).jpg". */

export function copyPath(from: string, toDir: string, onConflict: OnConflict = "rename"): Promise<OpResult> {
  return invoke<OpResult>("copy_path", { from, toDir, onConflict, copyLabel: t("name.copySuffix") });
}

export function movePath(from: string, toDir: string, onConflict: OnConflict = "rename"): Promise<OpResult> {
  return invoke<OpResult>("move_path", { from, toDir, onConflict, copyLabel: t("name.copySuffix") });
}

export function duplicatePath(path: string): Promise<OpResult> {
  return invoke<OpResult>("duplicate_path", { path, copyLabel: t("name.copySuffix") });
}

export function statPaths(paths: string[]): Promise<StatResult[]> {
  return invoke<StatResult[]>("stat_paths", { paths });
}

export function openInExplorer(path: string): Promise<void> {
  return invoke<void>("open_in_explorer", { path });
}

/** Systémový dialog „Otevřít v aplikaci". */
export function openWith(path: string): Promise<void> {
  return invoke<void>("open_with", { path });
}

/** Terminál ve složce — u souboru v té jeho. */
export function openTerminal(path: string): Promise<void> {
  return invoke<void>("open_terminal", { path });
}

/** Vytvoří složku a vrátí její cestu (název se při kolizi očísluje). */
export function createFolder(dir: string, name: string): Promise<string> {
  return invoke<string>("create_folder", { dir, name });
}

export function createFile(dir: string, name: string): Promise<string> {
  return invoke<string>("create_file", { dir, name });
}

/** Telefon nebo fotoaparát (shellová cesta) — prohlížet ho umí jen Průzkumník. */
export function openDevice(path: string): Promise<void> {
  return invoke("open_device", { path });
}

export function getFileProperties(path: string): Promise<FileProperties> {
  return invoke<FileProperties>("get_file_properties", { path });
}

/** Velikost a počet položek složky; mezisoučty chodí do `onProgress`. */
export function folderStats(
  path: string,
  requestId: number,
  onProgress: (stats: FolderStats) => void,
): Promise<FolderStats> {
  const channel = new Channel<FolderStats>();
  channel.onmessage = onProgress;
  return invoke<FolderStats>("folder_stats", { path, requestId, onProgress: channel });
}

export function cancelFolderStats(requestId: number): Promise<void> {
  return invoke<void>("cancel_folder_stats", { requestId });
}

export function searchRecursive(
  root: string,
  query: string,
  maxResults: number,
  showHidden: boolean,
  searchId: number,
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("search_recursive", { root, query, maxResults, showHidden, searchId });
}

/** Zastaví běžící hledání — backend by jinak prošel celý disk až do konce. */
export function cancelSearch(searchId: number): Promise<void> {
  return invoke<void>("cancel_search", { searchId });
}

/** Nadřazená složka, nebo null pro kořen disku či síťového share. */
export function parentPath(path: string): string | null {
  const { root, parts } = splitPath(path);
  if (parts.length === 0) return null;
  return joinPath(root, parts.slice(0, -1));
}

/**
 * Rodičovská složka relativně ke kořeni hledání — sloupec „Kde je" ve výsledcích.
 *
 * Prázdný řetězec znamená „přímo v prohledávané složce"; volající si za něj
 * dosadí vlastní popisek.
 */
export function relativeParent(path: string, root: string): string {
  const parent = parentPath(path);
  if (parent === null) return "";

  // Kořen může i nemusí končit lomítkem ("C:\" vs "C:\Users\jane").
  const base = root.endsWith("\\") ? root.slice(0, -1) : root;
  if (parent.toLowerCase() === base.toLowerCase()) return "";

  const prefix = `${base}\\`;
  return parent.toLowerCase().startsWith(prefix.toLowerCase())
    ? parent.slice(prefix.length)
    : parent;
}

/** Znaky, které Windows v názvu nepovoluje — stejná sada jako ve validate_name v Rustu. */
const INVALID_NAME = /[<>:"/\\|?*]/;

export function isValidFileName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !INVALID_NAME.test(trimmed);
}

/**
 * Rozdělí název na část k editaci a příponu — Finder při přejmenování
 * předvybere jen tělo názvu, příponu nechává být.
 */
export function stemLength(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}

/* ---------------------------- systémová schránka ---------------------------- */

/** Soubory ve schránce Windows (CF_HDROP); `cut` = vyjmuté přes Ctrl+X. */
export type ClipboardFiles = { paths: string[]; cut: boolean };

export function clipboardWriteFiles(paths: string[], cut: boolean): Promise<void> {
  return invoke<void>("clipboard_write_files", { paths, cut });
}

/** null = ve schránce nejsou soubory (text, obrázek, nic). */
export function clipboardReadFiles(): Promise<ClipboardFiles | null> {
  return invoke<ClipboardFiles | null>("clipboard_read_files");
}

export function clipboardHasFiles(): Promise<boolean> {
  return invoke<boolean>("clipboard_has_files");
}

export function clipboardClear(): Promise<void> {
  return invoke<void>("clipboard_clear");
}
