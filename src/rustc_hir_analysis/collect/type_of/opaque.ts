// Port of compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs (lane collect-a).
//
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import * as hir from "../../../rustc_hir/lib.ts";
import { All } from "../../../rustc_middle/hir/nested_filter.ts";
import type { AssocItem } from "../../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { type DefiningScopeKind, DefinitionSiteHiddenType, Ty } from "../../../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../../../rustc_middle/ty/typeck_results.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { type DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { assert, unported } from "../../../std/panic.ts";
import type { Result } from "../../../std/result.ts";
import * as diagnostics from "../../diagnostics.ts";

export * from "./opaque.gen.ts";

/// Checks "defining uses" of opaque `impl Trait` in associated types.
/// These can only be defined by associated items of the same trait.
// PORT: `#[instrument(skip(tcx), level = "debug")]` and the `debug!` / `trace!` calls (tracing) are dropped.
// rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:15 find_opaque_ty_constraints_for_impl_trait_in_assoc_type
export function find_opaque_ty_constraints_for_impl_trait_in_assoc_type(tcx: TyCtxt, def_id: LocalDefId, opaque_types_from: DefiningScopeKind): EarlyBinder<Ty> {
  let parent_def_id = def_id;
  while (tcx.def_kind(parent_def_id).$ === "OpaqueTy") {
    // Account for `type Alias = impl Trait<Foo = impl Trait>;` (#116031)
    parent_def_id = tcx.local_parent(parent_def_id);
  }
  const impl_def_id = tcx.local_parent(parent_def_id);
  const k = tcx.def_kind(impl_def_id);
  switch (k.$) {
    case "Impl":
      break;
    default:
      return bug(`invalid impl trait in assoc type parent: ${hir.def.debug_DefKind(k, PLAIN)}`);
  }

  const locator = new TaitConstraintLocator(tcx, def_id, undefined, opaque_types_from);

  for (const assoc_id of tcx.associated_item_def_ids(impl_def_id) as readonly DefId[]) {
    const assoc = tcx.associated_item(assoc_id) as AssocItem;
    switch (assoc.kind.$) {
      case "Const":
      case "Fn":
        locator.check(assoc_id.expect_local());
        break;
      // Associated types don't have bodies, so they can't constrain hidden types
      case "Type":
        break;
    }
  }

  const hidden = locator.found;
  if (hidden !== undefined) {
    return hidden.ty;
  } else {
    const guar = tcx.dcx().emit_err(
      diagnostics.UnconstrainedOpaqueType_diagnostic({
        span: tcx.def_span(def_id),
        name: tcx.item_ident(LocalDefId.to_def_id(parent_def_id)),
        what: "impl",
      }),
    );
    return EarlyBinder.bind(tcx, Ty.new_error(tcx, guar), fold_Ty);
  }
}

/// Checks "defining uses" of opaque `impl Trait` types to ensure that they meet the restrictions
/// laid for "higher-order pattern unification".
/// This ensures that inference is tractable.
/// In particular, definitions of opaque types can only use other generics as arguments,
/// and they cannot repeat an argument. Example:
///
/// ```ignore (illustrative)
/// type Foo<A, B> = impl Bar<A, B>;
///
/// // Okay -- `Foo` is applied to two distinct, generic types.
/// fn a<T, U>() -> Foo<T, U> { .. }
///
/// // Not okay -- `Foo` is applied to `T` twice.
/// fn b<T>() -> Foo<T, T> { .. }
///
/// // Not okay -- `Foo` is applied to a non-generic type.
/// fn b<T>() -> Foo<T, u32> { .. }
/// ```
// rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:75 find_opaque_ty_constraints_for_tait
export function find_opaque_ty_constraints_for_tait(tcx: TyCtxt, def_id: LocalDefId, opaque_types_from: DefiningScopeKind): EarlyBinder<Ty> {
  const locator = new TaitConstraintLocator(tcx, def_id, undefined, opaque_types_from);

  tcx.hir_walk_toplevel_module(locator);

  const hidden = locator.found;
  if (hidden !== undefined) {
    return hidden.ty;
  } else {
    let parent_def_id = def_id;
    while (tcx.def_kind(parent_def_id).$ === "OpaqueTy") {
      // Account for `type Alias = impl Trait<Foo = impl Trait>;` (#116031)
      parent_def_id = tcx.local_parent(parent_def_id);
    }
    const guar = tcx.dcx().emit_err(
      diagnostics.UnconstrainedOpaqueType_diagnostic({
        span: tcx.def_span(def_id),
        name: tcx.item_ident(LocalDefId.to_def_id(parent_def_id)),
        what: "crate",
      }),
    );
    return EarlyBinder.bind(tcx, Ty.new_error(tcx, guar), fold_Ty);
  }
}

// rustc-type: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:101 TaitConstraintLocator
export class TaitConstraintLocator extends hir.intravisit.Visitor {
  // `type NestedFilter = nested_filter::All;`
  override NestedFilter = All;

  constructor(
    public tcx: TyCtxt,

    /// def_id of the opaque type whose defining uses are being checked
    public def_id: LocalDefId,

    /// as we walk the defining uses, we are checking that all of them
    /// define the same hidden type. This variable is set to `Some`
    /// with the first type that we find, and then later types are
    /// checked against it (we also carry the span of that first
    /// type).
    public found: DefinitionSiteHiddenType | undefined,

    public opaque_types_from: DefiningScopeKind,
  ) {
    super();
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:118 insert_found
  insert_found(hidden_ty: DefinitionSiteHiddenType): void {
    const prev = this.found;
    if (prev !== undefined) {
      if (EarlyBinder.skip_binder(hidden_ty.ty) !== EarlyBinder.skip_binder(prev.ty)) {
        const r = prev.build_mismatch_error(hidden_ty, this.tcx);
        const guar = r.$ === "Ok" ? r._0.emit_err() : r._0;
        this.found = DefinitionSiteHiddenType.new_error(this.tcx, guar);
      }
    } else {
      this.found = hidden_ty;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:130 non_defining_use_in_defining_scope
  non_defining_use_in_defining_scope(item_def_id: LocalDefId): void {
    // We make sure that all opaque types get defined while
    // type checking the defining scope, so this error is unreachable
    // with the new solver.
    assert(!this.tcx.next_trait_solver_globally(), "assertion failed: !self.tcx.next_trait_solver_globally()");
    const guar = report_item_does_not_constrain_error(this.tcx, item_def_id, this.def_id, undefined);
    this.insert_found(DefinitionSiteHiddenType.new_error(this.tcx, guar));
  }

  // rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:140 check
  check(item_def_id: LocalDefId): void {
    // Don't try to check items that cannot possibly constrain the type.
    const tcx = this.tcx;
    if (!tcx.has_typeck_results(item_def_id)) {
      // debug!("no constraint: no typeck results");
      return;
    }

    const opaque_types_defined_by = tcx.opaque_types_defined_by(item_def_id) as readonly LocalDefId[];
    // Don't try to check items that cannot possibly constrain the type.
    if (!opaque_types_defined_by.includes(this.def_id)) {
      // debug!("no constraint: no opaque types defined");
      return;
    }

    // Function items with `_` in their return type already emit an error, skip any
    // "non-defining use" errors for them.
    // Note that we use `Node::fn_sig` instead of `Node::fn_decl` here, because the former
    // excludes closures, which are allowed to have `_` in their return type.
    const hir_node = tcx.hir_node_by_def_id(item_def_id);
    // debug_assert!(!matches!(hir_node, Node::ForeignItem(..)), "foreign items cannot constrain opaque types");
    const hir_sig = hir.Node.fn_sig(hir_node);
    if (hir_sig !== undefined && hir.FnRetTy.is_suggestable_infer_ty(hir_sig.decl.output) !== undefined) {
      const guar = this.tcx.dcx().span_delayed_bug(hir.FnRetTy.span(hir_sig.decl.output), "inferring return types and opaque types do not mix well");
      this.found = DefinitionSiteHiddenType.new_error(tcx, guar);
      return;
    }

    switch (this.opaque_types_from) {
      case "HirTypeck": {
        const tables = tcx.typeck(item_def_id) as TypeckResults;
        // PORT: typeck_results.ts still types `hidden_types`' values as a `Pending` alias of `ty::DefinitionSiteHiddenType`.
        const hidden_type = tables.hidden_types.get(this.def_id) as unknown as DefinitionSiteHiddenType | undefined;
        if (tables.tainted_by_errors !== undefined) {
          const guar = tables.tainted_by_errors;
          this.insert_found(DefinitionSiteHiddenType.new_error(tcx, guar));
        } else if (hidden_type !== undefined) {
          this.insert_found(hidden_type);
        } else {
          this.non_defining_use_in_defining_scope(item_def_id);
        }
        break;
      }
      case "MirBorrowck": {
        const r = tcx.mir_borrowck(item_def_id) as Result<Map<LocalDefId, DefinitionSiteHiddenType>, ErrorGuaranteed>;
        switch (r.$) {
          case "Err":
            this.insert_found(DefinitionSiteHiddenType.new_error(tcx, r._0));
            break;
          case "Ok": {
            const hidden_types = r._0;
            const hidden_type = hidden_types.get(this.def_id);
            let e: Result<null, ErrorGuaranteed>;
            if (hidden_type !== undefined) {
              // debug!(?hidden_type, "found constraint");
              this.insert_found(hidden_type);
            } else if (
              (e = TypeVisitableExt.error_reported(EarlyBinder.skip_binder(tcx.type_of_opaque_hir_typeck(this.def_id) as EarlyBinder<Ty>), fold_Ty)).$ === "Err"
            ) {
              this.insert_found(DefinitionSiteHiddenType.new_error(tcx, e._0));
            } else {
              this.non_defining_use_in_defining_scope(item_def_id);
            }
            break;
          }
        }
        break;
      }
    }
  }

  // impl<'tcx> intravisit::Visitor<'tcx> for TaitConstraintLocator<'tcx>

  // rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:208 maybe_tcx
  override maybe_tcx(): hir.intravisit.HirTyCtxt {
    return this.tcx;
  }
  // rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:211 visit_expr
  override visit_expr(ex: hir.Expr): undefined {
    return hir.intravisit.walk_expr(this, ex);
  }
  // rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:214 visit_item
  override visit_item(it: hir.Item): undefined {
    // trace!(?it.owner_id);
    this.check(it.owner_id.def_id);
    return hir.intravisit.walk_item(this, it);
  }
  // rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:219 visit_impl_item
  override visit_impl_item(it: hir.ImplItem): undefined {
    // trace!(?it.owner_id);
    this.check(it.owner_id.def_id);
    return hir.intravisit.walk_impl_item(this, it);
  }
  // rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:224 visit_trait_item
  override visit_trait_item(it: hir.TraitItem): undefined {
    // trace!(?it.owner_id);
    this.check(it.owner_id.def_id);
    return hir.intravisit.walk_trait_item(this, it);
  }
  // rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:229 visit_foreign_item
  override visit_foreign_item(it: hir.ForeignItem): undefined {
    // trace!(?it.owner_id);
    assert(it.owner_id.def_id !== this.def_id, "assertion `left != right` failed");
    // No need to call `check`, as we do not run borrowck on foreign items.
    return hir.intravisit.walk_foreign_item(this, it);
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/type_of/opaque.rs:237 find_opaque_ty_constraints_for_rpit
export function find_opaque_ty_constraints_for_rpit(tcx: TyCtxt, def_id: LocalDefId, owner_def_id: LocalDefId, opaque_types_from: DefiningScopeKind): EarlyBinder<Ty> {
  // When an opaque type is stranded, its hidden type cannot be inferred
  // so we should not continue.
  if (!(tcx.opaque_types_defined_by(owner_def_id) as readonly LocalDefId[]).includes(def_id)) {
    const opaque_type_span = tcx.def_span(def_id);
    const guar = tcx.dcx().span_delayed_bug(opaque_type_span, "cannot infer type for stranded opaque type");
    return EarlyBinder.bind(tcx, Ty.new_error(tcx, guar), fold_Ty);
  }

  switch (opaque_types_from) {
    case "HirTypeck": {
      const tables = tcx.typeck(owner_def_id) as TypeckResults;
      let hidden_ty: DefinitionSiteHiddenType | undefined;
      if (tables.tainted_by_errors !== undefined) {
        const guar = tables.tainted_by_errors;
        return EarlyBinder.bind(tcx, Ty.new_error(tcx, guar), fold_Ty);
      } else if ((hidden_ty = tables.hidden_types.get(def_id) as unknown as DefinitionSiteHiddenType | undefined) !== undefined) {
        return hidden_ty.ty;
      } else {
        assert(!tcx.next_trait_solver_globally(), "assertion failed: !tcx.next_trait_solver_globally()");
        // We failed to resolve the opaque type or it
        // resolves to itself. We interpret this as the
        // no values of the hidden type ever being constructed,
        // so we can just make the hidden type be `!`.
        // For backwards compatibility reasons, we fall back to
        // `()` until we the diverging default is changed.
        return EarlyBinder.bind(tcx, tcx.types.unit, fold_Ty);
      }
    }
    case "MirBorrowck": {
      const r = tcx.mir_borrowck(owner_def_id) as Result<Map<LocalDefId, DefinitionSiteHiddenType>, ErrorGuaranteed>;
      switch (r.$) {
        case "Ok": {
          const hidden_types = r._0;
          const hidden_ty = hidden_types.get(def_id);
          if (hidden_ty !== undefined) {
            return hidden_ty.ty;
          } else {
            const hir_ty = tcx.type_of_opaque_hir_typeck(def_id) as EarlyBinder<Ty>;
            const e = TypeVisitableExt.error_reported(EarlyBinder.skip_binder(hir_ty), fold_Ty);
            if (e.$ === "Err") {
              return EarlyBinder.bind(tcx, Ty.new_error(tcx, e._0), fold_Ty);
            } else {
              assert(!tcx.next_trait_solver_globally(), "assertion failed: !tcx.next_trait_solver_globally()");
              return hir_ty;
            }
          }
        }
        case "Err":
          return EarlyBinder.bind(tcx, Ty.new_error(tcx, r._0), fold_Ty);
      }
    }
  }
}

// ---- PORT(stand-in): upstream fns of crates not ported yet (not markers; repoint when they land) ----

/** `rustc_trait_selection::opaque_types::report_item_does_not_constrain_error` (rustc_trait_selection is not ported). */
function report_item_does_not_constrain_error(_tcx: TyCtxt, _item_def_id: LocalDefId, _def_id: LocalDefId, _non_defining_use: undefined): ErrorGuaranteed {
  return unported("rustc_trait_selection::opaque_types::report_item_does_not_constrain_error");
}
