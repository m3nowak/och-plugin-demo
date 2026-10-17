// Build-time conversion of the supplied Low Poly Rat archive into the data the
// panel bundle embeds. The panel never fetches the model or its textures: the
// host's asset route cannot serve FBX or binary buffers, and a sandboxed
// frame's fetches do not survive every host transport.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { unzipSync } from 'fflate';
import { Box3, Vector3 } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

export const SOURCE_ARCHIVE_SHA256 = 'b340026593dd2d8f86f85853715d7572c6e49c5fe28c31c67398ed1a311a1129';

const FBX_PATH = 'source/rattri.fbx';
const BASE_MAP_PATH = 'textures/rat_low_lambert1_BaseMap.png';
const NORMAL_MAP_PATH = 'textures/rat_low_lambert1_Normal.png';
const EXPECTED_VERTICES = 2274;

const toArrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const floatsToBase64 = (array) => Buffer.from(new Float32Array(array).buffer).toString('base64');

const pngDataUrl = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;

/**
 * Reads the archive and returns the embedded model plus a report of every
 * change made to the source, so the asset notes can be checked against it.
 */
export const convertRatModel = async (archivePath) => {
  const archive = await readFile(archivePath);
  const digest = createHash('sha256').update(archive).digest('hex');
  if (digest !== SOURCE_ARCHIVE_SHA256) {
    throw new Error(`${archivePath} has SHA-256 ${digest}, expected ${SOURCE_ARCHIVE_SHA256}.`);
  }

  const files = unzipSync(new Uint8Array(archive));
  for (const name of [FBX_PATH, BASE_MAP_PATH, NORMAL_MAP_PATH]) {
    if (!files[name]) throw new Error(`${archivePath} does not contain ${name}.`);
  }

  const group = new FBXLoader().parse(toArrayBuffer(files[FBX_PATH]), '');
  if (group.animations.length > 0) {
    throw new Error('The FBX unexpectedly contains animation clips.');
  }
  const meshes = [];
  group.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  if (meshes.length !== 1) {
    throw new Error(`Expected one mesh in the FBX, found ${meshes.length}.`);
  }
  const [mesh] = meshes;

  // Bake the node transform (0.01 scale; its scaling pivot and offset cancel
  // out) into the vertices, keeping the FBX's Y-up axes.
  group.updateMatrixWorld(true);
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);

  // Put the bounding-box centre at the origin, so the turntable spins the rat
  // about its middle instead of the FBX node's origin. That centre coincides
  // with the node's rotation pivot.
  const bounds = new Box3().setFromBufferAttribute(geometry.getAttribute('position'));
  const center = bounds.getCenter(new Vector3());
  geometry.translate(-center.x, -center.y, -center.z);

  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  if (geometry.index || !normal || !uv || position.count !== EXPECTED_VERTICES) {
    throw new Error('The FBX geometry does not match the expected 758 textured triangles.');
  }

  let radius = 0;
  for (let i = 0; i < position.count; i += 1) {
    radius = Math.max(radius, Math.hypot(position.getX(i), position.getZ(i)));
  }
  const size = bounds.getSize(new Vector3());

  return {
    vertexCount: position.count,
    positions: floatsToBase64(position.array),
    normals: floatsToBase64(normal.array),
    uvs: floatsToBase64(uv.array),
    // Exact archive bytes: the panel decodes these PNGs unchanged.
    baseColorPng: pngDataUrl(files[BASE_MAP_PATH]),
    normalPng: pngDataUrl(files[NORMAL_MAP_PATH]),
    // The space the rat sweeps while turning about Y: a cylinder.
    bounds: { radius, halfHeight: size.y / 2 },
    report: {
      sourceSha256: digest,
      triangles: position.count / 3,
      fbxNodeScale: mesh.scale.toArray(),
      recenteredBy: center.toArray().map((value) => -value),
      size: size.toArray(),
    },
  };
};

/** ES module source for the `virtual:rat-model` import. */
export const ratModelModule = (model) => [
  `export const vertexCount = ${model.vertexCount};`,
  `export const positions = ${JSON.stringify(model.positions)};`,
  `export const normals = ${JSON.stringify(model.normals)};`,
  `export const uvs = ${JSON.stringify(model.uvs)};`,
  `export const baseColorPng = ${JSON.stringify(model.baseColorPng)};`,
  `export const normalPng = ${JSON.stringify(model.normalPng)};`,
  `export const bounds = ${JSON.stringify(model.bounds)};`,
].join('\n');
