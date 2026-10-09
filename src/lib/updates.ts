import { getVersion } from "@tauri-apps/api/app";

import * as storage from "./storage";

/**
 * Kontrola nové verze: nejvýš jednou denně jeden GET na GitHub API, nic víc
 * (žádná telemetrie, nic se neodesílá). Vypíná se v menu Více.
 */

const LATEST_RELEASE = "https://api.github.com/repos/krystof2-ops/finder-win/releases/latest";
/** Stránka vydání — stejné pravidlo hlídá i backend (is_release_page). */
const RELEASE_PAGE = /^https:\/\/github\.com\/krystof2-ops\/finder-win\/releases\/tag\/[A-Za-z0-9.-]+$/;

function isReleasePage(url: string): boolean {
  return RELEASE_PAGE.test(url) && !url.includes("..");
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type AvailableUpdate = { version: string; url: string };

/** "1.10.0" > "1.9.2" — po číslech, ne jako text. Přípona za pomlčkou se ignoruje. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parts = (version: string) => version.split("-")[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

async function fetchLatest(): Promise<AvailableUpdate | null> {
  const response = await fetch(LATEST_RELEASE, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(String(response.status));
  const data = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
  if (typeof data.tag_name !== "string" || typeof data.html_url !== "string") return null;
  return { version: data.tag_name.replace(/^v/, ""), url: data.html_url };
}

/**
 * Novější verze, nebo null. Výsledek posledního dotazu se pamatuje
 * v settings.json, takže proužek se ukáže i ve dny, kdy se GitHubu neptá.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  // Store build se GitHubu neptá vůbec – aktualizace řeší Store (a CSP GitHub ani nepovolí).
  if (__STORE__) return null;
  await storage.init();
  const settings = storage.getSnapshot().updates;
  if (!settings.check) return null;

  if (Date.now() - settings.lastCheck >= CHECK_INTERVAL_MS) {
    try {
      await storage.setUpdates({ lastCheck: Date.now(), latest: await fetchLatest() });
    } catch {
      // Offline nebo limit API — zkusí se při dalším startu, nic se neukazuje.
    }
  }

  const [latest, current] = [storage.getSnapshot().updates.latest, await getVersion()];
  if (latest === null || !isReleasePage(latest.url)) return null;
  return isNewerVersion(latest.version, current) ? latest : null;
}
