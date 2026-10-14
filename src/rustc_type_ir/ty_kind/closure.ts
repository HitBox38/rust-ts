// Port of compiler/rustc_type_ir/src/ty_kind/closure.rs (lane tyir-kind). The types with their derived Debug /
// TypeVisitable / TypeFoldable impls are generated into closure.gen.ts (set rustc_ty of tools/codegen/types.ts, lane
// codegen-tyir); this file holds the inherent methods and the two working structs (`HasRegionsBoundAt`,
// `FoldEscapingRegions`, skipped by codegen), in upstream order.
// PORT (D3): `I: Interner` is erased; `cx: I` is `TyCtxt`. The inherent methods of the generated structs live on a
// same-named companion const taking `self` first (`ClosureArgs.kind(args)`).
// PORT: `Ty`'s traversal impls (rustc_middle structural_impls.rs, not ported yet) are fold.ts's `standin_fold_Ty`.
import { type ControlFlow, ControlFlow as ControlFlowC, type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArgsSlice, type Tys } from "../../rustc_middle/ty/generic_args.ts";
import { RawList, type Clauses } from "../../rustc_middle/ty/list.ts";
import { fold_with_Ty, Ty } from "../../rustc_middle/ty/mod.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, panic, unwrap } from "../../std/panic.ts";
import { DelayedMap } from "../data_structures/delayed_map.ts";
import { Binder, visit_Binder, fold_Binder } from "../binder.ts";
import { type PredicateProxy, shift_region, standin_fold_Ty, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../fold.ts";
import { type ClosureKind, type DebruijnIndex, INNERMOST } from "../lib.ts";
import type { Const, Region } from "../sty/mod.ts";
import { DebruijnIndex_shifted_in, DebruijnIndex_shifted_out, debug_TyKind, FnSigTys, PolyFnSigTys, type FnSig } from "../ty_kind.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../visit.ts";
import * as gen from "./closure.gen.ts";
import { visit_with_FnSigTys } from "../ty_kind.ts";

export * from "./closure.gen.ts";

// ---- ClosureArgs ---------------------------------------------------------------------------------------------------

export type ClosureArgs = gen.ClosureArgs;
export const ClosureArgs = {
  /// Construct `ClosureArgs` from `ClosureArgsParts`, containing `Args`
  /// for the closure parent, alongside additional closure-specific components.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:136 new
  new(cx: TyCtxt, parts: gen.ClosureArgsParts): ClosureArgs {
    return {
      args: cx.mk_args_from_iter([
        ...parts.parent_args,
        GenericArg.from_Ty(parts.closure_kind_ty),
        GenericArg.from_Ty(parts.closure_sig_as_fn_ptr_ty),
        GenericArg.from_Ty(parts.tupled_upvars_ty),
      ]),
    };
  },

  /// Divides the closure args into their respective components.
  /// The ordering assumed here must match that used by `ClosureArgs::new` above.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:148 split
  split(self: ClosureArgs): gen.ClosureArgsParts {
    return self.args.split_closure_args();
  },

  /// Returns the generic parameters of the closure's parent.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:153 parent_args
  parent_args(self: ClosureArgs): GenericArgsSlice {
    return ClosureArgs.split(self).parent_args;
  },

  /// Returns an iterator over the list of types of captured paths by the closure.
  /// In case there was a type error in figuring out the types of the captured path, an
  /// empty iterator is returned.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:161 upvar_tys
  upvar_tys(self: ClosureArgs): Tys {
    const ty = ClosureArgs.tupled_upvars_ty(self).kind();
    switch (ty.$) {
      case "Error":
        return RawList.empty<Ty>();
      case "Tuple":
        return ty._0;
      case "Infer":
        return panic("upvar_tys called before capture types are inferred");
      default:
        return panic(`Unexpected representation of upvar types tuple ${debug_TyKind(ty, PLAIN)}`);
    }
  },

  /// Returns the tuple type representing the upvars for this closure.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:172 tupled_upvars_ty
  tupled_upvars_ty(self: ClosureArgs): Ty {
    return ClosureArgs.split(self).tupled_upvars_ty;
  },

  /// Returns the closure kind for this closure; may return a type
  /// variable during inference. To get the closure kind during
  /// inference, use `infcx.closure_kind(args)`.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:179 kind_ty
  kind_ty(self: ClosureArgs): Ty {
    return ClosureArgs.split(self).closure_kind_ty;
  },

  /// Returns the `fn` pointer type representing the closure signature for this
  /// closure.
  // FIXME(eddyb) this should be unnecessary, as the shallowly resolved
  // type is known at the time of the creation of `ClosureArgs`,
  // see `rustc_hir_analysis::check::closure`.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:188 sig_as_fn_ptr_ty
  sig_as_fn_ptr_ty(self: ClosureArgs): Ty {
    return ClosureArgs.split(self).closure_sig_as_fn_ptr_ty;
  },

  /// Returns the closure kind for this closure; only usable outside
  /// of an inference context, because in that context we know that
  /// there are no type variables.
  ///
  /// If you have an inference context, use `infcx.closure_kind()`.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:197 kind
  kind(self: ClosureArgs): ClosureKind {
    return unwrap(ClosureArgs.kind_ty(self).to_opt_closure_kind());
  },

  /// Extracts the signature from the closure.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:202 sig
  sig(self: ClosureArgs): Binder<FnSig> {
    const ty = ClosureArgs.sig_as_fn_ptr_ty(self).kind();
    switch (ty.$) {
      case "FnPtr":
        return PolyFnSigTys.with(ty._0, ty._1);
      default:
        return panic(`closure_sig_as_fn_ptr_ty is not a fn-ptr: ${debug_TyKind(ty, PLAIN)}`);
    }
  },
};

// ---- CoroutineClosureArgs ------------------------------------------------------------------------------------------

export type CoroutineClosureArgs = gen.CoroutineClosureArgs;
export const CoroutineClosureArgs = {
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:250 new
  new(cx: TyCtxt, parts: gen.CoroutineClosureArgsParts): CoroutineClosureArgs {
    return {
      args: cx.mk_args_from_iter([
        ...parts.parent_args,
        GenericArg.from_Ty(parts.closure_kind_ty),
        GenericArg.from_Ty(parts.signature_parts_ty),
        GenericArg.from_Ty(parts.tupled_upvars_ty),
        GenericArg.from_Ty(parts.coroutine_captures_by_ref_ty),
      ]),
    };
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:261 split
  split(self: CoroutineClosureArgs): gen.CoroutineClosureArgsParts {
    return self.args.split_coroutine_closure_args();
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:265 parent_args
  parent_args(self: CoroutineClosureArgs): GenericArgsSlice {
    return CoroutineClosureArgs.split(self).parent_args;
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:270 upvar_tys
  upvar_tys(self: CoroutineClosureArgs): Tys {
    const ty = CoroutineClosureArgs.tupled_upvars_ty(self).kind();
    switch (ty.$) {
      case "Error":
        return RawList.empty<Ty>();
      case "Tuple":
        return CoroutineClosureArgs.tupled_upvars_ty(self).tuple_fields();
      case "Infer":
        return panic("upvar_tys called before capture types are inferred");
      default:
        return panic(`Unexpected representation of upvar types tuple ${debug_TyKind(ty, PLAIN)}`);
    }
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:280 tupled_upvars_ty
  tupled_upvars_ty(self: CoroutineClosureArgs): Ty {
    return CoroutineClosureArgs.split(self).tupled_upvars_ty;
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:284 kind_ty
  kind_ty(self: CoroutineClosureArgs): Ty {
    return CoroutineClosureArgs.split(self).closure_kind_ty;
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:288 kind
  kind(self: CoroutineClosureArgs): ClosureKind {
    return unwrap(CoroutineClosureArgs.kind_ty(self).to_opt_closure_kind());
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:292 signature_parts_ty
  signature_parts_ty(self: CoroutineClosureArgs): Ty {
    return CoroutineClosureArgs.split(self).signature_parts_ty;
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:296 coroutine_closure_sig
  coroutine_closure_sig(self: CoroutineClosureArgs): Binder<gen.CoroutineClosureSignature> {
    const k = CoroutineClosureArgs.signature_parts_ty(self).kind();
    if (k.$ !== "FnPtr") return panic("explicit panic");
    const sig_tys = k._0;
    const hdr = k._1;
    return Binder.map_bound(sig_tys, (sig_tys) => {
      const inputs = FnSigTys.inputs(sig_tys);
      if (inputs.length !== 2) {
        return panic("explicit panic");
      }
      const [resume_ty, tupled_inputs_ty] = inputs as [Ty, Ty];
      const outputs = FnSigTys.output(sig_tys).tuple_fields().as_slice();
      if (outputs.length !== 2) {
        return panic("explicit panic");
      }
      const [yield_ty, return_ty] = outputs as [Ty, Ty];
      return {
        tupled_inputs_ty,
        resume_ty,
        yield_ty,
        return_ty,
        fn_sig_kind: hdr.fn_sig_kind,
      };
    });
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:315 coroutine_captures_by_ref_ty
  coroutine_captures_by_ref_ty(self: CoroutineClosureArgs): Ty {
    return CoroutineClosureArgs.split(self).coroutine_captures_by_ref_ty;
  },

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:319 has_self_borrows
  has_self_borrows(self: CoroutineClosureArgs): boolean {
    const k = CoroutineClosureArgs.coroutine_captures_by_ref_ty(self).kind();
    switch (k.$) {
      case "FnPtr": {
        const sig_tys = k._0;
        return visit_with_FnSigTys(Binder.skip_binder(sig_tys), new HasRegionsBoundAt(INNERMOST)).$ === "Break";
      }
      case "Error":
        return true;
      default:
        return panic("explicit panic");
    }
  },
};

// ---- HasRegionsBoundAt ---------------------------------------------------------------------------------------------

/// Unlike `has_escaping_bound_vars` or `outermost_exclusive_binder`, this will
/// detect only regions bound *at* the debruijn index.
// rustc-type: compiler/rustc_type_ir/src/ty_kind/closure.rs:333 HasRegionsBoundAt
class HasRegionsBoundAt implements TypeVisitor<ControlFlow<null>> {
  readonly Result: VisitorResult<ControlFlow<null>, null> = VisitorResultC.ControlFlow<null>();

  constructor(public binder: DebruijnIndex) {}

  // FIXME: Could be optimized to not walk into components with no escaping bound vars.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:339 visit_binder
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<null> {
    this.binder = DebruijnIndex_shifted_in(this.binder, 1);
    const r = visit_Binder(d).super_visit_with(t, this);
    if (r.$ === "Break") return r;
    this.binder = DebruijnIndex_shifted_out(this.binder, 1);
    return ControlFlowC.CONTINUE;
  }

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:346 visit_region
  visit_region(r: Region): ControlFlow<null> {
    const k = r.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound" && this.binder === k._0._0) {
      return ControlFlowC.Break(null);
    } else {
      return ControlFlowC.CONTINUE;
    }
  }

  visit_ty(t: Ty): ControlFlow<null> {
    return TypeVisitor_provided.visit_ty(this, t);
  }

  visit_const(c: Const): ControlFlow<null> {
    return TypeVisitor_provided.visit_const(this, c);
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<null> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): ControlFlow<null> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<null> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// ---- CoroutineClosureSignature -------------------------------------------------------------------------------------

export type CoroutineClosureSignature = gen.CoroutineClosureSignature;
export const CoroutineClosureSignature = {
  /// Construct a coroutine from the closure signature. Since a coroutine signature
  /// is agnostic to the type of generator that is returned (by-ref/by-move),
  /// the caller must specify what "flavor" of generator that they'd like to
  /// create. Additionally, they must manually compute the upvars of the closure.
  ///
  /// This helper is not really meant to be used directly except for early on
  /// during typeck, when we want to put inference vars into the kind and upvars tys.
  /// When the kind and upvars are known, use the other helper functions.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:384 to_coroutine
  to_coroutine(
    self: CoroutineClosureSignature,
    cx: TyCtxt,
    parent_args: GenericArgsSlice,
    coroutine_kind_ty: Ty,
    coroutine_def_id: DefId,
    tupled_upvars_ty: Ty,
  ): Ty {
    const coroutine_args = CoroutineArgs.new(cx, {
      parent_args,
      kind_ty: coroutine_kind_ty,
      resume_ty: self.resume_ty,
      yield_ty: self.yield_ty,
      return_ty: self.return_ty,
      tupled_upvars_ty,
    });

    return Ty.new_coroutine(cx, coroutine_def_id, coroutine_args.args);
  },

  /// Given known upvars and a [`ClosureKind`](ty::ClosureKind), compute the coroutine
  /// returned by that corresponding async fn trait.
  ///
  /// This function expects the upvars to have been computed already, and doesn't check
  /// that the `ClosureKind` is actually supported by the coroutine-closure.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:412 to_coroutine_given_kind_and_upvars
  to_coroutine_given_kind_and_upvars(
    self: CoroutineClosureSignature,
    cx: TyCtxt,
    parent_args: GenericArgsSlice,
    coroutine_def_id: DefId,
    goal_kind: ClosureKind,
    env_region: Region,
    closure_tupled_upvars_ty: Ty,
    coroutine_captures_by_ref_ty: Ty,
  ): Ty {
    const tupled_upvars_ty = CoroutineClosureSignature.tupled_upvars_by_closure_kind(
      cx,
      goal_kind,
      self.tupled_inputs_ty,
      closure_tupled_upvars_ty,
      coroutine_captures_by_ref_ty,
      env_region,
    );

    return CoroutineClosureSignature.to_coroutine(
      self,
      cx,
      parent_args,
      Ty.from_coroutine_closure_kind(cx, goal_kind),
      coroutine_def_id,
      tupled_upvars_ty,
    );
  },

  /// Compute the tupled upvars that a coroutine-closure's output coroutine
  /// would return for the given `ClosureKind`.
  ///
  /// When `ClosureKind` is `FnMut`/`Fn`, then this will use the "captures by ref"
  /// to return a set of upvars which are borrowed with the given `env_region`.
  ///
  /// This ensures that the `AsyncFn::call` will return a coroutine whose upvars'
  /// lifetimes are related to the lifetime of the borrow on the closure made for
  /// the call. This allows borrowck to enforce the self-borrows correctly.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:449 tupled_upvars_by_closure_kind
  tupled_upvars_by_closure_kind(
    cx: TyCtxt,
    kind: ClosureKind,
    tupled_inputs_ty: Ty,
    closure_tupled_upvars_ty: Ty,
    coroutine_captures_by_ref_ty: Ty,
    env_region: Region,
  ): Ty {
    // If either of the tupled capture types are constrained to error
    // (e.g. during typeck when the infcx is tainted), then just return
    // the error type directly.
    if (tupled_inputs_ty.kind().$ === "Error") {
      return tupled_inputs_ty;
    } else if (coroutine_captures_by_ref_ty.kind().$ === "Error") {
      return coroutine_captures_by_ref_ty;
    }

    switch (kind) {
      case "Fn":
      case "FnMut": {
        const k = coroutine_captures_by_ref_ty.kind();
        if (k.$ !== "FnPtr") {
          return panic("explicit panic");
        }
        const sig_tys = k._0;
        const coroutine_captures_by_ref_ty_ = fold_with_Ty(
          Binder.skip_binder(PolyFnSigTys.output(sig_tys)),
          new FoldEscapingRegions(cx, INNERMOST, env_region, DelayedMap.default(([d, t]) => `${d}#${t.id}`)),
        );
        return Ty.new_tup_from_iter(cx, [...tupled_inputs_ty.tuple_fields(), ...coroutine_captures_by_ref_ty_.tuple_fields()]);
      }
      case "FnOnce":
        return Ty.new_tup_from_iter(cx, [...tupled_inputs_ty.tuple_fields(), ...closure_tupled_upvars_ty.tuple_fields()]);
    }
  },
};

// ---- FoldEscapingRegions -------------------------------------------------------------------------------------------

/// Instantiates a `for<'env> ...` binder with a specific region.
// FIXME(async_closures): Get rid of this in favor of `BoundVarReplacerDelegate`
// when that is uplifted.
// rustc-type: compiler/rustc_type_ir/src/ty_kind/closure.rs:500 FoldEscapingRegions
class FoldEscapingRegions implements TypeFolder {
  constructor(
    public interner: TyCtxt,
    public debruijn: DebruijnIndex,
    public region: Region,

    // Depends on `debruijn` because we may have types with regions of different
    // debruijn depths depending on the binders we've entered.
    public cache: DelayedMap<[DebruijnIndex, Ty], Ty>,
  ) {}

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:511 cx
  cx(): TyCtxt {
    return this.interner;
  }

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:515 fold_ty
  fold_ty(t: Ty): Ty {
    if (!TypeVisitableExt.has_vars_bound_at_or_above(t, this.debruijn, standin_fold_Ty)) {
      return t;
    } else {
      const t_ = this.cache.get([this.debruijn, t]);
      if (t_ !== undefined) {
        return t_;
      } else {
        const res = standin_fold_Ty.super_fold_with(t, this);
        assert(this.cache.insert([this.debruijn, t], res), "assertion failed: self.cache.insert((self.debruijn, t), res)");
        return res;
      }
    }
  }

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:527 fold_binder
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    this.debruijn = DebruijnIndex_shifted_in(this.debruijn, 1);
    const result = fold_Binder(d).super_fold_with(t, this);
    this.debruijn = DebruijnIndex_shifted_out(this.debruijn, 1);
    return result;
  }

  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:537 fold_region
  fold_region(r: Region): Region {
    const k = r.kind();
    if (k.$ === "ReBound" && k._0.$ === "Bound") {
      const debruijn = k._0._0;
      assert(debruijn <= this.debruijn, "cannot instantiate binder with escaping bound vars");
      if (this.debruijn === debruijn) {
        return shift_region(this.interner, this.region, this.debruijn);
      } else {
        return r;
      }
    } else {
      return r;
    }
  }

  fold_const(c: Const): Const {
    return TypeFolder_provided.fold_const(this, c);
  }

  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// ---- CoroutineArgs -------------------------------------------------------------------------------------------------

export type CoroutineArgs = gen.CoroutineArgs;
export const CoroutineArgs = {
  /// Construct `CoroutineArgs` from `CoroutineArgsParts`, containing `Args`
  /// for the coroutine parent, alongside additional coroutine-specific components.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:599 new
  new(cx: TyCtxt, parts: gen.CoroutineArgsParts): CoroutineArgs {
    return {
      args: cx.mk_args_from_iter([
        ...parts.parent_args,
        GenericArg.from_Ty(parts.kind_ty),
        GenericArg.from_Ty(parts.resume_ty),
        GenericArg.from_Ty(parts.yield_ty),
        GenericArg.from_Ty(parts.return_ty),
        GenericArg.from_Ty(parts.tupled_upvars_ty),
      ]),
    };
  },

  /// Divides the coroutine args into their respective components.
  /// The ordering assumed here must match that used by `CoroutineArgs::new` above.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:613 split
  split(self: CoroutineArgs): gen.CoroutineArgsParts {
    return self.args.split_coroutine_args();
  },

  /// Returns the generic parameters of the coroutine's parent.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:618 parent_args
  parent_args(self: CoroutineArgs): GenericArgsSlice {
    return CoroutineArgs.split(self).parent_args;
  },

  // Returns the kind of the coroutine. See docs on the `kind_ty` field.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:623 kind_ty
  kind_ty(self: CoroutineArgs): Ty {
    return CoroutineArgs.split(self).kind_ty;
  },

  /// Returns an iterator over the list of types of captured paths by the coroutine.
  /// In case there was a type error in figuring out the types of the captured path, an
  /// empty iterator is returned.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:631 upvar_tys
  upvar_tys(self: CoroutineArgs): Tys {
    const ty = CoroutineArgs.tupled_upvars_ty(self).kind();
    switch (ty.$) {
      case "Error":
        return RawList.empty<Ty>();
      case "Tuple":
        return ty._0;
      case "Infer":
        return panic("upvar_tys called before capture types are inferred");
      default:
        return panic(`Unexpected representation of upvar types tuple ${debug_TyKind(ty, PLAIN)}`);
    }
  },

  /// Returns the tuple type representing the upvars for this coroutine.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:642 tupled_upvars_ty
  tupled_upvars_ty(self: CoroutineArgs): Ty {
    return CoroutineArgs.split(self).tupled_upvars_ty;
  },

  /// Returns the type representing the resume type of the coroutine.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:647 resume_ty
  resume_ty(self: CoroutineArgs): Ty {
    return CoroutineArgs.split(self).resume_ty;
  },

  /// Returns the type representing the yield type of the coroutine.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:652 yield_ty
  yield_ty(self: CoroutineArgs): Ty {
    return CoroutineArgs.split(self).yield_ty;
  },

  /// Returns the type representing the return type of the coroutine.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:657 return_ty
  return_ty(self: CoroutineArgs): Ty {
    return CoroutineArgs.split(self).return_ty;
  },

  /// Returns the "coroutine signature", which consists of its resume, yield
  /// and return types.
  // rustc: compiler/rustc_type_ir/src/ty_kind/closure.rs:663 sig
  sig(self: CoroutineArgs): gen.GenSig {
    const parts = CoroutineArgs.split(self);
    return { resume_ty: parts.resume_ty, yield_ty: parts.yield_ty, return_ty: parts.return_ty };
  },
};
