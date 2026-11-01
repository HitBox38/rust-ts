// Port of src/tools/miri/src/alloc/mod.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-alloc` (plan-m6 wave 36). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into mod.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { isolated_alloc } from "./mod.gen.ts";
export * from "./mod.gen.ts";

// mod alloc_bytes;
// #[cfg(all(feature = "native-lib", unix))] pub mod isolated_alloc;  (PORT: built without `native-lib`, decision C6: the
// file alloc/isolated_alloc.rs is not compiled; the inline stub module below is, generated as the namespace `isolated_alloc`)
// PORT: the generated modules name `crate::alloc::isolated_alloc::IsolatedAlloc` as `IsolatedAlloc` of this module.
export type IsolatedAlloc = isolated_alloc.IsolatedAlloc;
export const debug_IsolatedAlloc = isolated_alloc.debug_IsolatedAlloc;

// pub use self::alloc_bytes::{MiriAllocBytes, MiriAllocParams};
export { MiriAllocBytes, MiriAllocParams } from "./alloc_bytes.ts";

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl IsolatedAlloc (inline `mod isolated_alloc`, alloc/mod.rs:12): new (:13), alloc (:17), alloc_zeroed (:21), dealloc (:25)
