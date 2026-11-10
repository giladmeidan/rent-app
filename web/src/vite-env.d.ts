/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** The MapLibre style URL (spec 0003d); unset means the bundled OSM raster style. */
  readonly VITE_MAP_STYLE_URL?: string;
}
