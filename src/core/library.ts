// The built-in library (library/ in the npm package, library/index.json):
// bundled fonts (OFL) and sample photos (CC0). Documents reference images as
// "library:<id>" (e.g. "library:portrait") and fonts by catalog id
// ("font": "inter"). The front door (CLI, Studio) loads the index and the
// bytes; ops only see these types.

export interface LibraryFontFile {
  path: string; // inside library/
  weight: number;
  style: "normal" | "italic";
  unicodeRange?: string;
}

export interface LibraryAsset {
  id: string;
  kind: "font" | "image";
  // image: file path inside library/
  path?: string;
  // font: CSS family and files
  family?: string;
  files?: LibraryFontFile[];
  width?: number;
  height?: number;
  license: string;
  author?: string;
  source?: string;
  title?: string;
  tags: string[];
  description: string;
  kb: number;
}

export interface LibraryIndex {
  assets: LibraryAsset[];
}

// Reads library files (path inside library/) — export copies, fonts for the engine.
export interface LibraryProvider {
  index: LibraryIndex;
  read(path: string): Promise<Uint8Array>;
}

export const LIBRARY_PREFIX = "library:";

export function isLibraryRef(path: unknown): path is string {
  return typeof path === "string" && path.startsWith(LIBRARY_PREFIX);
}

export function libraryId(ref: string): string {
  return ref.slice(LIBRARY_PREFIX.length);
}

export function findLibraryAsset(index: LibraryIndex | undefined, id: string): LibraryAsset | undefined {
  return index?.assets.find((a) => a.id === id);
}
