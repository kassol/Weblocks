# Weblocks V1 为未来物理与电学保留的最小扩展边界

## 结论

V1 不需要保存任何物理或电学求解数据。它只需要把作品（Build）保存为一个**有版本、身份稳定、可成环的图**：部件（Part）是节点，连接是带类型的边，边的两端引用部件定义（Part Definition）中有稳定 ID 和完整局部姿态的连接点。

这套骨架足以在以后增量加入铰链、滑轨、电源、灯、风扇、普通开关和双控开关，而不改变 V1 的 `parts + connections` 核心结构。无法承诺永远零迁移；根级版本和扩展机制的作用，是让演进保持增量且可检测，而不是把未来模型猜进 V1。

## 来自现有标准的约束

- SDFormat 把物体和关系分开：`link` 承载视觉、碰撞和惯性信息，`joint` 以类型、父/子端、局部姿态、轴和限位连接两个 `link`。固定、旋转和滑动关系共享同一个关节骨架，动力学参数是其上的增量字段。[SDFormat Link](https://sdformat.org/spec/1.12/link/)、[SDFormat Joint](https://sdformat.org/spec/1.12/joint/)
- 关节轴依赖明确的局部坐标框架；只保存位置或法线不足以无歧义地补上旋转轴、转动方向与零位。[SDFormat model kinematics](https://sdformat.org/tutorials/specification/spec_model_kinematics/)
- Modelica 将物理能力放在组件的连接器中，并由成对的 `connect(a, b)` 合并成连接集；电连接器包含电势和流量语义，但这些是模型定义，不是每次保存都要写入的运行值。[Modelica connectors and connections](https://specification.modelica.org/maint/3.6/connectors-and-connections.html)、[Modelica electrical Pin](https://doc.modelica.org/Modelica%204.0.0/Resources/helpWSM/Modelica/Modelica.Electrical.Analog.Interfaces.Pin.html)
- 双控开关本质上是一个有三个电气端子和一个控制状态的组件，不是一种特殊的“线”；电机基础件可同时暴露两个电气端子和一个旋转机械端口。这说明一个 Part Definition 必须能声明多个、不同领域的连接点，行为留在定义扩展中。[Modelica IdealTwoWaySwitch](https://doc.modelica.org/Modelica%204.0.0/Resources/helpWSM/Modelica/Modelica.Electrical.Analog.Ideal.IdealTwoWaySwitch.html)、[Modelica RotationalEMF](https://doc.modelica.org/Modelica%204.0.0/Resources/helpWSM/Modelica/Modelica.Electrical.Analog.Basic.RotationalEMF.html)
- glTF 固定坐标系与单位，并用根级版本及 `extensionsUsed` / `extensionsRequired` 管理可选能力；它也明确指出显示名称不保证唯一。[glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- 对可编辑对象使用与名称、数组顺序无关的持久 ID 可避免重排或改名使引用失效；UUID 是无需集中注册的标准选择，并应作为不透明值使用。[RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html)

以下均是基于这些标准对 Weblocks 的设计推论。

## V1 必须保留

### Part Definition

1. **稳定且不可变的定义引用**：`definitionId + definitionVersion`。连接点 ID 或行为语义改变时发布新版本；Build 精确引用原版本，显示名称不能充当 ID。
2. **视觉与占用空间分离**：V1 已需要占用空间做非法重叠判断，不要把渲染网格当成唯一几何来源。未来碰撞形状和惯性可以基于占用空间扩展，不必改视觉资源。
3. **命名连接点**：每个连接点至少有稳定 `pointId`、可扩展的 `kind` / 兼容性描述，以及相对 Part 原点的完整局部框架（平移 + 四元数旋转）。精确的机械兼容规则由机械连接决策另行确定。
4. **多个异构连接点**：同一 Part Definition 可同时拥有结构、电气或旋转机械连接点。一个既锁定又导电的实体位置可表示为两个共址、不同类型的连接点，不需要多重含义的特殊字段。
5. **实例属性契约**：定义可配置属性及默认值；V1 的颜色也走同一机制。以后开关初始位置、电机额定值等可新增为定义属性，而不是新增 Part 核心字段。
6. **命名空间扩展槽**：保留可选 `extensions` 对象，不预先定义 `physics`、`electrical` 或行为 DSL。

### Part

1. **持久 `partId`**：复制产生新 ID，移动、旋转、改色和重新保存不改变 ID。
2. **精确 Part Definition 引用**：保存 `definitionId + definitionVersion`，不能只保存目录索引或名称。
3. **完整世界姿态**：平移 + 单位四元数旋转。缩放不进入通用 Part 核心；不同尺寸应是不同 Part Definition，避免连接点和物理尺度被任意缩放。
4. **仅保存用户可编辑属性**：保存相对默认值的实例属性。未来可把开关位置或仿真初始条件放在这里；速度、电流、温度等求解器派生状态不进入 V1 Build。

### 连接

1. **显式保存，不从空间邻近反推**：每条连接有持久 `connectionId`、类型 `kind` 和两个端点；端点格式为 `{ partId, pointId }`。
2. **二元边即可**：SDFormat 关节和 Modelica `connect` 都以两个端点建立关系；多点电气网络可由多条边的连通分量得到。双控开关通过一个三端子的 Part 表示，不需要三端连接记录。
3. **允许图成环**：Parts 与 connections 必须是平坦集合，不能把连接关系塞进只允许树结构的场景父子层级。glTF 场景层级明确要求为无环树，而电路和机械闭环都可能成环。[glTF node hierarchy](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#nodes-and-hierarchy)
4. **合法性按连接类型判断**：不要在核心层写死“每个连接点只能连接一次”或“所有连接都必须空间重合”。结构连接可在 V1 施加这些规则；电气分支、导线或信号连接以后可有不同规则。
5. **类型专属数据走扩展**：V1 只有固定结构连接；未来的轴、限位、阻尼、导线参数等放进该 connection 的命名空间扩展，不增加另一套关系模型。

### Build

1. **根级 `schemaVersion` 与 `buildId`**。
2. **平坦 `parts[]` 与 `connections[]`**，连接是唯一拓扑事实来源；刚性组合、电气网络、岛屿和父子层级均在加载后计算。
3. **固定规范坐标与单位**：协议必须在 V1 定死，不必每个 Build 重复。建议直接采用 glTF 的右手系、+Y 向上、米和弧度，减少模型资源转换歧义。[glTF coordinate system and units](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)
4. **扩展能力声明**：预留根级 `extensionsUsed`、`extensionsRequired` 和命名空间 `extensions`。遇到不支持的 required 扩展应拒绝可编辑加载；可选未知扩展可忽略，但重新保存时必须原样保留。这沿用 glTF 的可检测扩展模式。[glTF extensions](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#specifying-extensions)
5. **定义版本必须可解析**：V1 本地目录保留 Build 所引用的不可变定义版本。未来做导入导出时再决定随包嵌入定义快照还是从目录解析；核心引用无需改变。

最小形状示意如下；空扩展不必实际写入：

```json
{
  "schemaVersion": "1.0",
  "buildId": "<uuid>",
  "parts": [
    {
      "partId": "<uuid>",
      "definition": { "definitionId": "weblocks:brick-2x4", "version": "1" },
      "transform": { "translation": [0, 0, 0], "rotation": [0, 0, 0, 1] },
      "properties": { "color": "blue" }
    }
  ],
  "connections": [
    {
      "connectionId": "<uuid>",
      "kind": "weblocks.mechanical.fixed",
      "a": { "partId": "<uuid>", "pointId": "stud-0" },
      "b": { "partId": "<uuid>", "pointId": "socket-0" }
    }
  ]
}
```

## 可安全延后

- 质量、质心、惯量、摩擦、弹性、重力、刚体分组和碰撞求解参数。
- 铰链/滑轨种类、轴、限位、阻尼、弹簧、马达和约束求解器。
- 电压、电流、电阻、电池容量、灯光功率、导线损耗以及电路求解器。
- 开关方程、灯的“功率到亮度”映射、风扇的电机/叶轮耦合；这些以后作为 Part Definition 行为扩展加入。
- 仿真实时状态、时间步、暂停/回放和状态快照。Build 核心只保存可编辑拓扑、配置与初始条件。
- 导线视觉路径、PCB 走线、扩展注册中心、用户脚本、插件 API、用户上传模型和挑战编辑器。
- 定义快照打包及跨版本迁移器；等 V1 出现第二个真实格式版本或导入导出需求时再实现。SDFormat 同样以根级版本区分可自动转换与不可兼容变化。[SDFormat root version](https://sdformat.org/spec/1.12/sdf/)

## 对未来功能的验证

| 功能 | 在同一核心结构中的表达 |
| --- | --- |
| 旋转/滑动 | 新 connection `kind` + 轴/限位扩展；端点仍是 `{ partId, pointId }` |
| 电池/电源 | 新 Part Definition，两个电气连接点 + 电源行为扩展 |
| 普通开关 | 新 Part Definition，两个电气连接点 + 一个可编辑初始位置 |
| 双控开关 | 新 Part Definition，三个电气连接点 + 一个可编辑初始位置 |
| 灯 | 两个电气连接点；行为扩展把求解功率映射为发光表现 |
| 风扇 | 两个电气连接点 + 一个旋转机械连接点；行为扩展耦合电气与机械域 |

因此，V1 的不可退让边界只有四项：稳定身份、完整局部连接框架、显式可成环的类型化连接图、版本化扩展机制。其余仿真细节都应等真实功能到来后再定义。
