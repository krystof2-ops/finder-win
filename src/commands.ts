import type { MessageKey } from "./i18n";

/**
 * Registr příkazů aplikace — jediný zdroj pravdy pro klávesové zkratky,
 * menu Více, tlačítka toolbaru a paletu příkazů (Ctrl+K).
 *
 * Tady je, *co* příkaz je: název, zkratka k zobrazení, klávesy a kde smí
 * běžet. *Co dělá* dodává App (handler) — jen ona zná aktivní panel, výběr
 * a dialogy. Šipky, Enter, mezerník a psaní písmen nejsou příkazy, ale
 * pohyb ve výpisu; ty obsluhuje App sama.
 */

export type CommandId =
  | "palette"
  | "newFolder"
  | "newFile"
  | "newItem"
  | "newTab"
  | "closeTab"
  | "nextTab"
  | "previousTab"
  | "toggleSplit"
  | "switchPanel"
  | "copyToOther"
  | "moveToOther"
  | "viewIcons"
  | "viewList"
  | "viewColumns"
  | "toggleHidden"
  | "toggleTheme"
  | "themeLight"
  | "themeDark"
  | "themeSystem"
  | "languageSystem"
  | "languageEnglish"
  | "languageCzech"
  | "motionSystem"
  | "motionOn"
  | "motionOff"
  | "terminalAuto"
  | "terminalWindows"
  | "terminalPwsh"
  | "terminalPowerShell"
  | "terminalCmd"
  | "goBack"
  | "goForward"
  | "goParent"
  | "openSelection"
  | "editPath"
  | "find"
  | "refresh"
  | "undo"
  | "redo"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "selectAll"
  | "rename"
  | "delete"
  | "copyPath"
  | "openTerminal"
  | "checkUpdates"
  | "about";

/**
 * Kde smí zkratka běžet:
 * - `global` — vždy, i s fokusem v poli hledání (záložky, paleta),
 * - `overlay` — mimo textová pole, i ve výsledcích hledání a v tag view,
 * - `folder` — jen nad výpisem složky (výchozí; Delete nad výsledky hledání
 *   by mířil na neviditelnou podkladovou složku).
 */
export type CommandScope = "global" | "overlay" | "folder";

/** `code` = fyzická klávesa (nezávislá na rozložení), `key` = znak. */
export type KeyBinding = {
  key?: string;
  code?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
};

type CommandDefinition = {
  title: MessageKey;
  /** Zkratka, jak se ukazuje v menu a paletě. */
  shortcut?: string;
  keys?: KeyBinding[];
  scope?: CommandScope;
  /** false = jen v menu / klávesou, v paletě ne (Ctrl+Tab apod.). */
  palette?: boolean;
};

