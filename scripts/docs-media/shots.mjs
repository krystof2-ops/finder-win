// Screenshoty do docs/screenshots (viz CLAUDE.md, sekce Screenshoty a demo).
// node scripts/docs-media/shots.mjs [jméno …]   (bez argumentu všech pět)
import { fileURLToPath } from "url";
import { setup, panel, TABS } from "./setup.mjs";

const ALL = ["hero-dark", "hero-light", "split-view", "command-palette", "previews"];
const which = process.argv.length > 2 ? process.argv.slice(2) : ALL;
const OUT = fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));

async function helpers(c) {
  // Klik na prvek podle selektoru (a volitelně textu) skutečnou myší přes CDP.
  const clickEl = async (sel, text, nth = 0) => {
    const pos = await c.evaluate(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(sel)})]
        .filter((e) => ${text ? `e.textContent.trim() === ${JSON.stringify(text)} || e.getAttribute("aria-label") === ${JSON.stringify(text)}` : "true"})
        .filter((e) => e.getBoundingClientRect().width > 0);
      const e = els[${nth}];
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    })()`);
    if (!pos) throw new Error(`nenalezeno: ${sel} ${text ?? ""}`);
    await c.click(pos[0], pos[1]);
    await c.sleep(400);
  };
  const ctrl = (k, code, vk, shift = false) => c.key(k, code, vk, shift ? 10 : 2);
  const palette = async (q) => {
    await ctrl("k", "KeyK", 75);
    await c.sleep(400);
    await c.type(q, 60);
    await c.sleep(500);
  };
  const enter = () => c.key("Enter", "Enter", 13, 0, "\r");
  const esc = () => c.key("Escape", "Escape", 27);
  return { clickEl, ctrl, palette, enter, esc };
}

const ICON = (c, h) => h.clickEl("[data-path]", "harbor-lights.jpg");
const scenes = {
  "hero-dark": { async run(c, h) { await ICON(c, h); await c.sleep(1500); } },
  "hero-light": { opts: { theme: "light" }, async run(c, h) { await ICON(c, h); await c.sleep(1500); } },
  "split-view": {
    opts: { tabs: { active: 2, items: [TABS.items[0], TABS.items[1], panel("Projects", "column")] } },
    async run(c, h) {
      await h.clickEl("[data-path]", "website");
      await c.sleep(600);
      const panels = await c.evaluate("document.querySelectorAll('[data-view]').length");
      if (panels < 2) await h.ctrl("d", "KeyD", 68, true);
      await c.sleep(1200);
      // Klik do prázdna v pravém panelu ho aktivuje.
      await c.click(860, 600);
      await c.sleep(400);
      await h.ctrl("l", "KeyL", 76);
      await c.sleep(400);
      await c.send("Input.insertText", { text: "C:\\Demo\\Photos\\Summer 2026" });
      await h.enter();
      await c.sleep(1200);
      await h.clickEl("button[role=radio]", "View as List");
      await c.sleep(1500);
    },
  },
  "command-palette": { async run(c, h) { await h.palette("dow"); await c.sleep(800); } },
  previews: {
    opts: { tabs: { active: 0, items: [panel("Videos", "column"), TABS.items[1], TABS.items[2]] } },
    async run(c, h) { await h.clickEl("[data-path]", "city-drive.mp4"); await c.sleep(2500); },
  },
};

for (const name of which) {
  const scene = scenes[name];
  const c = await setup(1280, 800, scene.opts);
  const h = await helpers(c);
  await c.sleep(1500);
  try { await scene.run(c, h); } catch (e) { console.error(e.message); }
  await c.shot(`${OUT}${name}.png`);
  console.log("ok", name);
  c.close();
}
