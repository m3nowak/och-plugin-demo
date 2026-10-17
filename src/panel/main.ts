import { connectHost } from '@openchamber/sdk';
import { applyHostReady } from '@openchamber/sdk/ui';
import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { ColorSpace } from 'three';
import * as ratModel from 'virtual:rat-model';

/** One full turn every 20 seconds. */
const ROTATION_SPEED = (2 * Math.PI) / 20;
const CAMERA_FOV = 30;
const CAMERA_ELEVATION = MathUtils.degToRad(14);
/** Empty space kept around the turning rat, as a share of the view. */
const FRAME_PADDING = 1.1;
/** Longest step between frames, so a stalled tab does not jump the rat. */
const MAX_FRAME_STEP_MS = 100;

const stage = document.getElementById('stage') as HTMLDivElement;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const message = document.getElementById('message') as HTMLParagraphElement;
const attribution = document.getElementById('attribution') as HTMLParagraphElement;

const host = connectHost();
host.onReady((ctx) => applyHostReady(ctx, document.documentElement));

// The sandboxed frame cannot open links itself; the host opens them.
attribution.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest('a');
  if (!link) return;
  event.preventDefault();
  host.openUrl(link.href).catch(() => undefined);
});

const showMessage = (text: string) => {
  canvas.hidden = true;
  message.textContent = text;
  message.hidden = false;
};

const decodeFloats = (base64: string, itemSize: number) => {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const array = new Float32Array(bytes.buffer);
  if (array.length !== ratModel.vertexCount * itemSize) {
    throw new Error('The rat model data is incomplete.');
  }
  return new BufferAttribute(array, itemSize);
};

const loadTexture = async (url: string, colorSpace: ColorSpace, renderer: WebGLRenderer) => {
  const image = new Image();
  image.src = url;
  await image.decode();
  const texture = new Texture(image);
  texture.colorSpace = colorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.needsUpdate = true;
  return texture;
};

const createRenderer = () => {
  try {
    return new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
};

/**
 * Camera distance that keeps the whole cylinder the rat sweeps while turning
 * inside the view, so no angle of the rotation clips the tail.
 */
const framingDistance = (aspect: number) => {
  const { radius, halfHeight } = ratModel.bounds;
  const tanV = Math.tan(MathUtils.degToRad(CAMERA_FOV / 2)) / FRAME_PADDING;
  const tanH = tanV * aspect;
  const toCamera = new Vector3(0, Math.sin(CAMERA_ELEVATION), Math.cos(CAMERA_ELEVATION));
  const up = new Vector3(0, Math.cos(CAMERA_ELEVATION), -Math.sin(CAMERA_ELEVATION));
  const point = new Vector3();
  let distance = 0;
  for (let step = 0; step < 72; step += 1) {
    const angle = (step / 72) * Math.PI * 2;
    for (const y of [-halfHeight, halfHeight]) {
      point.set(radius * Math.cos(angle), y, radius * Math.sin(angle));
      const depth = point.dot(toCamera);
      distance = Math.max(
        distance,
        depth + Math.abs(point.x) / tanH,
        depth + Math.abs(point.dot(up)) / tanV,
      );
    }
  }
  return distance;
};

const start = async () => {
  const renderer = createRenderer();
  if (!renderer) {
    showMessage('The 3D view needs WebGL, which is not available here.');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  let geometry: BufferGeometry;
  let textures: Texture[];
  try {
    geometry = new BufferGeometry();
    geometry.setAttribute('position', decodeFloats(ratModel.positions, 3));
    geometry.setAttribute('normal', decodeFloats(ratModel.normals, 3));
    geometry.setAttribute('uv', decodeFloats(ratModel.uvs, 2));
    textures = await Promise.all([
      loadTexture(ratModel.baseColorPng, SRGBColorSpace, renderer),
      loadTexture(ratModel.normalPng, '', renderer),
    ]);
  } catch {
    renderer.dispose();
    showMessage('The rat model could not be loaded.');
    return;
  }
  const [baseColor, normalMap] = textures;
  const material = new MeshLambertMaterial({ map: baseColor, normalMap });
  const rat = new Mesh(geometry, material);

  const scene = new Scene();
  scene.add(rat);
  scene.add(new HemisphereLight(0xffffff, 0x5a5048, 1.6));
  const keyLight = new DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(-2, 4, 3);
  scene.add(keyLight);

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.01, 100);

  let width = 0;
  let height = 0;
  let inView = false;
  let running = false;
  let disposed = false;
  let angle = 0;
  let lastTime: number | null = null;

  const renderFrame = (time: number) => {
    if (lastTime !== null) {
      const step = Math.min(time - lastTime, MAX_FRAME_STEP_MS);
      angle = (angle + (step / 1000) * ROTATION_SPEED) % (Math.PI * 2);
    }
    lastTime = time;
    rat.rotation.y = angle;
    renderer.render(scene, camera);
  };

  // The host keeps a hidden rail panel's frame mounted and does not say when
  // it hides it, so the panel watches its own size, clipping and page
  // visibility.
  const updateLoop = () => {
    const visible = !disposed && inView && width > 0 && height > 0 && document.visibilityState === 'visible';
    if (visible === running) return;
    running = visible;
    lastTime = null;
    renderer.setAnimationLoop(visible ? renderFrame : null);
  };

  const resize = (nextWidth: number, nextHeight: number) => {
    width = nextWidth;
    height = nextHeight;
    if (width > 0 && height > 0) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const distance = framingDistance(camera.aspect);
      camera.position.set(0, Math.sin(CAMERA_ELEVATION), Math.cos(CAMERA_ELEVATION)).multiplyScalar(distance);
      camera.near = distance / 10;
      camera.far = distance * 10;
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      if (running) renderFrame(performance.now());
    }
    updateLoop();
  };

  const resizeObserver = new ResizeObserver(([entry]) => {
    resize(Math.floor(entry.contentRect.width), Math.floor(entry.contentRect.height));
  });
  resizeObserver.observe(stage);

  // A closed rail panel stays mounted at opacity 0, partly clipped by the
  // narrower column the host leaves behind, and an open one is never clipped.
  // So the panel counts as shown only while no part of the stage is cut off.
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    const { boundingClientRect: box, intersectionRect: shown } = entry;
    inView = entry.isIntersecting && box.width - shown.width < 1 && box.height - shown.height < 1;
    updateLoop();
  }, { threshold: [0, 0.5, 0.9, 0.99, 0.995, 1] });
  intersectionObserver.observe(stage);

  document.addEventListener('visibilitychange', updateLoop);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    updateLoop();
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', updateLoop);
    geometry.dispose();
    material.dispose();
    for (const texture of textures) texture.dispose();
    renderer.dispose();
    host.dispose();
  };
  window.addEventListener('pagehide', dispose, { once: true });

  canvas.addEventListener('webglcontextlost', () => {
    dispose();
    showMessage('The 3D view stopped because the graphics device was reset. Reopen the panel to try again.');
  }, { once: true });
};

void start();