/** Pořadí určuje i prioritu kláves: první povolený příkaz s danou klávesou vyhrává. */
const DEFINITIONS: Record<CommandId, CommandDefinition> = {
  palette: { title: "command.palette", shortcut: "Ctrl+K", keys: [{ code: "KeyK", ctrl: true }], scope: "global", palette: false },
  newTab: { title: "tabs.new", shortcut: "Ctrl+T", keys: [{ code: "KeyT", ctrl: true }], scope: "global" },
  closeTab: { title: "command.closeTab", shortcut: "Ctrl+W", keys: [{ code: "KeyW", ctrl: true }], scope: "global" },
  nextTab: { title: "command.nextTab", shortcut: "Ctrl+Tab", keys: [{ key: "Tab", ctrl: true }], scope: "global", palette: false },
  previousTab: {
    title: "command.previousTab",
    shortcut: "Ctrl+Shift+Tab",
    keys: [{ key: "Tab", ctrl: true, shift: true }],
    scope: "global",
    palette: false,
  },
  toggleSplit: { title: "split.toggle", shortcut: "Ctrl+Shift+D", keys: [{ code: "KeyD", ctrl: true, shift: true }], scope: "global" },
  switchPanel: {
    title: "command.switchPanel",
    shortcut: "Tab",
    keys: [{ key: "Tab" }, { key: "Tab", shift: true }],
    scope: "overlay",
    palette: false,
  },
  // F5 / F6 jako v Total Commanderu — jen v rozděleném okně (jinak je F5 obnovit).
  copyToOther: { title: "split.copyToOther", shortcut: "F5", keys: [{ key: "F5" }] },
  moveToOther: { title: "split.moveToOther", shortcut: "F6", keys: [{ key: "F6" }] },
  newFolder: { title: "menu.newFolder", shortcut: "Ctrl+Shift+N", keys: [{ code: "KeyN", ctrl: true, shift: true }] },
  newFile: { title: "menu.newFile" },
  // Otevře menu Nový v toolbaru (Složka, Textový dokument, typy z registru).
  newItem: { title: "command.newItem" },
  viewIcons: { title: "toolbar.viewAsIcons" },
  viewList: { title: "toolbar.viewAsList" },
  viewColumns: { title: "toolbar.viewAsColumns" },
  toggleHidden: {
    title: "toolbar.showHidden",
    shortcut: "Ctrl+Shift+.",
    // Podle fyzické klávesy — tečka je na české klávesnici jinde než na anglické.
    keys: [{ code: "Period", ctrl: true, shift: true }],
    scope: "overlay",
  },
  toggleTheme: { title: "toolbar.darkMode" },
  themeLight: { title: "command.themeLight" },
  themeDark: { title: "command.themeDark" },
  themeSystem: { title: "command.themeSystem" },
  languageSystem: { title: "command.languageSystem" },
  languageEnglish: { title: "command.languageEnglish" },
  languageCzech: { title: "command.languageCzech" },
  motionSystem: { title: "command.motionSystem" },
  motionOn: { title: "command.motionOn" },
  motionOff: { title: "command.motionOff" },
  terminalAuto: { title: "command.terminalAuto" },
  terminalWindows: { title: "command.terminalWindows" },
  terminalPwsh: { title: "command.terminalPwsh" },
  terminalPowerShell: { title: "command.terminalPowerShell" },
  terminalCmd: { title: "command.terminalCmd" },
  goBack: {
    title: "toolbar.back",
    shortcut: "Alt+←",
    keys: [{ key: "ArrowLeft", alt: true }, { key: "Backspace" }],
    scope: "overlay",
  },
  goForward: { title: "toolbar.forward", shortcut: "Alt+→", keys: [{ key: "ArrowRight", alt: true }], scope: "overlay" },
  goParent: {
    title: "toolbar.parentFolder",
    shortcut: "Ctrl+↑",
    keys: [{ key: "ArrowUp", alt: true }, { key: "ArrowUp", ctrl: true }],
    scope: "overlay",
  },
  openSelection: { title: "menu.open", shortcut: "Ctrl+↓", keys: [{ key: "ArrowDown", ctrl: true }], palette: false },
  editPath: { title: "menu.editPath", shortcut: "Ctrl+L", keys: [{ code: "KeyL", ctrl: true }], scope: "overlay" },
  find: { title: "toolbar.search", shortcut: "Ctrl+F", keys: [{ code: "KeyF", ctrl: true }], scope: "overlay" },
  refresh: { title: "menu.refresh", shortcut: "Ctrl+R", keys: [{ key: "F5" }, { code: "KeyR", ctrl: true }], scope: "overlay" },
  // Ctrl+Z podle znaku: na QWERTZ je Z tam, kde ho uživatel vidí.
  undo: { title: "undo.undo", shortcut: "Ctrl+Z", keys: [{ key: "z", ctrl: true }], scope: "overlay" },
  redo: {
    title: "undo.redo",
    shortcut: "Ctrl+Shift+Z",
    keys: [{ key: "z", ctrl: true, shift: true }, { key: "y", ctrl: true }],
    scope: "overlay",
  },
  copy: { title: "menu.copy", shortcut: "Ctrl+C", keys: [{ key: "c", ctrl: true }], scope: "overlay" },
  cut: { title: "menu.cut", shortcut: "Ctrl+X", keys: [{ key: "x", ctrl: true }] },
  paste: { title: "menu.paste", shortcut: "Ctrl+V", keys: [{ key: "v", ctrl: true }] },
  duplicate: { title: "menu.duplicate", shortcut: "Ctrl+D", keys: [{ key: "d", ctrl: true }] },
  selectAll: { title: "menu.selectAll", shortcut: "Ctrl+A", keys: [{ key: "a", ctrl: true }] },
  rename: { title: "menu.rename", shortcut: "F2", keys: [{ key: "F2" }] },
  delete: { title: "menu.delete", shortcut: "Delete", keys: [{ key: "Delete" }] },
  copyPath: { title: "menu.copyPath", scope: "overlay" },
  openTerminal: { title: "menu.openInTerminal", scope: "overlay" },
  // Ve Store buildu se nenabízí (ani v menu Více, viz Toolbar).
  checkUpdates: { title: "toolbar.checkUpdates", palette: !__STORE__ },
  about: { title: "toolbar.about" },
};

