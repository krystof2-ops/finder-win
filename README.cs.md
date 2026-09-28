# Finder-Win

[English](README.md) · **Čeština**

Správce souborů pro Windows ve stylu macOS Finderu, postavený na Tauri 2, Reactu a Rustu.

## Screenshoty

![Sloupcové zobrazení](docs/screenshots/main-column-view.png)
![Quick Look](docs/screenshots/quick-look.png)
![Světlý režim](docs/screenshots/light-mode.png)

## Funkce

- **Tři režimy zobrazení** – Ikony, Seznam (řaditelné sloupce, pruhované řádky) a Sloupce (Miller columns s info panelem vybraného souboru).
- **Okno ve stylu macOS** – vlastní titulkový pruh se „semaforem“, zaoblené rohy, tenké scrollbary.
- **Postranní panel**
  - standardní složky (Plocha, Stažené, Dokumenty, Obrázky, Hudba, Videa, Domů), OneDrive / iCloud Drive, pokud existují,
  - **všechny připojené disky** (USB disky s vlastní ikonou) a telefony / fotoaparáty; seznam se aktualizuje hned po připojení nebo odpojení,
  - **vlastní oblíbené** – přetažením složky do panelu ji přidáš, tažením přeuspořádáš, pravým klikem přejmenuješ nebo odebereš; ukládá se mezi spuštěními,
  - **Nedávné** – naposledy otevřené položky s relativním časem,
  - **Tagy** – použité barvy s počtem položek.
- **Quick Look** (mezerník) – náhled obrázků, PDF, videa, zvuku, textu/zdrojáků a vykresleného Markdownu; ←/→ přepíná soubory.
- **Souborové operace** – přejmenování na místě, duplikace, přesun do koše, kopírovat / vyjmout / vložit v rámci aplikace, nová složka, Otevřít v aplikaci…, otevřít v Průzkumníku, otevřít ve Windows Terminálu, kopírovat cestu / název, vlastnosti.
- **Kontextová menu** na souborech, volné ploše i v postranním panelu, včetně vícenásobného výběru („Smazat 5 položek“).
- **Barevné tagy** – 7 barev jako ve Finderu; klik na tag v panelu ukáže všechny soubory té barvy.
- **Hledání** – psaní filtruje aktuální složku, Enter spustí rekurzivní hledání podle názvu.
- **Navigace** – historie zpět / vpřed (i boční tlačítka myši 4 / 5), cesta s drobečkovou navigací a editací (Ctrl+L), volné místo na disku ve stavovém řádku.
- **Světlý a tmavý režim**, plynulé animace jako na macOS (vypnou se, když je ve Windows zapnuté omezení animací).

## Klávesové zkratky

| Zkratka | Akce |
|---|---|
| `Ctrl+↑` | Nadřazená složka |
| `Ctrl+↓` / `Enter` | Otevřít vybranou položku |
| `Mezerník` | Quick Look |
| `Ctrl+L` | Editace cesty |
| `Ctrl+F` | Pole hledání (`Enter` = rekurzivní hledání, `Esc` = vymazat) |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Kopírovat / vyjmout / vložit |
| `Ctrl+D` | Duplikovat |
| `Ctrl+A` | Vybrat vše (ne ve sloupcovém zobrazení) |
| `Ctrl+Shift+N` | Nová složka |
| `F2` | Přejmenovat |
| `Delete` | Přesunout do koše |
| `Ctrl+R` / `F5` | Obnovit |
| `Ctrl+Shift+.` | Zobrazit / skrýt skryté soubory (dokud ho nezměníš, řídí se Průzkumníkem) |
| `Esc` | Zrušit výběr; zavřít výsledky hledání |
| `↑` `↓` `←` `→` `Home` `End` | Pohyb ve sloupcovém zobrazení |
| `←` / `→`, `Esc` | Předchozí / další soubor, zavřít (v Quick Look) |
| Tlačítko myši 4 / 5 | Zpět / vpřed |

## Instalace

Stáhni nejnovější `Finder-Win_…_x64-setup.exe` ze stránky [Releases](https://github.com/OWNER/finder-win/releases/latest) a spusť ho. Instaluje se jen pro aktuálního uživatele, práva administrátora nejsou potřeba.

### Varování Windows SmartScreen

Instalátor není digitálně podepsaný, takže Windows SmartScreen zobrazí „Systém Windows ochránil váš počítač“. Pro instalaci klikni na **Další informace** a pak **Přesto spustit**.

## Sestavení ze zdrojáků

Potřebuješ:

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable)
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) („Vývoj desktopových aplikací pomocí C++“)
- WebView2 (ve Windows 10/11 už je)

```powershell
npm install
npm run tauri dev     # vývojový režim
npm run tauri build   # sestavení instalátorů
```

Instalátor vznikne v `src-tauri/target/release/bundle/nsis/`.

## Známá omezení

- **Rozhraní je jen česky**, lokalizace zatím není.
- **Jen pro Windows.**
- **Chybí drag & drop souborů** mezi složkami i z Průzkumníku. Tažením jde zatím jen přidat složku do postranního panelu.
- **Kopírovat / vyjmout / vložit funguje jen uvnitř aplikace**, ne přes systémovou schránku (do Průzkumníku vložit nejde). „Kopírovat cestu“ systémovou schránku používá.
- **Tlačítka Seřadit, Sdílet a Štítky v toolbaru zatím nic nedělají.** Řadit jde přes hlavičky sloupců v zobrazení Seznam.
- **Telefony a fotoaparáty** (iPhone, Android — zařízení MTP) jsou v panelu vidět, ale klik je otevře v Průzkumníku Windows; přímo v aplikaci se procházet nedají.
- **Bez náhledů obrázků**, soubory mají ikonu podle typu.
- Rekurzivní hledání porovnává **jen názvy souborů**, končí na **500 výsledcích** a přeskakuje složky `.git`, `node_modules` a rustové `target` (jen ty vedle `Cargo.toml`).
- Žádné taby ani víc oken.
- Instalátor **není podepsaný** (viz SmartScreen výše).

## Licence

[MIT](LICENSE)
