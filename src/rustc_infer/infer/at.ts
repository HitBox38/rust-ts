// Port of compiler/rustc_infer/src/infer/at.rs (lane infer-core).
//
//! A nice interface for working with the infcx. The basic idea is to
//! do `infcx.at(cause, param_env)`, which sets the "cause" of the
//! operation as well as the surrounding parameter environment. Then
//! you can do something like `.sub(a, b)` or `.eq(a, b)` to create a
//! subtype or equality relationship respectively. The first argument
//! is always the "expected" output from the POV of diagnostics.
//!
//! Examples:
//! ```ignore (fragment)
//!     infcx.at(cause, param_env).sub(a, b)
//!     // requires that `a <: b`, with `a` considered the "expected" type
//!
//!     infcx.at(cause, param_env).sup(a, b)
//!     // requires that `b <: a`, with `a` considered the "expected" type
//!
//!     infcx.at(cause, param_env).eq(a, b)
//!     // requires that `a == b`, with `a` considered the "expected" type
//! ```
//! For finer-grained control, you can also do use `trace`:
//! ```ignore (fragment)
//!     infcx.at(...).trace(a, b).sub(&c, &d)
//! ```
//! This will set `a` and `b` as the "root" values for
//! error-reporting, but actually operate on `c` and `d`. This is
//! sometimes useful when the types of `c` and `d` are not traceable
//! things. (That system should probably be refactored.)
//
// Init order: top-level code here touches only ../decls.ts, at.gen.ts and other crates; the other rustc_infer modules
// (mod.ts, relate/*.ts, traits/mod.ts, ...) are read inside function bodies only.

