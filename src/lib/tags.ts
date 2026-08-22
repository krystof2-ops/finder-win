import type { TagColor } from "../types";

export { TAG_COLORS } from "./storage";

/** Přesné odstíny ze systémové palety — stejné jako tinty ikon souborů. */
export const TAG_HEX: Record<TagColor, string> = {
  red: "#ff3b30",
  orange: "#ff9500",
  yellow: "#ffcc00",
  green: "#30d158",
  blue: "#0a84ff",
  purple: "#af52de",
  grey: "#8e8e93",
};

export const TAG_LABEL: Record<TagColor, string> = {
  red: "Červený",
  orange: "Oranžový",
  yellow: "Žlutý",
  green: "Zelený",
  blue: "Modrý",
  purple: "Fialový",
  grey: "Šedý",
};
