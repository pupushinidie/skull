/**
 * 可复现的随机数（mulberry32）。状态是一个 32 位整数，存在对局状态里，
 * 所以同一种子、同一串操作总能得到同一局。
 */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  readonly state: number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number) => Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    pick: (items) => items[int(items.length)]!,
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = int(i + 1);
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      }
      return copy;
    },
    get state() {
      return state;
    },
  };
}

/**
 * 按剧本出数的随机数（教程、测试用）：int(n) 依次从 ints 里取（取完后回到种子随机数），
 * 比如别人骷髅时随机失牌 int(手里张数) 取到几就丢第几张。
 */
export function scriptedRng(ints: readonly number[], seed = 1): Rng {
  const fallback = createRng(seed);
  let index = 0;
  const int = (maxExclusive: number) => {
    if (index < ints.length) {
      const value = ints[index++]!;
      if (value < 0 || value >= maxExclusive) throw new Error(`剧本随机数 ${value} 超出范围 0–${maxExclusive - 1}`);
      return value;
    }
    return fallback.int(maxExclusive);
  };
  return {
    next: () => fallback.next(),
    int,
    pick: (items) => items[int(items.length)]!,
    shuffle: (items) => fallback.shuffle(items),
    get state() {
      return fallback.state;
    },
  };
}
