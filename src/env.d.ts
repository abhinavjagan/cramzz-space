/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_POSTHOG_KEY?: string;
  readonly PUBLIC_POSTHOG_HOST?: string;
  readonly PUBLIC_SPONSOR_FORM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
