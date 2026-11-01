// Port of src/tools/miri/src/alloc_addresses/address_generator.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-alloc` (plan-m6 wave 36).
// Its types are generated into address_generator.gen.ts (tools/codegen set `miri`); this module re-exports them.
// PORT: addresses are `u64` = `bigint` (decision C5); `checked_add` / `strict_add` check against `u64::MAX` explicitly.
// `rng.random_range(0..16)` is a `u64` draw (`slack` is added to a `u64`), through the vendored rand (lane vendor-rand).
import { AddressGenerator } from "./address_generator.gen.ts";
import { type Align, type Size } from "../../rustc_abi/lib.ts";
import { InterpErrorInfo_from_InterpErrorKind, interp_ok, type InterpErrorKind, type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { panic } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";
import { type Rng } from "../../vendor/rand_core/lib.ts";
import { RngExt } from "../../vendor/rand/rng.ts";
import { Range } from "../../vendor/rand/distr/uniform.ts";
import { SampleUniform_u64 } from "../../vendor/rand/distr/uniform_int.ts";
export * from "./address_generator.gen.ts";

const U64_MAX = (1n << 64n) - 1n;

/** `core::ops::Range<u64>` (`start..end`). */
export interface Range_u64 {
  start: bigint;
  end: bigint;
}

/** `err_exhaust!(AddressSpaceFull)` */
function err_exhaust_AddressSpaceFull(): InterpErrorKind {
  return { $: "ResourceExhaustion", _0: "AddressSpaceFull" };
}

/// Shifts `addr` to make it aligned with `align` by rounding `addr` to the smallest multiple
/// of `align` that is larger or equal to `addr`
// rustc: src/tools/miri/src/alloc_addresses/address_generator.rs:10 align_addr
export function align_addr(addr: bigint, align: bigint): bigint {
  const rem = addr % align;
  if (rem === 0n) {
    return addr;
  } else {
    // addr.strict_add(align) - rem
    const sum = addr + align;
    if (sum > U64_MAX) panic("attempt to add with overflow");
    return sum - rem;
  }
}

declare module "./address_generator.gen.ts" {
  interface AddressGenerator {
    // alloc_addresses/address_generator.rs:33
    get_remaining(): Range_u64;
    // alloc_addresses/address_generator.rs:40
    generate(size: Size, align: Align, rng: Rng): InterpResult<bigint>;
  }
  namespace AddressGenerator {
    // alloc_addresses/address_generator.rs:28
    function new_(addr_range: Range_u64): AddressGenerator;
    export { new_ as new };
  }
}

// rustc: src/tools/miri/src/alloc_addresses/address_generator.rs:28 new
(AddressGenerator as unknown as { new: (addr_range: Range_u64) => AddressGenerator }).new = function (
  addr_range: Range_u64,
): AddressGenerator {
  return new AddressGenerator(addr_range.start, addr_range.end);
};

/// Get the remaining range where this `AddressGenerator` can still allocate addresses.
// rustc: src/tools/miri/src/alloc_addresses/address_generator.rs:33 get_remaining
AddressGenerator.prototype.get_remaining = function (this: AddressGenerator): Range_u64 {
  return { start: this.next_base_addr, end: this.end };
};

/// Generate a new address with the specified size and alignment, using the given Rng to add some randomness.
/// The returned allocation is guaranteed not to overlap with any address ranges given out by the generator before.
/// Returns an error if the allocation request cannot be fulfilled.
// rustc: src/tools/miri/src/alloc_addresses/address_generator.rs:40 generate
AddressGenerator.prototype.generate = function (this: AddressGenerator, size: Size, align: Align, rng: Rng): InterpResult<bigint> {
  // Leave some space to the previous allocation, to give it some chance to be less aligned.
  // We ensure that `(self.next_base_addr + slack) % 16` is uniformly distributed.
  const slack = RngExt.random_range(rng, new Range(SampleUniform_u64, 0n, 16n));
  // From next_base_addr + slack, round up to adjust for alignment.
  let base_addr = this.next_base_addr + slack;
  if (base_addr > U64_MAX) return Err(InterpErrorInfo_from_InterpErrorKind(err_exhaust_AddressSpaceFull()));
  base_addr = align_addr(base_addr, BigInt(align.bytes()));

  // Remember next base address.  If this allocation is zero-sized, leave a gap of at
  // least 1 to avoid two allocations having the same base address. (The logic in
  // `alloc_id_from_addr` assumes unique addresses, and different function/vtable pointers
  // need to be distinguishable!)
  const size_bytes = size.bytes_u64();
  const next_base_addr = base_addr + (size_bytes > 1n ? size_bytes : 1n);
  if (next_base_addr > U64_MAX) return Err(InterpErrorInfo_from_InterpErrorKind(err_exhaust_AddressSpaceFull()));
  this.next_base_addr = next_base_addr;
  // Even if `Size` didn't overflow, we might still have filled up the address space.
  if (this.next_base_addr > this.end) {
    // throw_exhaust!(AddressSpaceFull);
    return Err(InterpErrorInfo_from_InterpErrorKind(err_exhaust_AddressSpaceFull()));
  }
  return interp_ok(base_addr);
};

// #[cfg(test)] mod tests (alloc_addresses/address_generator.rs:70): address_generator.test.ts
