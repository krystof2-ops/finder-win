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
