import { t, type MessageKey } from "../i18n";
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

const TAG_LABEL_KEYS: Record<TagColor, MessageKey> = {
  red: "tag.red",
  orange: "tag.orange",
  yellow: "tag.yellow",
  green: "tag.green",
  blue: "tag.blue",
  purple: "tag.purple",
  grey: "tag.grey",
};

/** Název barvy v aktuálním jazyce ("Červený" / "Red"). */
export function tagLabel(color: TagColor): string {
  return t(TAG_LABEL_KEYS[color]);
}
