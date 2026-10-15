// Port of compiler/rustc_hir_typeck/src/check.rs (STUB, lane typeck-lib-wb): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// check.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/check.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
import { unported } from "../std/panic.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { FnSig } from "../rustc_type_ir/decls.ts";
import type { FnCtxt } from "./decls.ts";
import type { CoroutineTypes } from "./lib.gen.ts";

// check.rs:28 (stub; final signature: decls.ts `Fns_check`)
export function check_fn(fcx: FnCtxt, fn_sig: FnSig, coroutine_types: CoroutineTypes | undefined, decl: hir.FnDecl, fn_def_id: LocalDefId, body: hir.Body, params_can_be_unsized: boolean): CoroutineTypes | undefined {
  return unported("rustc_hir_typeck::check::check_fn");
}

// check.rs:165 (stub; final signature: decls.ts `Fns_check`)
export function check_panic_info_fn(tcx: TyCtxt, fn_id: LocalDefId, fn_sig: FnSig): void {
  return unported("rustc_hir_typeck::check::check_panic_info_fn");
}

// check.rs:237 (stub; final signature: decls.ts `Fns_check`)
export function check_lang_start_fn(tcx: TyCtxt, fn_sig: FnSig, def_id: LocalDefId): void {
  return unported("rustc_hir_typeck::check::check_lang_start_fn");
}
