// Port of compiler/rustc_hir_typeck/src/naked_functions.rs (STUB, lane typeck-euv): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// naked_functions.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/naked_functions.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./naked_functions.gen.ts";
import { unported } from "../std/panic.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";

/** naked_functions.rs `struct CheckParameters` (`impl Visitor`; hand type, lane typeck-euv writes the class). */
export type CheckParameters = unknown;
/** naked_functions.rs `struct CheckInlineAssembly` (`impl Visitor`; hand type, lane typeck-euv writes the class). */
export type CheckInlineAssembly = unknown;

// naked_functions.rs:18 (stub; final signature: decls.ts `Fns_naked_functions`)
export function typeck_naked_fn(tcx: TyCtxt, def_id: LocalDefId, body: hir.Body): void {
  return unported("rustc_hir_typeck::naked_functions::typeck_naked_fn");
}

// naked_functions.rs:30 (stub; final signature: decls.ts `Fns_naked_functions`)
export function check_no_patterns(tcx: TyCtxt, params: readonly hir.Param[]): void {
  return unported("rustc_hir_typeck::naked_functions::check_no_patterns");
}

// naked_functions.rs:42 (stub; final signature: decls.ts `Fns_naked_functions`)
export function check_no_parameters_use(tcx: TyCtxt, body: hir.Body): void {
  return unported("rustc_hir_typeck::naked_functions::check_no_parameters_use");
}

// naked_functions.rs:74 (stub; final signature: decls.ts `Fns_naked_functions`)
export function check_asm(tcx: TyCtxt, def_id: LocalDefId, body: hir.Body): void {
  return unported("rustc_hir_typeck::naked_functions::check_asm");
}
