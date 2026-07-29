declare module 'virtual:mmd-background-data' {
  export const BACKGROUND_NAME: string;
  export const BACKGROUND_SHA256: string;
  export const BACKGROUND_UNCOMPRESSED_BYTES: number;
  export const BACKGROUND_GZIP_BASE64_CHUNKS: readonly string[];
  export const BACKGROUND_PROXY_SHA256: string;
  export const BACKGROUND_PROXY_UNCOMPRESSED_BYTES: number;
  export const BACKGROUND_PROXY_GZIP_BASE64: string;
}
