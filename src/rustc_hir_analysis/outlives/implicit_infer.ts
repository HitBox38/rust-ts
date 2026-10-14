// Port of compiler/rustc_hir_analysis/src/outlives/implicit_infer.rs (lane variance-outlives).
//
// PORT notes (file-wide):
// - `FxIndexMap<DefId, ty::EarlyBinder<'_, RequiredClauses<'_>>>` is a `DefIdMap` (insertion-ordered, as `IndexMap`;
//   `insert` on a present key keeps its position, as `IndexMap::insert` does).
// - `for i in 0..` is an unbounded counting loop.
// - `debug!` / `#[tracing::instrument]` are tracing only and stay as comments; `IgnoreClausesReferencingSelf`'s derived
//   Debug is only read by that tracing and is not ported.
// Init order: top-level code here touches only other crates.
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { type DefId, DefIdMap, LocalDefId } from "../../rustc_span/def_id.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { as_interner, PolyExistentialTraitRef } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { ExplicitClausesMap } from "./explicit.ts";
import { type ArgOutlivesClause, d_ArgOutlivesClause, insert_outlives_clause, new_RequiredClauses, type RequiredClauses } from "./utils.ts";
import type { OwnerId } from "../../rustc_hir_id/lib.ts";

/// Infer outlives-clauses for the items in the local crate.
// rustc: compiler/rustc_hir_analysis/src/outlives/implicit_infer.rs:12 infer_clauses
export function infer_clauses(tcx: TyCtxt): DefIdMap<EarlyBinder<RequiredClauses>> {
  // debug!("infer_clauses");

  const explicit_map = ExplicitClausesMap.new();

  const global_inferred_outlives = new DefIdMap<EarlyBinder<RequiredClauses>>();

  // If new clauses were added then we need to re-calculate
  // all crates since there could be new implied clauses.
  for (let i = 0; ; i++) {
    const clauses_added: OwnerId[] = [];

    // Visit all the crates and infer clauses
    for (const id of tcx.hir_free_items()) {
      const item_did = id.owner_id;

      // debug!("InferVisitor::visit_item(item={:?})", item_did);

      const item_required_clauses = new_RequiredClauses();
      const def_kind = tcx.def_kind(item_did.def_id);
      if (def_kind.$ === "Union" || def_kind.$ === "Enum" || def_kind.$ === "Struct") {
        const adt_def = tcx.adt_def(LocalDefId.to_def_id(item_did.def_id)) as AdtDef;

        // Iterate over all fields in item_did
        for (const field_def of adt_def.all_fields()) {
          // Calculating the clause requirements necessary
          // for item_did.
          //
          // For field of type &'a T (reference) or Adt
          // (struct/enum/union) there will be outlive
          // requirements for adt_def.
          const field_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(field_def.did) as EarlyBinder<Ty>));
          const field_span = tcx.def_span(field_def.did);
          insert_required_clauses_to_be_wf(tcx, field_ty, field_span, global_inferred_outlives, item_required_clauses, explicit_map);
        }
      } else if (def_kind.$ === "TyAlias" && tcx.type_alias_is_checked(item_did.def_id)) {
        insert_required_clauses_to_be_wf(
          tcx,
          Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(item_did.def_id) as EarlyBinder<Ty>)),
          tcx.def_span(item_did.def_id),
          global_inferred_outlives,
          item_required_clauses,
          explicit_map,
        );
      } else {
        // _ => {}
      }

      // If new clauses were added (`local_clause_map` has more
      // clauses than the `global_inferred_outlives`), the new clauses
      // might result in implied clauses for their parent types.
      // Therefore mark `clauses_added` as true and which will ensure
      // we walk the crates again and re-calculate clauses for all
      // items.
      const c = global_inferred_outlives.get(LocalDefId.to_def_id(item_did.def_id));
      const item_clauses_len: number = c === undefined ? 0 : EarlyBinder.skip_binder(EarlyBinder.as_ref(c)).size;
      if (item_required_clauses.size > item_clauses_len) {
        clauses_added.push(item_did);
        global_inferred_outlives.set(LocalDefId.to_def_id(item_did.def_id), EarlyBinder.bind_iter(item_required_clauses));
      }
    }

    if (clauses_added.length === 0) {
      // We've reached a fixed point.
      break;
    } else if (!tcx.recursion_limit().value_within_limit(i)) {
      let msg: string;
      if (clauses_added.length === 1) {
        const id = clauses_added[0]!;
        msg = `overflow computing implied lifetime bounds for \`${tcx.def_path_str(LocalDefId.to_def_id(id.def_id))}\``;
      } else {
        msg = "overflow computing implied lifetime bounds";
      }
      tcx.dcx().span_fatal(
        clauses_added.map((id) => tcx.def_span(id.def_id)),
        msg,
      );
    }
  }

  return global_inferred_outlives;
}