import { intern_key } from "../../rust_ts/intern_key.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { HirIdMap } from "../../rustc_hir_id/lib.ts";
import { WithDepNodeCache } from "../../rustc_middle/traits/cache.ts";
import { clone_ObligationCause, type ObligationCause } from "../../rustc_middle/traits/mod.ts";
import type { ParamEnv, Predicate } from "../../rustc_middle/ty/decls.ts";
import { debug_GenericArg, GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { Term, type Ty } from "../../rustc_middle/ty/mod.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { CanonicalizerState } from "../../rustc_type_ir/canonical.ts";
import type { ExistentialProjection, ExistentialTraitRef, FnSig, PolyExistentialProjection, PolyExistentialTraitRef, PolyFnSig, TraitRef } from "../../rustc_type_ir/decls.ts";
import { ExpectedFound } from "../../rustc_type_ir/error.ts";
import type { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import { Variance } from "../../rustc_type_ir/lib.ts";
import type { Relate, RelateResult } from "../../rustc_type_ir/relate.ts";
import {
  relate_AliasTerm,
  relate_AliasTy,
  relate_Binder,
  relate_Const,
  relate_ExistentialProjection,
  relate_ExistentialTraitRef,
  relate_FnSig,
  relate_GenericArg,
  relate_Region,
  relate_Term,
  relate_TraitRef,
  relate_Ty,
} from "../../rustc_type_ir/relate.ts";
import { RelateExt_for_Infcx } from "../../rustc_type_ir/relate/solver_relating.ts";
import type { Goal } from "../../rustc_type_ir/solve/mod.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { AliasTerm as AliasTermC } from "../../rustc_type_ir/term_kind.ts";
import type { AliasTerm, AliasTy } from "../../rustc_type_ir/ty/alias.ts";
import { upcast_from_self } from "../../rustc_type_ir/upcast.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { Ok } from "../../std/result.ts";
import type { Assumptions } from "../../rustc_type_ir/region_constraint.ts";
import { At, InferCtxt } from "../decls.ts";
import { Obligation } from "../traits/mod.ts";
import type { DefineOpaqueTypes } from "./at.gen.ts";
import { clone_LexicalRegionResolutions } from "./lexical_region_resolve/mod.ts";
import { clone_InferCtxtInner, InferOk, type InferResult, TypeTrace, type ValuePairs } from "./mod.ts";
import { LatticeOp, LatticeOpKind } from "./relate/lattice.ts";
import { TypeRelating } from "./relate/type_relating.ts";

export * from "./at.gen.ts";

// rustc-type: compiler/rustc_infer/src/infer/at.rs:50 At (class in ../decls.ts)
export { At } from "../decls.ts";

/** `#[derive(Clone, Copy)]` of `At` (a hand type: codegen does not derive its Clone). */
export function clone_At(v: At): At {
  return new At(v.infcx, v.cause, v.param_env);
}

// ---- impl InferCtxt (at.rs:56) ----------------------------------------------------------------------------------------

// rustc: compiler/rustc_infer/src/infer/at.rs:58 at
InferCtxt.prototype.at = function (this: InferCtxt, cause: ObligationCause, param_env: ParamEnv): At {
  return new At(this, cause, param_env);
};

/// Forks the inference context, creating a new inference context with the same inference
/// variables in the same state. This can be used to "branch off" many tests from the same
/// common state.
// rustc: compiler/rustc_infer/src/infer/at.rs:69 fork
InferCtxt.prototype.fork = function (this: InferCtxt): InferCtxt {
  return new InferCtxt(
    this.tcx,
    this.typing_mode,
    this.considering_regions,
    this.in_hir_typeck,
    this.skip_leak_check,
    clone_InferCtxtInner(this.inner),
    this.lexical_region_resolutions === undefined ? undefined : clone_LexicalRegionResolutions(this.lexical_region_resolutions),
    clone_cache(this.selection_cache),
    clone_cache(this.evaluation_cache),
    clone_reported_trait_errors(this.reported_trait_errors),
    clone_reported_hir_errors(this.reported_hir_errors),
    new KeyedSet<[Span, Span | undefined]>(intern_key, this.reported_signature_mismatch),
    this.tainted_by_errors_,
    this.universe_,
    clone_placeholder_assumptions(this.placeholder_assumptions_for_next_solver),
    this.next_trait_solver_,
    this.enable_next_solver_overflow_fcw_,
    this.obligation_inspector,
    CanonicalizerState.default_(),
  );
};

/// Forks the inference context, creating a new inference context with the same inference
/// variables in the same state, except possibly changing the intercrate mode. This can be
/// used to "branch off" many tests from the same common state. Used in negative coherence.
// rustc: compiler/rustc_infer/src/infer/at.rs:98 fork_with_typing_mode
InferCtxt.prototype.fork_with_typing_mode = function (this: InferCtxt, typing_mode: TypingMode): InferCtxt {
  // Unlike `fork`, this invalidates all cache entries as they may depend on the
  // typing mode.
  const forked = new InferCtxt(
    this.tcx,
    typing_mode,
    this.considering_regions,
    this.in_hir_typeck,
    this.skip_leak_check,
    clone_InferCtxtInner(this.inner),
    this.lexical_region_resolutions === undefined ? undefined : clone_LexicalRegionResolutions(this.lexical_region_resolutions),
    WithDepNodeCache.default_(),
    WithDepNodeCache.default_(),
    clone_reported_trait_errors(this.reported_trait_errors),
    clone_reported_hir_errors(this.reported_hir_errors),
    new KeyedSet<[Span, Span | undefined]>(intern_key, this.reported_signature_mismatch),
    this.tainted_by_errors_,
    this.universe_,
    clone_placeholder_assumptions(this.placeholder_assumptions_for_next_solver),
    this.next_trait_solver_,
    this.enable_next_solver_overflow_fcw_,
    this.obligation_inspector,
    CanonicalizerState.default_(),
  );
  forked.inner.projection_cache().clear();
  return forked;
};

// PORT (D4): `trait ToTrace: Relate<TyCtxt> + Copy` is a descriptor extending `Relate<T>`; one object per impl,
// `ToTrace_<T>` (the `Relate` part spreads rustc_type_ir relate.ts's `relate_<T>`). Generic `T: ToTrace` code takes
// `d_T: ToTrace<T>` last (decls.ts `At`).
// rustc-trait: compiler/rustc_infer/src/infer/at.rs:129 ToTrace
export interface ToTrace<T> extends Relate<T> {
  // rustc: compiler/rustc_infer/src/infer/at.rs:130 to_trace
  to_trace(cause: ObligationCause, a: T, b: T): TypeTrace;
}

// ---- impl At (at.rs:133) ----------------------------------------------------------------------------------------------

/// Makes `actual <: expected`. For example, if type-checking a
/// call like `foo(x)`, where `foo: fn(i32)`, you might have
/// `sup(i32, x)`, since the "expected" type is the type that
/// appears in the signature.
// rustc: compiler/rustc_infer/src/infer/at.rs:138 sup
At.prototype.sup = function <T>(this: At, define_opaque_types: DefineOpaqueTypes, expected: T, actual: T, d_T: ToTrace<T>): InferResult<null> {
  if (this.infcx.next_trait_solver_) {
    const r = RelateExt_for_Infcx.relate(this.infcx, this.param_env, expected, Variance.Contravariant, actual, this.cause.span, d_T);
    if (r.$ === "Err") return r;
    return Ok(this.goals_to_obligations(r._0));
  } else {
    const op = TypeRelating.new(this.infcx, d_T.to_trace(this.cause, expected, actual), this.param_env, define_opaque_types, Variance.Contravariant);
    const r = op.relate(expected, actual, d_T);
    if (r.$ === "Err") return r;
    return Ok(new InferOk(null, op.into_obligations()));
  }
};

/// Makes `expected <: actual`.
// rustc: compiler/rustc_infer/src/infer/at.rs:171 sub
At.prototype.sub = function <T>(this: At, define_opaque_types: DefineOpaqueTypes, expected: T, actual: T, d_T: ToTrace<T>): InferResult<null> {
  if (this.infcx.next_trait_solver_) {
    const r = RelateExt_for_Infcx.relate(this.infcx, this.param_env, expected, Variance.Covariant, actual, this.cause.span, d_T);
    if (r.$ === "Err") return r;
    return Ok(this.goals_to_obligations(r._0));
  } else {
    const op = TypeRelating.new(this.infcx, d_T.to_trace(this.cause, expected, actual), this.param_env, define_opaque_types, Variance.Covariant);
    const r = op.relate(expected, actual, d_T);
    if (r.$ === "Err") return r;
    return Ok(new InferOk(null, op.into_obligations()));
  }
};

/// Makes `expected == actual`.
// rustc: compiler/rustc_infer/src/infer/at.rs:204 eq
At.prototype.eq = function <T>(this: At, define_opaque_types: DefineOpaqueTypes, expected: T, actual: T, d_T: ToTrace<T>): InferResult<null> {
  return this.eq_trace(define_opaque_types, d_T.to_trace(this.cause, expected, actual), expected, actual, d_T);
};

/// Makes `expected == actual`.
// rustc: compiler/rustc_infer/src/infer/at.rs:222 eq_trace
At.prototype.eq_trace = function <T>(this: At, define_opaque_types: DefineOpaqueTypes, trace: TypeTrace, expected: T, actual: T, d_T: Relate<T>): InferResult<null> {
  if (this.infcx.next_trait_solver_) {
    const r = RelateExt_for_Infcx.relate(this.infcx, this.param_env, expected, Variance.Invariant, actual, this.cause.span, d_T);
    if (r.$ === "Err") return r;
    return Ok(this.goals_to_obligations(r._0));
  } else {
    const op = TypeRelating.new(this.infcx, trace, this.param_env, define_opaque_types, Variance.Invariant);
    const r = op.relate(expected, actual, d_T);
    if (r.$ === "Err") return r;
    return Ok(new InferOk(null, op.into_obligations()));
  }
};

// rustc: compiler/rustc_infer/src/infer/at.rs:255 relate
At.prototype.relate = function <T>(this: At, define_opaque_types: DefineOpaqueTypes, expected: T, variance: Variance, actual: T, d_T: ToTrace<T>): InferResult<null> {
  switch (variance) {
    case "Covariant":
      return this.sub(define_opaque_types, expected, actual, d_T);
    case "Invariant":
      return this.eq(define_opaque_types, expected, actual, d_T);
    case "Contravariant":
      return this.sup(define_opaque_types, expected, actual, d_T);

    // We could make this make sense but it's not readily
    // exposed and I don't feel like dealing with it. Note
    // that bivariance in general does a bit more than just
    // *nothing*, it checks that the types are the same
    // "modulo variance" basically.
    case "Bivariant":
      return panic("Bivariant given to `relate()`");
  }
};

/// Computes the least-upper-bound, or mutual supertype, of two
/// values. The order of the arguments doesn't matter, but since
/// this can result in an error (e.g., if asked to compute LUB of
/// u32 and i32), it is meaningful to call one of them the
/// "expected type".
// rustc: compiler/rustc_infer/src/infer/at.rs:284 lub
At.prototype.lub = function <T>(this: At, expected: T, actual: T, d_T: ToTrace<T>): InferResult<T> {
  const op = LatticeOp.new(this.infcx, d_T.to_trace(this.cause, expected, actual), this.param_env, LatticeOpKind.Lub);
  const value = op.relate(expected, actual, d_T);
  if (value.$ === "Err") return value;
  return Ok(new InferOk(value._0, op.into_obligations()));
};

// rustc: compiler/rustc_infer/src/infer/at.rs:298 goals_to_obligations
At.prototype.goals_to_obligations = function (this: At, goals: Goal<Predicate>[]): InferOk<null> {
  return new InferOk(
    null,
    goals.map((goal) => Obligation.new(this.infcx.tcx, clone_ObligationCause(this.cause), goal.param_env, goal.predicate, upcast_from_self)),
  );
};

// ---- impl ToTrace for <T> (at.rs:319..448), in upstream order --------------------------------------------------------

export const ToTrace_Ty: ToTrace<Ty> = {
  ...relate_Ty,
  // rustc: compiler/rustc_infer/src/infer/at.rs:320 to_trace
  to_trace(cause: ObligationCause, a: Ty, b: Ty): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), { $: "Terms", _0: ExpectedFound.new(Term.from_Ty(a), Term.from_Ty(b)) });
  },
};

