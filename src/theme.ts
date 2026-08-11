import type { Theme } from "./types";

const STORAGE_KEY = "finder-theme";

/** Light je výchozí, dokud si uživatel nepřepne na dark. */
export function readStoredTheme(): Theme {
  return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(STORAGE_KEY, theme);
}
