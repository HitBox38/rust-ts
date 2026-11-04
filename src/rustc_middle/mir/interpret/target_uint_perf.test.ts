// Lane miri-perf: the little-endian fast paths of `read_target_uint` / `write_target_uint` against a byte-by-byte `u128`.
import { expect, test } from "bun:test";
import { read_le_uint_at, read_target_uint, write_le_uint_at, write_target_uint } from "./mod.ts";

function slow_read(bytes: Uint8Array): bigint {
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]!);
  return v;
}
const ok = <T>(r: { $: "Ok"; _0: T } | { $: "Err"; _0: unknown }): T => {
  if (r.$ !== "Ok") throw new Error("Err");
  return r._0;
};
const PATTERNS = [0x00, 0x01, 0x7f, 0x80, 0xff];

test("read: every length up to 16 and byte pattern", () => {
  for (let len = 0; len <= 16; len++) {
    for (const p of PATTERNS) {
      const b = new Uint8Array(len).map((_, i) => (p + i * 37) & 0xff);
      expect(ok(read_target_uint("Little", b) as never) as bigint).toBe(slow_read(b));
      if (len <= 8) {
        const padded = new Uint8Array(len + 6).fill(0xaa);
        padded.set(b, 3);
        expect(read_le_uint_at(padded, 3, len)).toBe(slow_read(b));
      }
    }
  }
});

test("write: low bytes of the value, nothing outside the range", () => {
  const values = [0n, 1n, 255n, 256n, 0xdead_beefn, (1n << 32n) + 7n, (1n << 53n) - 1n, 1n << 53n, (1n << 64n) - 1n, (1n << 100n) + 9n];
  for (let len = 1; len <= 16; len++) {
    for (const v of values) {
      const t = new Uint8Array(len);
      ok(write_target_uint("Little", t, v) as never);
      expect(slow_read(t)).toBe(BigInt.asUintN(len * 8, v));
      if (len <= 8 && v < 1n << 53n) {
        const padded = new Uint8Array(len + 6).fill(0xaa);
        write_le_uint_at(padded, 3, len, v);
        expect(padded.subarray(3, 3 + len)).toEqual(t);
        expect([...padded.subarray(0, 3), ...padded.subarray(3 + len)]).toEqual([0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa]);
      }
    }
  }
});
