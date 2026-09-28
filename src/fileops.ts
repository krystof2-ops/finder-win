import { invoke } from "@tauri-apps/api/core";

import type { FileEntry, FileProperties, OpResult, StatResult } from "./types";

/* Tenké typované obálky nad Tauri commandy.
   Tauri převádí snake_case parametry na camelCase, proto toName / toDir. */

export function renamePath(from: string, toName: string): Promise<string> {
  return invoke<string>("rename_path", { from, toName });
}

export function moveToTrash(path: string): Promise<void> {
  return invoke<void>("move_to_trash", { path });
}

export function copyPath(from: string, toDir: string): Promise<OpResult> {
  return invoke<OpResult>("copy_path", { from, toDir });
}

export function movePath(from: string, toDir: string): Promise<OpResult> {
  return invoke<OpResult>("move_path", { from, toDir });
}

export function duplicatePath(path: string): Promise<OpResult> {
  return invoke<OpResult>("duplicate_path", { path });
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

export function searchRecursive(
  root: string,
  query: string,
  maxResults: number,
  showHidden: boolean,
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("search_recursive", { root, query, maxResults, showHidden });
}

/** Nadřazená složka, nebo null pro kořen disku. */
export function parentPath(path: string): string | null {
  const parts = path.split("\\").filter(Boolean);
  if (parts.length <= 1) return null;

  const parent = parts.slice(0, -1);
  // Kořen disku potřebuje koncové zpětné lomítko ("C:" samo o sobě není cesta).
  return parent.length === 1 ? `${parent[0]}\\` : parent.join("\\");
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
