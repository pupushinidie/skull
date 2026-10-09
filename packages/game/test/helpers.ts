import { apply, applyCommand, findPlayer } from "../src/engine.js";
import { createRng, type Rng } from "../src/rng.js";
import { discOf } from "../src/scenes.js";
import type { Face, GameCommand, GameEvent, GameState, Player } from "../src/types.js";

/** 座位 id 找玩家（找不到抛错）。 */
export function P(state: GameState, id: string): Player {
  const player = findPlayer(state, id);
  if (!player) throw new Error(`没有 ${id}`);
  return player;
}

/** 执行一条命令（用状态里的随机数）。 */
export function run(state: GameState, player: string, command: GameCommand): GameState {
  return applyCommand(state, player, command);
}

/** 不合法时返回错误信息，合法时返回 null（不改状态）。 */
export function rejects(state: GameState, player: string, command: GameCommand): string | null {
  try {
    apply(state, player, command, createRng(1));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function placeCmd(state: GameState, player: string, face: Face | "lastChance"): GameCommand {
  const discId = discOf(state, player, face);
  return state.phase === "placeInitial" ? { type: "placeFirst", discId } : { type: "placeDisc", discId };
}

export function eventsOf<T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type);
}

/** 整个对象（JSON）里有没有某个字段名。 */
export function hasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([name, child]) => name === key || hasKey(child, key));
  }
  return false;
}

/** 一个只按给定值出 int 的 rng。 */
export function intRng(...values: number[]): Rng {
  const base = createRng(3);
  let index = 0;
  return { ...base, int: () => values[index++] ?? 0, get state() { return base.state; } };
}

/** 深度冻结（检查 apply 不改输入）。 */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
