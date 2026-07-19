# Weblocks V1 浏览器 3D 技术栈与兼容性边界

- 研究日期：2026-07-19
- 决策票据：[研究 V1 浏览器 3D 技术栈与兼容性边界](https://github.com/kassol/Weblocks/issues/11)
- 范围：渲染、鼠标与平板触控、直接操作、glTF、占用空间与连接位可视化；不决定生产架构或性能预算。

## 结论

V1 采用 **vanilla TypeScript + Vite 8.1 + Three.js r185 的 `WebGLRenderer`**。运行时只加入 `three`；开发依赖使用 Vite、TypeScript 与版本匹配的 `@types/three`。使用同包的 `GLTFLoader` 与 `OrbitControls` addon，并直接使用浏览器 Pointer Events。暂不加入 React、React Three Fiber、Babylon.js、WebGPU renderer、物理引擎或碰撞库。[Three.js TypeScript 说明](https://threejs.org/manual/en/installation.html#using-three.js-with-typescript)、[`@types/three` 0.185.1](https://www.npmjs.com/package/@types/three/v/0.185.1)

当前版本基线是 Vite 8.1.5、Three.js r185 / npm 0.185.1；对照项为 Babylon.js 9.9.2 与 React Three Fiber 9.6.1。[Vite 8.1 发布与当前版本](https://vite.dev/blog/announcing-vite8-1)、[Three.js 当前 npm 版本](https://www.npmjs.com/package/three?activeTab=versions)、[Babylon.js 9.9.2 release](https://github.com/BabylonJS/Babylon.js/releases/tag/9.9.2)、[React Three Fiber 9.6.1 release](https://github.com/pmndrs/react-three-fiber/releases/tag/v9.6.1)

这是基于当前需求的推论：三个候选都能完成 V1，但 Three.js 已用一个运行时包覆盖所需渲染与数学原语；另外两项没有减少 Weblocks 必须自行维护的 Build、Part、Mechanical Connection、放置规则和手势状态，反而增加引擎或 reconciler 概念面。

## 最小实现组合

| V1 需求 | 采用能力 | 边界 |
| --- | --- | --- |
| 选中与拖动 Part | 原生 `PointerEvent` + `setPointerCapture()`；Three.js `Raycaster` | Canvas 设 `touch-action: none`；按 `pointerId` 跟踪触点；必须处理 `pointercancel`。[Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)、[Raycaster](https://threejs.org/docs/pages/Raycaster.html) |
| ghost 跟手 | 指针射线与工作平面求交后，更新单个预览 Mesh | touch 的 54px 视觉偏移在换算 NDC 前完成；拖动期间禁用相机控制。透明材质存在排序限制，若出现穿插改用网格线/轮廓 ghost，不引入后处理。[WebGLRenderer 透明排序说明](https://threejs.org/docs/pages/WebGLRenderer.html) |
| 90° 旋转 | Build 状态保存整数 quarter-turn，再生成 Three.js transform | renderer 不是规则真相；旋转按钮/快捷键只发出一次离散操作。 |
| 相机 | `OrbitControls`，Part 拖动时关闭；空白拖动、右键拖动与双指按已决定映射接入 | addon 已支持 orbit、pan、dolly 及可配置 mouse/touch 映射。[OrbitControls](https://threejs.org/docs/pages/OrbitControls.html) |
| Part 外观 | `.glb` / glTF 2.0，由 `GLTFLoader` 加载 | glTF 只描述外观；Occupied Space 与 Connection Point 仍来自 Part Definition。[GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)、[Khronos glTF registry](https://registry.khronos.org/glTF/) |
| Occupied Space | 每个本地 box 生成 `Box3`，套用 Part 世界矩阵后做 box-pair 相交 | `Box3` 是 AABB；V1 仅在轴对齐的 quarter-turn 姿态下把它当精确判定。[Box3](https://threejs.org/docs/pages/Box3.html) |
| Connection Point 可视化 | 小型基础 Mesh + `ArrowHelper` 表示位置、方向和类型 | 类型必须同时用形状/图标表达，不能只靠颜色。[ArrowHelper](https://threejs.org/docs/pages/ArrowHelper.html) |
| 构建工具 | Vite 的 `vanilla-ts` 模板与默认生产构建 | 不加 UI framework；Vite 官方提供 vanilla TypeScript 模板，生产构建输出静态资源。[Vite getting started](https://vite.dev/guide/)、[Vite production build](https://vite.dev/guide/build) |

输入流只需一个明确状态：`idle`、`dragging-part` 或 `moving-camera`。Pointer down 先 raycast；命中 Part 就锁定指针并创建 ghost，否则交给相机。Pointer move 只更新候选 transform，Pointer up 才用 Occupied Space 与 Connection Point 规则原子提交或复原。无需通用状态机库。

## 候选比较

| 候选 | 证据 | 对 V1 的判断 |
| --- | --- | --- |
| Plain Three.js | `Raycaster` 负责 picking；`OrbitControls` 覆盖 mouse/touch 相机；`GLTFLoader` 读 glTF 2.0；`Box3` 提供 AABB 变换与相交；addon 与核心从同一 `three` 包导入。[Raycaster](https://threejs.org/docs/pages/Raycaster.html)、[OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)、[GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)、[Three.js package exports](https://github.com/mrdoob/three.js/blob/r185/package.json) | **采用。** 能力刚好覆盖，Weblocks 规则可保持为 renderer 之外的普通 TypeScript。 |
| Babylon.js | 有 pointer/picking、可附着输入的 camera、glTF loader 与 `BoundingBox.Intersects`；ES module 包支持 tree shaking。[Picking](https://doc.babylonjs.com/features/featuresDeepDive/mesh/interactions/picking_collisions)、[Camera introduction](https://doc.babylonjs.com/features/featuresDeepDive/cameras/camera_introduction)、[glTF loader](https://doc.babylonjs.com/features/featuresDeepDive/importers/glTF)、[BoundingBox](https://doc.babylonjs.com/typedoc/classes/BABYLON.BoundingBox)、[ES6 packages](https://doc.babylonjs.com/setup/frameworkPackages/es6Support) | **不采用。** 技术上完整，但内建 engine/input/gizmo 仍无法替代 Weblocks 特有 ghost、离散旋转和合法性规则；V1 没有需要它额外 engine 能力的需求。若以后确定要一组 Babylon 独有的引擎能力，再整体复评，不做双引擎封装。 |
| React Three Fiber | 是 Three.js 的 React renderer，提供 declarative scene、Canvas 生命周期与基于 raycast 的 pointer event 层；9.6.1 还要求 React 19、Three.js，并自带 Zustand、scheduler 等依赖。[R3F introduction](https://r3f.docs.pmnd.rs/getting-started/introduction)、[R3F events](https://r3f.docs.pmnd.rs/api/events)、[R3F package dependencies](https://github.com/pmndrs/react-three-fiber/blob/v9.6.1/packages/fiber/package.json) | **不采用。** 它不增加 3D 能力，只增加 React reconciler 与第二套事件/生命周期语义。只有当项目先因 DOM UI 独立选择 React，且 scene 组件复用已成为实际负担时再评估。 |

`WebGPURenderer` 也不进入 V1。Three.js 官方将它定位为新的 WebGPU/TSL 路径，并在不支持 WebGPU 时退回 WebGL 2；V1 不使用 compute、node material 或其他 WebGPU 独有能力，因此直接选择 `WebGLRenderer` 更少。[WebGPURenderer overview](https://threejs.org/manual/en/webgpurenderer)、[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)

## 兼容性下限

Three.js `WebGLRenderer` 自 r163 起只支持 WebGL 2；Vite 8 的默认生产目标更低，已覆盖 Chrome 111、Edge 111、Firefox 114 与 Safari 16.4。因此下表是 Weblocks 主动选择的产品与 QA 下限，不是这些 API 的理论最低版本。[Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)、[Vite browser compatibility](https://vite.dev/guide/build#browser-compatibility)

| 路径 | V1 硬下限 | 还必须满足 |
| --- | --- | --- |
| Windows / macOS / ChromeOS 桌面 | Chrome 120+、Edge 120+、Firefox 121+；macOS Safari 17+ | 硬件 WebGL 2；mouse 或 trackpad |
| iPad | iPadOS 17+ 的 Safari 17+ | 硬件 WebGL 2；`navigator.maxTouchPoints >= 2` |
| Android 平板 | Android 12+ 的 Chrome 120+ | 硬件 WebGL 2；`navigator.maxTouchPoints >= 2` |

Chrome/Firefox on iPad、Android Firefox、内嵌 WebView、手机与 WebGL 1 设备不进 V1 保证矩阵；能运行不等于承诺支持。发布测试覆盖上述最低版本以及发布时各浏览器最新稳定版。Vite 不装 legacy plugin，也不生成 WebGL 1 或 2D editor。

这些下限高于底层 API 的历史最低实现：MDN Browser Compatibility Data 记录 WebGL 2 为 Chrome 56、Chrome Android 58、Firefox 51、Safari/iOS 15；Pointer Events 为 Chrome 55、Firefox 59、Safari/iOS 13。[WebGL2 BCD](https://github.com/mdn/browser-compat-data/blob/main/api/WebGL2RenderingContext.json)、[PointerEvent BCD](https://github.com/mdn/browser-compat-data/blob/main/api/PointerEvent.json)、[`setPointerCapture` BCD](https://github.com/mdn/browser-compat-data/blob/main/api/Element.json)、[`touch-action` BCD](https://github.com/mdn/browser-compat-data/blob/main/css/properties/touch-action.json)

启动时仍以能力检测为准，而不是只看 UA：`WebGL.isWebGL2Available()`、`PointerEvent`、`setPointerCapture`、`CSS.supports('touch-action', 'none')`；触控路径另查两个并发触点。Three.js 提供官方 WebGL 2 检测与错误信息 helper。[Three.js WebGL compatibility check](https://threejs.org/manual/en/webgl-compatibility-check.html)

## 降级策略

1. 启动能力检测失败时，不初始化编辑器；显示可理解的“不支持此浏览器/设备”页以及更新浏览器或更换设备的要求。
2. 不降级到 WebGL 1、WebGPU、软件 3D 或 2D 编辑器；四条额外渲染/交互路径都不能证明与 V1 合法性和手势一致。
3. `webglcontextlost` 时立即暂停操作并保留 renderer 之外的 Build 状态；`webglcontextrestored` 后重建 scene 与 GPU 资源。浏览器恢复 context 后，旧 texture/buffer 已无效，必须重建。[MDN `webglcontextrestored`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextrestored_event)
4. 单个 glTF 外观加载失败时，该 Part Definition 不可放置并显示资源错误，不用任意占位视觉冒充该 Part。

## 已知风险与后续验证

- 浏览器版本满足下限仍可能因 GPU、驱动、策略或资源压力拿不到/丢失 WebGL 2 context，所以 runtime gate 与 context restoration 都是必需的。[WebGL 2 context creation](https://registry.khronos.org/webgl/specs/latest/2.0/)、[MDN context loss reasons](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/isContextLost)
- `Box3` 是 AABB。若以后 Connection Point 允许产生非轴对齐姿态，world AABB 会出现误判；届时以真实失败用例为触发点加入 OBB/SAT，V1 不预建。[Three.js `Box3`](https://threejs.org/docs/pages/Box3.html)
- `GLTFLoader` 使用的 image bitmap 不会在失去引用后自动回收；卸载 Part 外观时必须显式释放 texture、material 与 geometry。[Three.js `GLTFLoader`](https://threejs.org/docs/pages/GLTFLoader.html)
- Three.js 版本升级可能包含迁移项；锁定 r185，在一次可运行交互检查通过后才升级，不追随每次 release。[Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
- 帧率、Part 数量、draw call、纹理、低端平板型号与热降频不在本票据定值，由后续 V1 3D 性能预算验证。

## 决策摘要

从 `vanilla-ts` Vite 项目开始，运行时仅安装 `three`，先实现一条端到端切片：一个 glTF Part、mouse/touch raycast、ghost、一次 90° 旋转、OrbitControls、一个 box-union 合法性检查和 Connection Point 标记。该切片在上述桌面与两类平板最低环境通过后，技术栈决策即足够支撑项目开发。
