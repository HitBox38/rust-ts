//! Constraint construction and representation
//!
//! The second pass over the HIR determines the set of constraints.
//! We walk the set of items and, for each member, generate new constraints.
//
// Port of compiler/rustc_hir_analysis/src/variance/constraints.rs (lane variance-outlives).
//
// PORT notes (file-wide):
// - The arena is erased (terms.ts header): `arena.alloc(term)` is the term object, `&*` is identity.
// - `match (*v1, *v2)` in `xform` keeps the arm order as an if-chain.
// - `map[&key]` (`Index`) is `unwrap(map.get(key), "key not found")`, the message of std's `HashMap` `Index` panic.
// - `#[instrument]` and `debug!` are tracing only and stay as comments.
// - `ty::Pattern` is pending in rustc_middle (ty/decls.ts), so `*pat` goes through the local stand-in `Pattern_kind`
//   (as rustc_type_ir walk.ts does), which stops as UNPORTED.
// - The fields `contravariant` / `invariant` share their names with the methods `contravariant()` / `invariant()`, so the
//   fields are `contravariant_` / `invariant_` (`covariant` / `bivariant` keep their names).
// Init order: top-level code here touches only other crates.
import type { ModuleItems } from "../../rustc_middle/hir/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Pattern } from "../../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import { Term, type Ty } from "../../rustc_middle/ty/mod.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { Variance } from "../../rustc_type_ir/lib.ts";
import type { PatternKind } from "../../rustc_type_ir/pattern.gen.ts";
import type { Const, Region } from "../../rustc_type_ir/sty/mod.ts";
import { debug_Region } from "../../rustc_type_ir/sty/mod.ts";
import { type FnSig, FnSig as FnSigC, PolyFnSigTys, UnsafeBinderInner } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import type { Mutability } from "../../rustc_ast_ir/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { unported, unwrap } from "../../std/panic.ts";
import { type InferredIndex, type TermsContext, type VarianceTerm, type VarianceTermPtr } from "./terms.ts";

/** `ty::TypeAndMut<'tcx>` (rustc_middle ty/sty.rs), a plain data struct. */
interface TypeAndMut {
  ty: Ty;
  mutbl: Mutability;
}

// rustc-type: compiler/rustc_hir_analysis/src/variance/constraints.rs:16 ConstraintContext
export class ConstraintContext {
  constructor(
    public terms_cx: TermsContext,

    // These are pointers to common `ConstantTerm` instances
    public covariant: VarianceTermPtr,
    public contravariant_: VarianceTermPtr,
    public invariant_: VarianceTermPtr,
    public bivariant: VarianceTermPtr,

    public constraints: Constraint[],
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:90 tcx
  tcx(): TyCtxt {
    return this.terms_cx.tcx;
  }

  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:94 build_constraints_for_item
  build_constraints_for_item(def_id: LocalDefId): void {
    const tcx = this.tcx();
    // debug!("build_constraints_for_item({})", tcx.def_path_str(def_id));

    // Skip items with no generics - there's nothing to infer in them.
    if ((tcx.generics_of(def_id) as Generics).is_empty()) {
      return;
    }

    const inferred_start = unwrap(this.terms_cx.inferred_starts.get(def_id), "key not found");
    const current_item: CurrentItem = { inferred_start };
    const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>));

