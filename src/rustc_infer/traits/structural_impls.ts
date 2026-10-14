// Port of compiler/rustc_infer/src/traits/structural_impls.rs (lane infer-opaque-snapshot).
//
// Contract stub (lane infcx-contract): every fn of this file that ../decls.ts declares is an `unported`
// placeholder below. Fill them per docs/handoff/infcx-contract.md "How to fill a stub": port each fn in upstream
// order with its `// rustc:` marker, then delete its name from the `unported_methods` list (and the call when
// the list is empty) or replace the stub `export const`. Init order: top-level code here may touch only
// ../decls.ts (or ../../decls.ts), this file's .gen.ts and other crates.


import { unported } from "../../std/panic.ts";
import type { Debug, Fmt } from "../../std/fmt.ts";
import type { Obligation } from "./mod.gen.ts";
import type { MismatchedProjectionTypes, Normalized } from "./project.gen.ts";

// Stubs of the three manual `Debug` impls (re-exported by traits/mod.ts and traits/project.ts, where codegen looks
// for them).
export function debug_Normalized<T>(_v: Normalized<T>, _f: Fmt, _debug_T: Debug<T>): string {
  return unported("rustc_infer::traits::structural_impls::<Normalized as Debug>::fmt");
}
export function debug_Obligation<T>(_v: Obligation<T>, _f: Fmt, _debug_T: Debug<T>): string {
  return unported("rustc_infer::traits::structural_impls::<Obligation as Debug>::fmt");
}
export const debug_MismatchedProjectionTypes: Debug<MismatchedProjectionTypes> = () =>
  unported("rustc_infer::traits::structural_impls::<MismatchedProjectionTypes as Debug>::fmt");

