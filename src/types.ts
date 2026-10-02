// Odpovídá structům v src-tauri/src/main.rs (serde používá výchozí snake_case).

export type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  /** Bajty; 0 pro složky. */
  size: number;
  /** Unix timestamp v sekundách. */
  modified: number;
  /** Unix timestamp v sekundách. */
  created: number;
  /** Přípona bez tečky, malými písmeny. */
  extension: string | null;
  /** Atribut skrytý — ve výpisu jen se zapnutým zobrazením skrytých souborů. */
  hidden: boolean;
  /** Symlink nebo junction; is_dir a size popisují cíl odkazu. */
  is_symlink: boolean;
};

/** Druh disku v sidebaru — určuje popisek bez názvu svazku („Místní disk (D:)"). */
export type DriveKind = "local" | "usb" | "network" | "optical" | "phone";

/** Standardní složky, které backend posílá jen jako id (popisek dělá i18n). */
export type StandardFolderId =
  | "desktop"
  | "downloads"
  | "documents"
  | "pictures"
  | "music"
  | "videos"
  | "home";

/** Položka sidebaru od backendu. Text se skládá ve frontendu — sidebarLabel(). */
export type FavoriteEntry = {
  id: StandardFolderId | null;
  /** Vlastní jméno: název svazku, OneDrive, iCloud, telefon. */
  label: string | null;
  /** Disk: písmeno bez dvojtečky. */
  letter: string | null;
  kind: DriveKind | null;
  path: string;
  icon_name: string;
  /** Telefon, fotoaparát — nemá souborový systém, otevírá se v Průzkumníku. */
  external: boolean;
};

export type SectionId = "favorites" | "cloud" | "devices";

export type FavoriteSection = {
  id: SectionId;
  items: FavoriteEntry[];
};

export type OpResult = {
  /** Cesta, která operací vznikla. */
  path: string;
  /** Kolik symlinků a junctions se při kopii přeskočilo. */
  skipped_links: number;
  /** Kolize vyřešená volbou Přeskočit — nic se nestalo. */
  skipped: boolean;
};

export type StatResult = {
  entry: FileEntry | null;
  /** True jen když položka prokazatelně neexistuje. Nedostupný disk dá false —
   *  volající pak nesmí nic promazávat. */
  missing: boolean;
};

export type FileProperties = {
  size: number;
  created: number;
  modified: number;
  accessed: number;
  is_dir: boolean;
  is_readonly: boolean;
  is_hidden: boolean;
};

export type ViewMode = "icon" | "list" | "column";

/** Modifikátory kliku na položku: Ctrl = přepnout, Shift = rozsah od kotvy. */
export type SelectMods = { toggle: boolean; range: boolean };

/** Velikost složky z folder_stats — průběžně i na konci. */
export type FolderStats = {
  files: number;
  folders: number;
  bytes: number;
  /** Výpočet narazil na strop 200 000 položek; čísla jsou dolní odhad. */
  truncated: boolean;
  done: boolean;
};

/** Interní schránka aplikace — nesouvisí se systémovou schránkou Windows. */
export type Clipboard = { paths: string[]; mode: "copy" | "cut" };

export type Theme = "light" | "dark";

/* ------------------------- persistentní nastavení -------------------------- */

/** Položka v uživatelské sekci "Moje oblíbené". Vždycky složka. */
export type CustomFavorite = {
  /** Zobrazený název — jde přejmenovat nezávisle na cestě. */
  label: string;
  path: string;
  /** Klíč do SIDEBAR_ICONS, prakticky vždy "Folder". */
  icon: string;
  /**
   * Soubor se z oblíbených otevírá, složka se do ní naviguje. Starší
   * settings.json tohle pole nemá — pak se položka bere jako složka.
   */
  type: RecentKind;
};

export type RecentKind = "file" | "folder";

export type RecentEntry = {
  path: string;
  name: string;
  type: RecentKind;
  /** Unix timestamp v **milisekundách** (na rozdíl od FileEntry.modified). */
  opened_at: number;
};

/** Sedm barev jako ve Finderu, víc jich být nemůže. */
export type TagColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "grey";

/** Cesta → seznam barev. Soubor může mít víc tagů zároveň. */
export type TagMap = Record<string, TagColor[]>;