export const COMMAND_IDS = Object.keys(DEFINITIONS) as CommandId[];

/** Co dodává App: akce a stav. `title` přebíjí název (Zpět: Přejmenovat „x"). */
export type CommandHandler = {
  run: () => void;
  enabled?: boolean;
  checked?: boolean;
  title?: string;
};

export type Command = {
  id: CommandId;
  title: string;
  shortcut?: string;
  keys: KeyBinding[];
  scope: CommandScope;
  palette: boolean;
  enabled: boolean;
  checked?: boolean;
  run: () => void;
};

export type Commands = Record<CommandId, Command>;

/** Spojí definice s akcemi App. `translate` = t() v aktuálním jazyce. */
export function buildCommands(
  handlers: Record<CommandId, CommandHandler>,
  translate: (key: MessageKey) => string,
  /** Každé spuštění (klávesou, z menu, z palety) — počítadlo pro paletu. */
  onRun?: (id: CommandId) => void,
): Commands {
  const result = {} as Commands;
  for (const id of COMMAND_IDS) {
    const definition = DEFINITIONS[id];
    const handler = handlers[id];
    result[id] = {
      id,
      title: handler.title ?? translate(definition.title),
      shortcut: definition.shortcut,
      keys: definition.keys ?? [],
      scope: definition.scope ?? "folder",
      palette: definition.palette ?? true,
      enabled: handler.enabled ?? true,
      checked: handler.checked,
      run: () => {
        onRun?.(id);
        handler.run();
      },
    };
  }
  return result;
}

function matchesBinding(binding: KeyBinding, event: KeyboardEvent): boolean {
  const ctrl = event.ctrlKey || event.metaKey;
  if (Boolean(binding.ctrl) !== ctrl) return false;
  if (Boolean(binding.shift) !== event.shiftKey) return false;
  if (Boolean(binding.alt) !== event.altKey) return false;
  if (binding.code !== undefined) return event.code === binding.code;
  return binding.key !== undefined && event.key.toLowerCase() === binding.key.toLowerCase();
}

/**
 * Příkaz pro stisk klávesy. Zakázaný příkaz se přeskočí a hledá se dál —
 * F5 je v rozděleném okně kopie do druhého panelu, jinak obnovit.
 */
export function commandForKey(
  commands: Commands,
  event: KeyboardEvent,
  context: { typing: boolean; overlay: boolean },
): Command | null {
  for (const id of COMMAND_IDS) {
    const command = commands[id];
    if (!command.enabled) continue;
    if (context.typing && command.scope !== "global") continue;
    if (context.overlay && command.scope === "folder") continue;
    if (command.keys.some((binding) => matchesBinding(binding, event))) return command;
  }
  return null;
}
