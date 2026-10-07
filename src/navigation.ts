import { pathKey } from "./lib/storage";

/**
 * Odkud se do složky přišlo — podle toho se vybere přechod obsahu:
 * zpět/vpřed posun do strany, vnoření a výstup nahoru zoom, skok jinam
 * (sidebar, zadaná cesta) jen prolnutí.
 */
export type NavDirection = "back" | "forward" | "into" | "up" | "jump";

/** Historie navigace jako dva zásobníky, stejně jako to dělá prohlížeč. */
export type NavState = {
  current: string | null;
  back: string[];
  forward: string[];
  direction: NavDirection;
};

export type NavAction =
  | { type: "go"; path: string }
  | { type: "back" }
  | { type: "forward" }
  /** Přepnutí záložky: celá historie té záložky naráz. */
  | { type: "restore"; state: NavState };

export const INITIAL_NAV: NavState = { current: null, back: [], forward: [], direction: "jump" };

/** Leží `path` někde uvnitř `ancestor` (ne ona sama)? */
function isInside(path: string, ancestor: string): boolean {
  const child = pathKey(path);
  const parent = pathKey(ancestor);
  return child !== parent && child.startsWith(parent.endsWith("\\") ? parent : `${parent}\\`);
}

function directionOf(from: string | null, to: string): NavDirection {
  if (from === null) return "jump";
  if (isInside(to, from)) return "into";
  if (isInside(from, to)) return "up";
  return "jump";
}

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "go": {
      if (action.path === state.current) return state;
      return {
        current: action.path,
        back: state.current === null ? state.back : [...state.back, state.current],
        forward: [],
        direction: directionOf(state.current, action.path),
      };
    }
    case "back": {
      const previous = state.back[state.back.length - 1];
      if (previous === undefined || state.current === null) return state;
      return {
        current: previous,
        back: state.back.slice(0, -1),
        forward: [state.current, ...state.forward],
        direction: "back",
      };
    }
    case "restore":
      return action.state;
    case "forward": {
      const [next, ...rest] = state.forward;
      if (next === undefined || state.current === null) return state;
      return {
        current: next,
        back: [...state.back, state.current],
        forward: rest,
        direction: "forward",
      };
    }
  }
}
