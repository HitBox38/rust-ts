// Tests of the self-contained fns of src/miri/helpers.ts (lane miri-eval). The `InterpCx` helpers need a running Miri
// machine (other wave-36 lanes) and are exercised by the Miri suites once those land.
import { expect, test } from "bun:test";
import "./lib.ts";
import { bool_to_simd_element, isolation_abort_error, ToU64_usize, ToUsize_u32, windows_check_buffer_size } from "./helpers.ts";
import { Size } from "../rustc_abi/lib.ts";
import { Scalar } from "../rustc_middle/mir/interpret/mod.ts";
import { Panic } from "../std/panic.ts";
import { TerminationInfoStop } from "./diagnostics.ts";

test("bool_to_simd_element: all ones for true, sign-extended/truncated to the size", () => {
  for (const [bytes, all] of [
    [1n, 0xffn],
    [2n, 0xffffn],
    [4n, 0xffff_ffffn],
    [8n, 0xffff_ffff_ffff_ffffn],
    [16n, (1n << 128n) - 1n],
  ] as const) {
    const size = Size.from_bytes(bytes);
    expect(Scalar.to_bits(bool_to_simd_element(true, size), size)).toEqual({ $: "Ok", _0: all });
    expect(Scalar.to_bits(bool_to_simd_element(false, size), size)).toEqual({ $: "Ok", _0: 0n });
  }
});

test("windows_check_buffer_size", () => {
  expect(windows_check_buffer_size([true, 5n])).toBe(4);
  expect(windows_check_buffer_size([false, 5n])).toBe(5);
  expect(() => windows_check_buffer_size([true, 0n])).toThrow(Panic);
  expect(() => windows_check_buffer_size([false, 1n << 32n])).toThrow(Panic);
});

test("ToUsize / ToU64", () => {
  expect(ToUsize_u32.to_usize(0xffff_ffff)).toBe(0xffff_ffff);
  expect(ToU64_usize.to_u64(12)).toBe(12n);
});

test("isolation_abort_error throws TerminationInfo::UnsupportedInIsolation as a MachineStop", () => {
  const r = isolation_abort_error("`open`");
  expect(r.$).toBe("Err");
  if (r.$ !== "Err") return;
  const kind = r._0.kind();
  expect(kind.$).toBe("MachineStop");
  if (kind.$ !== "MachineStop") return;
  expect(TerminationInfoStop.downcast_ref(kind._0)).toEqual({
    $: "UnsupportedInIsolation",
    _0: "`open` not available when isolation is enabled",
  });
});
