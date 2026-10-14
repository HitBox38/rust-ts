// Port of compiler/rustc_infer/src/infer/relate/higher_ranked.rs (lane infer-relate).
//
//! Helper routines for higher-ranked things. See the `doc` module at
//! the end of the file for details.
//
// The `impl InferCtxt` methods (declared in ../../decls.ts) are assigned onto `InferCtxt.prototype`, in upstream order.
// `#[instrument]` / `debug!` are dropped (tracing is off in the oracle).
// Init order: top-level code here touches only ../../decls.ts and other crates.
import { FnMutDelegate } from "../../../rustc_middle/ty/fold.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { Binder, type BoundConst, type BoundRegion, type BoundTy, PlaceholderConst, PlaceholderRegion, PlaceholderType } from "../../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import type { UniverseIndex } from "../../../rustc_type_ir/lib.ts";
import type { RelateResult } from "../../../rustc_type_ir/relate.ts";
import { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { Ok } from "../../../std/result.ts";
import { InferCtxt } from "../../decls.ts";
import type { CombinedSnapshot } from "../snapshot/mod.ts";

// impl<'tcx> InferCtxt<'tcx>

/// Replaces all bound variables (lifetimes, types, and constants) bound by
/// `binder` with placeholder variables in a new universe. This means that the
/// new placeholders can only be named by inference variables created after
/// this method has been called.
///
/// This is the first step of checking subtyping when higher-ranked things are involved.
/// For more details visit the relevant sections of the [rustc dev guide].
///
/// `fn enter_forall` should be preferred over this method.
///
/// [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/traits/hrtb.html
// #[instrument(level = "debug", skip(self), ret)]
// rustc: compiler/rustc_infer/src/infer/relate/higher_ranked.rs:24 enter_forall_and_leak_universe
InferCtxt.prototype.enter_forall_and_leak_universe = function <T>(this: InferCtxt, binder: Binder<T>, d_T: TypeFoldable<T>): T {
  // Inlined `no_bound_vars`.
  if (!TypeVisitableExt.has_escaping_bound_vars(Binder.skip_binder(Binder.as_ref(binder)), d_T)) {
    return Binder.skip_binder(binder);
  }

  const next_universe = this.create_next_universe();

  const delegate = new FnMutDelegate(
    (br: BoundRegion) => {
      return Region.new_placeholder(this.tcx, PlaceholderRegion.new(next_universe, br));
    },
    (bound_ty: BoundTy) => {
      return Ty.new_placeholder(this.tcx, PlaceholderType.new(next_universe, bound_ty));
    },
    (bound_const: BoundConst) => {
      return Const.new_placeholder(this.tcx, PlaceholderConst.new(next_universe, bound_const));
    },
  );

  // debug!(?next_universe);
  return this.tcx.replace_bound_vars_uncached(binder, delegate, d_T);
};

/// Replaces all bound variables (lifetimes, types, and constants) bound by
/// `binder` with placeholder variables in a new universe and then calls the
/// closure `f` with the instantiated value. The new placeholders can only be
/// named by inference variables created inside of the closure `f` or afterwards.
///
/// This is the first step of checking subtyping when higher-ranked things are involved.
/// For more details visit the relevant sections of the [rustc dev guide].
///
/// This method should be preferred over `fn enter_forall_and_leak_universe`.
///
/// [rustc dev guide]: https://rustc-dev-guide.rust-lang.org/traits/hrtb.html
// #[instrument(level = "debug", skip(self, f))]
// rustc: compiler/rustc_infer/src/infer/relate/higher_ranked.rs:66 enter_forall
InferCtxt.prototype.enter_forall = function <T, U>(this: InferCtxt, forall: Binder<T>, f: (_1: T) => U, d_T: TypeFoldable<T>): U {
  // FIXME: currently we do nothing to prevent placeholders with the new universe being
  // used after exiting `f`. For example region subtyping can result in outlives constraints
  // that name placeholders created in this function. Nested goals from type relations can
  // also contain placeholders created by this function.
  const value = this.enter_forall_and_leak_universe(forall, d_T);
  // debug!(?value);
  return f(value);
};

/// See [RegionConstraintCollector::leak_check][1]. We only check placeholder
/// leaking into `outer_universe`, i.e. placeholders which cannot be named by that
/// universe.
///
/// [1]: crate::infer::region_constraints::RegionConstraintCollector::leak_check
// rustc: compiler/rustc_infer/src/infer/relate/higher_ranked.rs:84 leak_check
InferCtxt.prototype.leak_check = function (this: InferCtxt, outer_universe: UniverseIndex, only_consider_snapshot: CombinedSnapshot | undefined): RelateResult<null> {
  // If the user gave `-Zno-leak-check`, or we have been
  // configured to skip the leak check, then skip the leak check
  // completely. The leak check is deprecated. Any legitimate
  // subtyping errors that it would have caught will now be
  // caught later on, during region checking. However, we
  // continue to use it for a transition period.
  if (this.tcx.sess.opts.unstable_opts.no_leak_check || this.skip_leak_check) {
    return Ok(null);
  }

  return this.inner.unwrap_region_constraints().leak_check(this.tcx, outer_universe, this.universe(), only_consider_snapshot);
};
