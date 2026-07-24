import * as THREE from "three";
import type { BuildDocument, PartInstance, Transform } from "../build/document.js";
import type { DefinitionRegistry } from "../definitions/registry.js";
import { worldConnectionPoint, worldOccupiedBoxes } from "../build/core.js";
import { MECHANICAL_FIXED_KIND, type PartDefinition } from "../definitions/types.js";
import type { AxisAlignedBox } from "../math/box.js";
import type { Vec3 } from "../math/types.js";
import type { HitTarget } from "./pointer-semantics.js";

const DPR_CAP = 1.5;

export type EditorAdapterOptions = {
  readonly canvas: HTMLCanvasElement;
  readonly registry: DefinitionRegistry;
};

export type ZoneVisual = {
  readonly zoneId: string;
  readonly label: string;
  readonly icon: string;
  readonly color: string;
  readonly volumes: readonly AxisAlignedBox[];
};

export class ThreeEditorAdapter {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera: THREE.PerspectiveCamera;
  readonly #raycaster = new THREE.Raycaster();
  readonly #pointer = new THREE.Vector2();
  readonly #registry: DefinitionRegistry;
  readonly #root = new THREE.Group();
  readonly #partsGroup = new THREE.Group();
  readonly #ghostGroup = new THREE.Group();
  readonly #zonesGroup = new THREE.Group();
  readonly #sceneryGroup = new THREE.Group();
  readonly #zoneResources: { dispose(): void }[] = [];
  readonly #sceneryResources: { dispose(): void }[] = [];
  readonly #ground: THREE.Mesh;
  readonly #geometryCache = new Map<string, THREE.BoxGeometry>();
  readonly #materialCache = new Map<string, THREE.MeshLambertMaterial>();
  readonly #connectionGeometry: THREE.SphereGeometry;
  readonly #connectionMesh: THREE.InstancedMesh;
  #connectionCount = 0;
  #yaw = 0.7;
  #pitch = 0.55;
  #distance = 14;
  #animation = 0;
  #disposed = false;

  constructor(options: EditorAdapterOptions) {
    this.#registry = options.registry;
    this.#scene.background = new THREE.Color(0xe8f2fa);
    this.#camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.#renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.#renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, DPR_CAP));
    this.#renderer.shadowMap.enabled = false;

    this.#ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshLambertMaterial({ color: 0xd5e6f2 }),
    );
    this.#ground.rotation.x = -Math.PI / 2;
    this.#ground.receiveShadow = false;
    this.#ground.name = "ground";
    this.#scene.add(this.#ground);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xb0c4d8, 1.1);
    this.#scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.55);
    key.position.set(8, 14, 6);
    this.#scene.add(key);

