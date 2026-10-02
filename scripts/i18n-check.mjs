// Hlídá překlady UI. Běží před každým buildem (npm run build).
//
//  (a) Ve zdrojácích mimo src/i18n/ nesmí zůstat text pro uživatele napsaný
//      natvrdo: řetězec s českými znaky kdekoli v kódu, a jakýkoli text v JSX,
//      v atributech title / aria-label / placeholder / alt / data-tooltip
//      a ve vlastnostech i props label / title / message / hint / confirmLabel.
//      Komentáře se neberou. Výjimku jde označit komentářem `i18n-ignore`
//      na stejném nebo předchozím řádku.
//  (b) cs.ts a en.ts mají stejné klíče, plurály na obou stranách a stejné
//      parametry {name} v textech.
//
// Bez nových závislostí — parser je TypeScript, který projekt už má.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
const I18N = join(SRC, "i18n");

const CZECH = /[áéěíóúůýčďňřšťžÁÉĚÍÓÚŮÝČĎŇŘŠŤŽ]/;
/** Aspoň dvě písmena za sebou — "×", "›", "+3" ani "%" text nejsou. */
const WORDS = /\p{L}{2,}/u;
/** Názvy kláves a zkratky jsou v obou jazycích stejné (Ctrl+C, F5, Enter). */
const SHORTCUT =
  /^(?:(?:Ctrl|Shift|Alt|Win|Enter|Esc|Escape|Space|Tab|Delete|Backspace|Home|End|PgUp|PgDn|F\d{1,2}|[A-Z0-9.,↑↓←→⌘⇧⌥])\+?)+$/;
/** Klíč do slovníku ("toolbar.sort") — přeloží ho až t(). */
const MESSAGE_KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;
/** Vlastní jména a technické texty, které se nepřekládají. */
const ALLOWED_TEXT = new Set(["Finder-Win", "Finder", "MIT"]);

const UI_PROPERTIES = new Set(["label", "title", "message", "hint", "confirmLabel", "placeholder"]);
/** JSX atributy s textem pro uživatele — i props vlastních komponent (label, hint). */
const UI_ATTRIBUTES = new Set(["aria-label", "alt", "data-tooltip", ...UI_PROPERTIES]);


const problems = [];

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return path === I18N ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

function isUserText(text) {
  const trimmed = text.trim();
  if (!WORDS.test(trimmed)) return false;
  if (SHORTCUT.test(trimmed.replace(/\s+/g, ""))) return false;
  if (MESSAGE_KEY.test(trimmed)) return false;
  return !ALLOWED_TEXT.has(trimmed);
}

