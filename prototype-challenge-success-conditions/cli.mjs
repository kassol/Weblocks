#!/usr/bin/env node
// PROTOTYPE — interactive shell for comparing success-condition semantics.

import { auditExperiments, evaluateChallenge, experiments } from "./rules.mjs";

const bold = "\x1b[1m", dim = "\x1b[2m", reset = "\x1b[0m";

if (process.argv.includes("--check")) {
  const audit = auditExperiments();
  const wrong = audit.filter(row => row.proposed !== row.expected);
  const exposed = audit.filter(row => row.naive !== row.expected);
  console.log(`proposed: ${audit.length - wrong.length}/${audit.length} expected verdicts`);
  console.log(`naive: ${exposed.length} false positive/negative cases exposed`);
  if (wrong.length || exposed.length < 3) process.exitCode = 1;
} else {
  let challengeIndex = 0, caseIndex = 0, mode = "proposed";

  const conditionLabel = condition => {
    if (condition.type === "assembly-spans-zones") return `assembly-spans-zones(${condition.zones.join(", ")})`;
    if (condition.type === "player-parts-clear-zone") return `player-parts-clear-zone(${condition.zone})`;
    return `player-part-count(${condition.min ?? 0}..${condition.max ?? "∞"})`;
  };

  function render() {
    console.clear();
    const challenge = experiments[challengeIndex];
    const example = challenge.cases[caseIndex];
    const evaluation = evaluateChallenge(challenge, example.build, mode);
    const expected = example.expected ? "成功" : "失败";
    const actual = evaluation.passed ? "成功" : "失败";
    const mismatch = evaluation.passed === example.expected ? "吻合" : evaluation.passed ? "假阳性" : "假阴性";

    console.log(`${bold}PROTOTYPE — 挑战成功条件${reset}`);
    console.log(`${dim}问题：三条声明式规则能否判断多种正确作品，并避开典型误判？${reset}\n`);
    console.log(`${bold}挑战${reset} ${challengeIndex + 1}/${experiments.length}  ${challenge.name}`);
    console.log(`${dim}${challenge.question}${reset}`);
    console.log(`${bold}案例${reset} ${caseIndex + 1}/${challenge.cases.length}  ${example.name}`);
    console.log(`  ${example.summary}`);
    console.log(`${bold}需要你判断${reset} ${example.probe}\n`);
    console.log(`${bold}当前模型${reset} ${mode === "proposed" ? "候选最小语义" : "故意天真的语义"}`);
    console.log(`${bold}完整条件${reset}`);
    challenge.conditions.forEach((condition, index) => console.log(`  ${index + 1}. ${conditionLabel(condition)}`));
    console.log(`${bold}作品事实${reset}`);
    console.log(`  部件：${example.build.parts.map(part => `${part.id}[${part.source === "player" ? "玩家" : "初始"}]`).join("  ")}`);
    console.log(`  机械连接：${example.build.connections.length ? example.build.connections.map(edge => edge.join("—")).join("  ") : "无"}`);
    console.log(`${bold}逐条结果${reset}`);
    evaluation.results.forEach((result, index) => console.log(`  ${result.passed ? "✓" : "✗"} ${index + 1}. ${result.detail}`));
    console.log(`\n${bold}结论${reset} 模型=${actual}  人工预期=${expected}  对照=${mismatch}`);
    console.log(`\n${bold}[n]${reset}${dim} 下个案例  ${reset}${bold}[p]${reset}${dim} 上个案例  ${reset}${bold}[c]${reset}${dim} 下个挑战  ${reset}${bold}[m]${reset}${dim} 切换模型  ${reset}${bold}[q]${reset}${dim} 退出${reset}`);
  }

  function moveCase(delta) {
    const count = experiments[challengeIndex].cases.length;
    caseIndex = (caseIndex + delta + count) % count;
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
    if (key === "n") moveCase(1);
    if (key === "p") moveCase(-1);
    if (key === "c") { challengeIndex = (challengeIndex + 1) % experiments.length; caseIndex = 0; }
    if (key === "m") mode = mode === "proposed" ? "naive" : "proposed";
    render();
  });
  render();
}
