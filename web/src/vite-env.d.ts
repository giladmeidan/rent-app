/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /** The MapLibre style URL (spec 0003d); unset means the bundled OSM raster style. */
  readonly VITE_MAP_STYLE_URL?: string;
  /** The public contact address of the footer and the legal pages (spec 0013f); unset means a placeholder. */
  readonly VITE_CONTACT_EMAIL?: string;
  /** The Google OAuth client id (spec 0016b, not a secret); unset or empty means no Google button. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Sentry error reports (spec 0019a); unset or empty means Sentry is off. */
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
}
