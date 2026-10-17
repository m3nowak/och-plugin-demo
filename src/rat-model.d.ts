/** Generated at build time from assets/low-poly-rat.zip by scripts/rat-model.mjs. */
declare module 'virtual:rat-model' {
  export const vertexCount: number;
  /** Base64 little-endian Float32 data, three components per vertex. */
  export const positions: string;
  export const normals: string;
  /** Base64 little-endian Float32 data, two components per vertex. */
  export const uvs: string;
  /** The archive's PNG bytes as data URLs. */
  export const baseColorPng: string;
  export const normalPng: string;
  /** The cylinder the rat sweeps while turning about Y, centred on the origin. */
  export const bounds: { radius: number; halfHeight: number };
}
