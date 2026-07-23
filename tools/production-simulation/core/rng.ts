function xmur3(value: string) {
  let hash = 1_779_033_703 ^ value.length;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3_432_918_353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2_246_822_507);
    hash = Math.imul(hash ^ (hash >>> 13), 3_266_489_909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type DeterministicRng = {
  next(): number;
  integer(minimum: number, maximum: number): number;
  weighted<T>(entries: ReadonlyArray<{ value: T; weight: number }>): T;
};

export function createDeterministicRng(identity: string): DeterministicRng {
  const random = mulberry32(xmur3(identity)());

  return {
    next: random,
    integer(minimum, maximum) {
      if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || maximum < minimum) {
        throw new Error("Invalid deterministic integer range.");
      }

      return minimum + Math.floor(random() * (maximum - minimum + 1));
    },
    weighted(entries) {
      const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
      if (entries.length === 0 || total <= 0) {
        throw new Error("Weighted choice requires positive entries.");
      }

      let target = random() * total;
      for (const entry of entries) {
        target -= entry.weight;
        if (target < 0) return entry.value;
      }

      return entries[entries.length - 1].value;
    },
  };
}