    this.#connectionGeometry = new THREE.SphereGeometry(0.08, 8, 8);
    this.#connectionMesh = new THREE.InstancedMesh(
      this.#connectionGeometry,
      new THREE.MeshLambertMaterial({ color: 0xffd24a }),
      1000,
    );
    this.#connectionMesh.count = 0;
    this.#connectionMesh.frustumCulled = false;

    this.#root.add(this.#sceneryGroup);
    this.#root.add(this.#zonesGroup);
    this.#root.add(this.#partsGroup);
    this.#root.add(this.#ghostGroup);
    this.#root.add(this.#connectionMesh);
    this.#scene.add(this.#root);

    this.#updateCamera();
    this.#bindContextLoss(options.canvas);
  }

  start(): void {
    const tick = () => {
      if (this.#disposed) return;
      this.#animation = requestAnimationFrame(tick);
      this.#renderer.render(this.#scene, this.#camera);
    };
    tick();
  }

  resize(width: number, height: number): void {
    this.#camera.aspect = width / Math.max(height, 1);
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(width, height, false);
    this.#renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, DPR_CAP));
  }

  orbit(deltaX: number, deltaY: number): void {
    this.#yaw -= deltaX * 0.005;
    this.#pitch = Math.min(1.2, Math.max(0.15, this.#pitch + deltaY * 0.005));
    this.#updateCamera();
  }

  syncBuild(build: BuildDocument, options?: { hidePartId?: string }): void {
    this.#clearGroup(this.#partsGroup);
    this.#connectionCount = 0;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (const part of build.parts) {
      if (options?.hidePartId && part.id === options.hidePartId) continue;
      const definition = this.#registry.resolvePart(part.definition);
      if (!definition) continue;
      this.#partsGroup.add(this.#createPartMesh(part, definition, false));
      for (const point of definition.connectionPoints) {
        if (point.kind !== MECHANICAL_FIXED_KIND) continue;
        if (this.#connectionCount >= 1000) break;
        const world = worldConnectionPoint(part, point);
        matrix.makeTranslation(world.position[0], world.position[1], world.position[2]);
        this.#connectionMesh.setMatrixAt(this.#connectionCount, matrix);
        this.#connectionMesh.setColorAt?.(this.#connectionCount, color.set(0xffd24a));
        this.#connectionCount += 1;
      }
    }
    this.#connectionMesh.count = this.#connectionCount;
    this.#connectionMesh.instanceMatrix.needsUpdate = true;
    if (this.#connectionMesh.instanceColor) this.#connectionMesh.instanceColor.needsUpdate = true;
  }

  /** Zone visuals combine color, stripe pattern, outline, and an icon+text plate. */
  syncZones(zones: readonly ZoneVisual[]): void {
    this.#clearGroup(this.#zonesGroup);
    for (const resource of this.#zoneResources.splice(0)) resource.dispose();
    for (const zone of zones) {
      const color = new THREE.Color(zone.color);
      for (const volume of zone.volumes) {
        const size = boxSize(volume);
        const center = boxCenter(volume);
        const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
        const texture = this.#stripeTexture(zone.color);
        const fill = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geometry, fill);
        mesh.position.set(center[0], center[1], center[2]);
        this.#zonesGroup.add(mesh);

        const edgeGeometry = new THREE.EdgesGeometry(geometry);
        const edgeMaterial = new THREE.LineBasicMaterial({ color });
        const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        edges.position.copy(mesh.position);
        this.#zonesGroup.add(edges);
        this.#zoneResources.push(geometry, texture, fill, edgeGeometry, edgeMaterial);
      }

      const first = zone.volumes[0];
      if (!first) continue;
      const center = boxCenter(first);
      const labelTexture = this.#labelTexture(`${zone.icon} ${zone.label}`.trim(), zone.color);
      const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(labelMaterial);
      sprite.position.set(center[0], first.max[1] + 0.55, center[2]);
      sprite.scale.set(2.4, 0.9, 1);
      this.#zonesGroup.add(sprite);
      this.#zoneResources.push(labelTexture, labelMaterial);
    }
  }

  syncWater(volumes: readonly AxisAlignedBox[]): void {
    this.#clearGroup(this.#sceneryGroup);
    for (const resource of this.#sceneryResources.splice(0)) resource.dispose();
    for (const volume of volumes) {
      const size = boxSize(volume);
      const center = boxCenter(volume);
      const geometry = new THREE.BoxGeometry(size[0], Math.max(size[1], 0.04), size[2]);
      const material = new THREE.MeshLambertMaterial({ color: 0x4aa3e0, transparent: true, opacity: 0.65 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(center[0], center[1] + 0.01, center[2]);
      this.#sceneryGroup.add(mesh);
      this.#sceneryResources.push(geometry, material);
    }
  }

  /** Read-only projection for scripted acceptance journeys. */
  worldToClient(point: Vec3, canvas: HTMLCanvasElement): { x: number; y: number } | undefined {
    const projected = new THREE.Vector3(point[0], point[1], point[2]).project(this.#camera);
    if (projected.z > 1) return undefined;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }

  syncGhost(part: PartInstance | undefined, legal: boolean): void {
    this.#clearGroup(this.#ghostGroup);
    if (!part) return;
    const definition = this.#registry.resolvePart(part.definition);
    if (!definition) return;
    this.#ghostGroup.add(this.#createPartMesh(part, definition, true, legal));
  }

  hitTest(clientX: number, clientY: number, canvas: HTMLCanvasElement): HitTarget {
    const rect = canvas.getBoundingClientRect();
    this.#pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.#pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);

    const partHits = this.#raycaster.intersectObjects(this.#partsGroup.children, true);
    for (const hit of partHits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        if (obj.userData.partId) {
          return {
            type: "part",
            partId: String(obj.userData.partId),
            position: [hit.point.x, hit.point.y, hit.point.z],
          };
        }
        obj = obj.parent;
      }
    }

    const groundHits = this.#raycaster.intersectObject(this.#ground);
    if (groundHits[0]) {
      const point = groundHits[0].point;
      return { type: "ground", position: [point.x, 0, point.z] };
    }
    return { type: "empty" };
  }

  groundPosition(clientX: number, clientY: number, canvas: HTMLCanvasElement): Vec3 | undefined {
    const hit = this.hitTest(clientX, clientY, canvas);
    if (hit.type === "ground" || hit.type === "part") {
      return [hit.position[0], 0, hit.position[2]];
    }
    return undefined;
  }

  dispose(): void {
    this.#disposed = true;
    cancelAnimationFrame(this.#animation);
    this.syncZones([]);
    this.syncWater([]);
    this.#renderer.dispose();
    this.#connectionGeometry.dispose();
    for (const geometry of this.#geometryCache.values()) geometry.dispose();
    for (const material of this.#materialCache.values()) material.dispose();
  }

  /** Rebuild projection after WebGL context restoration from the same Build. */
  restoreFromBuild(build: BuildDocument): void {
    this.syncBuild(build);
    this.syncGhost(undefined, false);
  }

  #updateCamera(): void {
    const x = Math.cos(this.#pitch) * Math.sin(this.#yaw) * this.#distance;
    const y = Math.sin(this.#pitch) * this.#distance;
    const z = Math.cos(this.#pitch) * Math.cos(this.#yaw) * this.#distance;
    this.#camera.position.set(x, y, z);
    this.#camera.lookAt(0, 0.4, 0);
  }

  #createPartMesh(part: PartInstance, definition: PartDefinition, ghost: boolean, legal = true): THREE.Group {
    const group = new THREE.Group();
    group.userData.partId = part.id;
    group.position.set(part.transform.position[0], part.transform.position[1], part.transform.position[2]);
    group.quaternion.set(
      part.transform.rotation[0],
      part.transform.rotation[1],
      part.transform.rotation[2],
      part.transform.rotation[3],
    );

    const colorValue = typeof part.properties.color === "string" ? part.properties.color : "#e04f3f";
    for (const [index, box] of definition.occupiedSpace.entries()) {
      const size: Vec3 = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
      const center: Vec3 = [
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2,
      ];
      const key = `${size[0]}x${size[1]}x${size[2]}`;
      let geometry = this.#geometryCache.get(key);
      if (!geometry) {
        geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
        this.#geometryCache.set(key, geometry);
      }
      const materialKey = ghost ? `ghost-${legal ? "ok" : "bad"}` : colorValue;
      let material = this.#materialCache.get(materialKey);
      if (!material) {
        material = new THREE.MeshLambertMaterial({
          color: ghost ? (legal ? 0x2ecc71 : 0xe74c3c) : colorValue,
          transparent: ghost,
          opacity: ghost ? 0.55 : 1,
          wireframe: false,
        });
        if (ghost && !legal) {
          // Illegal preview also uses a denser emissive cue (non-color-only with pattern via wireframe edge).
          material.emissive = new THREE.Color(0x4a1010);
        }
        this.#materialCache.set(materialKey, material);
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(center[0], center[1], center[2]);
      mesh.userData.partId = part.id;
      mesh.name = `part-${part.id}-${index}`;
      group.add(mesh);
    }

    if (ghost && !legal) {
      // Diagonal stripe proxy: a second translucent box rotated for pattern feedback.
      const stripe = new THREE.Mesh(
        this.#geometryCache.values().next().value ?? new THREE.BoxGeometry(1, 0.05, 1),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, wireframe: true }),
      );
      stripe.position.y = 0.35;
      group.add(stripe);
    }

    void worldOccupiedBoxes;
    return group;
  }

  #clearGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      group.remove(group.children[0]!);
    }
  }

  #stripeTexture(color: string): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.strokeStyle = color;
    context.lineWidth = 8;
    for (let offset = -64; offset < 128; offset += 20) {
      context.beginPath();
      context.moveTo(offset, 64);
      context.lineTo(offset + 64, 0);
      context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  #labelTexture(text: string, color: string): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 120;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ffffffee";
    context.strokeStyle = color;
    context.lineWidth = 8;
    context.beginPath();
    context.roundRect(6, 6, canvas.width - 12, canvas.height - 12, 26);
    context.fill();
    context.stroke();
    context.fillStyle = color;
    context.font = "700 52px 'Avenir Next', 'Segoe UI', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
    return new THREE.CanvasTexture(canvas);
  }

  #bindContextLoss(canvas: HTMLCanvasElement): void {
    canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
      },
      false,
    );
  }
}

function boxSize(volume: AxisAlignedBox): Vec3 {
  return [volume.max[0] - volume.min[0], volume.max[1] - volume.min[1], volume.max[2] - volume.min[2]];
}

function boxCenter(volume: AxisAlignedBox): Vec3 {
  return [
    (volume.min[0] + volume.max[0]) / 2,
    (volume.min[1] + volume.max[1]) / 2,
    (volume.min[2] + volume.max[2]) / 2,
  ];
}

export function transformOnGround(position: Vec3, yawTurns: number, rotation: Transform["rotation"]): Transform {
  return {
    position: [snap(position[0]), 0, snap(position[2])],
    rotation,
  };
}

function snap(value: number): number {
  return Math.round(value * 2) / 2;
}
