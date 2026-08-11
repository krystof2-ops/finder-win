import { invoke } from "@tauri-apps/api/core";

import type { FileProperties } from "./types";

/* Tenké typované obálky nad Tauri commandy.
   Tauri převádí snake_case parametry na camelCase, proto toName / toDir. */

export function renamePath(from: string, toName: string): Promise<string> {
  return invoke<string>("rename_path", { from, toName });
}

export function moveToTrash(path: string): Promise<void> {
  return invoke<void>("move_to_trash", { path });
}

export function copyPath(from: string, toDir: string): Promise<string> {
  return invoke<string>("copy_path", { from, toDir });
}

export function movePath(from: string, toDir: string): Promise<string> {
  return invoke<string>("move_path", { from, toDir });
}

export function duplicatePath(path: string): Promise<string> {
  return invoke<string>("duplicate_path", { path });
}

export function openInExplorer(path: string): Promise<void> {
  return invoke<void>("open_in_explorer", { path });
}

export function getFileProperties(path: string): Promise<FileProperties> {
  return invoke<FileProperties>("get_file_properties", { path });
}

/** Nadřazená složka, nebo null pro kořen disku. */
export function parentPath(path: string): string | null {
  const parts = path.split("\\").filter(Boolean);
  if (parts.length <= 1) return null;

  const parent = parts.slice(0, -1);
  // Kořen disku potřebuje koncové zpětné lomítko ("C:" samo o sobě není cesta).
  return parent.length === 1 ? `${parent[0]}\\` : parent.join("\\");
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
