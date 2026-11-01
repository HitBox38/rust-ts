// Port of the `#[cfg(test)] mod tests` of src/tools/miri/src/alloc_addresses/address_generator.rs (lane miri-alloc), plus
// checks of `generate`'s error paths. The rng-driven address sequences are checked against the oracle in
// addresses.oracle.test.ts.
import { expect, test } from "bun:test";
import { AddressGenerator, align_addr } from "./address_generator.ts";
import { Align, Size } from "../../rustc_abi/lib.ts";
import { unwrap_result } from "../../std/result.ts";
import { StdRng } from "../../vendor/rand/rngs/std.ts";

// rustc: src/tools/miri/src/alloc_addresses/address_generator.rs:74 test_align_addr
test("test_align_addr", () => {
  expect(align_addr(37n, 4n)).toBe(40n);
  expect(align_addr(44n, 4n)).toBe(44n);
});

test("generate: aligned, non-overlapping, zero-sized allocations get a gap; AddressSpaceFull", () => {
  const rng = StdRng.seed_from_u64(0n);
  const g = AddressGenerator.new({ start: 0x20000n, end: 0x20100n });
  const a = g.generate(Size.ZERO, unwrap_result(Align.from_bytes(16)), rng);
  expect(a.$).toBe("Ok");
  const a0 = (a as { _0: bigint })._0;
  expect(a0 % 16n).toBe(0n);
  expect(g.get_remaining().start).toBe(a0 + 1n);
  const b = g.generate(Size.from_bytes(8), unwrap_result(Align.from_bytes(8)), rng);
  expect(b.$ === "Ok" && b._0 > a0 && b._0 % 8n === 0n).toBe(true);
  // A request past `end` is `AddressSpaceFull` (and the generator already moved, as upstream).
  const c = g.generate(Size.from_bytes(0x1000), Align.ONE, rng);
  expect(c.$ === "Err" && c._0.kind().$ === "ResourceExhaustion").toBe(true);
  // u64 overflow of `next_base_addr + slack` / `+ size` is also `AddressSpaceFull`, never a wrapped address.
  const h = AddressGenerator.new({ start: (1n << 64n) - 4n, end: (1n << 64n) - 1n });
  const d = h.generate(Size.from_bytes(16), Align.ONE, StdRng.seed_from_u64(0n));
  expect(d.$ === "Err" && d._0.kind().$ === "ResourceExhaustion").toBe(true);
});
