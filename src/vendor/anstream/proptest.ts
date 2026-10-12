// rust-ts test support (not ported code): deterministic stand-ins for the `proptest` strategies
// anstream's tests use. Each property runs `CASES` cases from a fixed seed (proptest's default
// case count is 256).
//
// PORT: `"\\PC*"` (strings of chars outside Unicode category C, length 0..32) and
// `any::<Vec<u8>>()` (byte vectors, length 0..100) → seeded generators below. They do not
// shrink; a failure reports the case.

export const CASES = 256;

/** mulberry32 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOT_C = /^\P{C}$/u;

/** One char of `\PC`. */
function pc_char(r: () => number): string {
  for (;;) {
    const k = r();
    let cp: number;
    if (k < 0.5) cp = 0x20 + Math.floor(r() * 0x5f); // ASCII
    else if (k < 0.8) cp = 0xa0 + Math.floor(r() * (0x800 - 0xa0)); // 2-byte UTF-8
    else if (k < 0.95) cp = 0x800 + Math.floor(r() * (0x10000 - 0x800)); // 3-byte UTF-8
    else cp = 0x10000 + Math.floor(r() * (0x110000 - 0x10000)); // 4-byte UTF-8
    const s = String.fromCodePoint(cp);
    if (NOT_C.test(s)) return s;
  }
}

/** `"\\PC*"` */
export function pc_string(r: () => number): string {
  const n = Math.floor(r() * 33);
  let s = "";
  for (let i = 0; i < n; i++) s += pc_char(r);
  return s;
}

/** `any::<Vec<u8>>()` */
export function any_bytes(r: () => number): Uint8Array {
  const n = Math.floor(r() * 100);
  const v = new Uint8Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.floor(r() * 256);
  return v;
}
