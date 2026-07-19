import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { assess, BUDGET, type PerformanceSample } from "./budget.ts";
import "./style.css";

const PRESETS = {
  light: { label: "轻量", parts: 100, points: 400 },
  candidate: { label: "候选", parts: 250, points: 1000 },
  stretch: { label: "拉伸", parts: 500, points: 2000 },
  extreme: { label: "极限", parts: 1000, points: 4000 }
} as const;
type PresetKey = keyof typeof PRESETS;

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const metrics = document.querySelector<HTMLDListElement>("#metrics")!;
const verdict = document.querySelector<HTMLDivElement>("#verdict")!;
const presetHost = document.querySelector<HTMLDivElement>("#presets")!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07131f);
scene.fog = new THREE.Fog(0x07131f, 32, 70);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 120);
camera.position.set(18, 20, 25);
scene.add(new THREE.HemisphereLight(0xbce9ff, 0x132b3d, 2.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.8);
sun.position.set(8, 18, 10);
scene.add(sun);
scene.add(new THREE.GridHelper(70, 70, 0x2d6c91, 0x18384d));

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1, 0);
controls.maxPolarAngle = Math.PI * 0.48;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.35);
const hit = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3(1, 1, 1);
const bodyDimensions = [[1.5, .6, .8], [.8, .8, .8], [2.2, .4, .8], [.8, 1.2, .8]] as const;
const colors = [0x35a7ff, 0xffb229, 0xff5d7a, 0x7cdd77];
let partMeshes: THREE.InstancedMesh[] = [];
let detailMeshes: THREE.InstancedMesh[] = [];
let pointMesh: THREE.InstancedMesh | null = null;
let occupiedBoxes = new Float32Array();
let activePreset: PresetKey = "candidate";
let inputPendingAt: number | null = null;
let firstRenderedAt = 0;
let hovered = false;

const ghostMaterial = new THREE.MeshStandardMaterial({ color: 0x44e5a5, transparent: true, opacity: .58, roughness: .45 });
const ghost = new THREE.Mesh(new THREE.BoxGeometry(1.5, .6, .8), ghostMaterial);
ghost.visible = false;
scene.add(ghost);

const frameSamples: number[] = [];
const inputSamples: number[] = [];
const candidateSamples: number[] = [];
let lastFrameAt = performance.now();
let lastPanelAt = 0;

function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function remember(values: number[], value: number, limit = 240) {
  values.push(value);
  if (values.length > limit) values.splice(0, values.length - limit);
}

