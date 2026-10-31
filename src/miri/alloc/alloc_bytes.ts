// Port of src/tools/miri/src/alloc/alloc_bytes.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-alloc` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into alloc_bytes.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type Pending } from "../../rustc_type_ir/decls.ts";
import type { MiriAllocParams } from "./alloc_bytes.gen.ts";
export * from "./alloc_bytes.gen.ts";

// rustc-type: src/tools/miri/src/alloc/alloc_bytes.rs:22 MiriAllocBytes
/// Allocation bytes that explicitly handle the layout of the data they're storing.
/// This is necessary to interface with native code that accesses the program store in Miri.
// PORT(contract): the `Machine::Bytes` of Miri (`impl AllocBytes for MiriAllocBytes`), a hand type: Rust holds a raw
// `ptr: *mut u8` from the global (or isolated, native-lib only) allocator. Its TS representation (bytes over a
// `Uint8Array`, the `AllocBytes` dictionary interp-generic introduces for `M::Bytes`) is lane miri-alloc's, against the
// interp-generic contract (docs/handoff/miri-contract.md "Bytes"). The fields are the upstream ones (the generated
// derive(Debug) reads them).
export interface MiriAllocBytes {
  /// Stored layout information about the allocation.
  layout: Pending<"std::alloc::Layout">;
  /// Pointer to the allocation contents.
  /// Invariant:
  /// * If `self.layout.size() == 0`, then `self.ptr` was allocated with the equivalent layout with size 1.
  /// * Otherwise, `self.ptr` points to memory allocated with `self.layout`.
  // PORT: a raw pointer, typed as its address (the generator maps `*mut u8` to its pointee); the representation is the
  // fill lane's.
  ptr: number;
  /// Whether this instance of `MiriAllocBytes` had its allocation created by calling `alloc::alloc()`
  /// (`Global`) or the discrete allocator (`Isolated`)
  params: MiriAllocParams;
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Clone for MiriAllocBytes (alloc/alloc_bytes.rs:35): clone (:36)
// impl Drop for MiriAllocBytes (alloc/alloc_bytes.rs:43): drop (:44)
// impl std::ops::Deref for MiriAllocBytes (alloc/alloc_bytes.rs:64): deref (:67)
// impl std::ops::DerefMut for MiriAllocBytes (alloc/alloc_bytes.rs:74): deref_mut (:75)
// impl MiriAllocBytes (alloc/alloc_bytes.rs:82) [MiriAllocBytes is not a generated class: companion fns / hand type, lane decides]: alloc_with (:86)
// impl AllocBytes for MiriAllocBytes (alloc/alloc_bytes.rs:108): from_bytes (:111), zeroed (:136), as_mut_ptr (:149), as_ptr (:153)
