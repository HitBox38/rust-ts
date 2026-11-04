// Lane miri-perf: `Size`'s `number` fast paths and shared small values against upstream's `u64` arithmetic in `bigint`.
import { expect, test } from "bun:test";
import { Align, Size, Size_eq, TargetDataLayout } from "./lib.ts";
import { Panic } from "../std/panic.ts";

const U64_MAX = (1n << 64n) - 1n;
const VALUES = [0n, 1n, 7n, 8n, 9n, 15n, 16n, 255n, 1023n, 1024n, 1025n, 4096n, 65535n, (1n << 31n) - 1n, 1n << 31n, 1n << 32n, (1n << 50n) + 3n, (1n << 53n) - 9n, (1n << 53n) - 1n, 1n << 53n, (1n << 53n) + 1n, (1n << 60n) + 5n, (1n << 61n) - 1n, 1n << 61n, U64_MAX];
const ALIGNS = [1, 2, 4, 8, 16, 4096, 1 << 29];
const cx = { data_layout: () => TargetDataLayout.default() };
const OBJ_BOUND = 1n << 61n;

test("small values are shared and equal to built ones", () => {
  expect(Size.from_bytes(8)).toBe(Size.from_bytes(8n));
  expect(Size.from_bytes(0)).toBe(Size.ZERO);
  expect(Size_eq(Size.from_bytes(2048), Size.from_bytes(2048n))).toBe(true);
  expect(Size.from_bytes(1023).add(Size.from_bytes(1)).bytes()).toBe(1024);
});

test("from_bits, bits, align_to, is_aligned", () => {
  for (const v of VALUES) {
    if (v + 7n <= U64_MAX) {
      const fromBig = Size.from_bits(v).bytes_u64();
      expect(fromBig).toBe((v + 7n) / 8n);
      if (v <= BigInt(Number.MAX_SAFE_INTEGER)) expect(Size.from_bits(Number(v)).bytes_u64()).toBe(fromBig);
    }
    const s = Size.from_bytes(v);
    if (v * 8n <= BigInt(Number.MAX_SAFE_INTEGER)) expect(s.bits()).toBe(Number(v * 8n));
    for (const a of ALIGNS) {
      const al = Align.from_bytes(BigInt(a));
      if (al.$ !== "Ok") throw new Error("align");
      const mask = BigInt(a) - 1n;
      expect(s.align_to(al._0).bytes_u64()).toBe(((v + mask) & U64_MAX) & ~mask);
      expect(s.is_aligned(al._0)).toBe((v & mask) === 0n);
    }
  }
});

test("checked_add, checked_mul, add, mul", () => {
  for (const a of VALUES) {
    for (const b of VALUES) {
      const [x, y] = [Size.from_bytes(a), Size.from_bytes(b)];
      const sum = a + b;
      const ca = x.checked_add(y, cx);
      expect(ca?.bytes_u64()).toBe(sum < OBJ_BOUND ? sum : undefined);
      if (sum <= U64_MAX) expect(x.add(y).bytes_u64()).toBe(sum);
      else expect(() => x.add(y)).toThrow(Panic);
      const product = a * b;
      const count = b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b;
      expect(x.checked_mul(count, cx)?.bytes_u64()).toBe(product < OBJ_BOUND ? product : undefined);
      if (product <= U64_MAX) expect(x.mul(count).bytes_u64()).toBe(product);
      else expect(() => x.mul(count)).toThrow(Panic);
    }
  }
});

test("truncate and sign_extend against the 128-bit shifts", () => {
  const U128_MAX = (1n << 128n) - 1n;
  const inputs = [0n, 1n, -1n, 127n, 128n, 255n, 256n, -129n, (1n << 64n) + 5n, -(1n << 70n) + 3n, U128_MAX, 1n << 127n];
  for (const bytes of [1, 2, 4, 8, 16]) {
    const s = Size.from_bytes(bytes);
    const shift = BigInt(128 - bytes * 8);
    for (const v of inputs) {
      expect(s.truncate(v)).toBe(((v << shift) & U128_MAX) >> shift);
      expect(s.sign_extend(v)).toBe(BigInt.asIntN(128, (v << shift) & U128_MAX) >> shift);
    }
  }
  expect(Size.ZERO.truncate(5n)).toBe(0n);
  expect(Size.ZERO.sign_extend(5n)).toBe(0n);
});
