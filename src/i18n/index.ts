import { useMemo, useSyncExternalStore } from "react";

import { getSnapshot, setLanguage, subscribe as subscribeStorage } from "../lib/storage";
import { cs } from "./cs";
import { en } from "./en";

/**
 * Překlady UI. Výchozí je angličtina, čeština se zapne podle jazyka systému
 * (navigator.language) nebo ručně v menu Více → Language / Jazyk.
 *
 * Slovníky jsou ploché (`"toolbar.sort"`), hodnota je buď text s parametry
 * `{name}`, nebo plurál `{ one, few, other }` vybraný přes Intl.PluralRules
 * podle `params.count`.
 *
 * Komponenty berou `t` z useT() — tím se při přepnutí jazyka překreslí.
 * Mimo React (callbacky, toasty) stačí obyčejné `t`, které čte aktuální locale.
 */

export type Locale = "en" | "cs";
export type LanguageSetting = "system" | Locale;
export type MessageKey = keyof typeof cs;
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

type Plural = { one: string; few?: string; many?: string; other: string };
type Message = string | Plural;

const DICTIONARIES: Record<Locale, Record<MessageKey, Message>> = { cs, en };

/** Jazyk systému — čeština jen pro "cs", všechno ostatní dostane angličtinu. */
export function systemLocale(): Locale {
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("cs")
    ? "cs"
    : "en";
}

export function resolveLocale(setting: LanguageSetting): Locale {
  return setting === "system" ? systemLocale() : setting;
}

/* ------------------------------ locale signál ------------------------------ */

let current: Locale = resolveLocale(getSnapshot().language);
const listeners = new Set<() => void>();

function applyDocumentLanguage(locale: Locale) {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}
applyDocumentLanguage(current);

// Nastavení se načítá asynchronně a mění se z menu — locale jde za ním.
subscribeStorage(() => {
  const next = resolveLocale(getSnapshot().language);
  if (next === current) return;
  current = next;
  applyDocumentLanguage(next);
  for (const listener of listeners) listener();
});

/** Aktuální jazyk UI ("en" | "cs"). Mění se jen přes languageSetting. */
export const localeSignal = {
  get value(): Locale {
    return current;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Volba uživatele uložená v settings.json: podle systému, nebo napevno. */
export const languageSetting = {
  get value(): LanguageSetting {
    return getSnapshot().language;
  },
  set(value: LanguageSetting): Promise<void> {
    return setLanguage(value);
  },
};

export function getLocale(): Locale {
  return current;
}

/* --------------------------------- překlad --------------------------------- */

const pluralRules = new Map<Locale, Intl.PluralRules>();
const numberFormats = new Map<Locale, Intl.NumberFormat>();

function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/** Celá čísla v parametrech dostanou oddělovač tisíců podle jazyka (1,234 / 1 234). */
export function formatNumber(value: number, locale: Locale = current): string {
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format.format(value);
}

function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const message: Message | undefined = DICTIONARIES[locale][key] ?? DICTIONARIES.en[key];
  if (message === undefined) return key;

  let text: string;
  if (typeof message === "string") {
    text = message;
  } else {
    const count = typeof params?.count === "number" ? params.count : 0;
    const category = pluralCategory(locale, count);
    text = (message as Record<string, string | undefined>)[category] ?? message.other;
  }

  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(value, locale) : value;
  });
}

/** Překlad v aktuálním jazyce — pro kód mimo render (callbacky, chyby). */
export const t: Translate = (key, params) => translate(current, key, params);

/** Klíč poskládaný za běhu ("folder." + id) — ověří, že ve slovníku je. */
export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(cs, key);
}

/** Aktuální locale jako React stav — komponenta se při změně překreslí. */
export function useLocale(): Locale {
  return useSyncExternalStore(localeSignal.subscribe, getLocale, getLocale);
}

/** `t` vázané na aktuální jazyk; nová identita při přepnutí jazyka. */
export function useT(): Translate {
  const locale = useLocale();
  return useMemo<Translate>(() => (key, params) => translate(locale, key, params), [locale]);
}

/** Hláška o nepovedené akci: „Přejmenování selhalo — nemáte oprávnění". */
export function failure(action: MessageKey, err: unknown): string {
  return t("error.operation", { action: t(action), detail: errorText(err) });
}

/** Text chyby z backendu nebo JS — bez prefixu "Error: ". */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
