// Port of compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs (lane nts-canonical; the contract stub was lane
// evalctxt-contract's). Extension module (docs/handoff/evalctxt-contract.md "Init order").
//
// PORT: `Canonicalizer<'a, D, I>`: `D` is erased (`delegate: SolverDelegate`). The associated fns `new`,
// `canonicalize_response`, `canonicalize_param_env` and `canonicalize_input` are class statics; generic ones take the
// D4 descriptor last. `arg: impl Into<I::GenericArg>` is a `GenericArg`. `TypeFolder::fold_binder` is not overridden
// upstream: it forwards to `TypeFolder_provided`.
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { CanonicalVarKinds, Clauses, GenericArg, ParamEnv } from "../../rustc_middle/ty/decls.ts";
import { fold_with_ParamEnv, Ty, try_fold_with_ParamEnv, visit_with_ParamEnv } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Clauses, fold_PredefinedOpaques, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { type Binder, PlaceholderConst, PlaceholderRegion, PlaceholderType } from "../../rustc_type_ir/binder.ts";
import { type Canonical, CanonicalVarKind, type CanonicalizerState } from "../../rustc_type_ir/canonical.ts";
import type { TyVid } from "../../rustc_type_ir/decls.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.ts";
import { type PredicateProxy, type TypeFoldable, type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { BoundVar, debug_UniverseIndex, UniverseIndex } from "../../rustc_type_ir/lib.ts";
import type { Goal, QueryInput } from "../../rustc_type_ir/solve/mod.ts";
import { Const, debug_Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import { debug_Region, Region } from "../../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { type Debug, debug_struct, debug_tuple, PLAIN } from "../../std/fmt.ts";
import { assert, panic, unwrap } from "../../std/panic.ts";
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

  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:80 new
  static new(delegate: SolverDelegate, canonicalize_mode: CanonicalizeMode): Canonicalizer {
    return new Canonicalizer(delegate, canonicalize_mode, delegate.obtain_canonicalizer_state());
  }

  // PORT: D4 descriptor `d_T`.
  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:84 canonicalize_response
  static canonicalize_response<T>(
    delegate: SolverDelegate,
    max_input_universe: UniverseIndex,
    value: T,
    d_T: TypeFoldable<T>,
  ): Canonical<T> {
    const canonicalizer = Canonicalizer.new(delegate, { $: "Response", max_input_universe });
    value = TypeVisitableExt.has_type_flags(value, NEEDS_CANONICAL, d_T) ? d_T.fold_with(value, canonicalizer) : value;
    // debug_assert!(!value.has_infer(), "unexpected infer in {value:?}");
    // debug_assert!(!value.has_placeholders(), "unexpected placeholders in {value:?}");
    const [max_universe, _variables, var_kinds] = canonicalizer.finalize();

    return { max_universe, var_kinds, value };
  }

  // The return value is the canonicalized `param_env`, plus a canonicalizer suitable for
  // canonicalizing the rest of the input. (For efficiency, and when appropriate, the returned
  // canonicalizer will be the same one used on `param_env`, with suitable modifications.)
  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:106 canonicalize_param_env
  static canonicalize_param_env(delegate: SolverDelegate, param_env: ParamEnv): [ParamEnv, Canonicalizer] {
    if (!TypeVisitableExt.has_type_flags(param_env, NEEDS_CANONICAL, fold_ParamEnv_)) {
      const rest_canonicalizer = Canonicalizer.new(delegate, { $: "Input", _0: "Predicate" });

      return [param_env, rest_canonicalizer];
    }

    // Do the `env` canonicalization, and then convert the canonicalizer to `rest` form for
    // subsequent use.
    const do_env_and_make_rest = (): [ParamEnv, Canonicalizer] => {
      const env_canonicalizer = Canonicalizer.new(delegate, { $: "Input", _0: "ParamEnv" });
      const param_env_ = fold_ParamEnv_.fold_with(param_env, env_canonicalizer);

      // debug_assert!(env_canonicalizer.state.sub_root_lookup_table.is_empty());

      // Transform the `env_canonicalizer` into the `rest_canonicalizer`, keeping some things
      // and replacing others.
      //
      // We do not reuse the cache as it may contain entries whose canonicalized
      // value contains `'static`. While we could alternatively handle this by
      // checking for `'static` when using cached entries, this does not
      // feel worth the effort. I do not expect that a `ParamEnv` will ever
      // contain large enough types for caching to be necessary.
      //
      // We clear the cache rather than deleting it or replacing it with an empty cache. This
      // lets the allocated capacity be reused later.
      const rest_canonicalizer = env_canonicalizer;
      rest_canonicalizer.canonicalize_mode = { $: "Input", _0: "Predicate" };
      rest_canonicalizer.state.cache.clear();

      return [param_env_, rest_canonicalizer];
    };

    // Check whether we can use the global cache for this param_env. As we only use
    // the `param_env` itself as the cache key, considering any additional information
    // during its canonicalization would be incorrect. We always canonicalize region
    // inference variables in a separate universe, so these are fine. However, we do
    // track the universe of type and const inference variables so these must not be
    // globally cached. We don't rely on any additional information when canonicalizing
    // placeholders.
    if (!TypeVisitableExt.has_non_region_infer(param_env, fold_ParamEnv_)) {
      return delegate.cx().with_canonical_param_env_cache((cache) => {
        const e = cache._0.get(param_env);
        if (e === undefined) {
          // Cache miss. Do `env` canonicalization and get `rest_canonicalizer`, and
          // fill in the cache entry.
          const [param_env_, rest_canonicalizer] = do_env_and_make_rest();
          cache._0.set(param_env, {
            param_env: param_env_,
            variables: [...rest_canonicalizer.state.variables],
            var_kinds: [...rest_canonicalizer.state.var_kinds],
            // SAFETY: The iterated elements go straight back into a hashmap.
            // #[allow(rustc::potential_query_instability)]
            variable_lookup_table: new Map(rest_canonicalizer.state.variable_lookup_table),
          });
          return [param_env_, rest_canonicalizer];
        } else {
          // Cache hit; no canonicalization required. Just set up `rest_canonicalizer`.
          const rest_canonicalizer = Canonicalizer.new(delegate, { $: "Input", _0: "Predicate" });
          rest_canonicalizer.state.variables.push(...e.variables);
          rest_canonicalizer.state.var_kinds.push(...e.var_kinds);
          // SAFETY: The iterated elements go straight back into a hashmap.
          // #[allow(rustc::potential_query_instability)]
          for (const [arg, idx] of e.variable_lookup_table) {
            rest_canonicalizer.state.variable_lookup_table.set(arg, idx);
          }
          return [e.param_env, rest_canonicalizer];
        }
      });
    } else {
      // Do `env` canonicalization and get `rest_canonicalizer`.
      return do_env_and_make_rest();
    }
  }

  /// When canonicalizing query inputs, we keep `'static` in the `param_env`
  /// but erase it everywhere else. We generally don't want to depend on region
  /// identity, so while it should not matter whether `'static` is kept in the
  /// value or opaque type storage as well, this prevents us from accidentally
  /// relying on it in the future.
  ///
  /// We want to keep the option of canonicalizing `'static` to an existential
  /// variable in the future by changing the way we detect global where-bounds.
  // PORT: D4 descriptor `d_P`.
  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:206 canonicalize_input
  static canonicalize_input<P>(
    delegate: SolverDelegate,
    input: QueryInput<P>,
    d_P: TypeFoldable<P>,
  ): [GenericArg[], Canonical<QueryInput<P>>] {
    // First canonicalize the `param_env` while keeping `'static`. This produces a
    // canonicalizer that can canonicalize the rest of the input without keeping `'static`.
    const [param_env, rest_canonicalizer] = Canonicalizer.canonicalize_param_env(delegate, input.goal.param_env);

    let predicate = input.goal.predicate;
    predicate = d_P.fold_with(predicate, rest_canonicalizer);
    const goal: Goal<P> = { param_env, predicate };

    let predefined_opaques_in_body = input.predefined_opaques_in_body;
    predefined_opaques_in_body = TypeVisitableExt.has_type_flags(predefined_opaques_in_body, NEEDS_CANONICAL, fold_PredefinedOpaques)
      ? fold_PredefinedOpaques.fold_with(predefined_opaques_in_body, rest_canonicalizer)
      : predefined_opaques_in_body;

    const value: QueryInput<P> = { goal, predefined_opaques_in_body };

    // debug_assert!(!value.has_infer(), "unexpected infer in {value:?}");
    // debug_assert!(!value.has_placeholders(), "unexpected placeholders in {value:?}");
    const [max_universe, variables, var_kinds] = rest_canonicalizer.finalize();
    return [variables, { max_universe, var_kinds, value }];
  }

  // PORT: `arg: impl Into<I::GenericArg>` is a `GenericArg` (`Ty | Region | Const`, the identity `into`).
  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:235 get_or_insert_bound_var
  get_or_insert_bound_var(arg: GenericArg, kind: CanonicalVarKind): BoundVar {
    // The exact value of 16 here doesn't matter that much (8 and 32 give extremely similar
    // results). So long as we have protection against the rare cases where the length reaches
    // 1000+ (e.g. `wg-grammar`).
    let idx: number;
    if (this.state.variables.length > 16) {
      if (this.state.variable_lookup_table.size === 0) {
        this.state.variables.forEach((v, i) => this.state.variable_lookup_table.set(v, i));
      }

      const found = this.state.variable_lookup_table.get(arg);
      if (found !== undefined) {
        idx = found;
      } else {
        const var_ = this.state.variables.length;
        this.state.variables.push(arg);
        this.state.var_kinds.push(kind);
        this.state.variable_lookup_table.set(arg, var_);
        idx = var_;
      }
    } else {
      const pos = this.state.variables.indexOf(arg);
      if (pos !== -1) {
        idx = pos;
      } else {
        const var_ = this.state.variables.length;
        this.state.variables.push(arg);
        this.state.var_kinds.push(kind);
        idx = var_;
      }
    }

    return BoundVar.from_usize(idx);
  }

  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:269 get_or_insert_sub_root
  get_or_insert_sub_root(vid: TyVid): BoundVar {
    const root_vid = this.delegate.deref().sub_unification_table_root_var(vid);
    let idx = this.state.sub_root_lookup_table.get(root_vid);
    if (idx === undefined) {
      idx = this.state.variables.length;
      this.state.sub_root_lookup_table.set(root_vid, idx);
    }
    return BoundVar.from_usize(idx);
  }

  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:279 finalize
  finalize(): [UniverseIndex, GenericArg[], CanonicalVarKinds] {
    // See the rustc-dev-guide section about how we deal with universes
    // during canonicalization in the new solver.
    let max_universe: UniverseIndex;
    switch (this.canonicalize_mode.$) {
      // All placeholders and vars are canonicalized in the root universe.
      case "Input": {
        // debug_assert!(
        //     self.state
        //         .var_kinds
        //         .iter()
        //         .all(|var| var.universe() == ty::UniverseIndex::ROOT),
        //     "expected all vars to be canonicalized in root universe: {:#?}",
        //     self.state.var_kinds,
        // );
        max_universe = UniverseIndex.ROOT;
        break;
      }
      // When canonicalizing a response we map a universes already entered
      // by the caller to the root universe and only return useful universe
      // information for placeholders and inference variables created inside
      // of the query.
      case "Response": {
        const max_input_universe = this.canonicalize_mode.max_input_universe;
        const var_kinds = this.state.var_kinds;
        for (let i = 0; i < var_kinds.length; i++) {
          const var_ = var_kinds[i]!;
          const uv = CanonicalVarKind.universe(var_);
          // PORT: `usize::saturating_sub`.
          const new_uv = UniverseIndex.from_usize(Math.max(0, UniverseIndex.index(uv) - UniverseIndex.index(max_input_universe)));
          var_kinds[i] = CanonicalVarKind.with_updated_universe(var_, new_uv);
        }
        // PORT: `.max().unwrap_or(ROOT)` over the universes (`UniverseIndex` orders by its index).
        let max: UniverseIndex | undefined = undefined;
        for (const kind of this.state.var_kinds) {
          const u = CanonicalVarKind.universe(kind);
          if (max === undefined || u >= max) {
            max = u;
          }
        }
        max_universe = max ?? UniverseIndex.ROOT;
        break;
      }
    }
    const variables = this.state.variables;
    this.state.variables = [];
    const var_kinds = this.delegate.cx().mk_canonical_var_kinds(this.state.var_kinds);

    // We have finished with this canonicalizer and can return its state to the delegate for
    // later reuse.
    this.delegate.release_canonicalizer_state(this.state);

    return [max_universe, variables, var_kinds];
  }

  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:325 inner_fold_ty
  inner_fold_ty(t: Ty): Ty {
    let kind: CanonicalVarKind;
    const tk = t.kind();
    switch (tk.$) {
      case "Infer": {
        const i = tk._0;
        switch (i.$) {
          case "TyVar": {
            const vid = i._0;
            // debug_assert_eq!(
            //     self.delegate.shallow_resolve_ty_var(vid),
            //     t,
            //     "ty vid should have been resolved fully before canonicalization"
            // );

            const sub_root = this.get_or_insert_sub_root(vid);
            let ui: UniverseIndex;
            switch (this.canonicalize_mode.$) {
              case "Input":
                ui = UniverseIndex.ROOT;
                break;
              case "Response": {
                const u = this.delegate.deref().universe_of_ty(vid);
                ui = u !== undefined ? u : panic(`ty var should have been resolved: ${debug_Ty(t, PLAIN)}`);
                break;
              }
            }
            kind = { $: "Ty", ui, sub_root };
            break;
          }
          case "IntVar": {
            // debug_assert_eq!(
            //     self.delegate.shallow_resolve_int_var(vid),
            //     t,
            //     "ty vid should have been resolved fully before canonicalization"
            // );
            kind = CanonicalVarKind.Int;
            break;
          }
          case "FloatVar": {
            // debug_assert_eq!(
            //     self.delegate.shallow_resolve_float_var(vid),
            //     t,
            //     "ty vid should have been resolved fully before canonicalization"
            // );
            kind = CanonicalVarKind.Float;
            break;
          }
          case "FreshTy":
          case "FreshIntTy":
          case "FreshFloatTy":
            return panic("fresh vars not expected in canonicalization");
        }
        break;
      }
      case "Placeholder": {
        const placeholder = tk._0;
        switch (this.canonicalize_mode.$) {
          case "Input":
            kind = {
              $: "PlaceholderTy",
              _0: PlaceholderType.new_anon(UniverseIndex.ROOT, BoundVar.from_usize(this.state.variables.length)),
            };
            break;
          case "Response":
            kind = { $: "PlaceholderTy", _0: placeholder };
            break;
        }
        break;
      }
      case "Param": {
        switch (this.canonicalize_mode.$) {
          case "Input":
            kind = {
              $: "PlaceholderTy",
              _0: PlaceholderType.new_anon(UniverseIndex.ROOT, BoundVar.from_usize(this.state.variables.length)),
            };
            break;
          case "Response":
            return panic(`param ty in response: ${debug_Ty(t, PLAIN)}`);
        }
        break;
      }
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Adt":
      case "Foreign":
      case "Str":
      case "Array":
      case "Slice":
      case "RawPtr":
      case "Ref":
      case "Pat":
      case "FnDef":
      case "FnPtr":
      case "UnsafeBinder":
      case "Dynamic":
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
      case "CoroutineWitness":
      case "Never":
      case "Tuple":
      case "Alias":
      case "Bound":
      case "Error": {
        return fold_Ty.super_fold_with(t, this);
      }
    }

    const var_ = this.get_or_insert_bound_var(t, kind);

    return Ty.new_canonical_bound(this.cx(), var_);
  }

  // ---- impl TypeFolder for Canonicalizer ----
  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:420 cx
  cx(): TyCtxt {
    return this.delegate.cx();
  }

  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:424 fold_region
  fold_region(r: Region): Region {
    // We canonicalize free regions from the input into placeholder regions so that
    // region constraints created in nested contexts can be propagated back to the
    // caller, instead of unifying them.
    // See the following Zulip discussion for details:
    // https://rust-lang.zulipchat.com/#narrow/channel/364551-t-types.2Ftrait-system-refactor/topic/A.20question.20on.20.23251/near/579240238
    let kind: CanonicalVarKind;
    const rk = r.kind();
    const mode = this.canonicalize_mode;
    switch (rk.$) {
      case "ReBound":
        return r;

      // We don't canonicalize `ReStatic` in the `param_env` as we use it
      // when checking whether a `ParamEnv` candidate is global.
      case "ReStatic":
        if (mode.$ === "Input" && mode._0 === "Predicate") {
          kind = {
            $: "PlaceholderRegion",
            _0: PlaceholderRegion.new_anon(UniverseIndex.ROOT, BoundVar.from_usize(this.state.variables.length)),
          };
        } else {
          // CanonicalizeMode::Input(CanonicalizeInputKind::ParamEnv) | CanonicalizeMode::Response { .. }
          return r;
        }
        break;

      // `ReErased` should only be encountered in the hidden
      // type of an opaque for regions that are ignored for the purposes of
      // captures.
      //
      // FIXME: We should investigate the perf implications of not uniquifying
      // `ReErased`. We may be able to short-circuit registering region
      // obligations if we encounter a `ReErased` on one side, for example.
      case "ReErased":
      case "ReError":
        switch (mode.$) {
          case "Input":
            kind = {
              $: "PlaceholderRegion",
              _0: PlaceholderRegion.new_anon(UniverseIndex.ROOT, BoundVar.from_usize(this.state.variables.length)),
            };
            break;
          case "Response":
            return r;
        }
        break;

      case "ReEarlyParam":
      case "ReLateParam":
        switch (mode.$) {
          case "Input":
            kind = {
              $: "PlaceholderRegion",
              _0: PlaceholderRegion.new_anon(UniverseIndex.ROOT, BoundVar.from_usize(this.state.variables.length)),
            };
            break;
          case "Response":
            return panic(`unexpected region in response: ${debug_Region(r, PLAIN)}`);
        }
        break;

      case "RePlaceholder": {
        const placeholder = rk._0;
        switch (mode.$) {
          case "Input":
            kind = {
              $: "PlaceholderRegion",
              _0: PlaceholderRegion.new_anon(UniverseIndex.ROOT, BoundVar.from_usize(this.state.variables.length)),
            };
            break;
          case "Response": {
            const max_input_universe = mode.max_input_universe;
            // If we have a placeholder region inside of a query, it must be from
            // a new universe, unless from the root universe, which is used for
            // canonicalization of any free region from the input.
            if (
              PlaceholderRegion.universe(placeholder) !== UniverseIndex.ROOT &&
              UniverseIndex.can_name(max_input_universe, PlaceholderRegion.universe(placeholder))
            ) {
              return panic(`new placeholder in universe ${debug_UniverseIndex(max_input_universe, PLAIN)}: ${debug_Region(r, PLAIN)}`);
            }
            kind = { $: "PlaceholderRegion", _0: placeholder };
            break;
          }
        }
        break;
      }

      case "ReVar": {
        const vid = rk._0;
        // debug_assert_eq!(
        //     self.delegate.shallow_resolve_region_var(vid),
        //     r,
        //     "region vid should have been resolved fully before canonicalization"
        // );
        switch (mode.$) {
          case "Input":
            kind = {
              $: "PlaceholderRegion",
              _0: PlaceholderRegion.new_anon(UniverseIndex.ROOT, BoundVar.from_usize(this.state.variables.length)),
            };
            break;
          case "Response":
            // PORT(merge): ir_universe_of_region after infcx-contract
            kind = { $: "Region", _0: unwrap(this.delegate.deref().universe_of_region(vid)) };
            break;
        }
        break;
      }
    }

    const var_ = this.get_or_insert_bound_var(r, kind);

    return Region.new_canonical_bound(this.cx(), var_);
  }

  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:520 fold_ty
  fold_ty(t: Ty): Ty {
    if (!TypeFlags.intersects(t.flags(), NEEDS_CANONICAL)) {
      return t;
    } else {
      const ty = this.state.cache.get(t);
      if (ty !== undefined) {
        return ty;
      } else {
        const res = this.inner_fold_ty(t);
        const is_unseen = this.state.cache.insert(t, res);
        assert(is_unseen, "assertion failed: is_unseen");
        return res;
      }
    }
  }

  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:533 fold_const
  fold_const(c: Const): Const {
    if (!TypeFlags.intersects(c.flags(), NEEDS_CANONICAL)) {
      return c;
    }

    let kind: CanonicalVarKind;
    const ck = c.kind();
    switch (ck.$) {
      case "Infer": {
        const i = ck._0;
        switch (i.$) {
          case "Var": {
            // debug_assert_eq!(
            //     self.delegate.shallow_resolve_const_var(vid),
            //     c,
            //     "const vid should have been resolved fully before canonicalization"
            // );

            const vid = i._0;
            switch (this.canonicalize_mode.$) {
              case "Input":
                kind = { $: "Const", _0: UniverseIndex.ROOT };
                break;
              case "Response":
                kind = { $: "Const", _0: unwrap(this.delegate.deref().universe_of_const(vid)) };
                break;
            }
            break;
          }
          case "Fresh":
            return panic("not implemented");
        }
        break;
      }
      case "Placeholder": {
        const placeholder = ck._0;
        switch (this.canonicalize_mode.$) {
          case "Input":
            kind = {
              $: "PlaceholderConst",
              _0: PlaceholderConst.new_anon(UniverseIndex.ROOT, BoundVar.from_usize(this.state.variables.length)),
            };
            break;
          case "Response":
            kind = { $: "PlaceholderConst", _0: placeholder };
            break;
        }
        break;
      }
      case "Param": {
        switch (this.canonicalize_mode.$) {
          case "Input":
            kind = {
              $: "PlaceholderConst",
              _0: PlaceholderConst.new_anon(UniverseIndex.ROOT, BoundVar.from_usize(this.state.variables.length)),
            };
            break;
          case "Response":
            return panic(`param ty in response: ${debug_Const(c, PLAIN)}`);
        }
        break;
      }
      // FIXME: See comment above -- we could fold the region separately or something.
      case "Bound":
      case "Alias":
      case "Value":
      case "Error":
      case "Expr":
        return fold_Const.super_fold_with(c, this);
    }

    const var_ = this.get_or_insert_bound_var(c, kind);

    return Const.new_canonical_bound(this.cx(), var_);
  }

  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:591 fold_predicate
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return !TypeFlags.intersects(d.flags.flags(p), NEEDS_CANONICAL) ? p : d.super_fold_with(p, this);
  }

  // rustc: compiler/rustc_next_trait_solver/src/canonical/canonicalizer.rs:595 fold_clauses
  fold_clauses(c: Clauses): Clauses {
    const mode = this.canonicalize_mode;
    if ((mode.$ === "Input" && mode._0 === "ParamEnv") || mode.$ === "Response") {
      // nothing
    } else {
      // CanonicalizeMode::Input(CanonicalizeInputKind::Predicate)
      panic("erasing 'static in env");
    }
    return !TypeFlags.intersects(c.flags(), NEEDS_CANONICAL) ? c : fold_Clauses.super_fold_with(c, this);
  }

  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
}

/** PORT: D4 descriptor of `I::ParamEnv` (`#[derive(TypeVisitable, TypeFoldable)]`, rustc_middle ty/mod.rs: stubs there). */
const fold_ParamEnv_: TypeFoldable<ParamEnv> = {
  visit_with: visit_with_ParamEnv,
  try_fold_with: try_fold_with_ParamEnv,
  fold_with: fold_with_ParamEnv,
};
