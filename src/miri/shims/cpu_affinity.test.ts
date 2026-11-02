// Tests of src/miri/shims/cpu_affinity.ts (lane miri-shims-b): MAX_CPUS and the mask layout (`[c_ulong; _]` in the
// target's endianness), `from_array` masking.
import { afterEach, expect, test } from "bun:test";
import "../lib.ts";
import { CpuAffinityMask, type LayoutOfCx, MAX_CPUS } from "./cpu_affinity.ts";

const chunk_size = CpuAffinityMask.chunk_size;
afterEach(() => {
  CpuAffinityMask.chunk_size = chunk_size;
});
/** A `cx` for a target with this endianness and `c_ulong` size (`chunk_size` stubbed: it resolves `core::ffi::c_ulong`). */
function cx(endian: "Little" | "Big", ulong: number): LayoutOfCx {
  CpuAffinityMask.chunk_size = () => ulong;
  return { tcx_: () => ({ sess: { target: { endian } } }) } as unknown as LayoutOfCx;
}

test("MAX_CPUS = 1024 (CPU_SETSIZE), 128 mask bytes", () => {
  expect(MAX_CPUS).toBe(1024);
  expect(CpuAffinityMask.CPU_MASK_BYTES).toBe(128);
});

test("CpuAffinityMask::new sets the first cpu_count bits of [c_ulong; 16] little-endian (x86_64-linux)", () => {
  const m = CpuAffinityMask.new(cx("Little", 8), 10);
  expect(m.as_slice().length).toBe(128);
  expect(m.as_slice().slice(0, 3)).toEqual([0xff, 0x03, 0]);
  const all = CpuAffinityMask.new(cx("Little", 8), 2000); // out-of-range CPUs are ignored
  expect(all.as_slice().every((b) => b === 0xff)).toBe(true);
  const cpu70 = CpuAffinityMask.new(cx("Little", 8), 0);
  cpu70.set(cx("Little", 8), 70);
  expect(cpu70.as_slice()[8]).toBe(0x40);
});

test("big-endian chunks: bit k of each u32 / u64 counts from the chunk's last byte", () => {
  const be4 = CpuAffinityMask.new(cx("Big", 4), 0);
  be4.set(cx("Big", 4), 0);
  be4.set(cx("Big", 4), 9);
  be4.set(cx("Big", 4), 33);
  expect(be4.as_slice().slice(0, 8)).toEqual([0, 0, 0x02, 0x01, 0, 0, 0, 0x02]);
  const be8 = CpuAffinityMask.new(cx("Big", 8), 0);
  be8.set(cx("Big", 8), 63);
  expect(be8.as_slice().slice(0, 8)).toEqual([0x80, 0, 0, 0, 0, 0, 0, 0]);
  expect(() => CpuAffinityMask.new(cx("Little", 2), 1)).toThrow("chunk size not supported: 2");
});

test("from_array masks by the available CPUs and needs at least one", () => {
  const c = cx("Little", 8);
  const bytes = new Array<number>(128).fill(0);
  bytes[0] = 0xf0;
  bytes[100] = 0xff;
  const m = CpuAffinityMask.from_array(c, 6, bytes)!;
  expect(m.as_slice().slice(0, 2)).toEqual([0x30, 0]);
  expect(m.as_slice()[100]).toBe(0);
  bytes[0] = 0xc0;
  expect(CpuAffinityMask.from_array(c, 6, bytes)).toBeUndefined();
});
