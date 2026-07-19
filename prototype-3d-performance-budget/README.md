# PROTOTYPE — V1 3D 性能预算

问题：使用选定的 Three.js WebGL2 技术栈时，V1 同时支持多少 Part 与可见 Connection Point，仍能保持可用帧率、跟手响应和可接受初始加载？

这是一次性浏览器压力台，不是生产渲染器。它用四类低多边形 InstancedMesh Part、每个 Part 两个 Occupied Space box、可见 Connection Point、raycast、ghost 和逐 box 候选检查模拟核心编辑循环；不含动态阴影、后处理或真实 glTF 纹理。

安装一次依赖：

```sh
npm install --prefix prototype-3d-performance-budget
```

一个命令运行：

```sh
npm run dev --prefix prototype-3d-performance-budget
```

最小检查：

```sh
npm run check --prefix prototype-3d-performance-budget
```

默认打开候选档：250 个 Part、1000 个 Connection Point。移动鼠标或手指直到帧样本达到 120、输入样本达到 12；再比较轻量、拉伸与极限档。

候选硬门槛：平均 45 FPS、p95 帧耗时 34ms、p95 输入到画面 50ms、p95 候选计算 8ms、首帧 3 秒、首个 Challenge 必需资源初始压缩传输 1.5 MiB。该上限假设 DPR 封顶 1.5、共享几何/材质、无动态阴影；若生产视觉超过这些边界，必须重跑压力台后再扩大承诺。
