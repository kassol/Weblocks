// PROTOTYPE — pure success-condition evaluator; keep I/O in cli.mjs.

const axes = [0, 1, 2];

function overlaps(a, b) {
  return axes.every(axis => a.min[axis] < b.max[axis] && a.max[axis] > b.min[axis]);
}

function projectedCenterInside(part, zone) {
  const x = (part.space.min[0] + part.space.max[0]) / 2;
  const z = (part.space.min[2] + part.space.max[2]) / 2;
  return x > zone.min[0] && x < zone.max[0] && z > zone.min[2] && z < zone.max[2];
}

function assemblies(build) {
  const neighbours = new Map(build.parts.map(part => [part.id, []]));
  for (const [left, right] of build.connections) {
    neighbours.get(left).push(right);
    neighbours.get(right).push(left);
  }

  const seen = new Set();
  return build.parts.flatMap(part => {
    if (seen.has(part.id)) return [];
    const ids = [], pending = [part.id];
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id); ids.push(id); pending.push(...neighbours.get(id));
    }
    return [ids];
  });
}

function evaluateCondition(condition, challenge, build, mode) {
  const zones = Object.fromEntries(challenge.zones.map(zone => [zone.id, zone.space]));
  const playerParts = build.parts.filter(part => part.source === "player");

  if (condition.type === "assembly-spans-zones") {
    if (mode === "naive") {
      const passed = condition.zones.every(zoneId => build.parts.some(part => overlaps(part.space, zones[zoneId])));
      return { passed, detail: passed ? "每个区域都被某个部件占用（未检查是否属于同一组件）" : "至少一个区域没有部件" };
    }

    const partsById = new Map(build.parts.map(part => [part.id, part]));
    const spanning = assemblies(build).find(ids => condition.zones.every(zoneId => ids.some(id => overlaps(partsById.get(id).space, zones[zoneId]))));
    return { passed: Boolean(spanning), detail: spanning ? `组件 [${spanning.join(", ")}] 覆盖全部区域` : "没有单一组件覆盖全部区域" };
  }

  if (condition.type === "parts-share-assembly") {
    if (mode === "naive") {
      const passed = condition.parts.every(id => build.parts.some(part => part.id === id));
      return { passed, detail: passed ? "目标部件都存在（未检查机械连接）" : "至少一个目标部件不存在" };
    }

    const shared = assemblies(build).find(ids => condition.parts.every(id => ids.includes(id)));
    return { passed: Boolean(shared), detail: shared ? `目标部件同属组件 [${shared.join(", ")}]` : "目标部件不在同一组件" };
  }

  if (condition.type === "player-parts-clear-zone") {
    const blocked = mode === "naive"
      ? playerParts.filter(part => projectedCenterInside(part, zones[condition.zone]))
      : playerParts.filter(part => overlaps(part.space, zones[condition.zone]));
    return {
      passed: blocked.length === 0,
      detail: blocked.length ? `${blocked.map(part => part.id).join(", ")} 进入区域 ${condition.zone}` : `玩家部件避开区域 ${condition.zone}`
    };
  }

  const count = mode === "naive" ? build.parts.length : playerParts.length;
  const passed = count >= (condition.min ?? 0) && count <= (condition.max ?? Infinity);
  return { passed, detail: `${mode === "naive" ? "全部" : "玩家添加"}部件 ${count} 个，要求 ${condition.min ?? 0}–${condition.max ?? "∞"}` };
}

export function evaluateChallenge(challenge, build, mode = "proposed") {
  const results = challenge.conditions.map(condition => ({
    condition,
    ...evaluateCondition(condition, challenge, build, mode)
  }));
  return { passed: results.every(result => result.passed), results };
}

const zone = (id, min, max) => ({ id, space: { min, max } });
const part = (id, source, min, max) => ({ id, source, space: { min, max } });

