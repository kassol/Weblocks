# PROTOTYPE — 首次体验

问题：哪种最小首次体验能让 7–10 岁首要玩家独立开始、5 分钟内获得可见成果，并在 15–30 分钟内完成首个挑战？

三个结构不同的方案位于同一路由，通过 `?variant=` 或底部切换器比较：

- `A` — 马上开玩：直接进入挑战，只在需要时给一句提示。
- `B` — 一步一步：任务、步骤、部件和下一步建议始终可见。
- `C` — 先玩再接任务：先自由放一块，取得成果后再邀请进入挑战。

这是一张 2.5D 行为草图；已决定的 3D 镜头和连接细节不在此重新验证。

运行：

```sh
python3 -m http.server 4173
```

打开 <http://127.0.0.1:4173/prototype-first-session-experience/?variant=A>。

最小逻辑检查：

```sh
node prototype-first-session-experience/model.mjs
```