export const ToTrace_Region: ToTrace<Region> = {
  ...relate_Region,
  // rustc: compiler/rustc_infer/src/infer/at.rs:329 to_trace
  to_trace(cause: ObligationCause, a: Region, b: Region): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), { $: "Regions", _0: ExpectedFound.new(a, b) });
  },
};

export const ToTrace_Const: ToTrace<Const> = {
  ...relate_Const,
  // rustc: compiler/rustc_infer/src/infer/at.rs:335 to_trace
  to_trace(cause: ObligationCause, a: Const, b: Const): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), { $: "Terms", _0: ExpectedFound.new(Term.from_Const(a), Term.from_Const(b)) });
  },
};

export const ToTrace_GenericArg: ToTrace<GenericArg> = {
  ...relate_GenericArg,
  // rustc: compiler/rustc_infer/src/infer/at.rs:344 to_trace
  to_trace(cause: ObligationCause, a: GenericArg, b: GenericArg): TypeTrace {
    const ka = GenericArg.kind(a);
    const kb = GenericArg.kind(b);
    let values: ValuePairs;
    if (ka.$ === "Lifetime" && kb.$ === "Lifetime") {
      values = { $: "Regions", _0: ExpectedFound.new(ka._0, kb._0) };
    } else if (ka.$ === "Type" && kb.$ === "Type") {
      values = { $: "Terms", _0: ExpectedFound.new(Term.from_Ty(ka._0), Term.from_Ty(kb._0)) };
    } else if (ka.$ === "Const" && kb.$ === "Const") {
      values = { $: "Terms", _0: ExpectedFound.new(Term.from_Const(ka._0), Term.from_Const(kb._0)) };
    } else {
      return bug(`relating different kinds: ${debug_GenericArg(a, PLAIN)} ${debug_GenericArg(b, PLAIN)}`);
    }
    return new TypeTrace(clone_ObligationCause(cause), values);
  },
};

