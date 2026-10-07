import { getCurrentWindow } from "@tauri-apps/api/window";

import type { Theme } from "./types";

/** Vzhled z menu Více: světlý, tmavý, nebo podle Windows (prefers-color-scheme). */
export type ThemePreference = "light" | "dark" | "system";

/**
 * Zrcadlo volby v localStorage — jen kvůli prvnímu vykreslení (main.tsx),
 * než se načte settings.json. Pravdu drží storage.ts.
 */
const STORAGE_KEY = "finder-theme";

export function readThemeMirror(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "dark" || value === "light" ? value : "system";
  } catch {
    return "system";
  }
}

export function writeThemeMirror(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Bez zrcadla se jen první render řídí systémem — nic horšího.
  }
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Téma Windows (Nastavení → Přizpůsobení → Barvy → Režim aplikace). */
export function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === "system" ? systemTheme() : preference;
}

/** Zavolá `onChange`, když uživatel přepne režim ve Windows za běhu. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");

  // Nativní podklad okna (vidět při změně velikosti a v rozích) jde s tématem —
  // jinak by v tmavém režimu problikl světle šedý z tauri.conf.json.
  const color = getComputedStyle(document.documentElement).getPropertyValue("--bg-window").trim();
  if (color) void getCurrentWindow().setBackgroundColor(color).catch(() => undefined);
}
