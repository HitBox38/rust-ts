//! Deduces supplementary parameter attributes from MIR.
//!
//! Deduced parameter attributes are those that can only be soundly determined by examining the
//! body of the function instead of just the signature. These can be useful for optimization
//! purposes on a best-effort basis. We compute them here and store them into the crate metadata so
//! dependent crates can use them.
//!
//! Note that this *crucially* relies on codegen *not* doing any more MIR-level transformations
//! after `optimized_mir`! We check for things that are *not* guaranteed to be preserved by MIR
//! transforms, such as which local variables happen to be mutated.
//
// Port of compiler/rustc_mir_transform/src/deduce_param_attrs.rs (lane mt-opt2-b).
//
// PORT: `DeduceParamAttrs` is a class extending rustc_middle mir/visit.ts's `Visitor` (D4); `usage[i] |= F` is
// `usage[i] = UsageSummary.union(usage[i], F)`. The `deduced_param_attrs` query value is `readonly unknown[]` in
// queries.gen.ts (`&[DeducedParamAttrs]`); this provider returns `readonly DeducedParamAttrs[]`. `split_last` popping is
// a shrinking slice end.
import type { Constness } from "../rustc_hir/hir.ts";
import { DeducedParamAttrs, UsageSummary } from "../rustc_middle/middle/deduced_param_attrs.ts";
import { type Body, type Local, type Location, type Place, RETURN_PLACE, type Terminator } from "../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { Binder, type EarlyBinder } from "../rustc_type_ir/binder.ts";
import { PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { EarlyBinder as EarlyBinderC } from "../rustc_type_ir/binder.ts";

/// A visitor that determines how a return place and arguments are used inside MIR body.
/// To determine whether a local is mutated we can't use the mutability field on LocalDecl
/// because it has no meaning post-optimization.
// rustc-type: compiler/rustc_mir_transform/src/deduce_param_attrs.rs:24 DeduceParamAttrs
class DeduceParamAttrs extends Visitor {
  constructor(
    /// Summarizes how a return place and arguments are used inside MIR body.
    public usage: UsageSummary[],
  ) {
    super();
  }

  /// Returns a new DeduceParamAttrs instance.
  // rustc: compiler/rustc_mir_transform/src/deduce_param_attrs.rs:31 new
  static new(body: Body): DeduceParamAttrs {
    const this_ = new DeduceParamAttrs(Array.from({ length: body.arg_count + 1 }, () => UsageSummary.empty()));
    // Code generation indicates that a return place is writable. To avoid setting both
    // `readonly` and `writable` attributes, when return place is never written to, mark it as
    // mutated.
    this_.usage[RETURN_PLACE] = UsageSummary.union(this_.usage[RETURN_PLACE]!, UsageSummary.MUTATE);
    return this_;
  }

  /// Returns whether a local is the return place or an argument and returns its index.
  // rustc: compiler/rustc_mir_transform/src/deduce_param_attrs.rs:42 as_param
  as_param(local: Local): Local | undefined {
    if (local < this.usage.length) {
      return local;
    } else {
      return undefined;
    }
  }

  /** `self.usage[i] |= flag`. */
  private or(i: Local, flag: UsageSummary): void {
    this.usage[i] = UsageSummary.union(this.usage[i]!, flag);
  }

  // ---- impl<'tcx> Visitor<'tcx> for DeduceParamAttrs ----

  // rustc: compiler/rustc_mir_transform/src/deduce_param_attrs.rs:48 visit_place
  override visit_place(place: Place, context: PlaceContext, _location: Location): void {
    // We're only interested in the return place or an argument.
    const i = this.as_param(place.local);
    if (i === undefined) return;

    if (context.$ === "NonUse") {
      // Not actually using the local.
    } else if (place.is_indirect_first_projection()) {
      // Neither mutated nor captured.
    } else if (context.$ === "MutatingUse" && context._0 === "Drop" && place.projection.length === 0) {
      // This is a `Drop`. It could disappear at monomorphization, so mark it specially.
      // Projection changes the place's type, so `needs_drop(local.ty)` is not
      // `needs_drop(place.ty)`.
      this.or(i, UsageSummary.DROP);
    } else if (
      context.$ === "MutatingUse" &&
      (context._0 === "Call" || context._0 === "Yield" || context._0 === "Drop" || context._0 === "Borrow" || context._0 === "RawBorrow")
    ) {
      this.or(i, UsageSummary.MUTATE);
      this.or(i, UsageSummary.CAPTURE);
    } else if (
      context.$ === "MutatingUse" &&
      (context._0 === "Store" || context._0 === "SetDiscriminant" || context._0 === "AsmOutput" || context._0 === "Projection")
    ) {
      this.or(i, UsageSummary.MUTATE);
    } else if (context.$ === "NonMutatingUse" && context._0 === "RawBorrow") {
      // Whether mutating though a `&raw const` is allowed is still undecided, so we
      // disable any sketchy `readonly` optimizations for now.
      this.or(i, UsageSummary.MUTATE);
      this.or(i, UsageSummary.CAPTURE);
    } else if (context.$ === "NonMutatingUse" && context._0 === "SharedBorrow") {
      // Not mutating if the parameter is `Freeze`.
      this.or(i, UsageSummary.SHARED_BORROW);
      this.or(i, UsageSummary.CAPTURE);
    } else {
      // Not mutating, so it's fine.
      // PlaceContext::NonMutatingUse(Inspect | Copy | Move | FakeBorrow | PlaceMention | Projection)
    }
  }

  // rustc: compiler/rustc_mir_transform/src/deduce_param_attrs.rs:102 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    // OK, this is subtle. Suppose that we're trying to deduce whether `x` in `f` is read-only
    // and we have the following:
    //
    //     fn f(x: BigStruct) { g(x) }
    //     fn g(mut y: BigStruct) { y.foo = 1 }
    //
    // If, at the generated MIR level, `f` turned into something like:
    //
    //      fn f(_1: BigStruct) -> () {
    //          let mut _0: ();
    //          bb0: {
    //              _0 = g(move _1) -> bb1;
    //          }
    //          ...
    //      }
    //
    // then it would be incorrect to mark `x` (i.e. `_1`) as `readonly`, because `g`'s write to
    // its copy of the indirect parameter would actually be a write directly to the pointer that
    // `f` passes. Note that function arguments are the only situation in which this problem can
    // arise: every other use of `move` in MIR doesn't actually write to the value it moves
    // from.
    const kind = terminator.kind;
    switch (kind.$) {
      case "Call": {
        for (const arg of kind.args) {
          if (arg.node.$ === "Move") {
            const place = arg.node._0;
            if (!place.is_indirect_first_projection()) {
              const i = this.as_param(place.local);
              if (i !== undefined) {
                this.or(i, UsageSummary.MUTATE);
                this.or(i, UsageSummary.CAPTURE);
              }
            }
          }
        }
        break;
      }

      // Like a call, but more conservative because the backend may introduce writes to an
      // argument if the argument is passed as `PassMode::Indirect { mode: IndirectMode::Pointer, ... }`.
      case "TailCall": {
        for (let i = 0; i < this.usage.length; i++) {
          this.usage[i] = UsageSummary.union(this.usage[i]!, UsageSummary.MUTATE);
          this.usage[i] = UsageSummary.union(this.usage[i]!, UsageSummary.CAPTURE);
        }
        break;
      }
      default:
        break;
    }

    this.super_terminator(terminator, location);
  }
}

