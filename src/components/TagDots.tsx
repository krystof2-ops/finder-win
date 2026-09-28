import { TAG_HEX, TAG_LABEL } from "../lib/tags";
import type { TagColor } from "../types";

/** Víc než tři puntíky se do řádku nevejdou, zbytek shrne tečkami. */
const MAX_DOTS = 3;

type TagDotsProps = {
  colors: TagColor[];
  /** Průměr puntíku v px — 8 v icon a list view, 6 v column view. */
  size?: number;
};

export function TagDots({ colors, size = 8 }: TagDotsProps) {
  if (colors.length === 0) return null;

  const shown = colors.slice(0, MAX_DOTS);
  const overflow = colors.length > MAX_DOTS;

  return (
    <span
      className="flex shrink-0 items-center"
      style={{ gap: Math.max(2, Math.round(size / 3)) }}
      data-tooltip={colors.map((color) => TAG_LABEL[color]).join(", ")}
    >
      {shown.map((color) => (
        <span
          key={color}
          className="shrink-0 rounded-full"
          style={{
            width: size,
            height: size,
            backgroundColor: TAG_HEX[color],
            // Žlutá by na světlém podkladu splynula, proto tenký obrys.
            boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
          }}
        />
      ))}

      {overflow && (
        <span
          className="shrink-0 leading-none text-secondary"
          style={{ fontSize: Math.max(9, size + 1) }}
        >
          …
        </span>
      )}
    </span>
  );
}
