import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme, readStoredTheme } from "./theme";
// Inter přibalený v aplikaci místo Google Fonts: funguje offline a CSP
// nemusí povolovat cizí domény.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./index.css";

// Nastavit třídu ještě před prvním renderem, ať dark uživatel nevidí bílý záblesk.
applyTheme(readStoredTheme());

// Jezdec scrollbaru je vidět při najetí na kontejner — a taky chvíli po
// posunu kolečkem nebo klávesnicí, i když kurzor stojí jinde (jako macOS).
// Jeden posluchač v capture fázi pokryje všechny posouvané prvky.
const scrollTimers = new WeakMap<Element, number>();
window.addEventListener(
  "scroll",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    target.classList.add("is-scrolling");
    window.clearTimeout(scrollTimers.get(target));
    scrollTimers.set(
      target,
      window.setTimeout(() => target.classList.remove("is-scrolling"), 800),
    );
  },
  { capture: true, passive: true },
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
