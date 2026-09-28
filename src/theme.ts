import { getCurrentWindow } from "@tauri-apps/api/window";

import type { Theme } from "./types";

const STORAGE_KEY = "finder-theme";

/** Light je výchozí, dokud si uživatel nepřepne na dark. */
export function readStoredTheme(): Theme {
  return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(STORAGE_KEY, theme);

  // Nativní podklad okna (vidět při změně velikosti a v rozích) jde s tématem —
  // jinak by v tmavém režimu problikl světle šedý z tauri.conf.json.
  const color = getComputedStyle(document.documentElement).getPropertyValue("--bg-window").trim();
  if (color) void getCurrentWindow().setBackgroundColor(color).catch(() => undefined);
}