export const ToTrace_Term: ToTrace<Term> = {
  ...relate_Term,
  // rustc: compiler/rustc_infer/src/infer/at.rs:364 to_trace
  to_trace(cause: ObligationCause, a: Term, b: Term): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), { $: "Terms", _0: ExpectedFound.new(a, b) });
  },
};

export const ToTrace_TraitRef: ToTrace<TraitRef> = {
  ...relate_TraitRef,
  // rustc: compiler/rustc_infer/src/infer/at.rs:370 to_trace
  to_trace(cause: ObligationCause, a: TraitRef, b: TraitRef): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), { $: "TraitRefs", _0: ExpectedFound.new(a, b) });
  },
};

export const ToTrace_AliasTy: ToTrace<AliasTy> = {
  ...relate_AliasTy,
  // rustc: compiler/rustc_infer/src/infer/at.rs:376 to_trace
  to_trace(cause: ObligationCause, a: AliasTy, b: AliasTy): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), { $: "Aliases", _0: ExpectedFound.new(AliasTermC.from_AliasTy(a), AliasTermC.from_AliasTy(b)) });
  },
};

export const ToTrace_AliasTerm: ToTrace<AliasTerm> = {
  ...relate_AliasTerm,
  // rustc: compiler/rustc_infer/src/infer/at.rs:385 to_trace
  to_trace(cause: ObligationCause, a: AliasTerm, b: AliasTerm): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), { $: "Aliases", _0: ExpectedFound.new(a, b) });
  },
};

export const ToTrace_FnSig: ToTrace<FnSig> = {
  ...relate_FnSig,
  // rustc: compiler/rustc_infer/src/infer/at.rs:391 to_trace
  to_trace(cause: ObligationCause, a: FnSig, b: FnSig): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), { $: "PolySigs", _0: ExpectedFound.new(Binder.dummy(a, relate_FnSig), Binder.dummy(b, relate_FnSig)) });
  },
};

