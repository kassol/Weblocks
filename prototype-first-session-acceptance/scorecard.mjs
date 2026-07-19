// PROTOTYPE — pure evaluator for a manual first-session observation scorecard.

export const LIMITS = Object.freeze({
  firstPartPickupSeconds: 120,
  firstVisibleResultSeconds: 300,
  challengeCompletionSeconds: 1800
});

const seconds = value => value == null ? "未发生" : `${Math.floor(value / 60)}分${String(value % 60).padStart(2, "0")}秒`;
const within = (value, limit) => Number.isFinite(value) && value >= 0 && value <= limit;

export function evaluateSession(session) {
  const criteria = [
    {
      id: "independent-start",
      label: "独立开始",
      passed: session.adultInterventions === 0 && within(session.firstPartPickupSeconds, LIMITS.firstPartPickupSeconds),
      detail: `首次拿起部件 ${seconds(session.firstPartPickupSeconds)}；成人干预 ${session.adultInterventions} 次`
    },
    {
      id: "first-visible-result",
      label: "5 分钟内获得成果",
      passed: within(session.firstVisibleResultSeconds, LIMITS.firstVisibleResultSeconds),
      detail: `首次合法放置 ${seconds(session.firstVisibleResultSeconds)}`
    },
    {
      id: "first-challenge-complete",
      label: "单次会话完成首个挑战",
      passed: session.challengeSucceeded === true && within(session.challengeCompletionSeconds, LIMITS.challengeCompletionSeconds),
      detail: `${session.challengeSucceeded ? "成功条件已触发" : "成功条件未触发"}；完成 ${seconds(session.challengeCompletionSeconds)}`
    }
  ];
  return { passed: criteria.every(criterion => criterion.passed), criteria };
}

const isEligible = session => session.firstTime && session.age >= 7 && session.age <= 10 && !session.technicalFailure;
const rate = (passed, total) => total ? passed / total : 0;

export function evaluateRound(round) {
  const sessions = round.sessions.filter(isEligible);
  const evaluated = sessions.map(session => ({ session, result: evaluateSession(session) }));
  const passed = evaluated.filter(row => row.result.passed);
  const cohorts = Object.fromEntries(["mouse", "touch"].map(input => {
    const rows = evaluated.filter(row => row.session.input === input);
    const passing = rows.filter(row => row.result.passed).length;
    return [input, { total: rows.length, passed: passing, rate: rate(passing, rows.length) }];
  }));
  const gates = {
    coverage: sessions.length >= 6 && cohorts.mouse.total >= 3 && cohorts.touch.total >= 3,
    overall: sessions.length > 0 && passed.length === sessions.length,
    mouse: cohorts.mouse.total > 0 && cohorts.mouse.passed === cohorts.mouse.total,
    touch: cohorts.touch.total > 0 && cohorts.touch.passed === cohorts.touch.total
  };
  return {
    passed: Object.values(gates).every(Boolean),
    gates,
    eligible: sessions.length,
    excluded: round.sessions.length - sessions.length,
    passedSessions: passed.length,
    cohorts,
    evaluated
  };
}

export function evaluateNaiveRound(round) {
  const sessions = round.sessions.filter(isEligible);
  const completed = sessions.filter(session => session.challengeSucceeded && session.challengeCompletionSeconds != null);
  const average = field => sessions.reduce((sum, session) => sum + (session[field] ?? LIMITS.challengeCompletionSeconds), 0) / Math.max(sessions.length, 1);
  const completedAverage = completed.reduce((sum, session) => sum + session.challengeCompletionSeconds, 0) / Math.max(completed.length, 1);
  const passed = sessions.length >= 6
    && average("firstPartPickupSeconds") <= LIMITS.firstPartPickupSeconds
    && average("firstVisibleResultSeconds") <= LIMITS.firstVisibleResultSeconds
    && completedAverage <= LIMITS.challengeCompletionSeconds
    && rate(completed.length, sessions.length) >= 5 / 6;
  return { passed, eligible: sessions.length, completed: completed.length };
}