function checkFile(file) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split(/\r?\n/);
  const name = relative(ROOT, file).split(sep).join("/");

  function report(node, reason, value) {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    const ignored = [lines[line], lines[line - 1]].some((row) => row?.includes("i18n-ignore"));
    if (ignored) return;
    const snippet = value.trim().replace(/\s+/g, " ").slice(0, 60);
    problems.push(`${name}:${line + 1}  ${reason}: "${snippet}"`);
  }

  /**
   * Texty v hodnotě atributu / vlastnosti / JSX výrazu — i ve větvích
   * podmínky (`a ? "Foo" : "Bar"`). Argumenty volání se nepočítají: t("klíč"),
   * cesty a třídy jdou do funkcí, ne uživateli.
   */
  function literalsIn(node, found = []) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push([node, node.text]);
    } else if (ts.isTemplateExpression(node)) {
      found.push([node, [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ")]);
    } else if (
      !ts.isCallExpression(node) &&
      !ts.isJsxElement(node) &&
      !ts.isJsxSelfClosingElement(node) &&
      !isComparison(node)
    ) {
      // forEachChild končí na první pravdivé návratové hodnotě — proto blok.
      ts.forEachChild(node, (child) => {
        literalsIn(child, found);
      });
    }
    return found;
  }

  /** `mode === "copy" ? …` — porovnávaná hodnota není text pro uživatele. */
  function isComparison(node) {
    if (!ts.isBinaryExpression(node)) return false;
    const operator = node.operatorToken.kind;
    return (
      operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      operator === ts.SyntaxKind.EqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsToken
    );
  }

  function checkValue(node, reason) {
    for (const [literal, value] of literalsIn(node)) {
      // Český text hlásí obecné pravidlo níž, tady by byl dvakrát.
      if (isUserText(value) && !CZECH.test(value)) report(literal, reason, value);
    }
  }

  function visit(node) {
    // Moduly a typy nejsou text pro uživatele.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;

    if (ts.isJsxText(node)) {
      if (isUserText(node.text)) report(node, "JSX text", node.text);
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const attribute = node.name.getText(source);
      if (UI_ATTRIBUTES.has(attribute)) checkValue(node.initializer, `atribut ${attribute}`);
    } else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && UI_PROPERTIES.has(node.name.text)) {
      checkValue(node.initializer, `vlastnost ${node.name.text}`);
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      // {podmínka ? "Text" : "Jiný"} mezi potomky elementu.
      checkValue(node.expression, "JSX výraz");
    }

    // Český znak v jakémkoli řetězci — JSX atributy i vlastnosti výš to
    // nepokrývají celé (toasty, template stringy, konstanty).
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (CZECH.test(node.text)) report(node, "český text", node.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
}

/* --------------------------- (b) shoda slovníků --------------------------- */

/** Vytáhne z `export const <name> = { … }` klíče a hodnoty (text / plurál). */
function readDictionary(file, exportName) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const entries = new Map();

  function unwrap(expression) {
    while (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)) {
      expression = expression.expression;
    }
    return expression;
  }

  function propertyName(property) {
    const nameNode = property.name;
    return ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) ? nameNode.text : nameNode.getText(source);
  }

  function value(expression) {
    expression = unwrap(expression);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
    if (ts.isObjectLiteralExpression(expression)) {
      const forms = {};
      for (const property of expression.properties) {
        if (ts.isPropertyAssignment(property)) forms[propertyName(property)] = value(property.initializer);
      }
      return forms;
    }
    return null;
  }

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) !== exportName || !declaration.initializer) continue;
      const object = unwrap(declaration.initializer);
      if (!ts.isObjectLiteralExpression(object)) continue;
      for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property)) {
          problems.push(`src/i18n/${exportName}.ts: nečekaný zápis ${property.getText(source).slice(0, 40)}`);
          continue;
        }
        const key = propertyName(property);
        if (entries.has(key)) problems.push(`src/i18n/${exportName}.ts: duplicitní klíč "${key}"`);
        entries.set(key, value(property.initializer));
      }
    }
  }

  if (entries.size === 0) problems.push(`src/i18n/${exportName}.ts: slovník "${exportName}" nenalezen`);
  return entries;
}

function placeholders(message) {
  const texts = typeof message === "string" ? [message] : Object.values(message ?? {});
  return [...new Set(texts.flatMap((text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1])))].sort().join(",");
}

function checkDictionaries() {
  const csEntries = readDictionary(join(I18N, "cs.ts"), "cs");
  const enEntries = readDictionary(join(I18N, "en.ts"), "en");

  for (const key of csEntries.keys()) {
    if (!enEntries.has(key)) problems.push(`src/i18n/en.ts: chybí klíč "${key}"`);
  }
  for (const key of enEntries.keys()) {
    if (!csEntries.has(key)) problems.push(`src/i18n/cs.ts: chybí klíč "${key}" (je jen v en.ts)`);
  }

  for (const [key, csValue] of csEntries) {
    const enValue = enEntries.get(key);
    if (enValue === undefined) continue;

    const csPlural = typeof csValue === "object" && csValue !== null;
    const enPlural = typeof enValue === "object" && enValue !== null;
    if (csPlural !== enPlural) {
      problems.push(`"${key}": plurál jen v jednom jazyce`);
      continue;
    }
    if (csPlural && !["one", "few", "other"].every((form) => typeof csValue[form] === "string")) {
      problems.push(`src/i18n/cs.ts "${key}": plurál potřebuje one / few / other`);
    }
    if (enPlural && !["one", "other"].every((form) => typeof enValue[form] === "string")) {
      problems.push(`src/i18n/en.ts "${key}": plurál potřebuje one / other`);
    }
    if (placeholders(csValue) !== placeholders(enValue)) {
      problems.push(`"${key}": jiné parametry — cs {${placeholders(csValue)}}, en {${placeholders(enValue)}}`);
    }
  }

  return csEntries.size;
}

/* --------------------------------- běh ------------------------------------ */

const files = sourceFiles(SRC);
for (const file of files) checkFile(file);
const keyCount = checkDictionaries();


if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`\ni18n:check — ${problems.length} problémů`);
  process.exit(1);
}

console.log(`i18n:check — OK (${files.length} souborů, ${keyCount} klíčů)`);