export const ToTrace_PolyFnSig: ToTrace<PolyFnSig> = {
  ...relate_Binder(relate_FnSig),
  // rustc: compiler/rustc_infer/src/infer/at.rs:403 to_trace
  to_trace(cause: ObligationCause, a: PolyFnSig, b: PolyFnSig): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), { $: "PolySigs", _0: ExpectedFound.new(a, b) });
  },
};

export const ToTrace_PolyExistentialTraitRef: ToTrace<PolyExistentialTraitRef> = {
  ...relate_Binder(relate_ExistentialTraitRef),
  // rustc: compiler/rustc_infer/src/infer/at.rs:409 to_trace
  to_trace(cause: ObligationCause, a: PolyExistentialTraitRef, b: PolyExistentialTraitRef): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), { $: "ExistentialTraitRef", _0: ExpectedFound.new(a, b) });
  },
};

export const ToTrace_ExistentialTraitRef: ToTrace<ExistentialTraitRef> = {
  ...relate_ExistentialTraitRef,
  // rustc: compiler/rustc_infer/src/infer/at.rs:418 to_trace
  to_trace(cause: ObligationCause, a: ExistentialTraitRef, b: ExistentialTraitRef): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), {
      $: "ExistentialTraitRef",
      _0: ExpectedFound.new(Binder.dummy(a, relate_ExistentialTraitRef), Binder.dummy(b, relate_ExistentialTraitRef)),
    });
  },
};

export const ToTrace_PolyExistentialProjection: ToTrace<PolyExistentialProjection> = {
  ...relate_Binder(relate_ExistentialProjection),
  // rustc: compiler/rustc_infer/src/infer/at.rs:430 to_trace
  to_trace(cause: ObligationCause, a: PolyExistentialProjection, b: PolyExistentialProjection): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), { $: "ExistentialProjection", _0: ExpectedFound.new(a, b) });
  },
};

export const ToTrace_ExistentialProjection: ToTrace<ExistentialProjection> = {
  ...relate_ExistentialProjection,
  // rustc: compiler/rustc_infer/src/infer/at.rs:439 to_trace
  to_trace(cause: ObligationCause, a: ExistentialProjection, b: ExistentialProjection): TypeTrace {
    return new TypeTrace(clone_ObligationCause(cause), {
      $: "ExistentialProjection",
      _0: ExpectedFound.new(Binder.dummy(a, relate_ExistentialProjection), Binder.dummy(b, relate_ExistentialProjection)),
    });
  },
};

// ---- helpers ----------------------------------------------------------------------------------------------------------

/** `#[derive(Clone)]` of the selection / evaluation caches (`WithDepNodeCache::clone`). */
// PORT: the keys are interned tuples and the cached values are never mutated (rustc_middle traits/cache.ts), so the
// clone shares them.
function clone_cache<K, V>(cache: WithDepNodeCache<K, V>): WithDepNodeCache<K, V> {
  return cache.clone(
    (k) => k,
    (v) => v,
  );
}

/** `RefCell<FxIndexMap<Span, (Vec<Goal<Predicate>>, ErrorGuaranteed)>>::clone`. */
function clone_reported_trait_errors(m: Map<Span, [Goal<Predicate>[], ErrorGuaranteed]>): Map<Span, [Goal<Predicate>[], ErrorGuaranteed]> {
  const out = new Map<Span, [Goal<Predicate>[], ErrorGuaranteed]>();
  for (const [k, [goals, guar]] of m) out.set(k, [goals.map((g) => ({ param_env: g.param_env, predicate: g.predicate })), guar]);
  return out;
}

/** `RefCell<FxIndexMap<HirId, FxHashSet<Predicate>>>::clone`. */
function clone_reported_hir_errors(m: HirIdMap<Set<Predicate>>): HirIdMap<Set<Predicate>> {
  const out = new HirIdMap<Set<Predicate>>();
  for (const [k, v] of m) out.set(k, new Set(v));
  return out;
}

/** `RefCell<FxIndexMap<UniverseIndex, Assumptions>>::clone`. */
// PORT: the `TransitiveRelation`s of an `Assumptions` are frozen, so the clone shares them (as infer/mod.ts).
function clone_placeholder_assumptions<U>(m: Map<U, Assumptions>): Map<U, Assumptions> {
  const out = new Map<U, Assumptions>();
  for (const [k, v] of m) out.set(k, { type_outlives: v.type_outlives.slice(), region_outlives: v.region_outlives, inverse_region_outlives: v.inverse_region_outlives });
  return out;
}