// rustc: compiler/rustc_hir_analysis/src/outlives/implicit_infer.rs:110 insert_required_clauses_to_be_wf
function insert_required_clauses_to_be_wf(
  tcx: TyCtxt,
  ty: Ty,
  span: Span,
  global_inferred_outlives: DefIdMap<EarlyBinder<RequiredClauses>>,
  required_clauses: RequiredClauses,
  explicit_map: ExplicitClausesMap,
): void {
  for (const arg of ty.walk()) {
    const ak = GenericArg.kind(arg);
    let leaf_ty: Ty;
    switch (ak.$) {
      case "Type":
        leaf_ty = ak._0;
        break;

      // No clauses from lifetimes or constants, except potentially
      // constants' types, but `walk` will get to them as well.
      case "Lifetime":
      case "Const":
        continue;
    }

    const k = leaf_ty.kind();
    if (k.$ === "Ref") {
      const [region, rty] = [k._0, k._1];
      // The type is `&'a T` which means that we will have
      // a clause requirement of `T: 'a` (`T` outlives `'a`).
      //
      // We also want to calculate potential clauses for the `T`.
      // debug!("Ref");
      insert_outlives_clause(tcx, GenericArg.from_Ty(rty), region, span, required_clauses);
    } else if (k.$ === "Adt") {
      const [def, args] = [k._0 as AdtDef, k._1];
      // For ADTs (structs/enums/unions), we check inferred and explicit clauses.
      // debug!("Adt");
      check_inferred_clauses(tcx, def.did(), args, global_inferred_outlives, required_clauses);
      check_explicit_clauses(tcx, def.did(), args, required_clauses, explicit_map, "No");
    } else if (k.$ === "Alias" && k._1.kind.$ === "Free") {
      const [def_id, args] = [k._1.kind.def_id, k._1.args];
      // This corresponds to a type like `Type<'a, T>`.
      // We check inferred and explicit clauses.
      // debug!("Free");
      check_inferred_clauses(tcx, def_id, args, global_inferred_outlives, required_clauses);
      check_explicit_clauses(tcx, def_id, args, required_clauses, explicit_map, "No");
    } else if (k.$ === "Dynamic") {
      const obj = k._0;
      // This corresponds to `dyn Trait<..>`. In this case, we should
      // use the explicit clauses as well.
      // debug!("Dynamic");
      const trait_ref = obj.principal();
      if (trait_ref !== undefined) {
        const args = Binder.skip_binder(PolyExistentialTraitRef.with_self_ty(trait_ref, as_interner(tcx), tcx.types.trait_object_dummy_self)).args;
        // We skip clauses that reference the `Self` type parameter since we don't
        // want to leak the dummy Self to the clauses map.
        //
        // While filtering out bounds like `Self: 'a` as in `trait Trait<'a, T>: 'a {}`
        // doesn't matter since they can't affect the lifetime / type parameters anyway,
        // for bounds like `Self::AssocTy: 'b` which we of course currently also ignore
        // (see also #54467) it might conceivably be better to extract the binding
        // `AssocTy = U` from the trait object type (which must exist) and thus infer
        // an outlives requirement that `U: 'b`.
        check_explicit_clauses(tcx, PolyExistentialTraitRef.def_id(trait_ref), args, required_clauses, explicit_map, "Yes");
      }
    } else if (k.$ === "Alias" && k._1.kind.$ === "Projection") {
      const [def_id, args] = [k._1.kind.def_id, k._1.args];
      // This corresponds to a type like `<() as Trait<'a, T>>::Type`.
      // We only use the explicit clauses of the trait but
      // not the ones of the associated type itself.
      // debug!("Projection");
      check_explicit_clauses(tcx, tcx.parent(def_id), args, required_clauses, explicit_map, "No");
    } else if (k.$ === "Alias" && k._1.kind.$ === "Inherent") {
      // FIXME(inherent_associated_types): Use the explicit clauses from the parent impl.
    } else {
      // _ => {}
    }
  }
}

