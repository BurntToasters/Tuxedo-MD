/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TUXEDO_EDITION?: 'community' | 'full';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
