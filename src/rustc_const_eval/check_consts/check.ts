// Port of compiler/rustc_const_eval/src/check_consts/check.rs (lane const-check).
//
// PORT: `Q: Qualif` type parameters are the `Qualif` impl tables of qualifs.ts passed as values (`Q_`); the
// `Option<QualifResults<..>>` fields of `Qualifs` are `MutRef`s, so `Qualifs::in_local(&mut self.qualifs.x, ..)` passes
// the box and `get_or_insert_with` fills it (`??=`).
// PORT: `impl Deref for Checker { Target = ConstCx }` is the field `ccx` (PORTING §8: a `Deref` realised as a field);
// `self.tcx` / `self.body` / `self.const_kind()` read `this.ccx.tcx` / `this.ccx.body` / `this.ccx.const_kind_()`.
// PORT: `trace!` / `debug!` / `#[instrument]` (tracing) are not ported.
//! The `Visitor` responsible for actually checking a `mir::Body` for invalid operations.

import type { ConstStability } from "../../rustc_attr_ir/stability.gen.ts";
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import type { CoroutineKind } from "../../rustc_hir/hir.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { Obligation } from "../../rustc_infer/traits/mod.ts";
import { TraitErrors } from "../../rustc_infer/traits/engine.ts";
import {
  type BasicBlock,
  type BasicBlockData,
  type Body,
  CallSource,
  type ConstQualifs,
  type Local,
  type Location,
  Operand,
  type Place,
  RETURN_PLACE,
  type Rvalue,
  type SourceInfo,
  type Statement,
  type Terminator,
} from "../../rustc_middle/mir/mod.ts";
import * as traversal from "../../rustc_middle/mir/traversal.ts";
import { Visitor } from "../../rustc_middle/mir/visit.ts";
import { ObligationCause, ObligationCauseCode } from "../../rustc_middle/traits/mod.ts";
import { ConstConditions, type ConstConditions as ConstConditionsT } from "../../rustc_middle/ty/generics.ts";
import { fold_GenericArgs, type GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { HasAttrs_DefId, HasAttrs_LocalDefId, type Ty } from "../../rustc_middle/ty/mod.ts";
import type { PolyFnSig } from "../../rustc_middle/ty/sty.gen.ts";
import { type ResultsCursor } from "../../rustc_mir_dataflow/framework/cursor.ts";
import { always_storage_live_locals, MaybeStorageLive } from "../../rustc_mir_dataflow/impls/mod.ts";
import { type DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { span_bug } from "../../rustc_span/macros.ts";
import { sym, Symbol, type Symbol as SymbolT } from "../../rustc_span/symbol.ts";
import { ObligationCtxt } from "../../rustc_trait_selection/traits/engine.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../rustc_type_ir/binder.ts";
import { PolyTraitRef, TraitRef, fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../rustc_type_ir/predicate.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { FnSig } from "../../rustc_type_ir/ty_kind.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { PLAIN } from "../../std/fmt.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { Predicate_upcast_from_Clause } from "../../rustc_middle/ty/predicate.ts";
import type { Clause, Predicate } from "../../rustc_middle/ty/decls.ts";
import type { Interner } from "../../rustc_type_ir/interner.ts";
import { assert, unreachable, unwrap } from "../../std/panic.ts";
import * as diagnostics from "../diagnostics.ts";
import { type ConstCx, is_fn_or_trait_safe_to_expose_on_stable, rustc_allow_const_fn_unstable } from "./mod.ts";
import * as ops from "./ops.ts";
import type { NonConstOp } from "./ops.ts";
import * as post_drop_elaboration from "./post_drop_elaboration.ts";
import * as qualifs from "./qualifs.ts";
import { HasMutInterior, NeedsDrop, NeedsNonConstDrop, type Qualif } from "./qualifs.ts";
import { FlowSensitiveAnalysis, type State } from "./resolver.ts";

/** `{:?}` of a `Ty` in panic messages. */
function debug_ty(ty: Ty): string {
  return debug_Ty(ty, PLAIN);
}

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

// type QualifResults<'mir, 'tcx, Q> = rustc_mir_dataflow::ResultsCursor<'mir, 'tcx, FlowSensitiveAnalysis<'mir, 'tcx, Q>>;
type QualifResults = ResultsCursor<State, FlowSensitiveAnalysis>;

// rustc-type: compiler/rustc_const_eval/src/check_consts/check.rs:39 ConstConditionsHold
type ConstConditionsHold = "Yes" | "No";

// rustc-type: compiler/rustc_const_eval/src/check_consts/check.rs:45 Qualifs
export class Qualifs {
  constructor(
    public has_mut_interior: MutRef<QualifResults | undefined>,
    public needs_drop: MutRef<QualifResults | undefined>,
    public needs_non_const_drop: MutRef<QualifResults | undefined>,
  ) {}

  /** `#[derive(Default)]` */
  static default(): Qualifs {
    return new Qualifs({ value: undefined }, { value: undefined }, { value: undefined });
  }

  /// Does `Q` hold for the `local` at the given `Location`?
  ///
  /// Only updates the cursor if absolutely necessary.
  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:55 in_local
  static in_local(Q_: Qualif, qualif_results: MutRef<QualifResults | undefined>, ccx: ConstCx, local: Local, location: Location): boolean {
    const ty = ccx.body.local_decls[local]!.ty;
    // Peeking into opaque types causes cycles if the current function declares said opaque
    // type. Thus we avoid short circuiting on the type and instead run the more expensive
    // analysis that looks at the actual usage within this function.
    if (!TypeVisitableExt.has_opaque_types(ty, fold_Ty) && !Q_.in_any_value_of_ty(ccx, ty)) {
      return false;
    }

    const qualif_results_ = (qualif_results.value ??= ((): QualifResults => {
      const { tcx, body } = ccx;

      return FlowSensitiveAnalysis.new(Q_, ccx).iterate_to_fixpoint(tcx, body, undefined).into_results_cursor(body);
    })());

    qualif_results_.seek_before_primary_effect(location);
    return qualif_results_.get().contains(local);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:81 in_return_place
  in_return_place(ccx: ConstCx, tainted_by_errors: ErrorGuaranteed | undefined): ConstQualifs {
    // FIXME(explicit_tail_calls): uhhhh I think we can return without return now, does it change anything

    // Find the `Return` terminator if one exists.
    //
    // If no `Return` terminator exists, this MIR is divergent. Just return the conservative
    // qualifs for the return type.
    const blocks = ccx.body.basic_blocks.deref();
    let return_block: BasicBlock | undefined;
    for (let bb = 0; bb < blocks.length; bb++) {
      if (blocks[bb]!.terminator_().kind.$ === "Return") {
        return_block = bb as BasicBlock;
        break;
      }
    }

    if (return_block === undefined) {
      return qualifs.in_any_value_of_ty(ccx, ccx.body.return_ty(), tainted_by_errors);
    }

    const return_loc = ccx.body.terminator_loc(return_block);

    return {
      needs_drop: Qualifs.in_local(NeedsDrop, this.needs_drop, ccx, RETURN_PLACE, return_loc),
      needs_non_const_drop: Qualifs.in_local(NeedsNonConstDrop, this.needs_non_const_drop, ccx, RETURN_PLACE, return_loc),
      has_mut_interior: Qualifs.in_local(HasMutInterior, this.has_mut_interior, ccx, RETURN_PLACE, return_loc),
      tainted_by_errors,
    };
  }
}

// rustc-type: compiler/rustc_const_eval/src/check_consts/check.rs:124 Checker
export class Checker extends Visitor {
  constructor(
    public ccx: ConstCx,
    public qualifs: Qualifs,

    /// The span of the current statement.
    public span: Span,

    /// A set that stores for each local whether it is "transient", i.e. guaranteed to be dead
    /// when this MIR body returns.
    public transient_locals: DenseBitSet<Local> | undefined,

    public error_emitted: ErrorGuaranteed | undefined,
    public secondary_errors: Diag[],
  ) {
    super();
  }

  // impl Deref for Checker
  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:142 deref
  deref(): ConstCx {
    return this.ccx;
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:148 new
  static new(ccx: ConstCx): Checker {
    return new Checker(ccx, Qualifs.default(), ccx.body.span, undefined, undefined, []);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:159 check_body
  check_body(): void {
    const { tcx, body } = this.ccx;
    const def_id = this.ccx.def_id();

    // `async` functions cannot be `const fn`. This is checked during AST lowering, so there's
    // no need to emit duplicate errors here.
    if (this.ccx.is_async() || body.coroutine !== undefined) {
      tcx.dcx().span_delayed_bug(body.span, "`async` functions cannot be `const fn`");
      return;
    }

    if (find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcDoNotConstCheck" ? null : undefined)) === undefined) {
      this.visit_body(body);
    }

    // If we got through const-checking without emitting any "primary" errors, emit any
    // "secondary" errors if they occurred. Otherwise, cancel the "secondary" errors.
    const secondary_errors = this.secondary_errors;
    this.secondary_errors = [];
    if (this.error_emitted === undefined) {
      for (const error of secondary_errors) {
        this.error_emitted = error.emit_err();
      }
    } else {
      assert(this.ccx.tcx.dcx().has_errors() !== undefined, "assertion failed: self.tcx.dcx().has_errors().is_some()");
      for (const error of secondary_errors) {
        error.cancel();
      }
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:189 local_is_transient
  local_is_transient(local: Local): boolean {
    const ccx = this.ccx;
    return (this.transient_locals ??= ((): DenseBitSet<Local> => {
      // A local is "transient" if it is guaranteed dead at all `Return`.
      // So first compute the say of "maybe live" locals at each program point.
      const always_live_locals = always_storage_live_locals(ccx.body);
      const maybe_storage_live = MaybeStorageLive.new(always_live_locals)
        .iterate_to_fixpoint(ccx.tcx, ccx.body, undefined)
        .into_results_cursor(ccx.body);

      // And then check all `Return` in the MIR, and if a local is "maybe live" at a
      // `Return` then it is definitely not transient.
      const transient = DenseBitSet.new_filled<Local>(ccx.body.local_decls.length);
      // Make sure to only visit reachable blocks, the dataflow engine can ICE otherwise.
      for (const [bb, data] of traversal.reachable(ccx.body)) {
        if (data.terminator_().kind.$ === "Return") {
          const location = ccx.body.terminator_loc(bb);
          maybe_storage_live.seek_after_primary_effect(location);
          // If a local may be live here, it is definitely not transient.
          transient.subtract(maybe_storage_live.get());
        }
      }

      return transient;
    })()).contains(local);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:219 qualifs_in_return_place
  qualifs_in_return_place(): ConstQualifs {
    return this.qualifs.in_return_place(this.ccx, this.error_emitted);
  }

  /// Emits an error if an expression cannot be evaluated in the current context.
  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:224 check_op
  check_op(op: NonConstOp): void {
    this.check_op_spanned(op, this.span);
  }

  /// Emits an error at the given `span` if an expression cannot be evaluated in the current
  /// context.
  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:230 check_op_spanned
  check_op_spanned(op: NonConstOp, span: Span): void {
    const tcx = this.ccx.tcx;
    let gate: SymbolT | undefined;
    const status = op.status_in_item(this.ccx);
    if (status.$ === "Unstable" && (status.gate_already_checked || tcx.features().enabled(status.gate))) {
      const { gate, safe_to_expose_on_stable, is_function_call, gate_already_checked } = status;
      if (gate_already_checked) {
        assert(!safe_to_expose_on_stable, "setting `gate_already_checked` without `safe_to_expose_on_stable` makes no sense");
      }
      // Generally this is allowed since the feature gate is enabled -- except
      // if this function wants to be safe-to-expose-on-stable.
      if (
        !safe_to_expose_on_stable &&
        this.ccx.enforce_recursive_const_stability() &&
        !rustc_allow_const_fn_unstable(tcx, this.ccx.def_id(), gate)
      ) {
        // Avoid suggesting to add `rustc_const_unstable` if the attribute is already
        // present. Need to directly check raw attributes as
        // `tcx.lookup_const_stability` also includes inherited stability.
        const already_unstable =
          find_attr(HasAttrs_LocalDefId.get_attrs(this.ccx.def_id(), tcx), (k) =>
            k.$ === "RustcConstStability" && k.stability.is_const_unstable() ? null : undefined,
          ) !== undefined;
        emit_unstable_in_stable_exposed_error(this.ccx, span, gate, is_function_call, already_unstable);
      }

      return;
    } else if (status.$ === "Unstable") {
      gate = status.gate;
    } else {
      gate = undefined;
    }

    if (tcx.sess.opts.unstable_opts.unleash_the_miri_inside_of_you) {
      tcx.sess.miri_unleashed_feature(span, gate);
      return;
    }

    const err = op.build_error(this.ccx, span);
    assert(err.deref().is_error(), "assertion failed: err.is_error()");

    switch (op.importance()) {
      case "Primary": {
        const guar = err.emit_err();
        this.error_emitted = guar;
        break;
      }

      case "Secondary": {
        this.secondary_errors.push(err);
        tcx.dcx().span_delayed_bug(span, "compilation must fail when there is a secondary const checker error");
        break;
      }
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:294 check_static
  check_static(def_id: DefId, span: Span): void {
    const tcx = this.ccx.tcx;
    if (tcx.is_thread_local_static(def_id)) {
      tcx.dcx().span_bug(span, "tls access is checked in `Rvalue::ThreadLocalRef`");
    }
    const local = def_id.as_local();
    let r;
    if (local !== undefined && (r = tcx.ensure_result().check_well_formed(local) /* PORT: `hir::OwnerId { def_id }` is the query key `LocalDefId` */).$ === "Err") {
      const guar = r._0;
      this.error_emitted = guar;
    }
  }

  /// Returns whether this place can possibly escape the evaluation of the current const/static
  /// initializer. The check assumes that all already existing pointers and references point to
  /// non-escaping places.
  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:308 place_may_escape
  place_may_escape(place: Place): boolean {
    let is_transient: boolean;
    switch (this.ccx.const_kind_().$) {
      // In a const fn all borrows are transient or point to the places given via
      // references in the arguments (so we already checked them with
      // TransientMutBorrow/MutBorrow as appropriate).
      // The borrow checker guarantees that no new non-transient borrows are created.
      // NOTE: Once we have heap allocations during CTFE we need to figure out
      // how to prevent `const fn` to create long-lived allocations that point
      // to mutable memory.
      case "ConstFn":
        is_transient = true;
        break;
      default:
        // For indirect places, we are not creating a new permanent borrow, it's just as
        // transient as the already existing one.
        // Locals with StorageDead do not live beyond the evaluation and can
        // thus safely be borrowed without being able to be leaked to the final
        // value of the constant.
        // Note: This is only sound if every local that has a `StorageDead` has a
        // `StorageDead` in every control flow path leading to a `return` terminator.
        // If anything slips through, there's no safety net -- safe code can create
        // references to variants of `!Freeze` enums as long as that variant is `Freeze`, so
        // interning can't protect us here. (There *is* a safety net for mutable references
        // though, interning will ICE if we miss something here.)
        is_transient = place.is_indirect() || this.local_is_transient(place.local);
        break;
    }
    // Transient places cannot possibly escape because the place doesn't exist any more at the
    // end of evaluation.
    return !is_transient;
  }

  /// Returns whether there are const-conditions.
  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:339 revalidate_conditional_constness
  revalidate_conditional_constness(callee: DefId, callee_args: GenericArgs, call_span: Span): ConstConditionsHold | undefined {
    const tcx = this.ccx.tcx;
    if (!tcx.is_conditionally_const(callee)) {
      return undefined;
    }

    // PORT: the `const_conditions` query value is typed `unknown` in queries.gen.ts.
    const const_conditions = ConstConditions.instantiate(tcx.const_conditions(callee) as ConstConditionsT, tcx, callee_args);
    if (const_conditions.length === 0) {
      return undefined;
    }

    const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(this.ccx.body.typing_env(tcx));
    const ocx = ObligationCtxt.new(infcx);

    const body_id = this.ccx.body.source.def_id().expect_local();
    let host_polarity: "Maybe" | "Const";
    switch (this.ccx.const_kind_().$) {
      case "ConstFn":
        host_polarity = "Maybe";
        break;
      case "Static":
      case "Const":
        host_polarity = "Const";
        break;
    }
    const const_conditions_ = const_conditions.map(
      ([c, s]): [Binder<TraitRef>, Span] => [ocx.normalize(ObligationCause.misc(call_span, body_id), param_env, c, fold_Binder(d_TraitRef)), s],
    );
    ocx.register_obligations(
      const_conditions_.map(([trait_ref, span]) =>
        Obligation.new(
          tcx,
          ObligationCause.new(call_span, body_id, { $: "WhereClause", _0: callee, _1: span }),
          param_env,
          PolyTraitRef.to_host_effect_clause(trait_ref, tcx, host_polarity),
          Predicate_upcast_from_Clause as unknown as (from: Clause, tcx: Interner) => Predicate, // PORT: as effects.ts's `upcast_Clause`
        ),
      ),
    );

    const errors = ocx.evaluate_obligations_error_on_ambiguity();
    if (TraitErrors.no_errors(errors)) {
      return "Yes";
    } else {
      tcx.dcx().span_delayed_bug(call_span, "this should have reported a [const] error in HIR");
      return "No";
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:391 check_drop_terminator
  check_drop_terminator(dropped_place: Place, location: Location, terminator_span: Span): void {
    const ty_of_dropped_place = dropped_place.ty(this.ccx.body, this.ccx.tcx).ty;

    const local = dropped_place.as_local();
    const needs_drop =
      local !== undefined
        ? Qualifs.in_local(NeedsDrop, this.qualifs.needs_drop, this.ccx, local, location)
        : NeedsDrop.in_any_value_of_ty(this.ccx, ty_of_dropped_place);
    // If this type doesn't need a drop at all, then there's nothing to enforce.
    if (!needs_drop) {
      return;
    }

    let err_span = this.span;
    let needs_non_const_drop: boolean;
    const local_ = dropped_place.as_local();
    if (local_ !== undefined) {
      // Use the span where the local was declared as the span of the drop error.
      err_span = this.ccx.body.local_decls[local_]!.source_info.span;
      needs_non_const_drop = Qualifs.in_local(NeedsNonConstDrop, this.qualifs.needs_non_const_drop, this.ccx, local_, location);
    } else {
      needs_non_const_drop = NeedsNonConstDrop.in_any_value_of_ty(this.ccx, ty_of_dropped_place);
    }

    this.check_op_spanned(new ops.LiveDrop(terminator_span, ty_of_dropped_place, needs_non_const_drop), err_span);
  }

  /// Check the const stability of the given item (fn or trait).
  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:429 check_callee_stability
  check_callee_stability(def_id: DefId): void {
    const tcx = this.ccx.tcx;
    // PORT: the `lookup_const_stability` query value is typed `unknown` in queries.gen.ts.
    const stab = tcx.lookup_const_stability(def_id) as ConstStability | undefined;
    if (stab !== undefined && stab.level.$ === "Stable") {
      // All good.
    } else if (stab === undefined) {
      // This doesn't need a separate const-stability check -- const-stability equals
      // regular stability, and regular stability is checked separately.
      // However, we *do* have to worry about *recursive* const stability.
      if (this.ccx.enforce_recursive_const_stability() && !is_fn_or_trait_safe_to_expose_on_stable(tcx, def_id)) {
        this.ccx.dcx().emit_err(diagnostics.UnmarkedConstItemExposed_diagnostic({ span: this.span, def_path: tcx.def_path_str(def_id) }));
      }
    } else if (stab.level.$ === "Unstable") {
      const implied_feature = stab.level.implied_by;
      const issue = stab.level.issue;
      const feature = stab.feature;
      // An unstable const fn/trait with a feature gate.
      const callee_safe_to_expose_on_stable = is_fn_or_trait_safe_to_expose_on_stable(tcx, def_id);

      // We only honor `span.allows_unstable` aka `#[allow_internal_unstable]` if
      // the callee is safe to expose, to avoid bypassing recursive stability.
      // This is not ideal since it means the user sees an error, not the macro
      // author, but that's also the case if one forgets to set
      // `#[allow_internal_unstable]` in the first place. Note that this cannot be
      // integrated in the check below since we want to enforce
      // `callee_safe_to_expose_on_stable` even if
      // `!self.enforce_recursive_const_stability()`.
      if (
        (Span.allows_unstable(this.span, feature) || (implied_feature !== undefined && Span.allows_unstable(this.span, implied_feature))) &&
        callee_safe_to_expose_on_stable
      ) {
        return;
      }

      // We can't use `check_op` to check whether the feature is enabled because
      // the logic is a bit different than elsewhere: local functions don't need
      // the feature gate, and there might be an "implied" gate that also suffices
      // to allow this.
      const feature_enabled =
        def_id.is_local() ||
        tcx.features().enabled(feature) ||
        (implied_feature !== undefined && tcx.features().enabled(implied_feature)) ||
        // When we're compiling the compiler itself we may pull in
        // crates from crates.io, but those crates may depend on other
        // crates also pulled in from crates.io. We want to ideally be
        // able to compile everything without requiring upstream
        // modifications, so in the case that this looks like a
        // `rustc_private` crate (e.g., a compiler crate) and we also have
        // the `-Z force-unstable-if-unmarked` flag present (we're
        // compiling a compiler crate), then let this missing feature
        // annotation slide.
        // This matches what we do in `eval_stability_allow_unstable` for
        // regular stability.
        (feature === sym.rustc_private && issue === 27812 && tcx.sess.opts.unstable_opts.force_unstable_if_unmarked);
      // Even if the feature is enabled, we still need check_op to double-check
      // this if the callee is not safe to expose on stable.
      if (!feature_enabled || !callee_safe_to_expose_on_stable) {
        this.check_op(
          new ops.CallUnstable(def_id, feature, feature_enabled, callee_safe_to_expose_on_stable, tcx.def_kind(def_id).$ !== "Trait"),
        );
      }
    }
  }

  // ---- impl<'tcx> Visitor<'tcx> for Checker<'_, 'tcx> ----

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:511 visit_basic_block_data
  override visit_basic_block_data(bb: BasicBlock, block: BasicBlockData): void {
    // trace!("visit_basic_block_data: bb={:?} is_cleanup={:?}", bb, block.is_cleanup);

    // We don't const-check basic blocks on the cleanup path since we never unwind during
    // const-eval: a panic causes an immediate compile error. In other words, cleanup blocks
    // are unreachable during const-eval.
    //
    // We can't be more conservative (e.g., by const-checking cleanup blocks anyways) because
    // locals that would never be dropped during normal execution are sometimes dropped during
    // unwinding, which means backwards-incompatible live-drop errors.
    if (block.is_cleanup) {
      return;
    }

    this.super_basic_block_data(bb, block);
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:528 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    // trace!("visit_rvalue: rvalue={:?} location={:?}", rvalue, location);

    this.super_rvalue(rvalue, location);

    const tcx = this.ccx.tcx;
    switch (rvalue.$) {
      case "ThreadLocalRef":
        this.check_op(new ops.ThreadLocalAccess());
        break;

      case "Use":
      case "CopyForDeref":
      case "Repeat":
      case "Discriminant":
        break;

      case "Aggregate": {
        const kind = rvalue._0;
        let coroutine_kind: CoroutineKind | undefined;
        if (kind.$ === "Coroutine" && (coroutine_kind = tcx.coroutine_kind(kind._0) as CoroutineKind | undefined) !== undefined) {
          this.check_op(new ops.Coroutine(coroutine_kind));
        }
        break;
      }

      case "Ref":
      case "RawPtr": {
        const place = rvalue.$ === "Ref" ? rvalue._2 : rvalue._1;
        if ((rvalue.$ === "Ref" && rvalue._1.$ === "Mut") || (rvalue.$ === "RawPtr" && rvalue._0 === "Mut")) {
          // Inside mutable statics, we allow arbitrary mutable references.
          // We've allowed `static mut FOO = &mut [elements];` for a long time (the exact
          // reasons why are lost to history), and there is no reason to restrict that to
          // arrays and slices.
          const k = this.ccx.const_kind_();
          const is_allowed = k.$ === "Static" && k._0 === "Mut";

          if (!is_allowed && this.place_may_escape(place)) {
            this.check_op(new ops.EscapingMutBorrow());
          }
        } else if (rvalue.$ === "Ref" || rvalue._0 === "Const") {
          // `Rvalue::Ref(_, BorrowKind::Shared | BorrowKind::Fake(_), place) | Rvalue::RawPtr(RawPtrKind::Const, place)`
          const borrowed_place_has_mut_interior = qualifs.in_place(
            HasMutInterior,
            this.ccx,
            (local) => Qualifs.in_local(HasMutInterior, this.qualifs.has_mut_interior, this.ccx, local, location),
            place.as_ref(),
          );

          if (borrowed_place_has_mut_interior && this.place_may_escape(place)) {
            this.check_op(new ops.EscapingCellBorrow());
          }
        } else {
          // `Rvalue::RawPtr(RawPtrKind::FakeForPtrMetadata, place)`
          // These are only inserted for slice length, so the place must already be indirect.
          // This implies we do not have to worry about whether the borrow escapes.
          if (!place.is_indirect()) {
            tcx.dcx().span_delayed_bug(this.ccx.body.source_info(location).span, "fake borrows are always indirect");
          }
        }
        break;
      }

      case "Reborrow":
        // FIXME(reborrow): figure out if this is relevant at all.
        break;

      case "Cast": {
        const kind = rvalue._0;
        switch (kind.$) {
          case "IntToInt":
          case "FloatToInt":
          case "FloatToFloat":
          case "IntToFloat":
          case "PtrToPtr":
          case "FnPtrToPtr":
          case "Transmute":
          case "BoxDerefTransmute":
          case "PointerCoercion":
            // `PointerCoercion(MutToConstPointer | ArrayToPointer | UnsafeFnPointer | ClosureFnPointer(_) |
            // ReifyFnPointer(_) | Unsize, _)`: every `PointerCoercion` variant.
            // Operations that are fully supported by const-eval.
            break;
          // Special checks for special casts
          case "PointerExposeProvenance":
            this.check_op(new ops.RawPtrToIntCast());
            break;
          case "PointerWithExposedProvenance":
            // Since no pointer can ever get exposed (rejected above), this is easy to support.
            break;
          case "Subtype":
            span_bug(this.span, `invalid CastKind for this MIR phase: ${kind.$}`);
        }
        break;
      }

      case "UnaryOp": {
        const op = rvalue._0;
        const ty = Operand.ty(rvalue._1, this.ccx.body, tcx);
        switch (op) {
          case "Not":
          case "Neg":
            if (is_int_bool_float_or_char(ty)) {
              // Int, bool, float, and char operations are fine.
            } else {
              span_bug(this.span, `non-primitive type in \`Rvalue::UnaryOp${op}\`: ${debug_ty(ty)}`);
            }
            break;
          case "PtrMetadata":
            // Getting the metadata from a pointer is always const.
            // We already validated the type is valid in the validator.
            break;
        }
        break;
      }

      case "BinaryOp": {
        const op = rvalue._0;
        const [lhs, rhs] = rvalue._1;
        const lhs_ty = Operand.ty(lhs, this.ccx.body, tcx);
        const rhs_ty = Operand.ty(rhs, this.ccx.body, tcx);

        if (is_int_bool_float_or_char(lhs_ty) && is_int_bool_float_or_char(rhs_ty)) {
          // Int, bool, float, and char operations are fine.
        } else if (lhs_ty.is_fn_ptr() || lhs_ty.is_raw_ptr()) {
          assert(
            op === "Eq" || op === "Ne" || op === "Le" || op === "Lt" || op === "Ge" || op === "Gt" || op === "Offset",
            `assertion \`left matches right\` failed\n  left: ${op}\n right: BinOp::Eq | BinOp::Ne | BinOp::Le | BinOp::Lt | BinOp::Ge | BinOp::Gt | BinOp::Offset`,
          );

          this.check_op(new ops.RawPtrComparison());
        } else {
          span_bug(this.span, `non-primitive type in \`Rvalue::BinaryOp\`: ${debug_ty(lhs_ty)} ⚬ ${debug_ty(rhs_ty)}`);
        }
        break;
      }

      case "WrapUnsafeBinder":
        // Unsafe binders are always trivial to create.
        break;
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:687 visit_operand
  override visit_operand(op: Operand, location: Location): void {
    this.super_operand(op, location);
    let def_id: DefId | undefined;
    if (op.$ === "Constant" && (def_id = op._0.check_static_ptr(this.ccx.tcx)) !== undefined) {
      this.check_static(def_id, this.span);
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:696 visit_source_info
  override visit_source_info(source_info: SourceInfo): void {
    // trace!("visit_source_info: source_info={:?}", source_info);
    this.span = source_info.span;
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:701 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    // trace!("visit_statement: statement={:?} location={:?}", statement, location);

    this.super_statement(statement, location);

    switch (statement.kind.$) {
      case "Assign":
      case "SetDiscriminant":
      case "FakeRead":
      case "StorageLive":
      case "StorageDead":
      case "PlaceMention":
      case "AscribeUserType":
      case "Coverage":
      case "Intrinsic":
      case "ConstEvalCounter":
      case "BackwardIncompatibleDropHint":
      case "Nop":
        break;
    }
  }

  // rustc: compiler/rustc_const_eval/src/check_consts/check.rs:723 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    this.super_terminator(terminator, location);

    const tk = terminator.kind;
    switch (tk.$) {
      case "Call":
      case "TailCall": {
        const { func, args, fn_span } = tk;
        let call_source: CallSource;
        switch (tk.$) {
          case "Call":
            call_source = tk.call_source;
            break;
          case "TailCall":
            call_source = "Normal";
            break;
          default:
            unreachable();
        }

        const { tcx, body } = this.ccx;

        const fn_ty = Operand.ty(func, body, tcx);

        let callee: DefId;
        let fn_args: GenericArgs;
        const fk = fn_ty.kind();
        switch (fk.$) {
          case "FnDef":
            callee = fk._0;
            fn_args = unwrap(Binder.no_bound_vars(fk._1, fold_GenericArgs));
            break;

          case "FnPtr":
            this.check_op(new ops.FnCallIndirect());
            // We can get here without an error in miri-unleashed mode... might as well
            // skip the rest of the checks as well then.
            return;
          default:
            span_bug(terminator.source_info.span, `invalid callee of type ${debug_ty(fn_ty)}`);
        }

        const has_const_conditions = this.revalidate_conditional_constness(callee, fn_args, fn_span);

        // Attempting to call a trait method?
        const trait_did = tcx.trait_of_assoc(callee);
        if (trait_did !== undefined) {
          // We can't determine the actual callee (the underlying impl of the trait) here, so we have
          // to do different checks than usual.

          // trace!("attempting to call a trait method");
          const c = tcx.constness(callee) as import("../../rustc_hir/hir.ts").Constness; // PORT: query value `unknown`
          const is_const = c.$ === "Const" && c.always === false;

          // Only consider a trait to be const if the const conditions hold.
          // Otherwise, it's really misleading to call something "conditionally"
          // const when it's very obviously not conditionally const.
          if (is_const && has_const_conditions === "Yes") {
            // Trait calls are always conditionally-const.
            this.check_op(new ops.ConditionallyConstCall(callee, fn_args, fn_span, call_source));
            this.check_callee_stability(trait_did);
          } else {
            // Not even a const trait.
            this.check_op(new ops.FnCallNonConst(callee, fn_args, fn_span, call_source));
          }
          // That's all we can check here.
          return;
        }

        // Even if we know the callee, ensure we can use conditionally-const calls.
        if (has_const_conditions !== undefined) {
          this.check_op(new ops.ConditionallyConstCall(callee, fn_args, fn_span, call_source));
        }

        // PORT: the `fn_sig` query value is typed `unknown` in queries.gen.ts.
        if (FnSig.c_variadic(Binder.skip_binder(EarlyBinder.skip_binder(tcx.fn_sig(callee) as EarlyBinder<PolyFnSig>)))) {
          this.check_op(new ops.FnCallCVariadic());
        }

        // At this point, we are calling a function, `callee`, whose `DefId` is known...

        // `begin_panic` and `panic_display` functions accept generic
        // types other than str. Check to enforce that only str can be used in
        // const-eval.

        // const-eval of the `begin_panic` fn assumes the argument is `&str`
        if (tcx.is_lang_item(callee, LangItem.BeginPanic)) {
          const k = Operand.ty(args[0]!.node, this.ccx.body.local_decls, tcx).kind();
          if (k.$ === "Ref" && k._1.is_str()) {
          } else {
            this.check_op(new ops.PanicNonStr());
          }
          // Allow this call, skip all the checks below.
          return;
        }

        // const-eval of `panic_display` assumes the argument is `&&str`
        if (tcx.is_lang_item(callee, LangItem.PanicDisplay)) {
          const k = Operand.ty(args[0]!.node, this.ccx.body.local_decls, tcx).kind();
          let k2;
          if (k.$ === "Ref" && (k2 = k._1.kind()).$ === "Ref" && k2._1.is_str()) {
          } else {
            this.check_op(new ops.PanicNonStr());
          }
          // Allow this call, skip all the checks below.
          return;
        }

        // Intrinsics are language primitives, not regular calls, so treat them separately.
        const intrinsic = tcx.intrinsic(callee);
        if (intrinsic !== undefined) {
          if (!tcx.is_const_fn(callee)) {
            // Non-const intrinsic.
            this.check_op(new ops.IntrinsicNonConst(intrinsic.name));
            // If we allowed this, we're in miri-unleashed mode, so we might
            // as well skip the remaining checks.
            return;
          }
          // In addition to the usual check, we also require that the intrinsic either has
          // a fallback body, or the special `#[rustc_intrinsic_const_stable_indirect]`.
          const usable_fallback_body =
            !intrinsic.must_be_overridden &&
            find_attr(HasAttrs_DefId.get_attrs(callee, tcx), (k) => (k.$ === "RustcDoNotConstCheck" ? null : undefined)) === undefined;
          const const_stable_indirect =
            is_fn_or_trait_safe_to_expose_on_stable(tcx, callee) && (usable_fallback_body || intrinsic.const_stable_indirect);
          // PORT: the `lookup_const_stability` query value is typed `unknown` in queries.gen.ts.
          const stab = tcx.lookup_const_stability(callee) as ConstStability | undefined;
          if (stab === undefined) {
            // This doesn't need a separate const-stability check -- const-stability equals
            // regular stability, and regular stability is checked separately.
            // However, we *do* have to worry about *recursive* const stability.
            if (!const_stable_indirect && this.ccx.enforce_recursive_const_stability()) {
              this.ccx.dcx().emit_err(
                diagnostics.UnmarkedIntrinsicExposed_diagnostic({ span: this.span, def_path: tcx.def_path_str(callee) }),
              );
            }
          } else if (stab.level.$ === "Unstable") {
            const feature = stab.feature;
            // We only honor `span.allows_unstable` aka `#[allow_internal_unstable]`
            // if the callee is safe to expose, to avoid bypassing recursive stability.
            // This is not ideal since it means the user sees an error, not the macro
            // author, but that's also the case if one forgets to set
            // `#[allow_internal_unstable]` in the first place.
            if (Span.allows_unstable(this.span, feature) && const_stable_indirect) {
              return;
            }

            this.check_op(new ops.IntrinsicUnstable(intrinsic.name, feature, const_stable_indirect));
          } else {
            // All good. Note that a `#[rustc_const_stable]` intrinsic (meaning it
            // can be *directly* invoked from stable const code) does not always
            // have the `#[rustc_intrinsic_const_stable_indirect]` attribute (which controls
            // exposing an intrinsic indirectly); we accept this call anyway.
          }
          // This completes the checks for intrinsics.
          return;
        }

        if (!tcx.is_const_fn(callee)) {
          this.check_op(new ops.FnCallNonConst(callee, fn_args, fn_span, call_source));
          // If we allowed this, we're in miri-unleashed mode, so we might
          // as well skip the remaining checks.
          return;
        }

        // Finally, stability for regular function calls -- this is the big one.
        this.check_callee_stability(callee);
        break;
      }

      // Forbid all `Drop` terminators unless the place being dropped is a local with no
      // projections that cannot be `NeedsNonConstDrop`.
      case "Drop": {
        const dropped_place = tk.place;
        // If we are checking live drops after drop-elaboration, don't emit duplicate
        // errors here.
        if (post_drop_elaboration.checking_enabled(this.ccx)) {
          return;
        }

        this.check_drop_terminator(dropped_place, location, terminator.source_info.span);
        break;
      }

      case "InlineAsm":
        this.check_op(new ops.InlineAsm());
        break;

      case "Yield":
        this.check_op(
          new ops.Coroutine(
            unwrap(
              this.ccx.tcx.coroutine_kind(this.ccx.body.source.def_id()) as CoroutineKind | undefined,
              "Only expected to have a yield in a coroutine",
            ),
          ),
        );
        break;

      case "CoroutineDrop":
        span_bug(
          this.ccx.body.source_info(location).span,
          "We should not encounter TerminatorKind::CoroutineDrop after coroutine transform",
        );

      case "UnwindTerminate":
        // Cleanup blocks are skipped for const checking (see `visit_basic_block_data`).
        span_bug(this.span, "`Terminate` terminator outside of cleanup block");

      case "Assert":
      case "FalseEdge":
      case "FalseUnwind":
      case "Goto":
      case "UnwindResume":
      case "Return":
      case "SwitchInt":
      case "Unreachable":
        break;
    }
  }
}

// rustc: compiler/rustc_const_eval/src/check_consts/check.rs:955 is_int_bool_float_or_char
function is_int_bool_float_or_char(ty: Ty): boolean {
  return ty.is_bool() || ty.is_integral() || ty.is_char() || ty.is_floating_point();
}

// rustc: compiler/rustc_const_eval/src/check_consts/check.rs:959 emit_unstable_in_stable_exposed_error
function emit_unstable_in_stable_exposed_error(
  ccx: ConstCx,
  span: Span,
  gate: SymbolT,
  is_function_call: boolean,
  already_unstable: boolean,
): ErrorGuaranteed {
  const attr_span = Span.shrink_to_lo(ccx.tcx.def_span(LocalDefId.to_def_id(ccx.def_id())));

  return ccx.dcx().emit_err(
    diagnostics.UnstableInStableExposed_diagnostic({
      gate: Symbol.as_str(gate),
      span,
      suggest_const_unstable: !already_unstable ? attr_span : undefined,
      is_function_call,
      is_function_call2: is_function_call,
    }),
  );
}
