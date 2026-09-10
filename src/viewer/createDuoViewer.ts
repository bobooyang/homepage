import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ViewMotion } from './view-motion';
import { CameraPreview } from './camera-preview';
import { coverCrop, SCREEN_ASPECT } from './wallpaper-image';
import { introPose, INTRO_DURATION, type IntroPhase } from './intro-motion';
import { createInteractionState, setAngle as setInteractionAngle, requestFold, stepFold, pressDeviceButton } from './interaction-state';
import type { ButtonTargetSnapshot, DeviceButtonName, Finish, ScreenName, ViewerController, ViewerSnapshot, ViewName } from './types';

interface Resources {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  disposed: boolean;
}

type ColorMaterial = THREE.Material & { color: THREE.Color };

interface DeviceButton {
  name: DeviceButtonName;
  node: THREE.Object3D;
  target: THREE.Mesh;
  action: THREE.AnimationAction;
  materials: { material: ColorMaterial; color: THREE.Color }[];
  highlightUntil: number;
}

interface ScreenBinding {
  mesh: THREE.Mesh;
  materials: THREE.Material[];
  kinds: (ScreenName | null)[];
  array: boolean;
  originalEmissiveMaps: (THREE.Texture | null)[];
}

interface PreparedModel {
  object: THREE.Group;
  size: THREE.Vector3;
  scale: number;
  mixer: THREE.AnimationMixer;
  fold: THREE.AnimationAction;
  foldDuration: number;
  screens: ScreenBinding[];
  offMaterial: THREE.MeshPhysicalMaterial;
  screenKey: ScreenName | 'off' | '';
  buttons: Map<DeviceButtonName, DeviceButton>;
  solidMeshes: THREE.Mesh[];
  resources: Resources;
}

const buttonNames: DeviceButtonName[] = ['Power', 'Camera', 'VolumeUp', 'VolumeDown'];
const pressColor = new THREE.Color(0xa5c4df);

function createResources(): Resources {
  return { geometries: new Set(), materials: new Set(), textures: new Set(), disposed: false };
}

function trackMaterial(material: THREE.Material, resources: Resources): void {
  resources.materials.add(material);
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) resources.textures.add(value);
  }
}

function trackScene(root: THREE.Object3D, resources: Resources): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) trackMaterial(material, resources);
  });
}

function disposeResources(resources: Resources): void {
  if (resources.disposed) return;
  resources.disposed = true;
  const closedImages = new Set<object>();
  const closeImage = (image: unknown): void => {
    if (Array.isArray(image)) { image.forEach(closeImage); return; }
    if (!image || typeof image !== 'object' || closedImages.has(image)) return;
    closedImages.add(image);
    if ('close' in image && typeof image.close === 'function') image.close();
  };
  for (const geometry of resources.geometries) geometry.dispose();
  for (const material of resources.materials) material.dispose();
  for (const texture of resources.textures) {
    texture.dispose();
    closeImage(texture.source.data);
  }
  resources.geometries.clear();
  resources.materials.clear();
  resources.textures.clear();
}

function disposeGLTF(gltf: GLTF): void {
  const resources = createResources();
  for (const scene of gltf.scenes) trackScene(scene, resources);
  trackScene(gltf.scene, resources);
  disposeResources(resources);
}

function disposeModel(model: PreparedModel): void {
  if (model.resources.disposed) return;
  model.mixer.stopAllAction();
  model.mixer.uncacheRoot(model.mixer.getRoot());
  model.object.removeFromParent();
  disposeResources(model.resources);
}

function hasColor(material: THREE.Material): material is ColorMaterial {
  return 'color' in material && material.color instanceof THREE.Color;
}

