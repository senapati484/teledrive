/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the teledrive-backend service. Default: http://localhost:3000 */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "heic2any" {
  interface Heic2AnyOptions {
    blob: Blob;
    toType?: string;
    quality?: number;
    multiple?: boolean;
  }
  function heic2any(options: Heic2AnyOptions): Promise<Blob | Blob[]>;
  export default heic2any;
}