#!/usr/bin/env node
// PROTOTYPE — interactive shell for inspecting Part Definition projections.

import { auditDefinitions, definitions, projectForEditor, validateDefinition } from "./contract.mjs";

const bold = "\x1b[1m", dim = "\x1b[2m", reset = "\x1b[0m";
const views = ["摘要", "连接位", "属性", "扩展"];

if (process.argv.includes("--check")) {
  const audit = auditDefinitions();
  const invalid = audit.filter(result => result.errors.length);
  const futurePoints = audit.reduce((total, result) => total + result.v1Ignored, 0);
  const recoveredPoints = audit.reduce((total, result) => total + result.futureActive - result.v1Active, 0);
  console.log(`definitions and compatibility: ${audit.length - invalid.length}/${audit.length} valid`);
  console.log(`v1 editor: ${futurePoints} unsupported future Connection Points ignored and preserved`);
  console.log(`future editor: ${recoveredPoints}/${futurePoints} future Connection Points activated`);
  if (invalid.length || futurePoints !== recoveredPoints || futurePoints < 3) process.exitCode = 1;
} else {
  let definitionIndex = 0, viewIndex = 0, profile = "v1";

  function render() {
    console.clear();
    const definition = definitions[definitionIndex];
    const projection = projectForEditor(definition, profile);
    const errors = validateDefinition(definition);

    console.log(`${bold}PROTOTYPE — Part Definition 契约${reset}`);
    console.log(`${dim}问题：一个最小数据契约能否同时服务 V1 结构部件与未来电学部件？${reset}\n`);
    console.log(`${bold}部件定义${reset} ${definitionIndex + 1}/${definitions.length}  ${definition.displayName}`);
    console.log(`${bold}身份${reset} ${projection.identity}  schema ${definition.schemaVersion}`);
    console.log(`${bold}编辑器视角${reset} ${profile === "v1" ? "V1（只理解固定机械连接）" : "未来（额外理解电气与旋转连接）"}`);
    console.log(`${bold}当前视图${reset} ${views[viewIndex]}\n`);

    if (viewIndex === 0) {
      console.log(`${bold}外观${reset} ${projection.asset}${definition.appearance.tintProperty ? `  tint ← ${definition.appearance.tintProperty}` : ""}`);
      console.log(`${bold}占用空间${reset} ${projection.occupiedBoxes} 个局部轴对齐 box`);
      console.log(`${bold}连接位${reset} 激活 ${projection.activeConnectionPoints.length}  忽略但保留 ${projection.ignoredConnectionPoints.length}`);
      console.log(`${bold}属性控件${reset} ${projection.propertyControls.map(property => `${property.propertyId}:${property.type}`).join("  ") || "无"}`);
      console.log(`${bold}扩展${reset} ${projection.preservedExtensions.join("  ") || "无"}`);
      console.log(`${bold}校验${reset} ${errors.length ? errors.join("；") : "通过"}`);
    }

    if (viewIndex === 1) {
      definition.connectionPoints.forEach(connectionPoint => {
        const active = projection.activeConnectionPoints.includes(connectionPoint);
        console.log(`${active ? "✓" : "·"} ${bold}${connectionPoint.pointId}${reset}  ${connectionPoint.kind}`);
        console.log(`  type=${connectionPoint.type}  accepts=${connectionPoint.accepts.join(",")}  capacity=${connectionPoint.capacity}`);
        console.log(`  frame t=[${connectionPoint.frame.translation}] q=[${connectionPoint.frame.rotation}]`);
      });
    }

    if (viewIndex === 2) {
      if (!projection.propertyControls.length) console.log("无实例属性");
      projection.propertyControls.forEach(property => console.log(`${bold}${property.propertyId}${reset}  ${JSON.stringify(property)}`));
      console.log(`\n${dim}属性只保存用户配置；不改变占用空间或连接位布局。${reset}`);
    }

    if (viewIndex === 3) {
      if (!projection.preservedExtensions.length) console.log("无扩展");
      for (const key of projection.preservedExtensions) console.log(`${bold}${key}${reset}\n${JSON.stringify(definition.extensions[key], null, 2)}`);
      console.log(`\n${dim}核心不解释未知扩展，只按原样保留。${reset}`);
    }

    console.log(`\n${bold}[n]${reset}${dim} 下个定义  ${reset}${bold}[p]${reset}${dim} 上个定义  ${reset}${bold}[v]${reset}${dim} 切换视图  ${reset}${bold}[m]${reset}${dim} 切换编辑器  ${reset}${bold}[q]${reset}${dim} 退出${reset}`);
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
    if (key === "n") definitionIndex = (definitionIndex + 1) % definitions.length;
    if (key === "p") definitionIndex = (definitionIndex - 1 + definitions.length) % definitions.length;
    if (key === "v") viewIndex = (viewIndex + 1) % views.length;
    if (key === "m") profile = profile === "v1" ? "future" : "v1";
    render();
  });
  render();
}
