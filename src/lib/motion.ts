/**
 * Doby animací žijí jen v CSS (tokeny --dur-* v index.css, násobené
 * --motion-scale). Kód, který musí na konec animace počkat (odmontování
 * odcházejícího sloupce, zavření dialogu), si dobu přečte odtud — tokeny
 * jsou registrované přes @property jako <time>, takže getComputedStyle vrací
 * už spočítanou hodnotu včetně vypnutých animací (0 ms).
 */
export type MotionToken =
  | "--dur-press"
  | "--dur-quick"
  | "--dur-fade"
  | "--dur-shift"
  | "--dur-nav"
  | "--dur-enter"
  | "--dur-slow"
  | "--dur-zoom";

/** Doba tokenu v milisekundách (0, když jsou animace vypnuté). */
export function motionMs(token: MotionToken): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return raw.endsWith("ms") ? value : value * 1000;
}

/** Hýbe se vůbec něco? Pro JS posuny (scrollTo smooth), které CSS nevypne. */
export function motionEnabled(): boolean {
  return motionMs("--dur-nav") > 0;
}

/**
 * Volba z menu Více → Animace. "system" = řídí se omezením animací ve
 * Windows (prefers-reduced-motion), "on"/"off" ho přebíjí. CSS podle
 * atributu nastaví --motion-scale, z něj se počítají všechny doby.
 */
export function applyMotion(preference: "system" | "on" | "off"): void {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.motion;
  else root.dataset.motion = preference;
}

/** "smooth", jen když animace nejsou vypnuté (systémem nebo volbou). */
export function smoothIfAllowed(): ScrollBehavior {
  return motionEnabled() ? "smooth" : "auto";
}
