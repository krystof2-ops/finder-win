/** Historie navigace jako dva zásobníky, stejně jako to dělá prohlížeč. */
export type NavState = {
  current: string | null;
  back: string[];
  forward: string[];
};

export type NavAction = { type: "go"; path: string } | { type: "back" } | { type: "forward" };

export const INITIAL_NAV: NavState = { current: null, back: [], forward: [] };

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "go": {
      if (action.path === state.current) return state;
      return {
        current: action.path,
        back: state.current === null ? state.back : [...state.back, state.current],
        forward: [],
      };
    }
    case "back": {
      const previous = state.back[state.back.length - 1];
      if (previous === undefined || state.current === null) return state;
      return {
        current: previous,
        back: state.back.slice(0, -1),
        forward: [state.current, ...state.forward],
      };
    }
    case "forward": {
      const [next, ...rest] = state.forward;
      if (next === undefined || state.current === null) return state;
      return {
        current: next,
        back: [...state.back, state.current],
        forward: rest,
      };
    }
  }
}
