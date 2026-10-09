import {
  copyPath,
  createFile,
  createFolder,
  createShellNew,
  movePath,
  moveToTrash,
  parentPath,
  renamePath,
  restoreFromTrash,
  trashIsPermanent,
} from "./fileops";
import { t } from "./i18n";
import * as storage from "./lib/storage";
import type { TagColor } from "./types";

/**
 * Zpět / Znovu. Zásobník drží App (jen v paměti, posledních 50 operací);
 * tady je, co která operace znamená a jak ji vrátit. Inverze, která selže
 * (soubor mezitím zmizel, na původním místě je jiný), se nezkouší jinak —
 * App ukáže chybu a operaci ze zásobníku zahodí.
 */

export const UNDO_LIMIT = 50;

/** Položka před operací a po ní. */
type Moved = { from: string; to: string };

export type UndoOp =
  | { kind: "rename"; from: string; to: string }
  | { kind: "move"; items: Moved[] }
  /** Kopie i duplikace: `to` je nově vzniklá položka. */
  | { kind: "copy"; items: Moved[] }
  /** `shellNew` = přípona typu z menu Nový — Znovu vytvoří soubor se stejným obsahem. */
  | { kind: "create"; path: string; folder: boolean; shellNew?: string }
  /** `since` = unix sekundy těsně před smazáním — podle nich se hledá v Koši. */
  | { kind: "trash"; paths: string[]; since: number }
  | { kind: "tags"; before: Record<string, TagColor[]>; after: Record<string, TagColor[]> };

const name = storage.lastSegment;

/** Název bez přípony typu (create_shell_new ji přidá sám). */
function stemOf(fileName: string, extension: string): string {
  return fileName.toLowerCase().endsWith(extension.toLowerCase()) ? fileName.slice(0, -extension.length) : fileName;
}

/** Popisek do menu: „Přejmenovat „x.txt"", „Přesunout 3 položky". */
export function undoLabel(op: UndoOp): string {
  switch (op.kind) {
    case "rename":
      return t("undo.rename", { name: name(op.from) });
    case "move":
      return op.items.length === 1
        ? t("undo.moveOne", { name: name(op.items[0].from) })
        : t("undo.moveMany", { count: op.items.length });
    case "copy":
      return op.items.length === 1
        ? t("undo.copyOne", { name: name(op.items[0].from) })
        : t("undo.copyMany", { count: op.items.length });
    case "create":
      return t(op.folder ? "undo.newFolder" : "undo.newFile", { name: name(op.path) });
    case "trash":
      return op.paths.length === 1
        ? t("undo.trashOne", { name: name(op.paths[0]) })
        : t("undo.trashMany", { count: op.paths.length });
    case "tags":
      return t("undo.tags");
  }
}

/** Unix sekundy s rezervou — Koš zapisuje čas smazání po celých sekundách. */
export function trashTimestamp(): number {
  return Math.floor(Date.now() / 1000) - 2;
}

function parentOf(path: string): string {
  const parent = parentPath(path);
  if (parent === null) throw t("error.noParent");
  return parent;
}

/** Přesun zpátky nesmí nic přepsat ani přejmenovat — kolize je chyba. */
async function moveExactly(from: string, toDir: string): Promise<string> {
  const result = await movePath(from, toDir, "skip");
  if (result.skipped) throw t("error.atPath", { path: from, reason: t("error.undoConflict") });
  await storage.remapPath(from, result.path);
  return result.path;
}

/** Zpět u kopie a nové položky = do Koše. Kde Koš není, smazalo by se to
 *  natrvalo — to Zpět dělat nesmí. */
async function trashCreated(paths: string[]): Promise<void> {
  if (await trashIsPermanent(paths)) throw t("error.undoNoTrash");
  await moveToTrash(paths);
}

export async function undoOp(op: UndoOp): Promise<void> {
  switch (op.kind) {
    case "rename": {
      const back = await renamePath(op.to, name(op.from));
      await storage.remapPath(op.to, back);
      return;
    }
    case "move":
      for (const item of [...op.items].reverse()) await moveExactly(item.to, parentOf(item.from));
      return;
    case "copy":
      return trashCreated(op.items.map((item) => item.to));
    case "create":
      return trashCreated([op.path]);
    case "trash":
      return restoreFromTrash(op.paths, op.since);
    case "tags":
      return storage.setTagsOf(op.before);
  }
}

/** Zopakuje operaci; vrací ji s cestami, které vznikly tentokrát. */
export async function redoOp(op: UndoOp): Promise<UndoOp> {
  switch (op.kind) {
    case "rename": {
      const to = await renamePath(op.from, name(op.to));
      await storage.remapPath(op.from, to);
      return { ...op, to };
    }
    case "move": {
      const items: Moved[] = [];
      for (const item of op.items) {
        items.push({ from: item.from, to: await moveExactly(item.from, parentOf(item.to)) });
      }
      return { kind: "move", items };
    }
    case "copy": {
      const items: Moved[] = [];
      for (const item of op.items) {
        const result = await copyPath(item.from, parentOf(item.to), "rename");
        await storage.copyTags(item.from, result.path);
        items.push({ from: item.from, to: result.path });
      }
      return { kind: "copy", items };
    }
    case "create": {
      const dir = parentOf(op.path);
      const path = op.folder
        ? await createFolder(dir, name(op.path))
        : op.shellNew
          ? await createShellNew(dir, op.shellNew, stemOf(name(op.path), op.shellNew))
          : await createFile(dir, name(op.path));
      return { ...op, path };
    }
    case "trash": {
      if (await trashIsPermanent(op.paths)) throw t("error.undoNoTrash");
      const since = trashTimestamp();
      await moveToTrash(op.paths);
      return { ...op, since };
    }
    case "tags":
      await storage.setTagsOf(op.after);
      return op;
  }
}
