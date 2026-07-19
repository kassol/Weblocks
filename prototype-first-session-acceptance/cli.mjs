#!/usr/bin/env node
// PROTOTYPE — interactive shell for testing a manual first-session acceptance scorecard.

import { LIMITS, auditScenarios, evaluateNaiveRound, evaluateRound, evaluateSession, scenarios } from "./scorecard.mjs";

const bold = "\x1b[1m", dim = "\x1b[2m", reset = "\x1b[0m";

if (process.argv.includes("--check")) {
  const audit = auditScenarios();
  const wrong = audit.filter(row => row.proposed !== row.expected);
  const exposed = audit.filter(row => row.naive !== row.expected);
  console.log(`proposed: ${audit.length - wrong.length}/${audit.length} expected verdicts`);
  console.log(`naive: ${exposed.length} false-positive/negative rounds exposed`);
  if (wrong.length || exposed.length < 4) process.exitCode = 1;
} else {
  let scenarioIndex = 0, sessionIndex = 0, current = structuredClone(scenarios[0]), modified = false;

  const fmt = value => value == null ? "—" : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  const mark = passed => passed ? "✓" : "✗";

  function resetScenario() {
    current = structuredClone(scenarios[scenarioIndex]);
    sessionIndex = Math.min(sessionIndex, current.sessions.length - 1);
    modified = false;
  }

  function render() {
    console.clear();
    const round = evaluateRound(current);
    const naive = evaluateNaiveRound(current);
    const session = current.sessions[sessionIndex];
    const sessionResult = evaluateSession(session);
    const expected = current.expected ? "通过" : "不通过";

    console.log(`${bold}PROTOTYPE — 首次体验验收记分卡${reset}`);
    console.log(`${dim}问题：少量人工观察能否阻止平均数掩盖真实的首次体验失败？${reset}\n`);
    console.log(`${bold}候选硬门槛${reset}`);
    console.log(`  首次拿起 ≤ ${LIMITS.firstPartPickupSeconds / 60} 分钟；首次合法放置 ≤ ${LIMITS.firstVisibleResultSeconds / 60} 分钟`);
    console.log(`  挑战成功 ≤ ${LIMITS.challengeCompletionSeconds / 60} 分钟，并作为理解核心拼搭交互的证据`);
    console.log(`  成人干预 0 次；产品内提示允许使用`);
    console.log(`  ≥6 名，鼠标/触控各 ≥3；所有有效观察必须通过；同一阻塞不得重复\n`);

    console.log(`${bold}场景${reset} ${scenarioIndex + 1}/${scenarios.length}  ${current.name}${modified ? "（已修改）" : ""}`);
    console.log(`${dim}${current.question}${reset}`);
    console.log(`${bold}整轮状态${reset}`);
    console.log(`  ${mark(round.gates.coverage)} 覆盖：有效 ${round.eligible}，排除 ${round.excluded}`);
    console.log(`  ${mark(round.gates.overall)} 全部标准：${round.passedSessions}/${round.eligible}`);
    console.log(`  ${mark(round.gates.mouse)} 鼠标：${round.cohorts.mouse.passed}/${round.cohorts.mouse.total}`);
    console.log(`  ${mark(round.gates.touch)} 触控：${round.cohorts.touch.passed}/${round.cohorts.touch.total}`);
    console.log(`  ${mark(round.gates.noRepeatedBlocker)} 重复阻塞：${round.repeatedBlockers.length ? round.repeatedBlockers.map(item => `${item.issue}×${item.count}`).join("；") : "无"}`);
    console.log(`  候选模型=${round.passed ? "通过" : "不通过"}  天真平均值=${naive.passed ? "通过" : "不通过"}  人工预期=${expected}\n`);

    console.log(`${bold}全部观察${reset}`);
    current.sessions.forEach((item, index) => {
      const result = evaluateSession(item);
      const pointer = index === sessionIndex ? ">" : " ";
      console.log(`${pointer} ${item.id.padEnd(4)} ${item.age}岁 ${item.input.padEnd(5)} 帮助${item.adultInterventions}  拿起${fmt(item.firstPartPickupSeconds)}  首果${fmt(item.firstVisibleResultSeconds)}  完成${fmt(item.challengeCompletionSeconds)}  ${result.passed ? "通过" : "失败"}`);
    });

    console.log(`\n${bold}当前观察 ${session.id}${reset}`);
    console.log(`  首次玩家=${session.firstTime}  技术故障=${session.technicalFailure}  产品内提示=${session.inProductHintsUsed}  阻塞=${session.blockingIssue ?? "无"}`);
    sessionResult.criteria.forEach(criterion => console.log(`  ${mark(criterion.passed)} ${criterion.label} — ${criterion.detail}`));
    console.log(`\n${bold}[n/p]${reset}${dim} 场景  ${reset}${bold}[j/k]${reset}${dim} 观察  ${reset}${bold}[a]${reset}${dim} 成人帮助  ${reset}${bold}[r]${reset}${dim} 首果+1分  ${reset}${bold}[c]${reset}${dim} 完成+5分  ${reset}${bold}[i]${reset}${dim} 切换输入  ${reset}${bold}[b]${reset}${dim} 重复阻塞  ${reset}${bold}[x]${reset}${dim} 重置  ${reset}${bold}[q]${reset}${dim} 退出${reset}`);
  }

  function moveScenario(delta) {
    scenarioIndex = (scenarioIndex + delta + scenarios.length) % scenarios.length;
    sessionIndex = 0;
    resetScenario();
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
    if (key === "n") moveScenario(1);
    if (key === "p") moveScenario(-1);
    if (key === "j") sessionIndex = (sessionIndex + 1) % current.sessions.length;
    if (key === "k") sessionIndex = (sessionIndex - 1 + current.sessions.length) % current.sessions.length;
    const session = current.sessions[sessionIndex];
    if (key === "a") { session.adultInterventions = session.adultInterventions ? 0 : 1; modified = true; }
    if (key === "r") { session.firstVisibleResultSeconds = (session.firstVisibleResultSeconds ?? 0) + 60; modified = true; }
    if (key === "c") { session.challengeCompletionSeconds = (session.challengeCompletionSeconds ?? 0) + 300; session.challengeSucceeded = true; modified = true; }
    if (key === "i") { session.input = session.input === "mouse" ? "touch" : "mouse"; modified = true; }
    if (key === "b") { session.blockingIssue = session.blockingIssue ? null : "同一阻塞"; modified = true; }
    if (key === "x") resetScenario();
    render();
  });
  render();
}
