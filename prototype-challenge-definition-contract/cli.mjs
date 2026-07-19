#!/usr/bin/env node
// PROTOTYPE — interactive shell for inspecting Challenge Definition projections.

import { auditChallenges, challenges, projectChallenge, validateChallenge } from "./contract.mjs";

const bold = "\x1b[1m", dim = "\x1b[2m", reset = "\x1b[0m";
const views = ["摘要", "初始场景", "可用部件", "成功条件", "扩展"];

if (process.argv.includes("--check")) {
  const audit = auditChallenges();
  const invalid = audit.filter(result => result.errors.length);
  const v1BuiltIns = audit.slice(0, 3).filter(result => result.v1Editable).length;
  const v1FutureBlocked = !audit[3].v1Editable;
  const futureAccepted = audit.every(result => result.futureEditable);
  console.log(`definitions: ${audit.length - invalid.length}/${audit.length} structurally valid`);
  console.log(`v1 profile: ${v1BuiltIns}/3 built-ins editable; future extension blocked=${v1FutureBlocked}`);
  console.log(`future profile: ${futureAccepted ? "4/4" : "incomplete"} editable`);
  if (invalid.length || v1BuiltIns !== 3 || !v1FutureBlocked || !futureAccepted) process.exitCode = 1;
} else {
  let challengeIndex = 0, viewIndex = 0, profile = "v1";

  function render() {
    console.clear();
    const definition = challenges[challengeIndex];
    const projection = projectChallenge(definition, profile);
    const errors = validateChallenge(definition);

    console.log(`${bold}PROTOTYPE — Challenge Definition 契约${reset}`);
    console.log(`${dim}问题：一个最小数据契约能否描述 V1 内置 Challenge，并安全留出未来创作与扩展边界？${reset}\n`);
    console.log(`${bold}挑战定义${reset} ${challengeIndex + 1}/${challenges.length}  ${definition.metadata.title}`);
    console.log(`${bold}身份${reset} ${projection.identity}  schema ${definition.schemaVersion}`);
    console.log(`${bold}加载视角${reset} ${profile === "v1" ? "V1" : "未来扩展"}  ${projection.editable ? "可编辑" : "拒绝编辑"}`);
    console.log(`${bold}当前视图${reset} ${views[viewIndex]}\n`);

    if (viewIndex === 0) {
      console.log(`${bold}提示${reset} ${definition.metadata.prompt}`);
      console.log(`${bold}预计时长${reset} ${definition.metadata.estimatedMinutes} 分钟`);
      console.log(`${bold}初始场景${reset} ${projection.initialPartCount} 个 Part`);
      console.log(`${bold}可用部件${reset} ${projection.availablePartCount} 种 Part Definition`);
      console.log(`${bold}区域 / 条件${reset} ${projection.zoneCount} / ${projection.conditionCount}`);
      console.log(`${bold}扩展${reset} ${projection.preservedExtensions.join("  ") || "无"}`);
      console.log(`${bold}不支持${reset} ${projection.unsupportedExtensions.join("  ") || projection.unsupportedConditions.map(condition => condition.type).join("  ") || "无"}`);
      console.log(`${bold}结构校验${reset} ${errors.length ? errors.join("；") : "通过"}`);
    }

    if (viewIndex === 1) {
      definition.initialScene.parts.forEach(part => console.log(`${bold}${part.partId}${reset}  ${part.definition.definitionId}@${part.definition.version}  t=[${part.transform.translation}]`));
      console.log(`\n${bold}机械连接${reset}`);
      if (!definition.initialScene.connections.length) console.log("无");
      definition.initialScene.connections.forEach(connection => console.log(`${connection.connectionId}: ${connection.a.partId}.${connection.a.pointId} — ${connection.b.partId}.${connection.b.pointId}`));
    }

    if (viewIndex === 2) {
      definition.availableParts.forEach(entry => console.log(`${bold}${entry.definition.definitionId}@${entry.definition.version}${reset}  maxCount=${entry.maxCount ?? "不限"}`));
      console.log(`\n${dim}maxCount 是可用数量硬限制；成功条件里的 player-part-count 是作品判定。${reset}`);
    }

    if (viewIndex === 3) {
      definition.successConditions.forEach(condition => console.log(`${bold}${condition.conditionId}${reset}  ${JSON.stringify(condition)}`));
      console.log(`\n${dim}列表隐式 AND；条件只引用稳定的 Zone ID、初始 Part ID 或扩展。${reset}`);
    }

    if (viewIndex === 4) {
      console.log(`${bold}requiredExtensions${reset} ${definition.requiredExtensions.join("  ") || "无"}`);
      if (!projection.preservedExtensions.length) console.log("无扩展负载");
      for (const key of projection.preservedExtensions) console.log(`${bold}${key}${reset}\n${JSON.stringify(definition.extensions[key], null, 2)}`);
      console.log(`\n${dim}未知可选扩展保留；未知 required 扩展拒绝可编辑加载。${reset}`);
    }

    console.log(`\n${bold}[n]${reset}${dim} 下个定义  ${reset}${bold}[p]${reset}${dim} 上个定义  ${reset}${bold}[v]${reset}${dim} 切换视图  ${reset}${bold}[m]${reset}${dim} 切换加载视角  ${reset}${bold}[q]${reset}${dim} 退出${reset}`);
  }

  if (!process.stdin.isTTY) {
    console.error("请在交互终端运行，或追加 --check 执行自动检查。");
    process.exit(1);
  }

  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", key => {
    if (key === "q" || key === "\u0003") process.exit();
    if (key === "n") challengeIndex = (challengeIndex + 1) % challenges.length;
    if (key === "p") challengeIndex = (challengeIndex - 1 + challenges.length) % challenges.length;
    if (key === "v") viewIndex = (viewIndex + 1) % views.length;
    if (key === "m") profile = profile === "v1" ? "future" : "v1";
    render();
  });
  render();
}
