// Tlačítka „Download for Windows“ do docs/buttons/ (download.svg, download-cs.svg).
// Text je převedený na křivky z Inter (OFL, @fontsource/inter), takže GitHub vykreslí všude stejně.
// Verze z package.json, velikost z instalátoru src-tauri/target/release/bundle/nsis/Finder-Win_<verze>_x64-setup.exe.
// node scripts/docs-media/buttons.mjs   (po `npm run tauri build` vydávané verze)
import fs from "fs";
import { fileURLToPath } from "url";
import opentype from "opentype.js";

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const { version } = JSON.parse(fs.readFileSync(root("package.json"), "utf8"));
const installer = root(`src-tauri/target/release/bundle/nsis/Finder-Win_${version}_x64-setup.exe`);
if (!fs.existsSync(installer)) {
  console.error(`Chybí instalátor ${installer} – nejdřív npm run tauri build.`);
  process.exit(1);
}
// MiB s jedním desetinným místem, jak velikost ukazuje Průzkumník i GitHub.
const mb = (fs.statSync(installer).size / 1024 / 1024).toFixed(1);

const font = (f) => opentype.parse(fs.readFileSync(root(`node_modules/@fontsource/inter/files/${f}`)).buffer);
const semi = font("inter-latin-600-normal.woff");
const reg = font("inter-latin-400-normal.woff");

const W = 280, H = 56, PAD = 6; // tlačítko + okraj pro stín (v README height="68" = tlačítko 56 px)
const T = 16.5, S = 12, ICON = 22, GAP = 12;

function button(title, sub) {
  const block = ICON + GAP + Math.max(semi.getAdvanceWidth(title, T), reg.getAdvanceWidth(sub, S));
  const x0 = PAD + (W - block) / 2;
  const tx = x0 + ICON + GAP;
  const titlePath = semi.getPath(title, tx, PAD + 25, T).toPathData(2);
  const subPath = reg.getPath(sub, tx, PAD + 42, S).toPathData(2);
  // Ikona stažení (lucide „download“) ve 24px mřížce, svisle na střed.
  const iy = PAD + (H - ICON) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 2 * PAD}" height="${H + 2 * PAD}" viewBox="0 0 ${W + 2 * PAD} ${H + 2 * PAD}" role="img" aria-label="${title}">
  <title>${title}</title>
  <defs>
    <filter id="s" x="-10%" y="-20%" width="120%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#0b1f4d" flood-opacity="0.28"/>
    </filter>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3171F0"/>
      <stop offset="1" stop-color="#2563EB"/>
    </linearGradient>
  </defs>
  <rect x="${PAD}" y="${PAD}" width="${W}" height="${H}" rx="12" fill="url(#g)" filter="url(#s)"/>
  <rect x="${PAD + 0.5}" y="${PAD + 0.5}" width="${W - 1}" height="${H - 1}" rx="11.5" fill="none" stroke="#ffffff" stroke-opacity="0.18"/>
  <g transform="translate(${x0.toFixed(2)} ${iy.toFixed(2)}) scale(${ICON / 24})" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <path d="M7 10l5 5 5-5"/>
    <path d="M12 15V3"/>
  </g>
  <path fill="#fff" d="${titlePath}"/>
  <path fill="#fff" fill-opacity="0.82" d="${subPath}"/>
</svg>
`;
}

fs.mkdirSync(root("docs/buttons"), { recursive: true });
const out = [
  ["download.svg", "Download for Windows", `v${version} · Windows 10/11 · ${mb} MB`],
  ["download-cs.svg", "Stáhnout pro Windows", `v${version} · Windows 10/11 · ${mb.replace(".", ",")} MB`],
];
for (const [file, title, sub] of out) {
  fs.writeFileSync(root(`docs/buttons/${file}`), button(title, sub));
  console.log(`docs/buttons/${file}: ${sub}`);
}