export function createDuoViewer(container: HTMLElement, onSnapshot: (snapshot: ViewerSnapshot) => void): ViewerController {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const cleanups: (() => void)[] = [() => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
  }];
  const runCleanups = (): void => {
    while (cleanups.length) {
      try { cleanups.pop()?.(); } catch (error) { console.error('清理 3D 查看器资源失败', error); }
    }
  };
  let teardown = runCleanups;

  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xf3f2ef, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.style.opacity = '0';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    cleanups.push(() => controls.dispose());
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.2;
    controls.maxDistance = 24;
    controls.enabled = false;

    const environment = new RoomEnvironment();
    let pmrem: THREE.PMREMGenerator | undefined;
    try {
      pmrem = new THREE.PMREMGenerator(renderer);
      const environmentTarget = pmrem.fromScene(environment, 0.04);
      scene.environment = environmentTarget.texture;
      cleanups.push(() => { scene.environment = null; environmentTarget.dispose(); });
    } finally {
      environment.dispose();
      pmrem?.dispose();
    }
    scene.add(new THREE.HemisphereLight(0xffffff, 0xaaa9a4, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 7);
    scene.add(key);

    const interaction = createInteractionState();
    const modelCache = new Map<Finish, PreparedModel>();
    const wallpapers: Record<ScreenName, THREE.CanvasTexture | null> = { inner: null, outer: null };
    cleanups.push(() => { wallpapers.inner?.dispose(); wallpapers.outer?.dispose(); });
    const modelContainer = new THREE.Group();
    scene.add(modelContainer);
    const loadingManager = new THREE.LoadingManager();
    const loader = new GLTFLoader(loadingManager);
    const eventController = new AbortController();
    cleanups.push(() => eventController.abort());
    let disposed = false;
    let requestId = 0;
    let requestController: AbortController | null = null;
    let activeModel: PreparedModel | null = null;
    let finish: Finish | null = null;
    let lastRequest: Finish = 'star-white';
    let loading = false;
    let loadMessage = '';
    let error: string | null = null;
    let view: ViewName | null = 'perspective';
    let viewMotion: ViewMotion | null = null;
    let introPhase: IntroPhase = 'waiting';
    let introElapsed = 0;
    let introSkipped = false;
    let introDistance = 5;
    let foldFrequency = 18;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let hud: ViewerSnapshot['hud'] = null;
    let hudTimeout: ReturnType<typeof setTimeout> | undefined;
    let buttonTargets: ButtonTargetSnapshot[] = [];
    let lastSnapshot = '';
    let lastFrame = performance.now();
    let lastTargetFrame = 0;
    let modelSize = new THREE.Vector3(3, 2.3, 0.2);
    let normalizationReference: { center: THREE.Vector3; scale: number } | null = null;
    const video = document.createElement('video');
    let cameraTextures: Record<ScreenName, THREE.VideoTexture> | null = null;
    const preview = new CameraPreview(video, () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        showHud('当前环境不支持摄像头，请使用 HTTPS 或 localhost 打开页面。', null, 7000);
        return Promise.reject(new Error('Camera unavailable'));
      }
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }, (status, message) => {
      if (disposed) return;
      if (status === 'active') {
        cameraTextures = { inner: new THREE.VideoTexture(video), outer: new THREE.VideoTexture(video) };
        for (const texture of Object.values(cameraTextures)) {
          texture.flipY = false;
          texture.colorSpace = THREE.SRGBColorSpace;
        }
        updateCameraCrop();
      }
      const previous = status === 'off' ? cameraTextures : null;
      if (status === 'off') cameraTextures = null;
      for (const model of modelCache.values()) applyWallpapers(model);
      if (previous) Object.values(previous).forEach((texture) => texture.dispose());
      if (message) showHud(message, null, status === 'starting' ? 0 : 7000);
      emitSnapshot();
    });
    cleanups.push(() => {
      preview.dispose();
      if (cameraTextures) Object.values(cameraTextures).forEach((texture) => texture.dispose());
      cameraTextures = null;
    });
    window.addEventListener('pagehide', () => preview.stop(), { signal: eventController.signal });

    function updateCameraCrop(): void {
      if (!cameraTextures || !video.videoWidth || !video.videoHeight) return;
      for (const kind of ['inner', 'outer'] as const) {
        const crop = coverCrop(video.videoWidth, video.videoHeight, SCREEN_ASPECT[kind]);
        cameraTextures[kind].repeat.set(crop.width / video.videoWidth, crop.height / video.videoHeight);
        cameraTextures[kind].offset.set(crop.x / video.videoWidth, crop.y / video.videoHeight);
      }
    }

    function showHud(label: string, volume: number | null = null, duration = 1500): void {
      hud = { label, volume };
      clearTimeout(hudTimeout);
      if (duration) hudTimeout = setTimeout(() => { if (!disposed) { hud = null; emitSnapshot(); } }, duration);
      emitSnapshot();
    }
    const directions: Record<ViewName, THREE.Vector3> = {
      front: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(0, 0, -1),
      left: new THREE.Vector3(-1, 0, 0), right: new THREE.Vector3(1, 0, 0),
      perspective: new THREE.Vector3(0.62, 0.55, 1).normalize(),
    };

    function emitSnapshot(): void {
      if (disposed) return;
      const snapshot: ViewerSnapshot = {
        introPhase, introSkipped, cameraStatus: preview.status,
        ...interaction, angle: Number(interaction.angle.toFixed(2)), finish, loading, loadMessage, error, view,
        hud: hud ? { ...hud } : null, buttonTargets: buttonTargets.map((target) => ({ ...target })),
      };
      const serialized = JSON.stringify(snapshot);
      if (serialized === lastSnapshot) return;
      lastSnapshot = serialized;
      onSnapshot(snapshot);
    }

    function viewDestination(name: ViewName): THREE.Vector3 {
      return fitDirection(directions[name]);
    }

    function fitDirection(direction: THREE.Vector3): THREE.Vector3 {
      const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      const tanVertical = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const tanHorizontal = tanVertical * camera.aspect;
      let distance = 0;
      for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
        const corner = new THREE.Vector3(x, y, z).multiply(modelSize);
        const extent = Math.max(Math.abs(corner.dot(right)) / tanHorizontal, Math.abs(corner.dot(up)) / tanVertical);
        distance = Math.max(distance, corner.dot(direction) + extent * 1.18);
      }
      return direction.clone().multiplyScalar(THREE.MathUtils.clamp(distance, controls.minDistance, controls.maxDistance));
    }

    function setView(name: ViewName, animate = Boolean(activeModel)): void {
      if (disposed) return;
      view = name;
      const destination = viewDestination(name);
      if (animate && !reducedMotion.matches) {
        if (viewMotion) viewMotion.retarget(destination);
        else {
          // Clear residual OrbitControls damping without moving the rendered pose.
          const position = camera.position.clone();
          const focus = controls.target.clone();
          controls.enableDamping = false;
          controls.update();
          camera.position.copy(position);
          controls.target.copy(focus);
          controls.update();
          viewMotion = new ViewMotion(position, focus, destination);
        }
      } else {
        viewMotion = null;
        controls.enableDamping = false;
        controls.update();
        camera.position.copy(destination);
        controls.target.set(0, 0, 0);
        controls.update();
        controls.enableDamping = true;
      }
      lastTargetFrame = 0;
      emitSnapshot();
    }

    function applyIntro(): void {
      const pose = introPose(introElapsed);
      introPhase = pose.phase;
      controls.enableDamping = false;
      controls.target.set(0, 0, 0);
      camera.position.setFromSphericalCoords(introDistance * pose.radiusScale, Math.PI / 2 - pose.elevation, pose.azimuth);
      renderer.domElement.style.opacity = String(pose.opacity);
      setInteractionAngle(interaction, pose.angle);
      interaction.target = 180;
      view = pose.phase === 'spinning' ? null : 'front';
      if (pose.phase === 'complete') {
        controls.enabled = true;
        controls.enableDamping = true;
      }
    }

    function skipIntro(): void {
      if (disposed || !activeModel || introPhase === 'complete') return;
      introSkipped = true;
      introDistance = viewDestination('front').length();
      introElapsed = INTRO_DURATION;
      applyIntro();
      updateModel(activeModel, 0, performance.now());
      controls.update();
      emitSnapshot();
    }

    function resize(): void {
      if (disposed) return;
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (introPhase !== 'complete') {
        introDistance = viewDestination('front').length();
        if (introPhase !== 'waiting') applyIntro();
      } else if (view) setView(view);
      else {
        // Keep the user's viewing direction, but fit and recenter after a resize.
        const direction = camera.position.clone().sub(controls.target).normalize();
        viewMotion = null;
        controls.enableDamping = false;
        controls.update();
        camera.position.copy(fitDirection(direction));
        controls.target.set(0, 0, 0);
        controls.update();
        controls.enableDamping = true;
      }
      lastTargetFrame = 0;
    }

    function makeButtonTarget(node: THREE.Object3D, resources: Resources): THREE.Mesh {
      const inverse = node.matrixWorld.clone().invert();
      const bounds = new THREE.Box3();
      node.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.computeBoundingBox();
        const box = object.geometry.boundingBox;
        if (box) bounds.union(box.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)));
      });
      if (bounds.isEmpty()) throw new Error(`${node.name} 没有可拾取的网格`);
      bounds.expandByScalar(0.0011);
      const size = bounds.getSize(new THREE.Vector3());
      const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
      const material = new THREE.MeshBasicMaterial({ visible: false });
      resources.geometries.add(geometry);
      trackMaterial(material, resources);
      const target = new THREE.Mesh(geometry, material);
      target.position.copy(bounds.getCenter(new THREE.Vector3()));
      node.add(target);
      return target;
    }

    function prepareModel(gltf: GLTF): PreparedModel {
      const resources = createResources();
      for (const root of gltf.scenes) trackScene(root, resources);
      trackScene(gltf.scene, resources);
      const mixer = new THREE.AnimationMixer(gltf.scene);
      try {
        gltf.scene.removeFromParent();
        const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
        const foldClip = clips.get('Fold');
        if (!foldClip || foldClip.duration <= 0) throw new Error('模型缺少有效的 Fold 动画');
        const fold = mixer.clipAction(foldClip).setLoop(THREE.LoopOnce, 1);
        fold.clampWhenFinished = true;
        fold.play();
        fold.paused = true;
        fold.time = foldClip.duration;
        mixer.update(0);
        gltf.scene.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
        const size = bounds.getSize(new THREE.Vector3());
        if (bounds.isEmpty() || !Number.isFinite(size.length()) || size.length() === 0) throw new Error('模型没有有效的几何范围');
        const reference = normalizationReference ?? { center: bounds.getCenter(new THREE.Vector3()), scale: 3 / Math.max(size.x, size.y, size.z) };
        const normalized = new THREE.Group();
        const centered = new THREE.Group();
        centered.position.copy(reference.center).negate();
        centered.add(gltf.scene);
        normalized.scale.setScalar(reference.scale);
        normalized.add(centered);
        normalized.updateWorldMatrix(true, true);

        const solidMeshes: THREE.Mesh[] = [];
        const screens: ScreenBinding[] = [];
        const offMaterial = new THREE.MeshPhysicalMaterial({ color: 0x020304, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.12 });
        trackMaterial(offMaterial, resources);
        gltf.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          solidMeshes.push(object);
          const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
          const kinds = materials.map((material): ScreenName | null => /^ScreenInner(?:[._]|$)/.test(material.name) ? 'inner' : /^ScreenOuter(?:[._]|$)/.test(material.name) ? 'outer' : null);
          if (kinds.some(Boolean)) screens.push({
            mesh: object, materials, kinds, array: Array.isArray(object.material),
            originalEmissiveMaps: materials.map((material) => material instanceof THREE.MeshStandardMaterial ? material.emissiveMap : null),
          });
        });
        for (const kind of ['inner', 'outer'] as const) {
          if (!screens.some((screen) => screen.kinds.includes(kind))) throw new Error(`模型缺少 ${kind} 屏幕材质`);
        }
        const buttons = new Map<DeviceButtonName, DeviceButton>();
        for (const name of buttonNames) {
          const node = gltf.scene.getObjectByName(`Button${name}`);
          const clip = clips.get(`Press${name}`);
          if (!node || !clip) throw new Error(`模型缺少 ${name} 按钮或按压动画`);
          node.userData.deviceButton = name;
          const materials: DeviceButton['materials'] = [];
          node.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const originals: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
            const clones = originals.map((material) => {
              const clone = material.clone();
              trackMaterial(clone, resources);
              if (hasColor(clone)) materials.push({ material: clone, color: clone.color.clone() });
              return clone;
            });
            object.material = Array.isArray(object.material) ? clones : clones[0]!;
          });
          const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          buttons.set(name, { name, node, action, target: makeButtonTarget(node, resources), materials, highlightUntil: 0 });
        }
        normalizationReference = reference;
        return { object: normalized, size: size.multiplyScalar(reference.scale), scale: reference.scale, mixer, fold, foldDuration: foldClip.duration, screens, offMaterial, screenKey: '', buttons, solidMeshes, resources };
      } catch (cause) {
        mixer.stopAllAction();
        mixer.uncacheRoot(gltf.scene);
        disposeResources(resources);
        throw cause;
      }
    }

    function applyWallpapers(model: PreparedModel): void {
      for (const screen of model.screens) screen.materials.forEach((material, index) => {
        const kind = screen.kinds[index];
        if (!kind || !(material instanceof THREE.MeshStandardMaterial)) return;
        material.emissiveMap = cameraTextures?.[kind] ?? wallpapers[kind] ?? screen.originalEmissiveMaps[index] ?? null;
        material.needsUpdate = true;
      });
    }

    function applyScreens(model: PreparedModel): void {
      const key = interaction.powered ? interaction.screen : 'off';
      if (model.screenKey === key) return;
      for (const screen of model.screens) {
        const materials = screen.materials.map((material, index) => screen.kinds[index] && screen.kinds[index] !== key ? model.offMaterial : material);
        screen.mesh.material = screen.array ? materials : materials[0]!;
      }
      model.screenKey = key;
    }

    function updateModel(model: PreparedModel, seconds: number, now: number): void {
      model.fold.time = interaction.angle / 180 * model.foldDuration;
      model.mixer.update(seconds);
      applyScreens(model);
      for (const button of model.buttons.values()) {
        for (const { material, color } of button.materials) {
          material.color.copy(color);
          if (button.highlightUntil > now) material.color.lerp(pressColor, 0.38);
        }
      }
      model.object.updateWorldMatrix(true, true);
    }

    async function downloadModel(url: string, signal: AbortSignal, id: number): Promise<ArrayBuffer> {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`模型下载失败：HTTP ${response.status}`);
      if (!response.body) return response.arrayBuffer();
      const total = Number(response.headers.get('content-length')) || 0;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          chunks.push(result.value);
          loaded += result.value.byteLength;
          if (!disposed && id === requestId) {
            loadMessage = total ? `正在加载交互模型… ${Math.min(100, Math.round(loaded / total * 100))}%` : `正在加载交互模型… ${(loaded / 1024 / 1024).toFixed(1)} MB`;
            emitSnapshot();
          }
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes.buffer;
    }

    async function loadModel(nextFinish: Finish): Promise<void> {
      if (disposed) return;
      const id = ++requestId;
      requestController?.abort();
      const abortController = new AbortController();
      requestController = abortController;
      lastRequest = nextFinish;
      loading = true;
      error = null;
      loadMessage = '正在加载交互模型…';
      emitSnapshot();
      const stale = (): boolean => disposed || id !== requestId;
      try {
        let model = modelCache.get(nextFinish);
        if (!model) {
          const url = `${import.meta.env.BASE_URL}models/iphone-duo-${nextFinish}-interactive.glb?v=hd-wallpapers-1`;
          const buffer = await downloadModel(url, abortController.signal, id);
          if (stale()) return;
          const resourcePath = new URL('.', new URL(url, window.location.href)).href;
          const gltf = await loader.parseAsync(buffer, resourcePath);
          if (stale()) { disposeGLTF(gltf); return; }
          model = prepareModel(gltf);
          if (stale()) { disposeModel(model); return; }
          modelCache.set(nextFinish, model);
        }
        const firstLoad = !activeModel;
        applyWallpapers(model);
        updateModel(model, 0, performance.now());
        modelContainer.clear();
        modelContainer.add(model.object);
        activeModel = model;
        finish = nextFinish;
        modelSize = model.size;
        buttonTargets = [];
        lastTargetFrame = 0;
        if (firstLoad) introDistance = viewDestination('front').length();
      } catch (cause) {
        if (stale()) return;
        console.error('无法加载 iPhone Duo 交互模型', cause);
        const label = nextFinish === 'star-white' ? '星白色' : '夜空色';
        error = activeModel ? `${label}加载失败，已保留当前模型与交互状态。` : `${label}交互模型加载失败，请重试。`;
      } finally {
        if (!stale()) {
          loading = false;
          loadMessage = '';
          requestController = null;
          emitSnapshot();
        }
      }
    }

    const raycaster = new THREE.Raycaster();
    const visibilityRaycaster = new THREE.Raycaster();
    function resolveButton(object: THREE.Object3D): DeviceButton | null {
      if (!activeModel) return null;
      for (let node: THREE.Object3D | null = object; node; node = node.parent) {
        const name: unknown = node.userData.deviceButton;
        if (typeof name === 'string') {
          const button = [...activeModel.buttons.values()].find((item) => item.name === name);
          if (button) return button;
        }
      }
      return null;
    }

    function firstSurface(ray: THREE.Raycaster): THREE.Intersection | undefined {
      if (!activeModel) return undefined;
      return ray.intersectObjects(activeModel.solidMeshes, false).find(({ object }) => {
        for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
        return true;
      });
    }

    function buttonVisible(button: DeviceButton): boolean {
      const center = button.target.getWorldPosition(new THREE.Vector3());
      visibilityRaycaster.set(camera.position, center.sub(camera.position).normalize());
      const surface = firstSurface(visibilityRaycaster);
      return Boolean(surface && resolveButton(surface.object) === button);
    }

    function pickButton(clientX: number, clientY: number): DeviceButton | null {
      if (!activeModel || disposed || introPhase !== 'complete') return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      raycaster.setFromCamera(new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2), camera);
      const surface = firstSurface(raycaster);
      const direct = surface && resolveButton(surface.object);
      if (direct) return direct;
      const hit = raycaster.intersectObjects([...activeModel.buttons.values()].map((button) => button.target), false)[0];
      if (!hit || (surface && surface.distance + 0.00005 * activeModel.scale < hit.distance)) return null;
      const button = resolveButton(hit.object);
      return button && buttonVisible(button) ? button : null;
    }

    function pressButton(button: DeviceButton): void {
      if (disposed || !activeModel) return;
      pressDeviceButton(interaction, button.name);
      button.action.reset().play();
      button.highlightUntil = performance.now() + 280;
      const isVolume = button.name === 'VolumeUp' || button.name === 'VolumeDown';
      if (button.name === 'Camera') {
        if (preview.status !== 'off') {
          preview.stop();
          showHud('相机已关闭');
        } else {
          interaction.powered = true;
          if (!navigator.mediaDevices?.getUserMedia) showHud('当前环境不支持摄像头，请使用 HTTPS 或 localhost 打开页面。', null, 7000);
          else void preview.start();
        }
      } else {
        if (!interaction.powered) preview.stop();
        showHud(isVolume ? `音量 ${interaction.volume}%` : interaction.powered ? '屏幕已打开' : '屏幕已关闭', isVolume ? interaction.volume : null);
      }
      applyScreens(activeModel);
      lastTargetFrame = 0;
      emitSnapshot();
    }

    let pointer: { id: number; x: number; y: number; time: number; button: DeviceButton | null; dragged: boolean } | null = null;
    const pointers = new Set<number>();
    const eventOptions = { signal: eventController.signal };
    renderer.domElement.addEventListener('pointerdown', (event) => {
      pointers.add(event.pointerId);
      if (pointers.size !== 1 || event.button !== 0) { pointer = null; return; }
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), button: pickButton(event.clientX, event.clientY), dragged: false };
    }, eventOptions);
    renderer.domElement.addEventListener('pointermove', (event) => {
      if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6) pointer.dragged = true;
      if (!pointers.size) renderer.domElement.style.cursor = pickButton(event.clientX, event.clientY) ? 'pointer' : 'grab';
    }, eventOptions);
    renderer.domElement.addEventListener('pointerup', (event) => {
      const click = pointer;
      pointers.delete(event.pointerId);
      pointer = null;
      if (!click || click.id !== event.pointerId || click.dragged || performance.now() - click.time > 800 || !click.button) return;
      if (pickButton(event.clientX, event.clientY) === click.button) pressButton(click.button);
    }, { ...eventOptions, capture: true });
    renderer.domElement.addEventListener('pointercancel', (event) => { pointers.delete(event.pointerId); pointer = null; }, eventOptions);
    renderer.domElement.addEventListener('lostpointercapture', (event) => {
      pointers.delete(event.pointerId);
      if (pointer?.id === event.pointerId) pointer = null;
    }, eventOptions);
    const onOrbitStart = (): void => {
      viewMotion = null;
      controls.enableDamping = true;
      view = null;
      emitSnapshot();
    };
    controls.addEventListener('start', onOrbitStart);
    cleanups.push(() => controls.removeEventListener('start', onOrbitStart));

    function updateButtonTargets(now: number): void {
      if (!activeModel || now - lastTargetFrame < 100) return;
      lastTargetFrame = now;
      const rect = renderer.domElement.getBoundingClientRect();
      buttonTargets = [...activeModel.buttons.values()].map((button) => {
        const point = button.target.getWorldPosition(new THREE.Vector3()).project(camera);
        return {
          name: button.name,
          x: Number((rect.left + (point.x + 1) * rect.width / 2).toFixed(1)),
          y: Number((rect.top + (1 - point.y) * rect.height / 2).toFixed(1)),
          visible: Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && point.z >= -1 && point.z <= 1 && buttonVisible(button),
          pressed: button.highlightUntil > now,
        };
      });
    }

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    cleanups.push(() => observer.disconnect());
    function dispose(): void {
      if (disposed) return;
      disposed = true;
      viewMotion = null;
      requestId += 1;
      renderer.setAnimationLoop(null);
      requestController?.abort();
      requestController = null;
      loadingManager.abort();
      clearTimeout(hudTimeout);
      pointer = null;
      pointers.clear();
      for (const model of modelCache.values()) disposeModel(model);
      modelCache.clear();
      activeModel = null;
      buttonTargets = [];
      modelContainer.clear();
      runCleanups();
    }
    teardown = dispose;

    const controller: ViewerController = {
      startIntro() {
        if (disposed || !activeModel || introPhase !== 'waiting') return;
        introElapsed = 0;
        introDistance = viewDestination('front').length();
        if (reducedMotion.matches) { skipIntro(); return; }
        applyIntro();
        emitSnapshot();
      },
      skipIntro,
      setWallpaper(screen, image) {
        if (disposed) return;
        const previous = wallpapers[screen];
        const texture = image ? new THREE.CanvasTexture(image) : null;
        if (texture) {
          texture.flipY = false;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        }
        wallpapers[screen] = texture;
        for (const model of modelCache.values()) applyWallpapers(model);
        previous?.dispose();
      },
      setFinish(nextFinish) { if (!disposed && introPhase === 'complete') void loadModel(nextFinish); },
      setView(name) { if (introPhase === 'complete') setView(name); },
      setAngle(angle) {
        if (disposed || introPhase !== 'complete' || !Number.isFinite(angle)) return;
        foldFrequency = 48;
        requestFold(interaction, angle);
        if (reducedMotion.matches) setInteractionAngle(interaction, interaction.target);
        emitSnapshot();
      },
      foldTo(target) {
        if (disposed || introPhase !== 'complete') return;
        foldFrequency = 18;
        requestFold(interaction, target);
        if (reducedMotion.matches) setInteractionAngle(interaction, interaction.target);
        emitSnapshot();
      },
      pauseFold() { if (!disposed) { setInteractionAngle(interaction, interaction.angle); emitSnapshot(); } },
      retry() { if (!disposed) void loadModel(lastRequest); },
      dispose,
    };
    resize();
    emitSnapshot();
    void loadModel(lastRequest);
    renderer.setAnimationLoop((now) => {
      if (disposed) return;
      const seconds = Math.min(Math.max((now - lastFrame) / 1000, 0), 0.05);
      lastFrame = now;
      if (introPhase !== 'waiting' && introPhase !== 'complete') {
        if (reducedMotion.matches) skipIntro();
        else {
          introElapsed += seconds;
          applyIntro();
        }
      }
      if (activeModel) {
        if (reducedMotion.matches && interaction.moving) setInteractionAngle(interaction, interaction.target);
        stepFold(interaction, seconds, foldFrequency);
        updateModel(activeModel, seconds, now);
      }
      if (viewMotion && viewMotion.step(seconds, camera.position, controls.target, reducedMotion.matches)) {
        viewMotion = null;
        controls.enableDamping = true;
      }
      controls.update();
      updateCameraCrop();
      renderer.render(scene, camera);
      updateButtonTargets(now);
      emitSnapshot();
    });
    return controller;
  } catch (cause) {
    teardown();
    throw cause;
  }
}
