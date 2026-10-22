//! Methods for normalizing when you don't care about regions (and
//! aren't doing type inference). If either of those things don't
//! apply to you, use `infcx.normalize(...)`.
//!
//! The methods in this file use a `TypeFolder` to recursively process
//! contents, invoking the underlying
//! `normalize_generic_arg_after_erasing_regions` query for each type
//! or constant found within. (This underlying query is what is cached.)
// Port of compiler/rustc_middle/src/ty/normalize_erasing_regions.rs (lane small-gaps-18; contract stub by lane
// ty-contract).
//
// PORT:
// - `T: TypeFoldable` arguments take the D4 descriptor last. The folders are classes implementing `TypeFolder` /
//   `FallibleTypeFolder`; the provided methods they do not override delegate to `TypeFolder_provided` /
//   `FallibleTypeFolder_provided` (unmarked).
// - `NormalizationError` is a `$`-tagged union with its derived Debug; its `TyEncodable`/`TyDecodable`/`StableHash`
//   derives are not reached (no metadata or incremental use yet).
// - `#[instrument]` / `debug!` are tracing only and stay as comments.
// Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code touches only the classes it imports. ty/print/pretty.ts (another extension module) is reached
// through `require` when `get_type_for_failure` runs.
import type { Binder } from "../../rustc_type_ir/binder.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import {
  type FallibleTypeFolder,
  FallibleTypeFolder_provided,
  type PredicateProxy,
  set_aliases_to_non_rigid,
  type TypeFoldable,
  type TypeFolder,
  TypeFolder_provided,
} from "../../rustc_type_ir/fold.ts";
import { display_Const } from "../../rustc_type_ir/ir_print.ts";
import type { NoSolution } from "../../rustc_type_ir/solve/mod.gen.ts";
import { type Const, debug_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { intern_key } from "../../rust_ts/intern_key.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type Debug, debug_tuple, PLAIN } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import { Err, Ok } from "../../std/result.ts";
import { TyCtxt } from "./context.ts";
import type { Clauses, GenericArgs } from "./decls.ts";
import { GenericArg } from "./generic_args.ts";
import { debug_TypingEnv, type Ty, type TypingEnv } from "./mod.ts";
import { debug_GenericArg, debug_Ty } from "./structural_impls.ts";

// rustc-type: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:21 NormalizationError
export type NormalizationError = { readonly $: "Type"; _0: Ty } | { readonly $: "Const"; _0: Const };
/** `#[derive(Debug)]` */
export const debug_NormalizationError: Debug<NormalizationError> = (v, f) => {
  switch (v.$) {
    case "Type":
      return debug_tuple(f, "Type", [debug_Ty(v._0, f)]);
    case "Const":
      return debug_tuple(f, "Const", [debug_Const(v._0, f)]);
  }
};

export const NormalizationError = {
  // rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:27 get_type_for_failure
  get_type_for_failure(self: NormalizationError): string {
    switch (self.$) {
      case "Type": {
        const t = self._0;
        return pretty().display_Ty(t);
      }
      case "Const": {
        const c = self._0;
        return display_Const(c);
      }
    }
  },
};

/** `require` of the extension module ty/print/pretty.ts (module comment). */
function pretty(): typeof import("./print/pretty.ts") {
  return (pretty__m ??= require("./print/pretty.ts") as typeof import("./print/pretty.ts"));
}
var pretty__m: typeof import("./print/pretty.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

/// Erase the regions in `value` and then fully normalize all the
/// types found within. The result will also have regions erased.
///
/// This should only be used outside of type inference. For example,
/// it assumes that normalization will succeed.
// #[tracing::instrument(level = "debug", skip(self, typing_env), ret)]
// rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:42 normalize_erasing_regions
TyCtxt.prototype.normalize_erasing_regions = function <T>(this: TyCtxt, typing_env: TypingEnv, value_: Unnormalized<T>, d_T: TypeFoldable<T>): T {
  let value = Unnormalized.skip_normalization(value_);
  // debug!(
  //     "normalize_erasing_regions::<{}>(value={:?}, typing_env={:?})",
  //     std::any::type_name::<T>(),
  //     value,
  //     typing_env,
  // );

  // Erase first before we do the real query -- this keeps the
  // cache from being too polluted.
  value = this.erase_and_anonymize_regions(value, d_T);
  // debug!(?value);

  if (!TypeVisitableExt.has_aliases(value, d_T)) {
    return value;
  } else {
    return d_T.fold_with(value, new NormalizeAfterErasingRegionsFolder(this, typing_env));
  }
};

// rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:70 assert_fully_normalized
TyCtxt.prototype.assert_fully_normalized = function <T>(this: TyCtxt, typing_env: TypingEnv, value_: T, d_T: TypeFoldable<T>): void {
  const value = this.erase_and_anonymize_regions(value_, d_T);
  if (TypeVisitableExt.has_aliases(value, d_T)) {
    // We want this check to also detect cases where an alias is incorrectly
    // rigid in the current `TypingEnv`. This is the case if we use values
    // which have been normalized in a different `TypingEnv` without
    // renormalizing them. This was necessary to catch e.g. #163724.
    const normalized = d_T.fold_with(
      Unnormalized.skip_normalization(set_aliases_to_non_rigid(this, value, d_T)),
      new NormalizeAfterErasingRegionsFolder(this, typing_env),
    );
    // assert_eq!(value, normalized);
    // PORT: `T: Eq` is `intern_key` equality (rust_ts/intern_key.ts: equal exactly when the Rust values are `==`).
    // The failure message needs `T: Debug`, which the `TypeFoldable` descriptor does not carry, so a failing assert
    // (an ICE upstream) stops as UNPORTED instead of printing a guessed message.
    if (intern_key(value) !== intern_key(normalized)) {
      unported("rustc_middle::ty::normalize_erasing_regions::TyCtxt::assert_fully_normalized: assert_eq! failure message (Debug of T)");
    }
  }
};

// rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:88 debug_assert_fully_normalized
TyCtxt.prototype.debug_assert_fully_normalized = function <T>(this: TyCtxt, typing_env: TypingEnv, value: T, d_T: TypeFoldable<T>): void {
  // PORT: `cfg!(debug_assertions)` is false: rustc ships without debug assertions (PORTING §3).
  const debug_assertions = false;
  if (debug_assertions) {
    this.assert_fully_normalized(typing_env, value, d_T);
  }
};

/// Tries to erase the regions in `value` and then fully normalize all the
/// types found within. The result will also have regions erased.
///
/// Contrary to `normalize_erasing_regions` this function does not assume that normalization
/// succeeds.
// rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:103 try_normalize_erasing_regions
TyCtxt.prototype.try_normalize_erasing_regions = function <T>(
  this: TyCtxt,
  typing_env: TypingEnv,
  value_: Unnormalized<T>,
  d_T: TypeFoldable<T>,
): Result<T, NormalizationError> {
  let value = Unnormalized.skip_normalization(value_);
  // debug!(
  //     "try_normalize_erasing_regions::<{}>(value={:?}, typing_env={:?})",
  //     std::any::type_name::<T>(),
  //     value,
  //     typing_env,
  // );

  // Erase first before we do the real query -- this keeps the
  // cache from being too polluted.
  value = this.erase_and_anonymize_regions(value, d_T);
  // debug!(?value);

  if (!TypeVisitableExt.has_aliases(value, d_T)) {
    return Ok(value);
  } else {
    const folder = TryNormalizeAfterErasingRegionsFolder.new(this, typing_env);
    return d_T.try_fold_with(value, folder);
  }
};

/// If you have a `Binder<'tcx, T>`, you can do this to strip out the
/// late-bound regions and then normalize the result, yielding up
/// a `T` (with regions erased). This is appropriate when the
/// binder is being instantiated at the call site.
///
/// N.B., currently, higher-ranked type bounds inhibit
/// normalization. Therefore, each time we erase them in
/// codegen, we need to normalize the contents.
// FIXME(@lcnr): This method should not be necessary, we now normalize
// inside of binders. We should be able to only use
// `tcx.instantiate_bound_regions_with_erased`.
// #[tracing::instrument(level = "debug", skip(self, typing_env))]
// rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:144 normalize_erasing_late_bound_regions
TyCtxt.prototype.normalize_erasing_late_bound_regions = function <T>(this: TyCtxt, typing_env: TypingEnv, value: Binder<T>, d_T: TypeFoldable<T>): T {
  const value_ = this.instantiate_bound_regions_with_erased(value, d_T);
  return this.normalize_erasing_regions(typing_env, Unnormalized.new_wip(value_), d_T);
};

/// Monomorphizes a type from the AST by first applying the
/// in-scope instantiations and then normalizing any associated
/// types.
/// Panics if normalization fails. In case normalization might fail
/// use `try_instantiate_and_normalize_erasing_regions` instead.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:162 instantiate_and_normalize_erasing_regions
TyCtxt.prototype.instantiate_and_normalize_erasing_regions = function <T>(
  this: TyCtxt,
  param_args: GenericArgs,
  typing_env: TypingEnv,
  value: EarlyBinder<T>,
  d_T: TypeFoldable<T>,
): T {
  const instantiated = EarlyBinder.instantiate(value, this, param_args, d_T);
  return this.normalize_erasing_regions(typing_env, instantiated, d_T);
};

/// Monomorphizes a type from the AST by first applying the
/// in-scope instantiations and then trying to normalize any associated
/// types. Contrary to `instantiate_and_normalize_erasing_regions` this does
/// not assume that normalization succeeds.
// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:180 try_instantiate_and_normalize_erasing_regions
TyCtxt.prototype.try_instantiate_and_normalize_erasing_regions = function <T>(
  this: TyCtxt,
  param_args: GenericArgs,
  typing_env: TypingEnv,
  value: EarlyBinder<T>,
  d_T: TypeFoldable<T>,
): Result<T, NormalizationError> {
  const instantiated = EarlyBinder.instantiate(value, this, param_args, d_T);
  return this.try_normalize_erasing_regions(typing_env, instantiated, d_T);
};

// rustc-type: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:194 NormalizeAfterErasingRegionsFolder
class NormalizeAfterErasingRegionsFolder implements TypeFolder {
  constructor(
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:200 normalize_generic_arg_after_erasing_regions
  normalize_generic_arg_after_erasing_regions(arg_: GenericArg): GenericArg {
    const arg = this.typing_env.as_query_input(arg_);
    const r = this.tcx.try_normalize_generic_arg_after_erasing_regions(arg) as Result<GenericArg, NoSolution>;
    if (r.$ === "Ok") return r._0;
    return bug(
      `Failed to normalize ${debug_GenericArg(arg.value, PLAIN)} in typing_env=${debug_TypingEnv(this.typing_env, PLAIN)}, maybe try to call \`try_normalize_erasing_regions\` instead`,
    );
  }

  // rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:217 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:221 fold_ty
  fold_ty(ty: Ty): Ty {
    return GenericArg.expect_ty(this.normalize_generic_arg_after_erasing_regions(GenericArg.from_Ty(ty)));
  }

  // rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:225 fold_const
  fold_const(c: Const): Const {
    return GenericArg.expect_const(this.normalize_generic_arg_after_erasing_regions(GenericArg.from_Const(c)));
  }

  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }

  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }

  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }

  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// rustc-type: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:230 TryNormalizeAfterErasingRegionsFolder
class TryNormalizeAfterErasingRegionsFolder implements FallibleTypeFolder<NormalizationError> {
  constructor(
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
  ) {}

  // rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:236 new
  static new(tcx: TyCtxt, typing_env: TypingEnv): TryNormalizeAfterErasingRegionsFolder {
    return new TryNormalizeAfterErasingRegionsFolder(tcx, typing_env);
  }

  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:241 try_normalize_generic_arg_after_erasing_regions
  try_normalize_generic_arg_after_erasing_regions(arg: GenericArg): Result<GenericArg, NoSolution> {
    const input = this.typing_env.as_query_input(arg);
    return this.tcx.try_normalize_generic_arg_after_erasing_regions(input) as Result<GenericArg, NoSolution>;
  }

  // rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:253 cx
  cx(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:257 try_fold_ty
  try_fold_ty(ty: Ty): Result<Ty, NormalizationError> {
    const r = this.try_normalize_generic_arg_after_erasing_regions(GenericArg.from_Ty(ty));
    if (r.$ === "Ok") {
      const t = r._0;
      return Ok(GenericArg.expect_ty(t));
    } else {
      return Err({ $: "Type", _0: ty });
    }
  }

  // rustc: compiler/rustc_middle/src/ty/normalize_erasing_regions.rs:264 try_fold_const
  try_fold_const(c: Const): Result<Const, NormalizationError> {
    const r = this.try_normalize_generic_arg_after_erasing_regions(GenericArg.from_Const(c));
    if (r.$ === "Ok") {
      const t = r._0;
      return Ok(GenericArg.expect_const(t));
    } else {
      return Err({ $: "Const", _0: c });
    }
  }

  try_fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Result<Binder<T>, NormalizationError> {
    return FallibleTypeFolder_provided.try_fold_binder(this, t, d);
  }

  try_fold_region(r: Region): Result<Region, NormalizationError> {
    return FallibleTypeFolder_provided.try_fold_region(this, r);
  }

  try_fold_predicate<P>(p: P, d: PredicateProxy<P>): Result<P, NormalizationError> {
    return FallibleTypeFolder_provided.try_fold_predicate(this, p, d);
  }

  try_fold_clauses(c: Clauses): Result<Clauses, NormalizationError> {
    return FallibleTypeFolder_provided.try_fold_clauses(this, c);
  }
}
