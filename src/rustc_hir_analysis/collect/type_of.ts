// Port of compiler/rustc_hir_analysis/src/collect/type_of.rs (STUB, lane collect-a):
// see docs/handoff/hirtylowerer-contract.md "How to fill a stub".
//
// The free fns below have their final signatures (decls.ts `Fns_*`); fill the bodies in place, add the marker and drop the
// `(stub ..)` comment.
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import type { HirId } from "../../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import type { EarlyBinder } from "../../rustc_type_ir/decls.ts";
import type { HirTyLowerer, ItemCtxt } from "../decls.ts";
import { unported } from "../../std/panic.ts";

// mod opaque;
import "./type_of/opaque.ts";

// collect/type_of.rs:21 (stub; final signature: decls.ts `Fns_collect_type_of`)
export function type_of(_tcx: TyCtxt, _def_id: LocalDefId): EarlyBinder<Ty> {
  return unported("rustc_hir_analysis::collect::type_of::type_of");
}

// collect/type_of.rs:290 (stub; final signature: decls.ts `Fns_collect_type_of`)
export function type_of_opaque(_tcx: TyCtxt, _def_id: DefId): EarlyBinder<Ty> {
  return unported("rustc_hir_analysis::collect::type_of::type_of_opaque");
}

// collect/type_of.rs:333 (stub; final signature: decls.ts `Fns_collect_type_of`)
export function type_of_opaque_hir_typeck(_tcx: TyCtxt, _def_id: LocalDefId): EarlyBinder<Ty> {
  return unported("rustc_hir_analysis::collect::type_of::type_of_opaque_hir_typeck");
}

// collect/type_of.rs:369 (stub; final signature: decls.ts `Fns_collect_type_of`)
export function anon_const_type_of(_icx: ItemCtxt, _def_id: LocalDefId): Ty {
  return unported("rustc_hir_analysis::collect::type_of::anon_const_type_of");
}

// collect/type_of.rs:412 (stub; final signature: decls.ts `Fns_collect_type_of`)
export function const_arg_anon_type_of(_icx: ItemCtxt, _arg_hir_id: HirId, _span: Span): Ty {
  return unported("rustc_hir_analysis::collect::type_of::const_arg_anon_type_of");
}

// collect/type_of.rs:448 (stub; final signature: decls.ts `Fns_collect_type_of`)
export function infer_placeholder_type(_cx: HirTyLowerer, _def_id: LocalDefId, _hir_body_id: HirId | undefined, _ty_span: Span, _body_span: Span, _item_ident: Ident, _kind: string): Ty {
  return unported("rustc_hir_analysis::collect::type_of::infer_placeholder_type");
}

// collect/type_of.rs:557 (stub; final signature: decls.ts `Fns_collect_type_of`)
export function check_feature_inherent_assoc_ty(_tcx: TyCtxt, _span: Span): void {
  return unported("rustc_hir_analysis::collect::type_of::check_feature_inherent_assoc_ty");
}

// collect/type_of.rs:571 (stub; final signature: decls.ts `Fns_collect_type_of`)
export function type_alias_is_checked(_tcx: TyCtxt, _def_id: LocalDefId): boolean {
  return unported("rustc_hir_analysis::collect::type_of::type_alias_is_checked");
}
