// Port of compiler/rustc_ty_walk/src/lib.rs (lane ty-utils; upstream's former rustc_ty_utils `sig_types.rs`).
//! This crate contains a helper for walking all types of a signature, while preserving spans as
//! much as possible
//
// PORT (D4): `SpannedTypeVisitor::visit` is generic over `impl TypeVisitable`; it takes the value's descriptor last.
// PORT: `type Result: VisitorResult = ()` is the impl object in the visitor's `Result` property (rustc_ast_ir/visit.ts);
// `try_visit!` expands to `if ((r = try_visit(visitor.Result, e)) !== undefined) return r;`.
// PORT: tracing (`#[instrument]`, `trace!`) is left out.
import { try_visit, type VisitorResult } from "../rustc_ast_ir/visit.ts";
import { debug_DefKind, type DefKind } from "../rustc_hir/def.ts";
import { FnRetTy, Node } from "../rustc_hir/hir.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AdtDef } from "../rustc_middle/ty/decls.ts";
import { fold_GenericArg, type GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { GenericClauses } from "../rustc_middle/ty/generics.ts";
import type { InstantiatedClauses } from "../rustc_middle/ty/mod.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { AnonConstKind } from "../rustc_type_ir/const_kind.ts";
import { type FnSig, PolyFnSig, debug_TyKind } from "../rustc_type_ir/ty_kind.ts";
import type { TraitRef } from "../rustc_type_ir/predicate.ts";
import { Unnormalized, visit_with_Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, visit_with_slice } from "../rustc_type_ir/visit.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import { unwrap } from "../std/panic.ts";

// rustc-trait: compiler/rustc_ty_walk/src/lib.rs:14 SpannedTypeVisitor
export interface SpannedTypeVisitor<R = undefined> {
  /** `type Result: VisitorResult = ();` (the impl object, module comment). */
  readonly Result: VisitorResult<R, unknown>;
  // rustc: compiler/rustc_ty_walk/src/lib.rs:16 visit
  visit<T>(span: Span, value: T, d: TypeVisitable<T>): R;
}

/** PORT (D4): the descriptors of the values `walk_types` visits that have no shared one. */
const visit_Binder_Ty: TypeVisitable<Binder<Ty>> = {
  visit_with: (self, visitor) => visitor.visit_binder(self, fold_Ty),
};
const visit_Unnormalized_Ty: TypeVisitable<Unnormalized<Ty>> = {
  visit_with: (self, visitor) => visit_with_Unnormalized(self, visitor, fold_Ty.visit_with),
};
const visit_GenericArg_slice: TypeVisitable<readonly GenericArg[]> = {
  visit_with: (self, visitor) => visit_with_slice(self, visitor, fold_GenericArg.visit_with),
};

// #[instrument(level = "trace", skip(tcx, visitor))]
// rustc: compiler/rustc_ty_walk/src/lib.rs:20 walk_types
export function walk_types<R>(tcx: TyCtxt, item: LocalDefId, visitor: SpannedTypeVisitor<R>): R {
  let r: R | undefined;
  const kind: DefKind = tcx.def_kind(item);
  // trace!(?kind);
  const visit_alias = (): R => {
    let r: R | undefined;
    const ty = Node.ty(tcx.hir_node_by_def_id(item));
    if (ty !== undefined) {
      // If the type of the item uses `_`, we're gonna error out anyway, but
      // typeck (which type_of invokes below), will call back into opaque_types_defined_by
      // causing a cycle. So we just bail out in this case.
      if (ty.is_suggestable_infer_ty()) {
        return visitor.Result.output();
      }
      // Associated types in traits don't necessarily have a type that we can visit
      if (
        (r = try_visit(
          visitor.Result,
          visitor.visit(ty.span, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(item) as EarlyBinder<Ty>)), fold_Ty),
        )) !== undefined
      )
        return r;
    }
    for (const [clause, span] of explicit_clauses_of(tcx, item)) {
      if ((r = try_visit(visitor.Result, visitor.visit(span, Unnormalized.skip_norm_wip(clause), fold_Clause))) !== undefined) return r;
    }
    return visitor.Result.output();
  };
  switch (kind.$) {
    // Walk over the signature of the function
    case "AssocFn":
    case "Fn": {
      const hir_sig = unwrap(Node.fn_decl(tcx.hir_node_by_def_id(item)));
      // If the type of the item uses `_`, we're gonna error out anyway, but
      // typeck (which type_of invokes below), will call back into opaque_types_defined_by
      // causing a cycle. So we just bail out in this case.
      if (FnRetTy.is_suggestable_infer_ty(hir_sig.output) !== undefined) {
        return visitor.Result.output();
      }
      const ty_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(item) as EarlyBinder<Binder<FnSig>>));
      // Walk over the inputs and outputs manually in order to get good spans for them.
      if ((r = try_visit(visitor.Result, visitor.visit(FnRetTy.span(hir_sig.output), PolyFnSig.output(ty_sig), visit_Binder_Ty))) !== undefined) return r;
      const inputs = [...Binder.iter(PolyFnSig.inputs(ty_sig))];
      for (let i = 0; i < Math.min(hir_sig.inputs.length, inputs.length); i++) {
        const hir = hir_sig.inputs[i]!;
        const ty = inputs[i]!;
        if ((r = try_visit(visitor.Result, visitor.visit(hir.span, Binder.map_bound(ty, (x) => x), visit_Binder_Ty))) !== undefined) return r;
      }
      for (const [clause, span] of explicit_clauses_of(tcx, item)) {
        if ((r = try_visit(visitor.Result, visitor.visit(span, Unnormalized.skip_norm_wip(clause), fold_Clause))) !== undefined) return r;
      }
      break;
    }
    // Walk over the type behind the alias or the type of the item
    case "TyAlias":
    case "AssocTy":
    case "Static":
    case "Const":
    case "AssocConst":
      return visit_alias();
    case "AnonConst":
      if ((tcx.anon_const_kind(item) as AnonConstKind) !== "NonTypeSystemInline") {
        return visit_alias();
      }
      // These are not part of a public API, they can only appear as hidden types, and there
      // the interesting parts are solely in the signature of the containing item's opaque type
      // or dyn type.
      break;
    case "Closure":
    case "SyntheticCoroutineBody":
      break;
    case "OpaqueTy": {
      for (const [pred, span] of [...EarlyBinder.iter_identity_copied(tcx.explicit_item_bounds(item) as EarlyBinder<readonly (readonly [Clause, Span])[]>)].map(
        Unnormalized.skip_norm_wip,
      )) {
        if ((r = try_visit(visitor.Result, visitor.visit(span, pred, fold_Clause))) !== undefined) return r;
      }
      break;
    }
    // Look at field types
    case "Struct":
    case "Union":
    case "Enum": {
      const span = unwrap(tcx.def_ident_span(item));
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(item) as EarlyBinder<Ty>));
      if ((r = try_visit(visitor.Result, visitor.visit(span, ty, fold_Ty))) !== undefined) return r;
      const k = ty.kind();
      if (k.$ !== "Adt") {
        return span_bug(span, `invalid type for ${debug_DefKind(kind, PLAIN)}: ${debug_TyKind(ty.kind(), PRETTY)}`);
      }
      const def: AdtDef = k._0;
      const args = k._1;
      for (const field of def.all_fields()) {
        const span = unwrap(tcx.def_ident_span(field.did));
        const ty = field.ty(tcx, args);
        if ((r = try_visit(visitor.Result, visitor.visit(span, ty, visit_Unnormalized_Ty))) !== undefined) return r;
      }
      for (const [clause, span] of explicit_clauses_of(tcx, item)) {
        if ((r = try_visit(visitor.Result, visitor.visit(span, Unnormalized.skip_norm_wip(clause), fold_Clause))) !== undefined) return r;
      }
      break;
    }
    case "Impl": {
      if (kind.of_trait) {
        const span = unwrap(Node.expect_item(tcx.hir_node_by_def_id(item)).expect_impl().of_trait).trait_ref.path.span;
        const args = (Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.impl_trait_ref(item))) as TraitRef).args.slice(1);
        if ((r = try_visit(visitor.Result, visitor.visit(span, args, visit_GenericArg_slice))) !== undefined) return r;
      }
      const hir_ty = Node.ty(tcx.hir_node_by_def_id(item));
      const span = hir_ty !== undefined ? hir_ty.span : tcx.def_span(item);
      if (
        (r = try_visit(
          visitor.Result,
          visitor.visit(span, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(item) as EarlyBinder<Ty>)), fold_Ty),
        )) !== undefined
      )
        return r;
      for (const [clause, span] of explicit_clauses_of(tcx, item)) {
        if ((r = try_visit(visitor.Result, visitor.visit(span, Unnormalized.skip_norm_wip(clause), fold_Clause))) !== undefined) return r;
      }
      break;
    }
    case "TraitAlias":
    case "Trait": {
      for (const [clause, span] of explicit_clauses_of(tcx, item)) {
        if ((r = try_visit(visitor.Result, visitor.visit(span, Unnormalized.skip_norm_wip(clause), fold_Clause))) !== undefined) return r;
      }
      break;
    }
    case "Variant":
    case "TyParam":
    case "ConstParam":
    case "Ctor":
    case "Field":
    case "LifetimeParam":
      return span_bug(
        tcx.def_span(item),
        `${debug_DefKind(kind, PLAIN)} has not seen any uses of \`walk_types\` yet, ping oli-obk if you'd like any help`,
      );
    // These don't have any types, but are visited during privacy checking.
    case "ExternCrate":
    case "ForeignMod":
    case "ForeignTy":
    case "Macro":
    case "GlobalAsm":
    case "Mod":
    case "Use":
    case "TestBinderConstraints":
      break;
  }
  return visitor.Result.output();
}

/** PORT: `tcx.explicit_clauses_of(item).instantiate_identity(tcx)`, an adapter for the query value typed `unknown` in
 *  queries.gen.ts (not an upstream fn). */
function explicit_clauses_of(tcx: TyCtxt, item: LocalDefId): InstantiatedClauses {
  return GenericClauses.instantiate_identity(tcx.explicit_clauses_of(item) as GenericClauses, tcx);
}