const goodSession = (id, input, age, offset = 0) => ({
  id,
  input,
  age,
  firstTime: true,
  technicalFailure: false,
  adultInterventions: 0,
  firstPartPickupSeconds: 35 + offset,
  firstVisibleResultSeconds: 95 + offset,
  challengeCompletionSeconds: 720 + offset,
  challengeSucceeded: true,
  inProductHintsUsed: offset > 20 ? 2 : 1,
  blockingIssue: null
});

const cleanSix = () => [
  goodSession("M7", "mouse", 7, 0),
  goodSession("M8", "mouse", 8, 15),
  goodSession("M10", "mouse", 10, 30),
  goodSession("T7", "touch", 7, 5),
  goodSession("T9", "touch", 9, 20),
  goodSession("T10", "touch", 10, 35)
];

const failing = (session, issue, changes) => ({ ...session, ...changes, blockingIssue: issue });

export const scenarios = [
  {
    id: "clean",
    name: "六名玩家顺利完成",
    question: "两种输入各三名玩家都独立达到三个里程碑。",
    expected: true,
    sessions: cleanSix()
  },
  {
    id: "one-outlier",
    name: "一名玩家失败",
    question: "六名中五名全部通过，但一名鼠标玩家没有找到部件区；严格门槛应否决整轮。",
    expected: false,
    sessions: cleanSix().map(session => session.id === "M8" ? failing(session, "没有找到部件区", {
      firstPartPickupSeconds: 170,
      firstVisibleResultSeconds: 430,
      challengeCompletionSeconds: null,
      challengeSucceeded: false
    }) : session)
  },
  {
    id: "adult-assisted",
    name: "平均很快，但两人由成人教会",
    question: "所有时间平均值都漂亮，但两名玩家需要成人解释拿起和放下。",
    expected: false,
    sessions: cleanSix().map(session => ["M7", "T7"].includes(session.id) ? failing(session, "需要成人解释操作", { adultInterventions: 1 }) : session)
  },
  {
    id: "slow-first-result",
    name: "最终完成，但首个成果太慢",
    question: "所有人都在 30 分钟内完成，两个玩家却到第 7 分钟才放下第一块。",
    expected: false,
    sessions: cleanSix().map(session => ["M10", "T10"].includes(session.id) ? failing(session, "首次合法放置过慢", {
      firstVisibleResultSeconds: 420,
      challengeCompletionSeconds: 1200
    }) : session)
  },
  {
    id: "missing-milestone",
    name: "完成时间有了，但首次成果缺失",
    question: "两名玩家被记为最终完成，却没有发生首次合法放置；缺失值不能当作零秒。",
    expected: false,
    sessions: cleanSix().map(session => ["M10", "T10"].includes(session.id) ? failing(session, "中间里程碑未发生", {
      firstVisibleResultSeconds: null
    }) : session)
  },
  {
    id: "touch-hidden-by-average",
    name: "鼠标人数掩盖触控失败",
    question: "九名鼠标玩家都通过，但三名触控玩家只有一名通过；总体仍达到 5/6。",
    expected: false,
    sessions: [
      ...Array.from({ length: 9 }, (_, index) => goodSession(`M${index + 1}`, "mouse", 7 + index % 4, index)),
      goodSession("T1", "touch", 8, 10),
      failing(goodSession("T2", "touch", 9, 10), "手指遮住 ghost", { challengeCompletionSeconds: null, challengeSucceeded: false }),
      failing(goodSession("T3", "touch", 10, 10), "双指镜头误放部件", { challengeCompletionSeconds: null, challengeSucceeded: false })
    ]
  },
  {
    id: "insufficient-coverage",
    name: "只有四名观察对象",
    question: "四个人都通过，但没有达到每种输入至少三名的覆盖门槛。",
    expected: false,
    sessions: cleanSix().slice(0, 2).concat(cleanSix().slice(3, 5))
  }
];

export function auditScenarios() {
  return scenarios.map(scenario => ({
    id: scenario.id,
    expected: scenario.expected,
    proposed: evaluateRound(scenario).passed,
    naive: evaluateNaiveRound(scenario).passed
  }));
}