export const experiments = [
  {
    id: "connect-two-zones",
    name: "连接两端",
    question: "两个区域必须由同一个组件覆盖；多个互不相连的部件不能凑数。",
    zones: [zone("left", [-4, 0, -1], [-3, 2, 1]), zone("right", [3, 0, -1], [4, 2, 1])],
    conditions: [{ type: "assembly-spans-zones", zones: ["left", "right"] }],
    cases: [
      {
        name: "三段式连接",
        summary: "三个玩家部件形成一条机械连接链，分别抵达左右区域。",
        probe: "这是明显的正确解。",
        expected: true,
        build: {
          parts: [
            part("a", "player", [-3.6, 0, -.4], [-1, .5, .4]),
            part("b", "player", [-1, 0, -.4], [1, .5, .4]),
            part("c", "player", [1, 0, -.4], [3.6, .5, .4])
          ],
          connections: [["a", "b"], ["b", "c"]]
        }
      },
      {
        name: "两座分离的塔",
        summary: "左右区域各有一个玩家部件，但两者没有机械连接。",
        probe: "只占住两个区域不应算连接成功。",
        expected: false,
        build: {
          parts: [
            part("left-tower", "player", [-3.6, 0, -.4], [-3.1, 1, .4]),
            part("right-tower", "player", [3.1, 0, -.4], [3.6, 1, .4])
          ],
          connections: []
        }
      },
      {
        name: "单个部件覆盖两区",
        summary: "单个部件的占用空间同时抵达左右区域；条件不关心它有几个单位长。",
        probe: "候选语义只看占用空间与区域的关系，不把“长”当作部件类型。",
        expected: true,
        build: {
          parts: [part("spanning-part", "player", [-3.5, 0, -.3], [3.5, .5, .3])],
          connections: []
        }
      }
    ]
  },
  {
    id: "avoid-volume",
    name: "绕开危险区",
    question: "避让按玩家部件的三维占用空间判断，而不是只看中心点或俯视投影。",
    zones: [
      zone("start", [-4, 0, -1], [-3, 2, 1]),
      zone("end", [3, 0, -1], [4, 2, 1]),
      zone("danger", [-.7, 0, -.7], [.7, 1, .7])
    ],
    conditions: [
      { type: "assembly-spans-zones", zones: ["start", "end"] },
      { type: "player-parts-clear-zone", zone: "danger" }
    ],
    cases: [
      {
        name: "侧面绕行",
        summary: "一条机械连接链从危险区侧面绕过并抵达终点。",
        probe: "这是明显的正确解。",
        expected: true,
        build: {
          parts: [
            part("start-arm", "player", [-3.5, 0, .8], [-1, .5, 2]),
            part("detour", "player", [-1, 0, 1.2], [1, .5, 2]),
            part("end-arm", "player", [1, 0, .8], [3.5, .5, 2])
          ],
          connections: [["start-arm", "detour"], ["detour", "end-arm"]]
        }
      },
      {
        name: "中心在外但边缘侵入",
        summary: "中间部件的中心在危险区外，但占用空间伸进危险区。",
        probe: "只看部件中心会误判成功；候选语义应判失败。",
        expected: false,
        build: {
          parts: [
            part("start-arm", "player", [-3.5, 0, -.3], [-1.5, .5, .3]),
            part("overhang", "player", [-1.5, 0, -.3], [-.5, .5, .3]),
            part("end-arm", "player", [.7, 0, -.3], [3.5, .5, .3])
          ],
          connections: [["start-arm", "overhang"], ["overhang", "end-arm"]]
        }
      },
      {
        name: "从危险区上方跨过",
        summary: "架高部件的俯视投影覆盖危险区，但整个占用空间高于危险体积。",
        probe: "候选语义判成功；如果视觉语言表达的是地面禁区，你可能希望改成失败。",
        expected: true,
        build: {
          parts: [part("high-bridge", "player", [-3.5, 1.2, -.3], [3.5, 1.7, .3])],
          connections: []
        }
      }
    ]
  },
  {
    id: "limit-player-parts",
    name: "限制部件数量",
    question: "数量预算只统计玩家添加的部件，且指定目标部件必须通过机械连接进入同一组件。",
    zones: [zone("base", [-2, 0, -1], [-1, 2, 1]), zone("flag", [1, 0, -1], [2, 2, 1])],
    conditions: [
      { type: "parts-share-assembly", parts: ["base", "flag"] },
      { type: "player-part-count", min: 1, max: 4 }
    ],
    cases: [
      {
        name: "四个玩家部件加两个初始部件",
        summary: "两个端点来自初始场景，玩家用四个部件把它们连成一个组件。",
        probe: "初始场景不应消耗玩家的四件预算。",
        expected: true,
        build: {
          parts: [
            part("base", "initial", [-1.8, 0, -.4], [-1.2, 1, .4]),
            part("p1", "player", [-1.2, 0, -.3], [-.6, .5, .3]),
            part("p2", "player", [-.6, 0, -.3], [0, .5, .3]),
            part("p3", "player", [0, 0, -.3], [.6, .5, .3]),
            part("p4", "player", [.6, 0, -.3], [1.2, .5, .3]),
            part("flag", "initial", [1.2, 0, -.4], [1.8, 1.5, .4])
          ],
          connections: [["base", "p1"], ["p1", "p2"], ["p2", "p3"], ["p3", "p4"], ["p4", "flag"]]
        }
      },
      {
        name: "用了五个玩家部件",
        summary: "连接成立，但玩家使用了五个部件。",
        probe: "应因超过预算而失败。",
        expected: false,
        build: {
          parts: [
            part("base", "initial", [-1.8, 0, -.4], [-1.2, 1, .4]),
            ...[1, 2, 3, 4, 5].map(index => part(`p${index}`, "player", [-1.2 + index * .4, 0, -.3], [-.8 + index * .4, .5, .3])),
            part("flag", "initial", [1.2, 0, -.4], [1.8, 1.5, .4])
          ],
          connections: [["base", "p1"], ["p1", "p2"], ["p2", "p3"], ["p3", "p4"], ["p4", "p5"], ["p5", "flag"]]
        }
      },
      {
        name: "抵达旗帜区域但未连接旗帜",
        summary: "玩家只用了两个部件并抵达 flag 区域，但没有与初始 flag 部件形成机械连接。",
        probe: "已确认仅抵达区域不够；目标旗帜必须加入同一组件。",
        expected: false,
        build: {
          parts: [
            part("base", "initial", [-1.8, 0, -.4], [-1.2, 1, .4]),
            part("p1", "player", [-1.2, 0, -.3], [0, .5, .3]),
            part("p2", "player", [0, 0, -.3], [1.2, .5, .3]),
            part("flag", "initial", [1.2, 0, -.4], [1.8, 1.5, .4])
          ],
          connections: [["base", "p1"], ["p1", "p2"]]
        }
      }
    ]
  }
];

export function auditExperiments() {
  return experiments.flatMap(challenge => challenge.cases.map(example => ({
    challenge: challenge.name,
    case: example.name,
    expected: example.expected,
    proposed: evaluateChallenge(challenge, example.build, "proposed").passed,
    naive: evaluateChallenge(challenge, example.build, "naive").passed
  })));
}