    const k = ty.kind();
    switch (k.$) {
      case "Adt": {
        const def = k._0;
        // Not entirely obvious: constraints on structs/enums do not
        // affect the variance of their type parameters. See discussion
        // in comment at top of module.
        //
        // self.add_constraints_from_generics(generics);

        for (const field of def.all_fields()) {
          this.add_constraints_from_ty(current_item, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>)), this.covariant);
        }
        break;
      }

      case "FnDef": {
        this.add_constraints_from_sig(current_item, Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>)), this.covariant);
        break;
      }

      case "Error":
        break;

      default: {
        span_bug(tcx.def_span(def_id), "`build_constraints_for_item` unsupported for this item");
      }
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:143 add_constraint
  add_constraint(current: CurrentItem, index: number, variance: VarianceTermPtr): void {
    // debug!("add_constraint(index={}, variance={:?})", index, variance);
    this.constraints.push({
      inferred: (current.inferred_start + index) as InferredIndex,
      variance,
    });
  }

  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:151 contravariant
  contravariant(variance: VarianceTermPtr): VarianceTermPtr {
    return this.xform(variance, this.contravariant_);
  }

  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:155 invariant
  invariant(variance: VarianceTermPtr): VarianceTermPtr {
    return this.xform(variance, this.invariant_);
  }

  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:159 constant_term
  constant_term(v: Variance): VarianceTermPtr {
    switch (v) {
      case "Covariant":
        return this.covariant;
      case "Invariant":
        return this.invariant_;
      case "Contravariant":
        return this.contravariant_;
      case "Bivariant":
        return this.bivariant;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:168 xform
  xform(v1: VarianceTermPtr, v2: VarianceTermPtr): VarianceTermPtr {
    if (v2.$ === "ConstantTerm" && v2._0 === "Covariant") {
      // Applying a "covariant" transform is always a no-op
      return v1;
    }

    if (v1.$ === "ConstantTerm" && v2.$ === "ConstantTerm") {
      const [c1, c2] = [v1._0, v2._0];
      return this.constant_term(Variance.xform(c1, c2));
    }

    return { $: "TransformTerm", _0: v1, _1: v2 } satisfies VarianceTerm;
  }

  // #[instrument(level = "debug", skip(self, current))]
  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:182 add_constraints_from_invariant_args
  add_constraints_from_invariant_args(current: CurrentItem, args: GenericArgs, variance: VarianceTermPtr): void {
    // Trait are always invariant so we can take advantage of that.
    const variance_i = this.invariant(variance);

    for (const arg of args) {
      const k = GenericArg.kind(arg);
      switch (k.$) {
        case "Lifetime":
          this.add_constraints_from_region(current, k._0, variance_i);
          break;
        case "Type":
          this.add_constraints_from_ty(current, k._0, variance_i);
          break;
        case "Const":
          this.add_constraints_from_const(current, k._0, variance_i);
          break;
      }
    }
  }

  /// Adds constraints appropriate for an instance of `ty` appearing
  /// in a context with the generics defined in `generics` and
  /// ambient variance `variance`
  // #[instrument(level = "debug", skip(self, current))]
  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:208 add_constraints_from_ty
  add_constraints_from_ty(current: CurrentItem, ty: Ty, variance: VarianceTermPtr): void {
    const k = ty.kind();
    switch (k.$) {
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Str":
      case "Never":
      case "Foreign":
        // leaf type -- noop
        break;

      case "FnDef":
      case "Coroutine":
      case "Closure":
      case "CoroutineClosure":
        bug(`Unexpected unnameable type in variance computation: ${display_Ty(ty)}`);

      case "Ref": {
        const [region, ty, mutbl] = [k._0, k._1, k._2];
        this.add_constraints_from_region(current, region, variance);
        this.add_constraints_from_mt(current, { ty, mutbl }, variance);
        break;
      }

      case "Array": {
        const [typ, len] = [k._0, k._1];
        this.add_constraints_from_const(current, len, variance);
        this.add_constraints_from_ty(current, typ, variance);
        break;
      }

      case "Pat": {
        const [typ, pat] = [k._0, k._1];
        this.add_constraints_from_pat(current, variance, pat);
        this.add_constraints_from_ty(current, typ, variance);
        break;
      }

      case "Slice": {
        const typ = k._0;
        this.add_constraints_from_ty(current, typ, variance);
        break;
      }

      case "RawPtr": {
        const [ty, mutbl] = [k._0, k._1];
        this.add_constraints_from_mt(current, { ty, mutbl }, variance);
        break;
      }

      case "Tuple": {
        const subtys = k._0;
        for (const subty of subtys) {
          this.add_constraints_from_ty(current, subty, variance);
        }
        break;
      }

      case "Adt": {
        const [def, args] = [k._0 as AdtDef, k._1];
        this.add_constraints_from_args(current, def.did(), args, variance);
        break;
      }

      case "Alias": {
        const kind = k._1.kind;
        if (kind.$ === "Projection" || kind.$ === "Inherent" || kind.$ === "Opaque") {
          const args = k._1.args;
          this.add_constraints_from_invariant_args(current, args, variance);
        } else {
          // ty::Free { .. }
          const ty_ = this.tcx().expand_free_alias_tys(ty, fold_Ty);
          this.add_constraints_from_ty(current, ty_, variance);
        }
        break;
      }

      case "Dynamic": {
        const [data, r] = [k._0, k._1];
        // The type `dyn Trait<T> +'a` is covariant w/r/t `'a`:
        this.add_constraints_from_region(current, r, variance);

        const poly_trait_ref = data.principal();
        if (poly_trait_ref !== undefined) {
          this.add_constraints_from_invariant_args(current, Binder.skip_binder(poly_trait_ref).args, variance);
        }

        for (const projection of data.projection_bounds()) {
          const tk = Term.kind(Binder.skip_binder(projection).term);
          switch (tk.$) {
            case "Ty":
              this.add_constraints_from_ty(current, tk._0, this.invariant_);
              break;
            case "Const":
              this.add_constraints_from_const(current, tk._0, this.invariant_);
              break;
          }
        }
        break;
      }

      case "Param": {
        const data = k._0;
        this.add_constraint(current, data.index, variance);
        break;
      }

      case "FnPtr": {
        const [sig_tys, hdr] = [k._0, k._1];
        this.add_constraints_from_sig(current, PolyFnSigTys.with(sig_tys, hdr), variance);
        break;
      }

      case "UnsafeBinder": {
        const ty_ = k._0;
        // FIXME(unsafe_binders): This is covariant, right?
        this.add_constraints_from_ty(current, Binder.skip_binder(UnsafeBinderInner.into_Binder(ty_)), variance);
        break;
      }

      case "Error":
        // we encounter this when walking the trait references for object
        // types, where we use Error as the Self type
        break;

      case "Placeholder":
      case "CoroutineWitness":
      case "Bound":
      case "Infer":
        bug(`unexpected type encountered in variance inference: ${display_Ty(ty)}`);
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:327 add_constraints_from_pat
  add_constraints_from_pat(current: CurrentItem, variance: VarianceTermPtr, pat: Pattern): void {
    const k = Pattern_kind(pat);
    switch (k.$) {
      case "Range": {
        const [start, end] = [k.start, k.end];
        this.add_constraints_from_const(current, start, variance);
        this.add_constraints_from_const(current, end, variance);
        break;
      }
      case "NotNull":
        break;
      case "Or": {
        const patterns = k._0;
        for (const pat of patterns) {
          this.add_constraints_from_pat(current, variance, pat);
        }
        break;
      }
    }
  }

  /// Adds constraints appropriate for a nominal type (enum, struct,
  /// object, etc) appearing in a context with ambient variance `variance`
  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:349 add_constraints_from_args
  add_constraints_from_args(current: CurrentItem, def_id: DefId, args: GenericArgs, variance: VarianceTermPtr): void {
    // debug!(
    //     "add_constraints_from_args(def_id={:?}, args={:?}, variance={:?})",
    //     def_id, args, variance
    // );

    // We don't record `inferred_starts` entries for empty generics.
    if (args.length === 0) {
      return;
    }

    let local: InferredIndex | undefined;
    let remote: readonly Variance[] | undefined;
    const local_def_id = def_id.as_local();
    if (local_def_id !== undefined) {
      [local, remote] = [unwrap(this.terms_cx.inferred_starts.get(local_def_id), "key not found"), undefined];
    } else {
      [local, remote] = [undefined, this.tcx().variances_of(def_id) as readonly Variance[]];
    }

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      let variance_decl: VarianceTermPtr;
      if (local !== undefined) {
        const start = local;
        // Parameter on an item defined within current crate:
        // variance not yet inferred, so return a symbolic
        // variance.
        variance_decl = this.terms_cx.inferred_terms[start + i]!;
      } else {
        // Parameter on an item defined within another crate:
        // variance already inferred, just look it up.
        variance_decl = this.constant_term(remote![i]!);
      }
      const variance_i = this.xform(variance, variance_decl);
      // debug!(
      //     "add_constraints_from_args: variance_decl={:?} variance_i={:?}",
      //     variance_decl, variance_i
      // );
      const k = GenericArg.kind(arg);
      switch (k.$) {
        case "Lifetime":
          this.add_constraints_from_region(current, k._0, variance_i);
          break;
        case "Type":
          this.add_constraints_from_ty(current, k._0, variance_i);
          break;
        case "Const":
          this.add_constraints_from_const(current, k._0, variance);
          break;
      }
    }
  }

  /// Adds constraints appropriate for a const expression `val`
  /// in a context with ambient variance `variance`
  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:402 add_constraints_from_const
  add_constraints_from_const(current: CurrentItem, c: Const, variance: VarianceTermPtr): void {
    // debug!("add_constraints_from_const(c={:?}, variance={:?})", c, variance);

    const k = c.kind();
    switch (k.$) {
      case "Alias": {
        const alias_const = k._1;
        this.add_constraints_from_invariant_args(current, alias_const.args, variance);
        break;
      }
      default:
        break;
    }
  }

  /// Adds constraints appropriate for a function with signature
  /// `sig` appearing in a context with ambient variance `variance`
  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:420 add_constraints_from_sig
  add_constraints_from_sig(current: CurrentItem, sig: Binder<FnSig>, variance: VarianceTermPtr): void {
    const contra = this.contravariant(variance);
    for (const input of FnSigC.inputs(Binder.skip_binder(sig))) {
      this.add_constraints_from_ty(current, input, contra);
    }
    this.add_constraints_from_ty(current, FnSigC.output(Binder.skip_binder(sig)), variance);
  }

  /// Adds constraints appropriate for a region appearing in a
  /// context with ambient variance `variance`
  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:435 add_constraints_from_region
  add_constraints_from_region(current: CurrentItem, region: Region, variance: VarianceTermPtr): void {
    const k = region.kind();
    switch (k.$) {
      case "ReEarlyParam": {
        const data = k._0;
        this.add_constraint(current, data.index, variance);
        break;
      }

      case "ReStatic":
        break;

      case "ReBound":
        // Either a higher-ranked region inside of a type or a
        // late-bound function parameter.
        //
        // We do not compute constraints for either of these.
        break;

      case "ReError":
        break;

      case "ReLateParam":
      case "ReVar":
      case "RePlaceholder":
      case "ReErased":
        // We don't expect to see anything but 'static or bound
        // regions when visiting member types or method types.
        bug(`unexpected region encountered in variance inference: ${debug_Region(region, PLAIN)}`);
    }
  }

  /// Adds constraints appropriate for a mutability-type pair
  /// appearing in a context with ambient variance `variance`
  // rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:471 add_constraints_from_mt
  add_constraints_from_mt(current: CurrentItem, mt: TypeAndMut, variance: VarianceTermPtr): void {
    switch (mt.mutbl) {
      case "Mut": {
        const invar = this.invariant(variance);
        this.add_constraints_from_ty(current, mt.ty, invar);
        break;
      }

      case "Not":
        this.add_constraints_from_ty(current, mt.ty, variance);
        break;
    }
  }
}

/// Declares that the variable `decl_id` appears in a location with
/// variance `variance`.
// #[derive(Copy, Clone)]
// rustc-type: compiler/rustc_hir_analysis/src/variance/constraints.rs:31 Constraint
export interface Constraint {
  inferred: InferredIndex;
  variance: VarianceTerm;
}

/// To build constraints, we visit one item (type, trait) at a time
/// and look at its contents. So e.g., if we have
/// ```ignore (illustrative)
/// struct Foo<T> {
///     b: Bar<T>
/// }
/// ```
/// then while we are visiting `Bar<T>`, the `CurrentItem` would have
/// the `DefId` and the start of `Foo`'s inferreds.
// rustc-type: compiler/rustc_hir_analysis/src/variance/constraints.rs:45 CurrentItem
interface CurrentItem {
  inferred_start: InferredIndex;
}

// rustc: compiler/rustc_hir_analysis/src/variance/constraints.rs:49 add_constraints_from_crate
export function add_constraints_from_crate(terms_cx: TermsContext): ConstraintContext {
  const tcx = terms_cx.tcx;
  const covariant: VarianceTerm = { $: "ConstantTerm", _0: Variance.Covariant };
  const contravariant: VarianceTerm = { $: "ConstantTerm", _0: Variance.Contravariant };
  const invariant: VarianceTerm = { $: "ConstantTerm", _0: Variance.Invariant };
  const bivariant: VarianceTerm = { $: "ConstantTerm", _0: Variance.Bivariant };
  const constraint_cx = new ConstraintContext(terms_cx, covariant, contravariant, invariant, bivariant, []);

  const crate_items = tcx.hir_crate_items(null) as ModuleItems;

  for (const def_id of crate_items.definitions()) {
    const def_kind = tcx.def_kind(def_id);
    switch (def_kind.$) {
      case "Struct":
      case "Union":
      case "Enum": {
        constraint_cx.build_constraints_for_item(def_id);

        const adt = tcx.adt_def(def_id) as AdtDef;
        for (const variant of adt.variants()) {
          const ctor_def_id = variant.ctor_def_id();
          if (ctor_def_id !== undefined) {
            constraint_cx.build_constraints_for_item(ctor_def_id.expect_local());
          }
        }
        break;
      }
      case "Fn":
      case "AssocFn":
        constraint_cx.build_constraints_for_item(def_id);
        break;
      default:
        break;
    }
  }

  return constraint_cx;
}

// ---- PORT stand-ins for items of files that are not ported yet ----------------------------------------------------

/** PORT: stand-in for `*pat` (`impl Deref for Pattern`, rustc_middle ty/pattern.rs; `Pattern` is pending). */
function Pattern_kind(_pat: Pattern): PatternKind {
  return unported("rustc_middle::ty::Pattern (deref to PatternKind; ty/pattern.rs not ported)");
}