/// Returns true if values of a given type will never be passed indirectly, regardless of ABI.
// rustc: compiler/rustc_mir_transform/src/deduce_param_attrs.rs:153 type_will_always_be_passed_directly
function type_will_always_be_passed_directly(ty: Ty): boolean {
  const k = ty.kind().$;
  return k === "Bool" || k === "Char" || k === "Float" || k === "Int" || k === "RawPtr" || k === "Ref" || k === "Slice" || k === "Uint";
}

/// Returns the deduced parameter attributes for a function.
///
/// Deduced parameter attributes are those that can only be soundly determined by examining the
/// body of the function instead of just the signature. These can be useful for optimization
/// purposes on a best-effort basis. We compute them here and store them into the crate metadata so
/// dependent crates can use them.
// #[tracing::instrument(level = "trace", skip(tcx), ret)]
// rustc: compiler/rustc_mir_transform/src/deduce_param_attrs.rs:174 deduced_param_attrs
export function deduced_param_attrs(tcx: TyCtxt, def_id: LocalDefId): readonly DeducedParamAttrs[] {
  // This computation is unfortunately rather expensive, so don't do it unless we're optimizing.
  // Also skip it in incremental mode.
  if (tcx.sess.opts.optimize === "No" || tcx.sess.opts.incremental !== undefined) {
    return [];
  }

  // If the Freeze lang item isn't present, then don't bother.
  if (tcx.lang_items().freeze_trait() === undefined) {
    return [];
  }

  // Codegen won't use this information for anything if all the function parameters are passed
  // directly. Detect that and bail, for compilation speed.
  const fn_ty = Unnormalized.skip_norm_wip(EarlyBinderC.instantiate_identity(tcx.type_of(LocalDefId.to_def_id(def_id)) as EarlyBinder<Ty>));
  if (fn_ty.kind().$ === "FnDef" && Binder.skip_binder(PolyFnSig.inputs_and_output(fn_ty.fn_sig(tcx))).every(type_will_always_be_passed_directly)) {
    return [];
  }

  // Don't deduce any attributes for functions that have no MIR.
  if (!tcx.is_mir_available(def_id)) {
    return [];
  }

  const constness = tcx.constness(def_id) as Constness;
  if (constness.$ === "Const" && constness.always === true) {
    // Comptime functions only exist during const eval and can never be passed
    // to codegen.
    return [];
  }

  // Grab the optimized MIR. Analyze it to determine which arguments have been mutated.
  const body: Body = tcx.optimized_mir(def_id);
  // Arguments spread at ABI level are currently unsupported.
  if (body.spread_arg !== undefined) {
    return [];
  }

  const deduce = DeduceParamAttrs.new(body);
  deduce.visit_body(body);
  // tracing::trace!(?deduce.usage);

  const all: DeducedParamAttrs[] = deduce.usage.map((usage) => ({ usage }));
  let len = all.length;

  // Trailing parameters past the size of the `deduced_param_attrs` array are assumed to have the
  // default set of attributes, so we don't have to store them explicitly. Pop them off to save a
  // few bytes in metadata.
  while (len > 0 && DeducedParamAttrs.is_default(all[len - 1]!)) {
    len -= 1;
  }

  return all.slice(0, len);
}
