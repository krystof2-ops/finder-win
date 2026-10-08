// Demo settings.json pro dev spuštěný s demo-conf.json (identifier ….demo) – skutečné
// nastavení aplikace zůstane netknuté. Spouštět, když aplikace neběží (store se drží v paměti).
import fs from "fs";
import path from "path";
const out = process.argv[2] ?? path.join(process.env.APPDATA, "com.krystof2ops.finderwin.demo", "settings.json");
const [theme = "dark", lang = "en"] = process.argv.slice(3);
const D = "C:\\Demo";
const now = Date.now();
const p = (v, view) => ({ path: `${D}\\${v}`, view, sortKey: "name", sortDirection: "asc" });
const s = {
  favorites: [
    { label: "Projects", path: `${D}\\Projects`, icon: "Folder", type: "folder" },
    { label: "Photos", path: `${D}\\Photos`, icon: "Folder", type: "folder" },
  ],
  recents: [
    ["Photos\\Summer 2026\\coastline.jpg", "file", 2], ["Documents\\roadmap.pptx", "file", 30],
    ["Projects\\website", "folder", 90], ["Documents\\meeting-notes.md", "file", 200],
  ].map(([r, type, min]) => ({ path: `${D}\\${r}`, name: r.split("\\").pop(), type, opened_at: now - min * 60000 })),
  tags: {
    [`${D}\\Documents\\budget-2026.xlsx`]: ["green"],
    [`${D}\\Documents\\contract.pdf`]: ["red"],
    [`${D}\\Documents\\roadmap.pptx`]: ["blue"],
    [`${D}\\Photos\\Summer 2026\\sunset-over-lake.jpg`]: ["orange"],
    [`${D}\\Projects\\website`]: ["purple"],
  },
  showHidden: false, sidebarWidth: 200, motion: "on", language: lang, theme, terminal: "auto",
  tabs: { active: 0, items: [p("Photos\\Summer 2026", "icon"), p("Documents", "list"), p("Projects", "column")] },
  updates: { check: false, lastCheck: now, latest: null },
  splitRatio: 0.5,
  commandUsage: {},
};
fs.mkdirSync(out.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
fs.writeFileSync(out, JSON.stringify(s, null, 2));
