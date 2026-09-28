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
};

export type FavoriteEntry = {
  label: string;
  path: string;
  icon_name: string;
};

export type FavoriteSection = {
  label: string;
  items: FavoriteEntry[];
};

export type OpResult = {
  /** Cesta, která operací vznikla. */
  path: string;
  /** Kolik symlinků a junctions se při kopii přeskočilo. */
  skipped_links: number;
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
