// Port of src/tools/miri/src/alloc/alloc_bytes.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-alloc` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into alloc_bytes.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type Pending } from "../../rustc_type_ir/decls.ts";
import type { Align, Size } from "../../rustc_abi/lib.ts";
import type { AllocBytes } from "../../rustc_middle/mir/interpret/mod.ts";
import { unported } from "../../std/panic.ts";
import type { MiriAllocParams } from "./alloc_bytes.gen.ts";
export * from "./alloc_bytes.gen.ts";

// rustc-type: src/tools/miri/src/alloc/alloc_bytes.rs:22 MiriAllocBytes
/// Allocation bytes that explicitly handle the layout of the data they're storing.
/// This is necessary to interface with native code that accesses the program store in Miri.
// PORT(contract): the `Machine::Bytes` of Miri (`impl AllocBytes for MiriAllocBytes`, `AllocBytes_MiriAllocBytes` below),
// a hand type. interp-generic PORT 3 (miri-contract review N5): every `AllocBytes` value is a `Uint8Array`, so this is a
// `Uint8Array` subclass whose elements are the allocation's bytes (`Deref<Target = [u8]>` and `as_ptr` / `as_mut_ptr`
// are the value itself); its views (`subarray`, `slice`) are plain `Uint8Array`s. The fields are the upstream ones (the
// generated derive(Debug) reads them); `ptr` (the host address of the storage, `*mut u8`) is typed as a number and its
// value is lane miri-alloc's (with `native-lib` off, decision C6, nothing needs a host address).
export class MiriAllocBytes extends Uint8Array {
  /// Stored layout information about the allocation.
  declare layout: Pending<"std::alloc::Layout">;
  /// Pointer to the allocation contents.
  /// Invariant:
  /// * If `self.layout.size() == 0`, then `self.ptr` was allocated with the equivalent layout with size 1.
  /// * Otherwise, `self.ptr` points to memory allocated with `self.layout`.
  declare ptr: number;
  /// Whether this instance of `MiriAllocBytes` had its allocation created by calling `alloc::alloc()`
  /// (`Global`) or the discrete allocator (`Isolated`)
  declare params: MiriAllocParams;

  /** Views of the bytes are not allocations. */
  static get [Symbol.species](): Uint8ArrayConstructor {
    return Uint8Array;
  }
}

/** `unported` text of a not-yet-ported fn of this file (the `stub_*` format, src/rust_ts/miri_stub.ts). */
function unported_here(name: string): never {
  return unported(`miri::alloc::alloc_bytes::MiriAllocBytes::${name} (src/tools/miri/src/alloc/alloc_bytes.rs; lane miri-alloc)`);
}

// impl AllocBytes for MiriAllocBytes
// type AllocParams = MiriAllocParams;
// PORT(contract) (lane interp-miri-reconcile): `MiriMachine`'s `Machine.Bytes` (machine.ts); its fns stop `unported` until
// lane miri-alloc ports them in place (markers alloc/alloc_bytes.rs:111 from_bytes, :136 zeroed, :149 as_mut_ptr,
// :153 as_ptr).
export const AllocBytes_MiriAllocBytes: AllocBytes<MiriAllocBytes, MiriAllocParams> = {
  from_bytes(_slice: Uint8Array, _align: Align, _params: MiriAllocParams): MiriAllocBytes {
    return unported_here("from_bytes");
  },
  zeroed(_size: Size, _align: Align, _params: MiriAllocParams): MiriAllocBytes | undefined {
    return unported_here("zeroed");
  },
  as_mut_ptr(_self: MiriAllocBytes): Uint8Array {
    return unported_here("as_mut_ptr");
  },
  as_ptr(_self: MiriAllocBytes): Uint8Array {
    return unported_here("as_ptr");
  },
};

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Clone for MiriAllocBytes (alloc/alloc_bytes.rs:35): clone (:36)
// impl Drop for MiriAllocBytes (alloc/alloc_bytes.rs:43): drop (:44)
// impl std::ops::Deref for MiriAllocBytes (alloc/alloc_bytes.rs:64): deref (:67)
// impl std::ops::DerefMut for MiriAllocBytes (alloc/alloc_bytes.rs:74): deref_mut (:75)
// impl MiriAllocBytes (alloc/alloc_bytes.rs:82) [MiriAllocBytes is not a generated class: companion fns / hand type, lane decides]: alloc_with (:86)
// impl AllocBytes for MiriAllocBytes (alloc/alloc_bytes.rs:108): from_bytes (:111), zeroed (:136), as_mut_ptr (:149), as_ptr (:153) [the stub table `AllocBytes_MiriAllocBytes` above]
