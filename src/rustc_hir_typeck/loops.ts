// Port of compiler/rustc_hir_typeck/src/loops.rs (STUB, lane typeck-lib-wb): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// loops.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/loops.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./loops.gen.ts";
import { unported } from "../std/panic.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";

/** loops.rs `struct CheckLoopVisitor` (`impl Visitor`; hand type, lane typeck-lib-wb writes the class). */
export type CheckLoopVisitor = unknown;

// loops.rs:86 (stub; final signature: decls.ts `Fns_loops`)
export function check(tcx: TyCtxt, def_id: LocalDefId, body: hir.Body): void {
  return unported("rustc_hir_typeck::loops::check");
}
