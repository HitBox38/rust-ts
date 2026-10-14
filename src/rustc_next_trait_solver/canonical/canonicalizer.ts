// Contract stub for compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs (lane evalctxt-contract; the file
// belongs to lane nts-canonical). The consts and types are final; `Canonicalizer`'s methods (inherent and `TypeFolder`)
// are stubs with final signatures: fill each in place and add the `// rustc:` marker. Extension module
// (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT: `Canonicalizer<'a, D, I>`: `D` is erased (`delegate: SolverDelegate`). The associated fns `new`,
// `canonicalize_response`, `canonicalize_param_env` and `canonicalize_input` are class statics; generic ones take the
// D4 descriptor last. `arg: impl Into<I::GenericArg>` is a `GenericArg`. `TypeFolder::fold_binder` is not overridden
// upstream: it forwards to `TypeFolder_provided`.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { CanonicalVarKinds, Clauses, GenericArg, ParamEnv, Ty } from "../../rustc_middle/ty/decls.ts";
import type { Canonical, CanonicalVarKind } from "../../rustc_type_ir/canonical.ts";
import type { CanonicalizerState } from "../../rustc_type_ir/canonical.ts";
import type { Binder, BoundVar, TyVid, UniverseIndex } from "../../rustc_type_ir/decls.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { debug_UniverseIndex } from "../../rustc_type_ir/lib.ts";
import type { QueryInput } from "../../rustc_type_ir/solve/mod.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { type Debug, debug_struct, debug_tuple } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { SolverDelegate } from "../delegate.ts";

/// Does this have infer/placeholder/param, free regions or ReErased?
// We're explicitly checking for fresh types and consts to trigger an
// assert if they ever leak into the trait solver. They should never
// exist with the new solver.
// PORT: `TypeFlags::from_bits(..).unwrap()` of flags that all exist is their union.
export const NEEDS_CANONICAL: TypeFlags = (TypeFlags.HAS_INFER |
  TypeFlags.HAS_PLACEHOLDER |
  TypeFlags.HAS_PARAM |
  TypeFlags.HAS_FREE_REGIONS |
  TypeFlags.HAS_RE_ERASED |
  TypeFlags.HAS_TY_FRESH |
  TypeFlags.HAS_CT_FRESH) as TypeFlags;

// PORT: `#[derive(Debug, Clone, Copy)]` fieldless enum.
export type CanonicalizeInputKind =
  /// When canonicalizing the `param_env`, we keep `'static` as merging
  /// trait candidates relies on it when deciding whether a where-bound
  /// is trivial.
  | "ParamEnv"
  /// When canonicalizing predicates, we don't keep `'static`.
  | "Predicate";
export const CanonicalizeInputKind = { ParamEnv: "ParamEnv", Predicate: "Predicate" } as const;
export const debug_CanonicalizeInputKind: Debug<CanonicalizeInputKind> = (v) => v;

/// Whether we're canonicalizing a query input or the query response.
///
/// When canonicalizing an input we're in the context of the caller
/// while canonicalizing the response happens in the context of the
/// query.
// PORT: `#[derive(Debug, Clone, Copy)]`.
export type CanonicalizeMode =
  | { readonly $: "Input"; readonly _0: CanonicalizeInputKind }
  /// FIXME: We currently return region constraints referring to
  /// placeholders and inference variables from a binder instantiated
  /// inside of the query.
  ///
  /// In the long term we should eagerly deal with these constraints
  /// inside of the query and only propagate constraints which are
  /// actually nameable by the caller.
  | {
      readonly $: "Response";
      /// The highest universe nameable by the caller.
      ///
      /// All variables in a universe nameable by the caller get mapped
      /// to the root universe in the response and then mapped back to
      /// their correct universe when applying the query response in the
      /// context of the caller.
      ///
      /// This doesn't work for universes created inside of the query so
      /// we do remember their universe in the response.
      readonly max_input_universe: UniverseIndex;
    };
export const debug_CanonicalizeMode: Debug<CanonicalizeMode> = (v, f) => {
  switch (v.$) {
    case "Input":
      return debug_tuple(f, "Input", [debug_CanonicalizeInputKind(v._0, f)]);
    case "Response":
      return debug_struct(f, "Response", [["max_input_universe", debug_UniverseIndex(v.max_input_universe, f)]]);
  }
};

export class Canonicalizer implements TypeFolder {
  constructor(
    public delegate: SolverDelegate,

    // Immutable field.
    public canonicalize_mode: CanonicalizeMode,

    // Mutable fields.
    public state: CanonicalizerState,
  ) {}

  static new(_delegate: SolverDelegate, _canonicalize_mode: CanonicalizeMode): Canonicalizer {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::new");
  }

  static canonicalize_response<T>(
    _delegate: SolverDelegate,
    _max_input_universe: UniverseIndex,
    _value: T,
    _d_T: TypeFoldable<T>,
  ): Canonical<T> {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::canonicalize_response");
  }

  static canonicalize_param_env(_delegate: SolverDelegate, _param_env: ParamEnv): [ParamEnv, Canonicalizer] {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::canonicalize_param_env");
  }

  static canonicalize_input<P>(
    _delegate: SolverDelegate,
    _input: QueryInput<P>,
    _d_P: TypeFoldable<P>,
  ): [GenericArg[], Canonical<QueryInput<P>>] {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::canonicalize_input");
  }

  get_or_insert_bound_var(_arg: GenericArg, _kind: CanonicalVarKind): BoundVar {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::get_or_insert_bound_var");
  }

  get_or_insert_sub_root(_vid: TyVid): BoundVar {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::get_or_insert_sub_root");
  }

  finalize(): [UniverseIndex, GenericArg[], CanonicalVarKinds] {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::finalize");
  }

  inner_fold_ty(_t: Ty): Ty {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::inner_fold_ty");
  }

  // ---- impl TypeFolder for Canonicalizer ----
  cx(): TyCtxt {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::cx");
  }

  fold_region(_r: Region): Region {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::fold_region");
  }

  fold_ty(_t: Ty): Ty {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::fold_ty");
  }

  fold_const(_c: Const): Const {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::fold_const");
  }

  fold_predicate<P>(_p: P, _d: PredicateProxy<P>): P {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::fold_predicate");
  }

  fold_clauses(_c: Clauses): Clauses {
    return unported("rustc_next_trait_solver::canonical::canonicalizer::Canonicalizer::fold_clauses");
  }

  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
}
