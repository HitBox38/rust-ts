// Port of compiler/rustc_hir_typeck/src/lib.rs (STUB, lane fnctxt-contract): see docs/handoff/fnctxt-contract.md "How to
// fill a stub".
//
// Every fn of this file is declared in ../decls.ts under `// lib.rs:<line>`:
// - methods of FnCtxt and the other contract classes: assign each onto the prototype in upstream order
//   (`FnCtxt.prototype.<name> = function (this: FnCtxt, ..): R { .. };`) with the marker
//   `// rustc: compiler/rustc_hir_typeck/src/lib.rs:<line> <name>` directly above it, then delete the name from the
//   `unported_methods(..)` list below (and the call when the list is empty);
// - free fns have their final signatures (decls.ts `Fns_*`): fill the body in place, add the marker and drop the
//   `(stub ..)` comment;
// - comment-only declarations (helper types, trait impls, nested fns): pick the form (decls.ts, last section).
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every
// other rustc_hir_typeck export is read inside function bodies only.
export * from "./lib.gen.ts";
import { unported_methods } from "../rust_ts/stubs.ts";
import { unported } from "../std/panic.ts";
import { FnCtxt } from "./decls.ts";
import { EnclosingBreakables } from "./lib.gen.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { ObligationInspector } from "../rustc_infer/traits/mod.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";

unported_methods(FnCtxt.prototype, "rustc_hir_typeck::FnCtxt", ["report_unexpected_variant_res"]);
unported_methods(EnclosingBreakables.prototype, "rustc_hir_typeck::EnclosingBreakables", ["find_breakable", "opt_find_breakable"]);

// lib.rs:80 (stub; final signature: decls.ts `Fns_lib`)
export function used_trait_imports(tcx: TyCtxt, def_id: LocalDefId): Set<LocalDefId> {
  return unported("rustc_hir_typeck::used_trait_imports");
}

// lib.rs:84 (stub; final signature: decls.ts `Fns_lib`)
export function typeck_root(tcx: TyCtxt, def_id: LocalDefId): TypeckResults {
  return unported("rustc_hir_typeck::typeck_root");
}

// lib.rs:92 (stub; final signature: decls.ts `Fns_lib`)
export function inspect_typeck(tcx: TyCtxt, def_id: LocalDefId, inspect: ObligationInspector): TypeckResults {
  return unported("rustc_hir_typeck::inspect_typeck");
}

// lib.rs:108 (stub; final signature: decls.ts `Fns_lib`)
export function typeck_with_inspect(tcx: TyCtxt, def_id: LocalDefId, inspector: ObligationInspector | undefined): TypeckResults {
  return unported("rustc_hir_typeck::typeck_with_inspect");
}

// lib.rs:279 (stub; final signature: decls.ts `Fns_lib`)
export function extend_err_with_const_context(err: Diag, tcx: TyCtxt, node: hir.Node, expected_ty: Ty): void {
  return unported("rustc_hir_typeck::extend_err_with_const_context");
}

// lib.rs:375 (stub; final signature: decls.ts `Fns_lib`)
export function infer_type_if_missing(fcx: FnCtxt, node: hir.Node): Ty | undefined {
  return unported("rustc_hir_typeck::infer_type_if_missing");
}

// lib.rs:697 (stub; final signature: decls.ts `Fns_lib`)
export function fatally_break_rust(tcx: TyCtxt, span: Span): never {
  return unported("rustc_hir_typeck::fatally_break_rust");
}

// lib.rs:719 (stub; final signature: decls.ts `Fns_lib`)
export function provide(providers: Providers): void {
  return unported("rustc_hir_typeck::provide");
}
