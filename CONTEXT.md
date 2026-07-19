# Weblocks

Weblocks is a playful construction world where people create structures and solve open-ended problems by connecting extensible parts.

## Language

**部件 (Part)**:
Any placeable unit that can participate in connections. Bricks, wheels, lamps, switches, and fans are all parts.
_Avoid_: 模块, 物件, 元素

**部件定义 (Part Definition)**:
A reusable description shared by parts of one kind, covering appearance, occupied space, connection capabilities, and configurable properties.
_Avoid_: 积木配置, 模块协议, 部件模板

**连接位 (Connection Point)**:
A typed, locally positioned and oriented site on a part where a compatible connection may form, with finite connection capacity.
_Avoid_: 插槽, 接口, 锚点

**机械连接 (Mechanical Connection)**:
An explicit relation between compatible connection points on two parts that fixes their relative placement in V1.
_Avoid_: 父子关系, 吸附, 接触

**占用空间 (Occupied Space)**:
The solid region a part reserves for placement validity, independent of its visible shape.
_Avoid_: 碰撞盒, 模型边界

**积木 (Brick)**:
A structural part used to build form and support other parts through mechanical connections.
_Avoid_: 方块, 结构模块

**挑战 (Challenge)**:
An open-ended problem with an initial scene, an available part set, and success conditions. A challenge may have many valid solutions and never requires copying one target model.
_Avoid_: 问题场景, 关卡

**挑战定义 (Challenge Definition)**:
A portable description of a challenge's initial scene, available parts, success conditions, and metadata.
_Avoid_: 关卡协议, 关卡配置, 题目 JSON

**自由创作 (Free Build)**:
A construction activity without success conditions.
_Avoid_: 沙盒模式, 自由模式

**作品 (Build)**:
An editable set of parts and connections created during free build or a challenge.
_Avoid_: 项目, 模型, 存档

**组件 (Assembly)**:
A maximal group of parts linked by mechanical connections. A build may contain one or more assemblies.
_Avoid_: 部件组, 连通分量

**接地 (Grounded)**:
The condition of an assembly that has at least one part legally touching the workspace ground, without implying structural stability.
_Avoid_: 固定, 稳定, 支撑

**首要玩家 (Primary Player)**:
The player profile whose needs win when V1 interaction and content trade-offs conflict: an independent home user aged 7–10 with basic reading and mouse or touch skills, but no assumed 3D editing experience.
_Avoid_: 目标用户, 核心用户, 儿童用户