function disposeMeshes(meshes: THREE.InstancedMesh[]) {
  for (const mesh of meshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
}

function rebuild(key: PresetKey) {
  activePreset = key;
  const preset = PRESETS[key];
  disposeMeshes(partMeshes);
  disposeMeshes(detailMeshes);
  if (pointMesh) {
    scene.remove(pointMesh);
    pointMesh.geometry.dispose();
    (pointMesh.material as THREE.Material).dispose();
  }
  partMeshes = [];
  detailMeshes = [];
  occupiedBoxes = new Float32Array(preset.parts * 12);
  const perType = Array.from({ length: 4 }, (_, type) => Math.floor((preset.parts + 3 - type) / 4));
  const typeOffsets = [0, 0, 0, 0];
  const gridWidth = Math.ceil(Math.sqrt(preset.parts));

  perType.forEach((count, type) => {
    const [width, height, depth] = bodyDimensions[type];
    const body = new THREE.InstancedMesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: colors[type], roughness: .58, metalness: .03 }),
      count
    );
    const details = new THREE.InstancedMesh(
      new THREE.SphereGeometry(.18, 12, 6),
      new THREE.MeshStandardMaterial({ color: colors[type], roughness: .5 }),
      count * 2
    );
    body.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    details.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    body.userData.type = type;
    partMeshes.push(body);
    detailMeshes.push(details);
    scene.add(body, details);
  });

  for (let index = 0; index < preset.parts; index++) {
    const type = index % 4;
    const [baseWidth, height, baseDepth] = bodyDimensions[type];
    const quarterTurn = index % 3 === 0;
    const width = quarterTurn ? baseDepth : baseWidth;
    const depth = quarterTurn ? baseWidth : baseDepth;
    const x = (index % gridWidth - gridWidth / 2) * 2.45;
    const z = (Math.floor(index / gridWidth) - gridWidth / 2) * 2.15;
    const y = height / 2 + (index % 11 === 0 ? .8 : 0);
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), quarterTurn ? Math.PI / 2 : 0);
    matrix.compose(position.set(x, y, z), rotation, scale);
    const instance = typeOffsets[type]++;
    partMeshes[type].setMatrixAt(instance, matrix);
    for (let stud = 0; stud < 2; stud++) {
      const offset = (stud ? .25 : -.25) * width;
      matrix.compose(position.set(x + offset, y + height / 2, z), rotation, scale);
      detailMeshes[type].setMatrixAt(instance * 2 + stud, matrix);
    }
    const start = index * 12;
    for (let half = 0; half < 2; half++) {
      const halfWidth = width / 2;
      const centerX = x + (half ? .25 : -.25) * width;
      const offset = start + half * 6;
      occupiedBoxes.set([centerX - halfWidth / 2, y - height / 2, z - depth / 2, centerX + halfWidth / 2, y + height / 2, z + depth / 2], offset);
    }
  }
  [...partMeshes, ...detailMeshes].forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });

  pointMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(.11, .32, 8),
    new THREE.MeshStandardMaterial({ color: 0xf8ff74, emissive: 0x465000, roughness: .45 }),
    preset.points
  );
  for (let index = 0; index < preset.points; index++) {
    const part = index % preset.parts;
    const x = (part % gridWidth - gridWidth / 2) * 2.45 + ((index % 4) - 1.5) * .22;
    const z = (Math.floor(part / gridWidth) - gridWidth / 2) * 2.15;
    matrix.compose(position.set(x, 1.15 + (index % 3) * .08, z), rotation.identity(), scale);
    pointMesh.setMatrixAt(index, matrix);
  }
  pointMesh.instanceMatrix.needsUpdate = true;
  scene.add(pointMesh);
  frameSamples.length = inputSamples.length = candidateSamples.length = 0;
  history.replaceState(null, "", `?preset=${key}`);
  renderPresetButtons();
}

function candidateIsClear(x: number, z: number) {
  const minX = x - .75, maxX = x + .75, minY = 0, maxY = .6, minZ = z - .4, maxZ = z + .4;
  for (let offset = 0; offset < occupiedBoxes.length; offset += 6) {
    if (maxX > occupiedBoxes[offset] && minX < occupiedBoxes[offset + 3]
      && maxY > occupiedBoxes[offset + 1] && minY < occupiedBoxes[offset + 4]
      && maxZ > occupiedBoxes[offset + 2] && minZ < occupiedBoxes[offset + 5]) return false;
  }
  return true;
}