/// Check the explicit clauses declared on the type.
///
/// ### Example
///
/// ```ignore (illustrative)
/// struct Outer<'a, T> {
///     field: Inner<T>,
/// }
///
/// struct Inner<U> where U: 'static, U: Outer {
///     // ...
/// }
/// ```
/// Here, we should fetch the explicit clauses, which
/// will give us `U: 'static` and `U: Outer`. The latter we
/// can ignore, but we will want to process `U: 'static`,
/// applying the instantiation as above.
// #[tracing::instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_hir_analysis/src/outlives/implicit_infer.rs:248 check_explicit_clauses
function check_explicit_clauses(
  tcx: TyCtxt,
  def_id: DefId,
  args: readonly GenericArg[],
  required_clauses: RequiredClauses,
  explicit_map: ExplicitClausesMap,
  ignore_clauses_refing_self: IgnoreClausesReferencingSelf,
): void {
  const explicit_clauses = explicit_map.explicit_clauses_of(tcx, def_id);

  for (const [clause_, span] of EarlyBinder.skip_binder(EarlyBinder.as_ref(explicit_clauses))) {
    const arg_ = clause_._0;
    // debug!(?clause);

    if (ignore_clauses_refing_self === "Yes" && iter_any(GenericArg.walk(arg_), (arg) => arg === GenericArg.from_Ty(tcx.types.self_param))) {
      // debug!("ignoring clause since it references `Self`");
      continue;
    }

    const clause: ArgOutlivesClause = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.rebind(explicit_clauses, clause_), tcx, args, d_ArgOutlivesClause));
    const [arg, region] = [clause._0, clause._1];
    // debug!(?clause);

    insert_outlives_clause(tcx, arg, region, span, required_clauses);
  }
}

// #[derive(Debug)]
// rustc-type: compiler/rustc_hir_analysis/src/outlives/implicit_infer.rs:277 IgnoreClausesReferencingSelf
type IgnoreClausesReferencingSelf = "Yes" | "No";

/// Check the inferred clauses of the type.
///
/// ### Example
///
/// ```ignore (illustrative)
/// struct Outer<'a, T> {
///     outer: Inner<'a, T>,
/// }
///
/// struct Inner<'b, U> {
///     inner: &'b U,
/// }
/// ```
///
/// Here, when processing the type of field `outer`, we would request the
/// set of implicit clauses computed for `Inner` thus far. This will
/// initially come back empty, but in next round we will get `U: 'b`.
/// We then apply the instantiation `['b => 'a, U => T]` and thus get the
/// requirement that `T: 'a` holds for `Outer`.
// rustc: compiler/rustc_hir_analysis/src/outlives/implicit_infer.rs:301 check_inferred_clauses
function check_inferred_clauses(
  tcx: TyCtxt,
  def_id: DefId,
  args: readonly GenericArg[],
  global_inferred_outlives: DefIdMap<EarlyBinder<RequiredClauses>>,
  required_clauses: RequiredClauses,
): void {
  // Load the current set of inferred and explicit clauses from `global_inferred_outlives`
  // and filter the ones that are `TypeOutlives`.

  const clauses = global_inferred_outlives.get(def_id);
  if (clauses === undefined) {
    return;
  }

  for (const [clause, span] of EarlyBinder.skip_binder(EarlyBinder.as_ref(clauses))) {
    // `clause` is `U: 'b` in the example above.
    // So apply the instantiation to get `T: 'a`.
    const instantiated = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.rebind(clauses, clause), tcx, args, d_ArgOutlivesClause));
    const [arg, region] = [instantiated._0, instantiated._1];
    insert_outlives_clause(tcx, arg, region, span, required_clauses);
  }
}

/** `Iterator::any` */
function iter_any<T>(it: Iterable<T>, f: (x: T) => boolean): boolean {
  for (const x of it) if (f(x)) return true;
  return false;
}
