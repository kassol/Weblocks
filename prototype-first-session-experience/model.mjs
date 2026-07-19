export const BOARD = Object.freeze({
  columns: 8,
  rows: 5,
  start: Object.freeze({ x: 0, y: 2 }),
  finish: Object.freeze({ x: 7, y: 2 })
});

export const PART_KINDS = Object.freeze({
  beam: Object.freeze({ label: "蓝色 2 格积木", length: 2 }),
  cube: Object.freeze({ label: "橙色 1 格积木", length: 1 })
});

export function liftedPointerY(clientY, pointerType, holding) {
  return clientY - (pointerType === "touch" && holding ? 54 : 0);
}

const key = ({ x, y }) => `${x},${y}`;

export function footprint(part) {
  const length = PART_KINDS[part.kind].length;
  return Array.from({ length }, (_, index) => ({
    x: part.x + (part.rotation % 2 === 0 ? index : 0),
    y: part.y + (part.rotation % 2 === 0 ? 0 : index)
  }));
}

export function placementError(parts, candidate) {
  const cells = footprint(candidate);
  if (cells.some(({ x, y }) => x < 0 || x >= BOARD.columns || y < 0 || y >= BOARD.rows)) return "积木超出搭建区";
  if (cells.some(cell => key(cell) === key(BOARD.start) || key(cell) === key(BOARD.finish))) return "起点和终点要留出来";
  const occupied = new Set(parts.flatMap(footprint).map(key));
  if (cells.some(cell => occupied.has(key(cell)))) return "这里已经有积木了";
  return null;
}

export function connectedCells(parts) {
  const available = new Set([key(BOARD.start), key(BOARD.finish), ...parts.flatMap(footprint).map(key)]);
  const seen = new Set([key(BOARD.start)]);
  const queue = [BOARD.start];
  while (queue.length) {
    const current = queue.shift();
    for (const next of [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 }
    ]) {
      const nextKey = key(next);
      if (available.has(nextKey) && !seen.has(nextKey)) {
        seen.add(nextKey);
        queue.push(next);
      }
    }
  }
  return seen;
}

export function isChallengeComplete(parts) {
  return connectedCells(parts).has(key(BOARD.finish));
}

export function suggestedCell(parts) {
  const connected = connectedCells(parts);
  const occupied = new Set(parts.flatMap(footprint).map(key));
  const candidates = [];
  for (const cellKey of connected) {
    const [x, y] = cellKey.split(",").map(Number);
    for (const cell of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
      if (cell.x <= 0 || cell.x >= BOARD.columns - 1 || cell.y < 0 || cell.y >= BOARD.rows || occupied.has(key(cell))) continue;
      candidates.push(cell);
    }
  }
  return candidates.sort((a, b) =>
    (Math.abs(a.x - BOARD.finish.x) + Math.abs(a.y - BOARD.finish.y)) -
    (Math.abs(b.x - BOARD.finish.x) + Math.abs(b.y - BOARD.finish.y))
  )[0] ?? { x: 1, y: BOARD.start.y };
}

if (typeof process !== "undefined" && process.argv[1]?.endsWith("model.mjs")) {
  let checks = 0;
  const check = (condition, message) => {
    checks += 1;
    if (!condition) throw new Error(message);
  };
  check(JSON.stringify(footprint({ kind: "beam", x: 1, y: 2, rotation: 0 })) === JSON.stringify([{ x: 1, y: 2 }, { x: 2, y: 2 }]), "horizontal footprint");
  check(JSON.stringify(footprint({ kind: "beam", x: 1, y: 2, rotation: 1 })) === JSON.stringify([{ x: 1, y: 2 }, { x: 1, y: 3 }]), "vertical footprint");
  check(placementError([], { kind: "cube", x: 0, y: 2, rotation: 0 }) !== null, "anchors stay clear");
  const straightBridge = [1, 3, 5].map((x, id) => ({ id, kind: "beam", x, y: 2, rotation: 0 }));
  check(isChallengeComplete(straightBridge), "three beams connect both banks");
  check(!isChallengeComplete([{ id: 1, kind: "beam", x: 3, y: 2, rotation: 0 }]), "disconnected beam does not win");
  check(liftedPointerY(100, "touch", true) === 46 && liftedPointerY(100, "mouse", true) === 100, "touch ghost stays above the finger");
  console.log(`${checks}/6 checks passed`);
}