function updatePointer(event: PointerEvent) {
  if (inputPendingAt == null) inputPendingAt = performance.now();
  const rect = canvas.getBoundingClientRect();
  const visualY = event.pointerType === "touch" ? event.clientY - 54 : event.clientY;
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((visualY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const started = performance.now();
  raycaster.intersectObjects(partMeshes, false);
  if (raycaster.ray.intersectPlane(groundPlane, hit)) {
    const x = Math.round(hit.x * 2) / 2;
    const z = Math.round(hit.z * 2) / 2;
    const clear = candidateIsClear(x, z);
    ghost.position.set(x, .3, z);
    ghostMaterial.color.setHex(clear ? 0x44e5a5 : 0xff5d73);
    ghost.visible = true;
    hovered = clear;
  }
  remember(candidateSamples, performance.now() - started);
}

function renderPresetButtons() {
  presetHost.replaceChildren(...Object.entries(PRESETS).map(([key, preset]) => {
    const button = document.createElement("button");
    button.textContent = `${preset.label}\n${preset.parts}`;
    button.setAttribute("aria-pressed", String(key === activePreset));
    button.onclick = () => rebuild(key as PresetKey);
    return button;
  }));
}

function metric(label: string, value: string, passed?: boolean) {
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  if (passed != null) dd.className = passed ? "good" : "bad";
  return [dt, dd];
}

function updatePanel() {
  const preset = PRESETS[activePreset];
  const averageFrame = frameSamples.reduce((sum, value) => sum + value, 0) / Math.max(frameSamples.length, 1);
  const transferKb = performance.getEntriesByType("resource").reduce((sum, entry) => sum + ((entry as PerformanceResourceTiming).transferSize || 0), 0) / 1024;
  const sample: PerformanceSample = {
    parts: preset.parts,
    connectionPoints: preset.points,
    fps: averageFrame ? 1000 / averageFrame : 0,
    frameP95Ms: quantile(frameSamples, .95),
    inputP95Ms: quantile(inputSamples, .95),
    candidateP95Ms: quantile(candidateSamples, .95),
    interactiveMs: firstRenderedAt,
    initialTransferKiB: transferKb
  };
  const result = assess(sample);
  const ready = frameSamples.length >= 120 && inputSamples.length >= 12;
  verdict.className = `verdict ${ready ? (result.passed ? "pass" : "fail") : "waiting"}`;
  verdict.textContent = ready ? (result.passed ? "候选预算：当前设备通过" : "候选预算：当前设备不通过") : `采样中：帧 ${frameSamples.length}/120，输入 ${inputSamples.length}/12`;
  metrics.replaceChildren(
    ...metric("Part", `${preset.parts} / ${BUDGET.parts}`, result.gates.parts),
    ...metric("Connection Point", `${preset.points} / ${BUDGET.connectionPoints}`, result.gates.connectionPoints),
    ...metric("平均 FPS", `${sample.fps.toFixed(1)} / ≥${BUDGET.minimumFps}`, result.gates.fps),
    ...metric("帧耗时 p95", `${sample.frameP95Ms.toFixed(1)} / ≤${BUDGET.maximumFrameP95Ms} ms`, result.gates.frameP95),
    ...metric("输入到画面 p95", inputSamples.length ? `${sample.inputP95Ms.toFixed(1)} / ≤${BUDGET.maximumInputP95Ms} ms` : "等待指针", inputSamples.length ? result.gates.input : undefined),
    ...metric("候选计算 p95", candidateSamples.length ? `${sample.candidateP95Ms.toFixed(2)} / ≤${BUDGET.maximumCandidateP95Ms} ms` : "等待指针", candidateSamples.length ? result.gates.candidate : undefined),
    ...metric("首帧", `${sample.interactiveMs.toFixed(0)} / ≤${BUDGET.maximumInteractiveMs} ms`, result.gates.interactive),
    ...metric("初始传输", `${transferKb.toFixed(0)} / ≤${BUDGET.maximumInitialTransferKiB} KiB`, result.gates.transfer),
    ...metric("draw calls / triangles", `${renderer.info.render.calls} / ${renderer.info.render.triangles.toLocaleString()}`),
    ...metric("DPR / ghost", `${renderer.getPixelRatio().toFixed(1)} / ${hovered ? "可放" : "冲突"}`)
  );
}

function animate(now: number) {
  const elapsed = now - lastFrameAt;
  lastFrameAt = now;
  if (elapsed > 0 && elapsed < 200) remember(frameSamples, elapsed);
  if (inputPendingAt != null) {
    remember(inputSamples, now - inputPendingAt);
    inputPendingAt = null;
  }
  controls.update();
  renderer.render(scene, camera);
  if (!firstRenderedAt) firstRenderedAt = performance.now();
  if (now - lastPanelAt > 250) {
    updatePanel();
    lastPanelAt = now;
  }
}

canvas.addEventListener("pointermove", updatePointer);
canvas.addEventListener("pointercancel", () => { inputPendingAt = null; ghost.visible = false; });
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});
document.addEventListener("visibilitychange", () => {
  lastFrameAt = performance.now();
  frameSamples.length = inputSamples.length = candidateSamples.length = 0;
});

const requested = new URLSearchParams(location.search).get("preset") as PresetKey | null;
rebuild(requested && requested in PRESETS ? requested : "candidate");
renderer.setAnimationLoop(animate);
