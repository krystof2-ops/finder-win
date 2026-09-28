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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
