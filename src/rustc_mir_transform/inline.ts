// Port of compiler/rustc_mir_transform/src/inline.rs (lane mt-inline).
//
// PORT: `trait Inliner<'tcx>` is the interface `Inliner`; its implementors `ForceInliner` / `NormalInliner` are classes.
// The generic `inline::<T: Inliner>` takes `T::new` as a parameter (`new_inliner`); the generic helpers over
// `I: Inliner` take the inliner object. `changed(self)` (by value) is a method call.
// PORT: `Result<_, &'static str>` is `Result<_, string>`; `Result<(), _>` is `Result<null, _>`; `?` is an explicit `Err`
// return. `Range<BasicBlock>` is `{ start, end }` (`BlockRange`); `RangeFrom<Local / SourceScope / BasicBlock>` in
// `Integrator` is the `start` index.
// PORT: `#[instrument]` / `trace!` / `debug!` / `trace_span!` (tracing) are dropped; `#[derive(Clone, Debug)]` of
// `CallSite` is not ported (only tracing printed it, and `CallSite` is never cloned).
// PORT: `Integrator`'s `tcx` field is `tcx_` (`MutVisitor::tcx()` holds the name), as the cleanup passes' visitors.
// PORT: `ty::EarlyBinder::bind(tcx, callee_body.clone())` clones with the generated `clone_Body` and binds with
// shim.ts's `Body_foldable` descriptor (the derived `TypeFoldable for Body`), reached through a lazy `require`: shim.ts
// imports this module.
// PORT: copies of the `Copy` MIR objects (`SourceInfo`, `Place`) stored into new statements and terminators are
// `clone_*` (PORTING §8).
// PORT: the query values typed `unknown` by queries.gen.ts (`codegen_fn_attrs`, `fn_sig`) are cast to their upstream
// types; `tcx.codegen_instance_attrs` is codegen_fn_attrs.ts's `TyCtxt_codegen_instance_attrs`.
//! Inlining pass for MIR functions.
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { FieldIdx } from "../rustc_abi/layout.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { sub_types } from "../rustc_const_eval/util/compare_types.ts";
import { BodyOwnerKind } from "../rustc_hir/hir.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import {
  type CodegenFnAttrs,
  SanitizerFnAttrs_eq,
  TyCtxt_codegen_instance_attrs,
} from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { Const as mir_Const } from "../rustc_middle/mir/consts.ts";
import {
  BasicBlock,
  BasicBlockData,
  type Body,
  clone_Body,
  clone_Place,
  clone_SourceInfo,
  clone_SourceScopeData,
  debug_TerminatorKind,
  Local,
  LocalDecl,
  type Location,
  type MentionedItem,
  Operand,
  OUTERMOST_SOURCE_SCOPE,
  type Place,
  Place_from_Local,
  RETURN_PLACE,
  type Rvalue,
  Rvalue as Rvalue_,
  SourceInfo,
  SourceScope,
  type SourceScopeData,
  START_BLOCK,
  Statement,
  Terminator,
  TerminatorKind,
  type UnwindAction,
} from "../rustc_middle/mir/mod.ts";
import { MutVisitor, type PlaceContext } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArgs, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { debug_Instance, Instance, InstanceKind } from "../rustc_middle/ty/instance.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { OptLevel } from "../rustc_session/config.ts";
import { type DefId, DefId_eq } from "../rustc_span/def_id.ts";
import { debug_Span, type Spanned } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { TypeFlags } from "../rustc_type_ir/flags.ts";
import { type FnSig, fold_FnSig, PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized, visit_with_Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { intern_key_eq } from "../rust_ts/intern_key.ts";
import { debug_option, debug_tuple, format_debug, PLAIN } from "../std/fmt.ts";
import { field_mut, type MutRef } from "../std/mut_ref.ts";
import { assert, assert_eq, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { is_inline_valid_on_body, is_inline_valid_on_fn } from "./check_inline.ts";
import { CostChecker, is_call_like } from "./cost_checker.ts";
import { ForceInlineFailure_diagnostic } from "./diagnostics.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { simplify_cfg, UsedInStmtLocals } from "./simplify.ts";
import { validate_types } from "./validate.ts";

// pub(crate) mod cycle;
export * as cycle from "./inline/cycle.ts";

const HISTORY_DEPTH_LIMIT = 20;
const TOP_DOWN_DEPTH_LIMIT = 5;

/** PORT: `std::ops::Range<BasicBlock>` (see the header). */
interface BlockRange {
  start: BasicBlock;
  end: BasicBlock;
}

/** PORT: shim.ts's `Body_foldable` (see the header). */
function Body_foldable(): typeof import("./shim.ts").Body_foldable {
  return (require("./shim.ts") as typeof import("./shim.ts")).Body_foldable;
}

// #[derive(Clone, Debug)]
// rustc-type: compiler/rustc_mir_transform/src/inline.rs:34 CallSite
interface CallSite {
  callee: Instance;
  fn_sig: Binder<FnSig>;
  block: BasicBlock;
  source_info: SourceInfo;
}

// Made public so that `mir_drops_elaborated_and_const_checked` can be overridden
// by custom rustc drivers, running all the steps by themselves. See #114628.
// rustc-type: compiler/rustc_mir_transform/src/inline.rs:43 Inline
export class Inline extends MirPass {
  readonly type_name = "rustc_mir_transform::inline::Inline";

  // rustc: compiler/rustc_mir_transform/src/inline.rs:46 policy
  policy(ctx: PassCtx): PassPolicy {
    const opts = ctx.deref().opts;
    const enabled = opts.unstable_opts.inline_mir;
    if (enabled !== undefined) {
      return PassPolicy.optional(enabled);
    } else {
      let on: boolean;
      const level = ctx.mir_opt_level();
      switch (level) {
        case 0:
        case 1:
          on = false;
          break;
        // Only inline for `-Copt-level >= 2`, and don't inline
        // in incremental mode to increase incremental effectiveness.
        // FIXME: This should be cleaned up to not rely on inspecting the global opt level.
        case 2:
          on = (opts.optimize === OptLevel.More || opts.optimize === OptLevel.Aggressive) && opts.incremental === undefined;
          break;
        default:
          on = true;
      }
      return PassPolicy.optional(on);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:64 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // let span = trace_span!("inline", body = %tcx.def_path_str(body.source.def_id()));
    if (inline(tcx, body, NormalInliner.new)) {
      // debug!("running simplify cfg on {:?}", body.source);
      simplify_cfg(tcx, body);
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/inline.rs:74 ForceInline
export class ForceInline extends MirPass {
  readonly type_name = "rustc_mir_transform::inline::ForceInline";

  // rustc: compiler/rustc_mir_transform/src/inline.rs:77 should_run_pass_for_callee
  static should_run_pass_for_callee(tcx: TyCtxt, def_id: DefId): boolean {
    return (tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).inline.$ === "Force";
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:83 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Forced inlining is part of MIR semantics.
    return PassPolicy.Required;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:88 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // let span = trace_span!("force_inline", body = %tcx.def_path_str(body.source.def_id()));
    if (inline(tcx, body, ForceInliner.new)) {
      // debug!("running simplify cfg on {:?}", body.source);
      simplify_cfg(tcx, body);
    }
  }
}

// rustc-trait: compiler/rustc_mir_transform/src/inline.rs:98 Inliner
interface Inliner {
  // rustc: compiler/rustc_mir_transform/src/inline.rs:99 new
  // (static: passed to `inline` as `new_inliner`)

  // rustc: compiler/rustc_mir_transform/src/inline.rs:101 tcx
  tcx(): TyCtxt;
  // rustc: compiler/rustc_mir_transform/src/inline.rs:102 typing_env
  typing_env(): TypingEnv;
  // rustc: compiler/rustc_mir_transform/src/inline.rs:103 history
  history(): readonly DefId[];
  // rustc: compiler/rustc_mir_transform/src/inline.rs:104 caller_def_id
  caller_def_id(): DefId;

  /// Has the caller body been changed?
  // rustc: compiler/rustc_mir_transform/src/inline.rs:107 changed
  changed(): boolean;

  /// Should inlining happen for a given callee?
  // rustc: compiler/rustc_mir_transform/src/inline.rs:110 should_inline_for_callee
  should_inline_for_callee(def_id: DefId): boolean;

  // rustc: compiler/rustc_mir_transform/src/inline.rs:112 check_codegen_attributes_extra
  check_codegen_attributes_extra(callee_attrs: CodegenFnAttrs): Result<null, string>;

  // rustc: compiler/rustc_mir_transform/src/inline.rs:117 check_caller_mir_body
  check_caller_mir_body(body: Body): boolean;

  /// Returns inlining decision that is based on the examination of callee MIR body.
  /// Assumes that codegen attributes have been checked for compatibility already.
  // rustc: compiler/rustc_mir_transform/src/inline.rs:121 check_callee_mir_body
  check_callee_mir_body(callsite: CallSite, callee_body: Body, callee_attrs: CodegenFnAttrs): Result<null, string>;

  /// Called when inlining succeeds.
  // rustc: compiler/rustc_mir_transform/src/inline.rs:129 on_inline_success
  on_inline_success(callsite: CallSite, caller_body: Body, new_blocks: BlockRange): void;

  /// Called when inlining failed or was not performed.
  // rustc: compiler/rustc_mir_transform/src/inline.rs:137 on_inline_failure
  on_inline_failure(callsite: CallSite, reason: string): void;
}

// rustc-type: compiler/rustc_mir_transform/src/inline.rs:140 ForceInliner
class ForceInliner implements Inliner {
  constructor(
    public tcx_: TyCtxt,
    public typing_env_: TypingEnv,
    /// `DefId` of caller.
    public def_id: DefId,
    /// Stack of inlined instances.
    /// We only check the `DefId` and not the args because we want to
    /// avoid inlining cases of polymorphic recursion.
    /// The number of `DefId`s is finite, so checking history is enough
    /// to ensure that we do not loop endlessly while inlining.
    public history_: DefId[],
    /// Indicates that the caller body has been modified.
    public changed_: boolean,
  ) {}

  // impl<'tcx> Inliner<'tcx> for ForceInliner<'tcx>

  // rustc: compiler/rustc_mir_transform/src/inline.rs:156 new
  static new(tcx: TyCtxt, def_id: DefId, body: Body): ForceInliner {
    return new ForceInliner(tcx, body.typing_env(tcx), def_id, [], false);
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:160 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:164 typing_env
  typing_env(): TypingEnv {
    return this.typing_env_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:168 history
  history(): readonly DefId[] {
    return this.history_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:172 caller_def_id
  caller_def_id(): DefId {
    return this.def_id;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:176 changed
  changed(): boolean {
    return this.changed_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:180 should_inline_for_callee
  should_inline_for_callee(def_id: DefId): boolean {
    return ForceInline.should_run_pass_for_callee(this.tcx(), def_id);
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:184 check_codegen_attributes_extra
  check_codegen_attributes_extra(_callee_attrs: CodegenFnAttrs): Result<null, string> {
    // debug_assert_matches!(callee_attrs.inline, InlineAttr::Force { .. });
    return Ok(null);
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:192 check_caller_mir_body
  check_caller_mir_body(_: Body): boolean {
    return true;
  }

  // #[instrument(level = "debug", skip(self, callee_body))]
  // rustc: compiler/rustc_mir_transform/src/inline.rs:197 check_callee_mir_body
  check_callee_mir_body(_: CallSite, callee_body: Body, callee_attrs: CodegenFnAttrs): Result<null, string> {
    if (callee_body.tainted_by_errors !== undefined) {
      return Err("body has errors");
    }

    const caller_attrs = this.tcx().codegen_fn_attrs(this.caller_def_id()) as CodegenFnAttrs;
    if (
      callee_attrs.instruction_set !== caller_attrs.instruction_set &&
      callee_body.basic_blocks.deref().some((bb) => bb.terminator_().kind.$ === "InlineAsm")
    ) {
      // During the attribute checking stage we allow a callee with no
      // instruction_set assigned to count as compatible with a function that does
      // assign one. However, during this stage we require an exact match when any
      // inline-asm is detected. LLVM will still possibly do an inline later on
      // if the no-attribute function ends up with the same instruction set anyway.
      return Err("cannot move inline-asm across instruction sets");
    } else {
      return Ok(null);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:225 on_inline_success
  on_inline_success(callsite: CallSite, caller_body: Body, new_blocks: BlockRange): void {
    this.changed_ = true;

    this.history_.push(Instance.def_id(callsite.callee));
    process_blocks(this, caller_body, new_blocks);
    this.history_.pop();
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:238 on_inline_failure
  on_inline_failure(callsite: CallSite, reason: string): void {
    const tcx = this.tcx();
    const inline_attr = TyCtxt_codegen_instance_attrs(tcx, callsite.callee.def).inline;
    if (inline_attr.$ !== "Force") {
      bug("called on item without required inlining");
    }
    const { attr_span, reason: justification } = inline_attr;

    const call_span = callsite.source_info.span;
    const callee = tcx.def_path_str(Instance.def_id(callsite.callee));
    tcx.dcx().emit_err(
      ForceInlineFailure_diagnostic({
        call_span,
        attr_span,
        caller_span: tcx.def_span(this.def_id),
        caller: tcx.def_path_str(this.def_id),
        callee_span: tcx.def_span(Instance.def_id(callsite.callee)),
        callee: callee,
        reason,
        justification: justification !== undefined ? { sym: justification, callee } : undefined,
      }),
    );
  }
}

// rustc-type: compiler/rustc_mir_transform/src/inline.rs:262 NormalInliner
class NormalInliner implements Inliner {
  constructor(
    public tcx_: TyCtxt,
    public typing_env_: TypingEnv,
    /// `DefId` of caller.
    public def_id: DefId,
    /// Stack of inlined instances.
    /// We only check the `DefId` and not the args because we want to
    /// avoid inlining cases of polymorphic recursion.
    /// The number of `DefId`s is finite, so checking history is enough
    /// to ensure that we do not loop endlessly while inlining.
    public history_: DefId[],
    /// How many (multi-call) callsites have we inlined for the top-level call?
    ///
    /// We need to limit this in order to prevent super-linear growth in MIR size.
    public top_down_counter: number,
    /// Indicates that the caller body has been modified.
    public changed_: boolean,
    /// Indicates that the caller is #[inline] and just calls another function,
    /// and thus we can inline less into it as it'll be inlined itself.
    public caller_is_inline_forwarder: boolean,
  ) {}

  // rustc: compiler/rustc_mir_transform/src/inline.rs:285 past_depth_limit
  past_depth_limit(): boolean {
    return this.history_.length > HISTORY_DEPTH_LIMIT || this.top_down_counter > TOP_DOWN_DEPTH_LIMIT;
  }

  // impl<'tcx> Inliner<'tcx> for NormalInliner<'tcx>

  // rustc: compiler/rustc_mir_transform/src/inline.rs:291 new
  static new(tcx: TyCtxt, def_id: DefId, body: Body): NormalInliner {
    const typing_env = body.typing_env(tcx);
    const codegen_fn_attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;

    return new NormalInliner(
      tcx,
      typing_env,
      def_id,
      [],
      0,
      false,
      (codegen_fn_attrs.inline.$ === "Hint" || codegen_fn_attrs.inline.$ === "Always" || codegen_fn_attrs.inline.$ === "Force") &&
        body_is_forwarder(body),
    );
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:309 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:313 caller_def_id
  caller_def_id(): DefId {
    return this.def_id;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:317 typing_env
  typing_env(): TypingEnv {
    return this.typing_env_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:321 history
  history(): readonly DefId[] {
    return this.history_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:325 changed
  changed(): boolean {
    return this.changed_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:329 should_inline_for_callee
  should_inline_for_callee(_: DefId): boolean {
    return true;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:333 check_codegen_attributes_extra
  check_codegen_attributes_extra(callee_attrs: CodegenFnAttrs): Result<null, string> {
    if (this.past_depth_limit() && callee_attrs.inline.$ === "None") {
      return Err("Past depth limit so not inspecting unmarked callee");
    } else {
      return Ok(null);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:344 check_caller_mir_body
  check_caller_mir_body(body: Body): boolean {
    // Avoid inlining into coroutines, since their `optimized_mir` is used for layout computation,
    // which can create a cycle, even when no attempt is made to inline the function in the other
    // direction.
    return body.coroutine === undefined;
  }

  // #[instrument(level = "debug", skip(self, callee_body))]
  // rustc: compiler/rustc_mir_transform/src/inline.rs:352 check_callee_mir_body
  check_callee_mir_body(callsite: CallSite, callee_body: Body, callee_attrs: CodegenFnAttrs): Result<null, string> {
    const tcx = this.tcx();

    if (callee_body.tainted_by_errors !== undefined) {
      return Err("body has errors");
    }

    if (this.past_depth_limit() && callee_body.basic_blocks.deref().length > 1) {
      return Err("Not inlining multi-block body as we're past a depth limit");
    }

    let threshold: number;
    if (this.caller_is_inline_forwarder || this.past_depth_limit()) {
      threshold = tcx.sess.opts.unstable_opts.inline_mir_forwarder_threshold ?? 30;
    } else if (tcx.cross_crate_inlinable(Instance.def_id(callsite.callee))) {
      threshold = tcx.sess.opts.unstable_opts.inline_mir_hint_threshold ?? 100;
    } else {
      threshold = tcx.sess.opts.unstable_opts.inline_mir_threshold ?? 50;
    }

    // Give a bonus functions with a small number of blocks,
    // We normally have two or three blocks for even
    // very small functions.
    if (callee_body.basic_blocks.deref().length <= 3) {
      threshold += Math.floor(threshold / 4);
    }
    // debug!("    final inline threshold = {}", threshold);

    // FIXME: Give a bonus to functions with only a single caller

    const checker = CostChecker.new(tcx, this.typing_env(), callsite.callee, callee_body);

    checker.add_function_level_costs();

    // Traverse the MIR manually so we can account for the effects of inlining on the CFG.
    const work_list: BasicBlock[] = [START_BLOCK];
    const visited = DenseBitSet.new_empty<number>(callee_body.basic_blocks.deref().length);
    let bb: BasicBlock | undefined;
    while ((bb = work_list.pop()) !== undefined) {
      if (!visited.insert(BasicBlock.index(bb))) {
        continue;
      }

      const blk = callee_body.basic_blocks.deref()[bb]!;
      checker.visit_basic_block_data(bb, blk);

      const term = blk.terminator_();
      const caller_attrs = tcx.codegen_fn_attrs(this.caller_def_id()) as CodegenFnAttrs;
      const kind = term.kind;
      if (kind.$ === "Drop") {
        const { place, target, unwind } = kind;
        work_list.push(target);

        // If the place doesn't actually need dropping, treat it like a regular goto.
        const ty = Instance.instantiate_mir(
          callsite.callee,
          tcx,
          EarlyBinder.bind(tcx, place.ty(callee_body, tcx).ty, fold_Ty),
          fold_Ty,
        );
        if (ty.needs_drop(tcx, this.typing_env()) && unwind.$ === "Cleanup") {
          work_list.push(unwind._0);
        }
      } else if (callee_attrs.instruction_set !== caller_attrs.instruction_set && kind.$ === "InlineAsm") {
        // During the attribute checking stage we allow a callee with no
        // instruction_set assigned to count as compatible with a function that does
        // assign one. However, during this stage we require an exact match when any
        // inline-asm is detected. LLVM will still possibly do an inline later on
        // if the no-attribute function ends up with the same instruction set anyway.
        return Err("cannot move inline-asm across instruction sets");
      } else if (kind.$ === "TailCall") {
        // FIXME(explicit_tail_calls): figure out how exactly functions containing tail
        // calls can be inlined (and if they even should)
        return Err("can't inline functions with tail calls");
      } else {
        work_list.push(...term.successors());
      }
    }

    // N.B. We still apply our cost threshold to #[inline(always)] functions.
    // That attribute is often applied to very large functions that exceed LLVM's (very
    // generous) inlining threshold. Such functions are very poor MIR inlining candidates.
    // Always inlining #[inline(always)] functions in MIR, on net, slows down the compiler.
    const cost = checker.cost();
    if (cost <= threshold) {
      // debug!("INLINING {:?} [cost={} <= threshold={}]", callsite, cost, threshold);
      return Ok(null);
    } else {
      // debug!("NOT inlining {:?} [cost={} > threshold={}]", callsite, cost, threshold);
      return Err("cost above threshold");
    }
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:451 on_inline_success
  on_inline_success(callsite: CallSite, caller_body: Body, new_blocks: BlockRange): void {
    this.changed_ = true;

    let new_calls_count = 0;
    for (let bb = new_blocks.start; bb < new_blocks.end; bb = BasicBlock.from_usize(bb + 1)) {
      if (is_call_like(caller_body.basic_blocks.deref()[bb]!.terminator_())) new_calls_count += 1;
    }
    if (new_calls_count > 1) {
      this.top_down_counter += 1;
    }

    this.history_.push(Instance.def_id(callsite.callee));
    process_blocks(this, caller_body, new_blocks);
    this.history_.pop();

    if (this.history_.length === 0) {
      this.top_down_counter = 0;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:476 on_inline_failure
  on_inline_failure(_: CallSite, _reason: string): void {}
}

// rustc: compiler/rustc_mir_transform/src/inline.rs:479 inline
function inline(tcx: TyCtxt, body: Body, new_inliner: (tcx: TyCtxt, def_id: DefId, body: Body) => Inliner): boolean {
  const def_id = body.source.def_id();

  // Only do inlining into fn bodies.
  if (!BodyOwnerKind.is_fn_or_closure(tcx.hir_body_owner_kind(def_id))) {
    return false;
  }

  const inliner = new_inliner(tcx, def_id, body);
  if (!inliner.check_caller_mir_body(body)) {
    return false;
  }

  const blocks: BlockRange = { start: START_BLOCK, end: BasicBlock.from_usize(body.basic_blocks.deref().length) };
  process_blocks(inliner, body, blocks);
  return inliner.changed();
}

// rustc: compiler/rustc_mir_transform/src/inline.rs:497 process_blocks
function process_blocks(inliner: Inliner, caller_body: Body, blocks: BlockRange): void {
  for (let bb = blocks.start; bb < blocks.end; bb = BasicBlock.from_usize(bb + 1)) {
    const bb_data = caller_body.index(bb);
    if (bb_data.is_cleanup) {
      continue;
    }

    const callsite = resolve_callsite(inliner, caller_body, bb, bb_data);
    if (callsite === undefined) {
      continue;
    }

    // let span = trace_span!("process_blocks", %callsite.callee, ?bb);

    const r = try_inlining(inliner, caller_body, callsite);
    switch (r.$) {
      case "Err": {
        const reason = r._0;
        // debug!("not-inlined {} [{}]", callsite.callee, reason);
        inliner.on_inline_failure(callsite, reason);
        break;
      }
      case "Ok": {
        const new_blocks = r._0;
        // debug!("inlined {}", callsite.callee);
        inliner.on_inline_success(callsite, caller_body, new_blocks);
        break;
      }
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/inline.rs:528 resolve_callsite
function resolve_callsite(inliner: Inliner, caller_body: Body, bb: BasicBlock, bb_data: BasicBlockData): CallSite | undefined {
  const tcx = inliner.tcx();
  // Only consider direct calls to functions
  const terminator = bb_data.terminator_();

  // FIXME(explicit_tail_calls): figure out if we can inline tail calls
  const kind = terminator.kind;
  if (kind.$ === "Call") {
    const { func, fn_span } = kind;
    const func_ty = Operand.ty(func, caller_body, tcx);
    const fk = func_ty.kind();
    if (fk.$ === "FnDef") {
      const def_id = fk._0;
      const args_ = fk._1;
      if (!inliner.should_inline_for_callee(def_id)) {
        // debug!("not enabled");
        return undefined;
      }

      // To resolve an instance its args have to be fully normalized.
      const normalized = tcx.try_normalize_erasing_regions(
        inliner.typing_env(),
        Unnormalized.new_wip(args_),
        fold_Binder(fold_GenericArgs),
      );
      if (normalized.$ !== "Ok") return undefined;
      const args: GenericArgs = unwrap(Binder.no_bound_vars(normalized._0, fold_GenericArgs));
      const resolved = Instance.try_resolve(tcx, inliner.typing_env(), def_id, args);
      if (resolved.$ !== "Ok" || resolved._0 === undefined) return undefined;
      let callee = resolved._0;

      if (callee.def.$ === "Virtual") {
        return undefined;
      }
      if (callee.def.$ === "Intrinsic") {
        const intrinsic = unwrap(tcx.intrinsic(def_id));
        if (intrinsic.must_be_overridden) {
          return undefined; // intrinsic without fallback body
        }
        if (!tcx.sess.fallback_intrinsics.has(intrinsic.name)) {
          return undefined; // intrinsic that the backend may want to overwrite
        }
        // The callee is the fallback body.
        // debug!("callsite is fallback body: {def_id:?}");
        callee = { def: { $: "Item", _0: def_id }, args: callee.args };
      }

      const callee_did = Instance.def_id(callee);
      if (inliner.history().some((d) => DefId_eq(d, callee_did))) {
        return undefined;
      }

      const fn_sig = Unnormalized.skip_norm_wip(
        EarlyBinder.instantiate(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>, tcx, args, fold_Binder(fold_FnSig)),
      );

      // Additionally, check that the body that we're inlining actually agrees
      // with the ABI of the trait that the item comes from.
      if (callee.def.$ === "Item") {
        const instance_def_id = callee.def._0;
        if (tcx.def_kind(instance_def_id).$ === "AssocFn") {
          const instance_fn_sig = EarlyBinder.skip_binder(tcx.fn_sig(instance_def_id) as EarlyBinder<Binder<FnSig>>);
          if (!ExternAbi.eq(PolyFnSig.abi(instance_fn_sig), PolyFnSig.abi(fn_sig))) {
            return undefined;
          }
        }
      }

      const source_info = new SourceInfo(fn_span, terminator.source_info.scope);

      return { callee, fn_sig, block: bb, source_info };
    }
  }

  return undefined;
}

/// Attempts to inline a callsite into the caller body. When successful returns basic blocks
/// containing the inlined body. Otherwise returns an error describing why inlining didn't take
/// place.
// rustc: compiler/rustc_mir_transform/src/inline.rs:600 try_inlining
function try_inlining(inliner: Inliner, caller_body: Body, callsite: CallSite): Result<BlockRange, string> {
  const tcx = inliner.tcx();
  let r: Result<null, string> = check_mir_is_available(inliner, caller_body, callsite.callee);
  if (r.$ === "Err") return r;

  const callee_attrs = TyCtxt_codegen_instance_attrs(tcx, callsite.callee.def);
  // let callee_attrs = callee_attrs.as_ref();
  r = is_inline_valid_on_fn(tcx, Instance.def_id(callsite.callee));
  if (r.$ === "Err") return r;
  r = check_codegen_attributes(inliner, callsite, callee_attrs);
  if (r.$ === "Err") return r;

  const terminator = unwrap(caller_body.index(callsite.block).terminator);
  const tk = terminator.kind;
  if (tk.$ !== "Call") bug();
  const { args, destination } = tk;
  const destination_ty = destination.ty(caller_body.local_decls, tcx).ty;
  for (const arg of args) {
    if (!Operand.ty(arg.node, caller_body.local_decls, tcx).is_sized(tcx, inliner.typing_env())) {
      // We do not allow inlining functions with unsized params. Inlining these functions
      // could create unsized locals, which are unsound and being phased out.
      return Err("call has unsized argument");
    }
  }

  const callee_body_r = try_instance_mir(tcx, callsite.callee.def);
  if (callee_body_r.$ === "Err") return callee_body_r;
  const callee_body_ref = callee_body_r._0;
  r = is_inline_valid_on_body(tcx, callee_body_ref);
  if (r.$ === "Err") return r;
  r = inliner.check_callee_mir_body(callsite, callee_body_ref, callee_attrs);
  if (r.$ === "Err") return r;

  const Body_d = Body_foldable();
  const callee_body_n = Instance.try_instantiate_mir_and_normalize_erasing_regions(
    callsite.callee,
    tcx,
    inliner.typing_env(),
    EarlyBinder.bind(tcx, clone_Body(callee_body_ref), Body_d),
    Body_d,
  );
  if (callee_body_n.$ !== "Ok") {
    // debug!("failed to normalize callee body");
    return Err("implementation limitation -- could not normalize callee body");
  }
  const callee_body = callee_body_n._0;

  // Normally, this shouldn't be required, but trait normalization failure can create a
  // validation ICE.
  if (validate_types(tcx, inliner.typing_env(), callee_body, caller_body).length !== 0) {
    // debug!("failed to validate callee body");
    return Err("implementation limitation -- callee body failed validation");
  }

  // Check call signature compatibility.
  // Normally, this shouldn't be required, but trait normalization failure can create a
  // validation ICE.
  const output_type = callee_body.return_ty();
  if (!sub_types(tcx, inliner.typing_env(), output_type, destination_ty)) {
    // trace!(?output_type, ?destination_ty);
    return Err("implementation limitation -- return type mismatch");
  }
  if (ExternAbi.eq(PolyFnSig.abi(callsite.fn_sig), ExternAbi.RustCall)) {
    let self_arg: Spanned<Operand> | undefined;
    let arg_tuple: Spanned<Operand>;
    if (args.length === 1) {
      self_arg = undefined;
      arg_tuple = args[0]!;
    } else if (args.length === 2) {
      self_arg = args[0]!;
      arg_tuple = args[1]!;
    } else {
      bug("Expected `rust-call` to have 1 or 2 args");
    }

    const self_arg_ty = self_arg !== undefined ? Operand.ty(self_arg.node, caller_body.local_decls, tcx) : undefined;

    const arg_tuple_ty = Operand.ty(arg_tuple.node, caller_body.local_decls, tcx);
    let arg_tys: readonly Ty[];
    if (callee_body.spread_arg !== undefined) {
      arg_tys = [arg_tuple_ty];
    } else {
      const k = arg_tuple_ty.kind();
      if (k.$ !== "Tuple") {
        bug("Closure arguments are not passed as a tuple");
      }
      arg_tys = k._0;
    }

    const tys = [...(self_arg_ty !== undefined ? [self_arg_ty] : []), ...arg_tys];
    const inputs = callee_body.args_iter();
    for (let i = 0; i < tys.length && i < inputs.length; i++) {
      const arg_ty = tys[i]!;
      const input = inputs[i]!;
      const input_type = callee_body.local_decls[input]!.ty;
      if (!sub_types(tcx, inliner.typing_env(), input_type, arg_ty)) {
        // trace!(?arg_ty, ?input_type);
        // debug!("failed to normalize tuple argument type");
        return Err("implementation limitation");
      }
    }
  } else {
    const inputs = callee_body.args_iter();
    for (let i = 0; i < args.length && i < inputs.length; i++) {
      const arg = args[i]!;
      const input = inputs[i]!;
      const input_type = callee_body.local_decls[input]!.ty;
      const arg_ty = Operand.ty(arg.node, caller_body.local_decls, tcx);
      if (!sub_types(tcx, inliner.typing_env(), input_type, arg_ty)) {
        // trace!(?arg_ty, ?input_type);
        // debug!("failed to normalize argument type");
        return Err("implementation limitation -- arg mismatch");
      }
    }
  }

  const old_blocks = BasicBlock.from_usize(caller_body.basic_blocks.deref().length);
  inline_call(inliner, caller_body, callsite, callee_body);
  const new_blocks: BlockRange = { start: old_blocks, end: BasicBlock.from_usize(caller_body.basic_blocks.deref().length) };

  return Ok(new_blocks);
}

// rustc: compiler/rustc_mir_transform/src/inline.rs:700 check_mir_is_available
function check_mir_is_available(inliner: Inliner, caller_body: Body, callee: Instance): Result<null, string> {
  const caller_def_id = caller_body.source.def_id();
  const callee_def_id = Instance.def_id(callee);
  if (DefId_eq(callee_def_id, caller_def_id)) {
    return Err("self-recursion");
  }

  const def = callee.def;
  switch (def.$) {
    case "Item": {
      // If there is no MIR available (either because it was not in metadata or
      // because it has no MIR because it's an extern function), then the inliner
      // won't cause cycles on this.
      if (!inliner.tcx().is_mir_available(callee_def_id)) {
        // debug!("item MIR unavailable");
        return Err("implementation limitation -- MIR unavailable");
      }
      break;
    }
    // These have no own callable MIR.
    case "Intrinsic":
    case "LlvmIntrinsic":
    case "Virtual": {
      // debug!("instance without MIR (intrinsic / virtual)");
      return Err("implementation limitation -- cannot inline intrinsic");
    }

    case "Shim": {
      const shim = def._0;
      // FIXME(#127030): `ConstParamHasTy` has bad interactions with
      // the drop shim builder, which does not evaluate predicates in
      // the correct param-env for types being dropped. Stall resolving
      // the MIR for this instance until all of its const params are
      // substituted.
      if (shim.$ === "DropGlue" && shim._1 !== undefined && TypeVisitableExt.has_type_flags(shim._1, TypeFlags.HAS_CT_PARAM, fold_Ty)) {
        // debug!("still needs substitution");
        return Err("implementation limitation -- HACK for dropping polymorphic type");
      }
      switch (shim.$) {
        case "AsyncDropGlue":
        case "AsyncDropGlueCtor": {
          const ty = shim._1;
          return TypeVisitableExt.still_further_specializable(ty, fold_Ty) ? Err("still needs substitution") : Ok(null);
        }
        case "FutureDropPoll": {
          const ty = shim._1;
          const ty2 = shim._2;
          return TypeVisitableExt.still_further_specializable(ty, fold_Ty) || TypeVisitableExt.still_further_specializable(ty2, fold_Ty)
            ? Err("still needs substitution")
            : Ok(null);
        }

        // This cannot result in an immediate cycle since the callee MIR is a shim, which does
        // not get any optimizations run on it. Any subsequent inlining may cause cycles, but we
        // do not need to catch this here, we can wait until the inliner decides to continue
        // inlining a second time.
        case "VTable":
        case "Reify":
        case "FnPtr":
        case "ClosureOnce":
        case "ConstructCoroutineInClosure":
        case "DropGlue":
        case "Clone":
        case "ThreadLocal":
        case "FnPtrAsPtr":
        case "FnPtrFromPtr":
          return Ok(null);
      }
    }
  }

  if (inliner.tcx().is_constructor(callee_def_id)) {
    // trace!("constructors always have MIR");
    // Constructor functions cannot cause a query cycle.
    return Ok(null);
  }

  const callee_local = callee_def_id.as_local();
  if (callee_local !== undefined && !inliner.tcx().is_lang_item(inliner.tcx().parent(caller_def_id), LangItem.FnOnce)) {
    // If we know for sure that the function we're calling will itself try to
    // call us, then we avoid inlining that function.
    const cyclic_callees = inliner.tcx().mir_callgraph_cyclic(caller_def_id.expect_local());
    if (cyclic_callees === undefined) {
      return Err("call graph cycle detection bailed due to recursion limit");
    }
    if (cyclic_callees.has(callee_local)) {
      // debug!("query cycle avoidance");
      return Err("caller might be reachable from callee");
    }

    return Ok(null);
  } else {
    // This cannot result in an immediate cycle since the callee MIR is from another crate
    // and is already optimized. Any subsequent inlining may cause cycles, but we do
    // not need to catch this here, we can wait until the inliner decides to continue
    // inlining a second time.
    // trace!("functions from other crates always have MIR");
    return Ok(null);
  }
}

/// Returns an error if inlining is not possible based on codegen attributes alone. A success
/// indicates that inlining decision should be based on other criteria.
// rustc: compiler/rustc_mir_transform/src/inline.rs:803 check_codegen_attributes
function check_codegen_attributes(inliner: Inliner, callsite: CallSite, callee_attrs: CodegenFnAttrs): Result<null, string> {
  const tcx = inliner.tcx();
  if (callee_attrs.inline.$ === "Never") {
    return Err("never inline attribute");
  }

  if (callee_attrs.optimize === "DoNotOptimize") {
    return Err("has DoNotOptimize attribute");
  }

  const r = inliner.check_codegen_attributes_extra(callee_attrs);
  if (r.$ === "Err") return r;

  // Reachability pass defines which functions are eligible for inlining. Generally inlining
  // other functions is incorrect because they could reference symbols that aren't exported.
  const is_generic = callsite.callee.args.non_erasable_generics()[Symbol.iterator]().next().done !== true;
  if (!is_generic && !tcx.cross_crate_inlinable(Instance.def_id(callsite.callee))) {
    return Err("not exported");
  }

  const codegen_fn_attrs = tcx.codegen_fn_attrs(inliner.caller_def_id()) as CodegenFnAttrs;
  if (!SanitizerFnAttrs_eq(callee_attrs.sanitizers, codegen_fn_attrs.sanitizers)) {
    return Err("incompatible sanitizer set");
  }

  // Two functions are compatible if the callee has no attribute (meaning
  // that it's codegen agnostic), or sets an attribute that is identical
  // to this function's attribute.
  if (callee_attrs.instruction_set !== undefined && callee_attrs.instruction_set !== codegen_fn_attrs.instruction_set) {
    return Err("incompatible instruction set");
  }

  const callee_feature_names = callee_attrs.target_features.map((f) => f.name);
  const this_feature_names = codegen_fn_attrs.target_features.map((f) => f.name);
  if (callee_feature_names.length !== this_feature_names.length || callee_feature_names.some((n, i) => n !== this_feature_names[i])) {
    // In general it is not correct to inline a callee with target features that are a
    // subset of the caller. This is because the callee might contain calls, and the ABI of
    // those calls depends on the target features of the surrounding function. By moving a
    // `Call` terminator from one MIR body to another with more target features, we might
    // change the ABI of that call!
    return Err("incompatible target features");
  }

  return Ok(null);
}

// rustc: compiler/rustc_mir_transform/src/inline.rs:854 inline_call
function inline_call(inliner: Inliner, caller_body: Body, callsite: CallSite, callee_body: Body): void {
  const tcx = inliner.tcx();
  const caller_block = caller_body.index_mut(callsite.block);
  const terminator = unwrap(caller_block.terminator);
  caller_block.terminator = undefined;
  const tk = terminator.kind;
  if (tk.$ !== "Call") {
    bug(`unexpected terminator kind ${format_debug(tk, debug_TerminatorKind, PLAIN)}`);
  }
  const { func, args, destination, unwind, target } = tk;

  let return_block: BasicBlock | undefined;
  if (target !== undefined) {
    const block = target;
    // Prepare a new block for code that should execute when call returns. We don't use
    // target block directly since it might have other predecessors.
    const data = BasicBlockData.new(
      new Terminator(clone_SourceInfo(terminator.source_info), TerminatorKind.goto(block)),
      caller_body.index(block).is_cleanup,
    );
    const blocks = caller_body.basic_blocks_mut();
    blocks.push(data);
    return_block = BasicBlock.from_usize(blocks.length - 1);
  } else {
    return_block = undefined;
  }

  // If the call is something like `a[*i] = f(i)`, where
  // `i : &mut usize`, then just duplicating the `a[*i]`
  // Place could result in two different locations if `f`
  // writes to `i`. To prevent this we need to create a temporary
  // borrow of the place and pass the destination as `*temp` instead.
  //
  // This must be a raw pointer: a mutable reference could be invalidated by
  // reading the arguments later, and would be invalid if the destination type
  // is uninhabited.
  let dest: Place;
  if (!destination.is_stable_offset()) {
    // trace!("creating temp for return destination");
    const dest_rv: Rvalue = { $: "RawPtr", _0: "Mut", _1: clone_Place(destination) };
    const dest_ty = Rvalue_.ty(dest_rv, caller_body, tcx);
    const temp = Place_from_Local(new_call_temp(caller_body, callsite, dest_ty, return_block));
    caller_body
      .index_mut(callsite.block)
      .statements.push(Statement.new(clone_SourceInfo(callsite.source_info), { $: "Assign", _0: [clone_Place(temp), dest_rv] }));
    dest = tcx.mk_place_deref(temp);
  } else {
    dest = destination;
  }

  // Always create a local to hold the destination, as `RETURN_PLACE` may appear
  // where a full `Place` is not allowed.
  let remap_destination: boolean;
  let destination_local: Local;
  const d = dest.as_local();
  if (d !== undefined) {
    remap_destination = false;
    destination_local = d;
  } else {
    remap_destination = true;
    destination_local = new_call_temp(caller_body, callsite, destination.ty(caller_body, tcx).ty, return_block);
  }

  // Copy the arguments if needed.
  const call_args = make_call_args(inliner, args, callsite, caller_body, callee_body, return_block);

  const integrator = new Integrator(
    call_args,
    Local.from_usize(caller_body.local_decls.length),
    SourceScope.from_usize(caller_body.source_scopes.length),
    BasicBlock.from_usize(caller_body.basic_blocks.deref().length),
    destination_local,
    clone_SourceScopeData(caller_body.source_scopes[callsite.source_info.scope]!),
    callsite,
    unwind,
    false,
    return_block,
    tcx,
    UsedInStmtLocals.new(callee_body).locals,
  );

  // Map all `Local`s, `SourceScope`s and `BasicBlock`s to new ones
  // (or existing ones, in a few special cases) in the caller.
  integrator.visit_body(callee_body);

  // If there are any locals without storage markers, give them storage only for the
  // duration of the call.
  for (const local of callee_body.vars_and_temps_iter()) {
    if (integrator.always_live_locals.contains(local)) {
      const new_local = integrator.map_local(local);
      caller_body
        .index_mut(callsite.block)
        .statements.push(Statement.new(clone_SourceInfo(callsite.source_info), { $: "StorageLive", _0: new_local }));
    }
  }
  if (return_block !== undefined) {
    const block = return_block;
    // To avoid repeated O(n) insert, push any new statements to the end and rotate
    // the slice once.
    let n = 0;
    if (remap_destination) {
      caller_body.index_mut(block).statements.push(
        Statement.new(clone_SourceInfo(callsite.source_info), {
          $: "Assign",
          _0: [dest, { $: "Use", _0: { $: "Move", _0: Place_from_Local(destination_local) }, _1: "Yes" }],
        }),
      );
      n += 1;
    }
    for (const local of [...callee_body.vars_and_temps_iter()].reverse()) {
      if (integrator.always_live_locals.contains(local)) {
        const new_local = integrator.map_local(local);
        caller_body
          .index_mut(block)
          .statements.push(Statement.new(clone_SourceInfo(callsite.source_info), { $: "StorageDead", _0: new_local }));
        n += 1;
      }
    }
    // statements.rotate_right(n)
    const stmts = caller_body.index_mut(block).statements;
    if (n > 0) stmts.unshift(...stmts.splice(stmts.length - n, n));
  }

  // Insert all of the (mapped) parts of the callee body into the caller.
  caller_body.local_decls.push(...callee_body.drain_vars_and_temps());
  caller_body.source_scopes.push(...callee_body.source_scopes.splice(0));

  // only "full" debug promises any variable-level information
  if (tcx.sess.opts.unstable_opts.inline_mir_preserve_debug ?? tcx.sess.opts.debuginfo === "Full") {
    // -Zinline-mir-preserve-debug is enabled when building the standard library, so that
    // people working on rust can build with or without debuginfo while
    // still getting consistent results from the mir-opt tests.
    caller_body.var_debug_info.push(...callee_body.var_debug_info.splice(0));
  } else {
    for (const bb of callee_body.basic_blocks_mut()) {
      bb.drop_debuginfo();
    }
  }
  caller_body.basic_blocks_mut().push(...callee_body.basic_blocks_mut().splice(0));

  caller_body.index_mut(callsite.block).terminator = new Terminator(
    clone_SourceInfo(callsite.source_info),
    TerminatorKind.goto(integrator.map_block(START_BLOCK)),
  );

  // Copy required constants from the callee_body into the caller_body. Although we are only
  // pushing constants that still need evaluation to `required_consts`, here they may have been evaluated
  // because we are calling `instantiate_and_normalize_erasing_regions` -- so we filter again.
  unwrap(caller_body.required_consts).push(...callee_body.required_consts_().filter((ct) => mir_Const.is_required_const(ct.const_)));
  // Now that we incorporated the callee's `required_consts`, we can remove the callee from
  // `mentioned_items` -- but we have to take their `mentioned_items` in return. This does
  // some extra work here to save the monomorphization collector work later. It helps a lot,
  // since monomorphization can avoid a lot of work when the "mentioned items" are similar to
  // the actually used items. By doing this we can entirely avoid visiting the callee!
  // We need to reconstruct the `required_item` for the callee so that we can find and
  // remove it.
  const callee_item: MentionedItem = { $: "Fn", _0: Operand.ty(func, caller_body, tcx) };
  const caller_mentioned_items = unwrap(caller_body.mentioned_items);
  const idx = caller_mentioned_items.findIndex((item) => intern_key_eq(item.node, callee_item));
  if (idx !== -1) {
    // We found the callee, so remove it and add its items instead.
    caller_mentioned_items.splice(idx, 1);
    caller_mentioned_items.push(...callee_body.mentioned_items_());
  } else {
    // If we can't find the callee, there's no point in adding its items. Probably it
    // already got removed by being inlined elsewhere in the same function, so we already
    // took its items.
  }
}

// rustc: compiler/rustc_mir_transform/src/inline.rs:1029 make_call_args
function make_call_args(
  inliner: Inliner,
  args: Spanned<Operand>[],
  callsite: CallSite,
  caller_body: Body,
  callee_body: Body,
  return_block: BasicBlock | undefined,
): Local[] {
  const tcx = inliner.tcx();

  // There is a bit of a mismatch between the *caller* of a closure and the *callee*.
  // The caller provides the arguments wrapped up in a tuple:
  //
  //     tuple_tmp = (a, b, c)
  //     Fn::call(closure_ref, tuple_tmp)
  //
  // meanwhile the closure body expects the arguments (here, `a`, `b`, and `c`)
  // as distinct arguments. (This is the "rust-call" ABI hack.) Normally, codegen has
  // the job of unpacking this tuple. But here, we are codegen. =) So we want to create
  // a vector like
  //
  //     [closure_ref, tuple_tmp.0, tuple_tmp.1, tuple_tmp.2]
  //
  // Except for one tiny wrinkle: we don't actually want `tuple_tmp.0`. It's more convenient
  // if we "spill" that into *another* temporary, so that we can map the argument
  // variable in the callee MIR directly to an argument variable on our side.
  // So we introduce temporaries like:
  //
  //     tmp0 = tuple_tmp.0
  //     tmp1 = tuple_tmp.1
  //     tmp2 = tuple_tmp.2
  //
  // and the vector is `[closure_ref, tmp0, tmp1, tmp2]`.
  if (ExternAbi.eq(PolyFnSig.abi(callsite.fn_sig), ExternAbi.RustCall) && callee_body.spread_arg === undefined) {
    let i = 0;
    const self_ = create_temp_if_necessary(inliner, unwrap(args[i++]).node, callsite, caller_body, return_block);
    const tuple_ = create_temp_if_necessary(inliner, unwrap(args[i++]).node, callsite, caller_body, return_block);
    assert(i >= args.length, "assertion failed: args.next().is_none()");

    const tuple = Place_from_Local(tuple_);
    const k = tuple.ty(caller_body, tcx).ty.kind();
    if (k.$ !== "Tuple") {
      bug("Closure arguments are not passed as a tuple");
    }
    const tuple_tys = k._0;

    // The `closure_ref` in our example above.
    const closure_ref_arg = [self_];

    // The `tmp0`, `tmp1`, and `tmp2` in our example above.
    const tuple_tmp_args = tuple_tys.map((ty, i) => {
      // This is e.g., `tuple_tmp.0` in our example above.
      const tuple_field: Operand = { $: "Move", _0: tcx.mk_place_field(tuple, FieldIdx.from_usize(i), ty) };

      // Spill to a local to make e.g., `tmp0`.
      return create_temp_if_necessary(inliner, tuple_field, callsite, caller_body, return_block);
    });

    return [...closure_ref_arg, ...tuple_tmp_args];
  } else {
    return args.map((a) => create_temp_if_necessary(inliner, a.node, callsite, caller_body, return_block));
  }
}

/// If `arg` is already a temporary, returns it. Otherwise, introduces a fresh temporary `T` and an
/// instruction `T = arg`, and returns `T`.
// rustc: compiler/rustc_mir_transform/src/inline.rs:1107 create_temp_if_necessary
function create_temp_if_necessary(
  inliner: Inliner,
  arg: Operand,
  callsite: CallSite,
  caller_body: Body,
  return_block: BasicBlock | undefined,
): Local {
  // Reuse the operand if it is a moved temporary.
  if (arg.$ === "Move") {
    const local = arg._0.as_local();
    if (local !== undefined && caller_body.local_kind(local) === "Temp") {
      return local;
    }
  }

  // Otherwise, create a temporary for the argument.
  // trace!("creating temp for argument {:?}", arg);
  const arg_ty = Operand.ty(arg, caller_body, inliner.tcx());
  const local = new_call_temp(caller_body, callsite, arg_ty, return_block);
  caller_body.index_mut(callsite.block).statements.push(
    Statement.new(clone_SourceInfo(callsite.source_info), {
      $: "Assign",
      _0: [Place_from_Local(local), { $: "Use", _0: arg, _1: "Yes" }],
    }),
  );
  return local;
}

/// Introduces a new temporary into the caller body that is live for the duration of the call.
// rustc: compiler/rustc_mir_transform/src/inline.rs:1134 new_call_temp
function new_call_temp(caller_body: Body, callsite: CallSite, ty: Ty, return_block: BasicBlock | undefined): Local {
  caller_body.local_decls.push(LocalDecl.new(ty, callsite.source_info.span));
  const local = Local.from_usize(caller_body.local_decls.length - 1);

  caller_body
    .index_mut(callsite.block)
    .statements.push(Statement.new(clone_SourceInfo(callsite.source_info), { $: "StorageLive", _0: local }));

  if (return_block !== undefined) {
    const block = return_block;
    caller_body
      .index_mut(block)
      .statements.splice(0, 0, Statement.new(clone_SourceInfo(callsite.source_info), { $: "StorageDead", _0: local }));
  }

  return local;
}

/**
 * Integrator.
 *
 * Integrates blocks from the callee function into the calling function.
 * Updates block indices, references to locals and other control flow
 * stuff.
 */
// rustc-type: compiler/rustc_mir_transform/src/inline.rs:1162 Integrator
class Integrator extends MutVisitor {
  constructor(
    public args: readonly Local[],
    public new_locals: Local,
    public new_scopes: SourceScope,
    public new_blocks: BasicBlock,
    public destination: Local,
    public callsite_scope: SourceScopeData,
    public callsite: CallSite,
    public cleanup_block: UnwindAction,
    public in_cleanup_block: boolean,
    public return_block: BasicBlock | undefined,
    public tcx_: TyCtxt,
    public always_live_locals: DenseBitSet<Local>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:1178 map_local
  map_local(local: Local): Local {
    let new_: Local;
    if (local === RETURN_PLACE) {
      new_ = this.destination;
    } else {
      const idx = Local.index(local) - 1;
      if (idx < this.args.length) {
        new_ = this.args[idx]!;
      } else {
        new_ = Local.from_usize(Local.index(this.new_locals) + (idx - this.args.length));
      }
    }
    // trace!("mapping local `{:?}` to `{:?}`", local, new);
    return new_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:1193 map_scope
  map_scope(scope: SourceScope): SourceScope {
    const new_ = SourceScope.from_usize(SourceScope.index(this.new_scopes) + SourceScope.index(scope));
    // trace!("mapping scope `{:?}` to `{:?}`", scope, new);
    return new_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:1199 map_block
  map_block(block: BasicBlock): BasicBlock {
    const new_ = BasicBlock.from_usize(BasicBlock.index(this.new_blocks) + BasicBlock.index(block));
    // trace!("mapping block `{:?}` to `{:?}`", block, new);
    return new_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:1205 map_unwind
  map_unwind(unwind: UnwindAction): UnwindAction {
    if (this.in_cleanup_block) {
      switch (unwind.$) {
        case "Cleanup":
        case "Continue": {
          bug("cleanup on cleanup block");
        }
        case "Unreachable":
        case "Terminate":
          return unwind;
      }
    }

    switch (unwind.$) {
      case "Unreachable":
      case "Terminate":
        return unwind;
      case "Cleanup":
        return { $: "Cleanup", _0: this.map_block(unwind._0) };
      // Add an unwind edge to the original call's cleanup block
      case "Continue":
        return this.cleanup_block;
    }
  }

  // impl<'tcx> MutVisitor<'tcx> for Integrator<'_, 'tcx>

  // rustc: compiler/rustc_mir_transform/src/inline.rs:1225 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:1229 visit_local
  override visit_local(local: MutRef<Local>, _ctxt: PlaceContext, _location: Location): void {
    local.value = this.map_local(local.value);
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:1233 visit_source_scope_data
  override visit_source_scope_data(scope_data: SourceScopeData): void {
    this.super_source_scope_data(scope_data);
    if (scope_data.parent_scope === undefined) {
      // Attach the outermost callee scope as a child of the callsite
      // scope, via the `parent_scope` and `inlined_parent_scope` chains.
      scope_data.parent_scope = this.callsite.source_info.scope;
      assert_eq(scope_data.inlined_parent_scope, undefined, (v) => debug_option(v, PLAIN, SourceScope.debug));
      scope_data.inlined_parent_scope =
        this.callsite_scope.inlined !== undefined ? this.callsite.source_info.scope : this.callsite_scope.inlined_parent_scope;

      // Mark the outermost callee scope as an inlined one.
      assert_eq(scope_data.inlined, undefined, (v) =>
        debug_option(v, PLAIN, (t, f) => debug_tuple(f, "", [debug_Instance(t[0], f), debug_Span(t[1], f)])),
      );
      scope_data.inlined = [this.callsite.callee, this.callsite.source_info.span];
    } else if (scope_data.inlined_parent_scope === undefined) {
      // Make it easy to find the scope with `inlined` set above.
      scope_data.inlined_parent_scope = this.map_scope(OUTERMOST_SOURCE_SCOPE);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:1255 visit_source_scope
  override visit_source_scope(scope: MutRef<SourceScope>): void {
    scope.value = this.map_scope(scope.value);
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:1259 visit_basic_block_data
  override visit_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    this.in_cleanup_block = data.is_cleanup;
    this.super_basic_block_data(block, data);
    this.in_cleanup_block = false;
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:1265 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    const kind = statement.kind;
    if (kind.$ === "StorageLive" || kind.$ === "StorageDead") {
      this.always_live_locals.remove(kind._0);
    }
    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_mir_transform/src/inline.rs:1274 visit_terminator
  override visit_terminator(terminator: Terminator, loc: Location): void {
    // Don't try to modify the implicit `_0` access on return (`return` terminators are
    // replaced down below anyways).
    if (terminator.kind.$ !== "Return") {
      this.super_terminator(terminator, loc);
    } else {
      this.visit_source_info(terminator.source_info);
    }

    const kind = terminator.kind;
    switch (kind.$) {
      case "CoroutineDrop":
      case "Yield":
        bug();
      case "Goto": {
        kind.target = this.map_block(kind.target);
        break;
      }
      case "SwitchInt": {
        const tgts = kind.targets.all_targets_mut();
        for (let i = 0; i < tgts.length; i++) {
          tgts[i] = this.map_block(tgts[i]!);
        }
        break;
      }
      case "Drop": {
        kind.target = this.map_block(kind.target);
        kind.unwind = this.map_unwind(kind.unwind);
        break;
      }
      case "TailCall": {
        // check_mir_body forbids tail calls
        unreachable();
      }
      case "Call": {
        if (kind.target !== undefined) {
          const tgt = field_mut(kind, "target") as MutRef<BasicBlock>;
          tgt.value = this.map_block(tgt.value);
        }
        kind.unwind = this.map_unwind(kind.unwind);
        break;
      }
      case "Assert": {
        kind.target = this.map_block(kind.target);
        kind.unwind = this.map_unwind(kind.unwind);
        break;
      }
      case "Return": {
        const tgt = this.return_block;
        terminator.kind = tgt !== undefined ? TerminatorKind.goto(tgt) : TerminatorKind.Unreachable;
        break;
      }
      case "UnwindResume": {
        const cb = this.cleanup_block;
        switch (cb.$) {
          case "Cleanup":
            terminator.kind = TerminatorKind.goto(cb._0);
            break;
          case "Continue":
            terminator.kind = TerminatorKind.UnwindResume;
            break;
          case "Unreachable":
            terminator.kind = TerminatorKind.Unreachable;
            break;
          case "Terminate":
            terminator.kind = { $: "UnwindTerminate", _0: cb._0 };
            break;
        }
        break;
      }
      case "UnwindTerminate":
        break;
      case "Unreachable":
        break;
      case "FalseEdge": {
        kind.real_target = this.map_block(kind.real_target);
        kind.imaginary_target = this.map_block(kind.imaginary_target);
        break;
      }
      case "FalseUnwind":
        // see the ordering of passes in the optimized_mir query.
        bug("False unwinds should have been removed before inlining");
      case "InlineAsm": {
        const targets = kind.targets;
        for (let i = 0; i < targets.length; i++) {
          targets[i] = this.map_block(targets[i]!);
        }
        kind.unwind = this.map_unwind(kind.unwind);
        break;
      }
    }
  }
}

// #[instrument(skip(tcx), level = "debug")]
// rustc: compiler/rustc_mir_transform/src/inline.rs:1348 try_instance_mir
function try_instance_mir(tcx: TyCtxt, instance: InstanceKind): Result<Body, string> {
  if (instance.$ === "Shim" && (instance._0.$ === "DropGlue" || instance._0.$ === "AsyncDropGlueCtor")) {
    const ty = instance._0._1;
    if (ty !== undefined) {
      const k = ty.kind();
      if (k.$ === "Adt") {
        const def = k._0;
        const args = k._1;
        const fields = def.all_fields();
        for (const field of fields) {
          const field_ty = field.ty(tcx, args);
          const d = { visit_with: <R>(s: Unnormalized<Ty>, v: Parameters<typeof fold_Ty.visit_with<R>>[1]) => visit_with_Unnormalized(s, v, fold_Ty.visit_with) };
          if (TypeVisitableExt.has_param(field_ty, d) && TypeVisitableExt.has_aliases(field_ty, d)) {
            return Err("cannot build drop shim for polymorphic type");
          }
        }
      }
    }
  }
  return Ok(tcx.instance_mir(instance));
}

// rustc: compiler/rustc_mir_transform/src/inline.rs:1367 body_is_forwarder
function body_is_forwarder(body: Body): boolean {
  const k = body.basic_blocks.deref()[START_BLOCK]!.terminator_().kind;
  if (k.$ !== "Call") {
    return false;
  }
  const target = k.target;
  if (target !== undefined) {
    if (body.basic_blocks.deref()[target]!.terminator_().kind.$ !== "Return") {
      return false;
    }
  }

  let max_blocks: number;
  if (!body.is_polymorphic) {
    max_blocks = 2;
  } else if (target === undefined) {
    max_blocks = 3;
  } else {
    max_blocks = 4;
  }
  if (body.basic_blocks.deref().length > max_blocks) {
    return false;
  }

  return body.basic_blocks.deref().every((bb_data, bb) => {
    const kind = bb_data.terminator_().kind;
    return (
      bb === START_BLOCK ||
      kind.$ === "Return" ||
      kind.$ === "Drop" ||
      kind.$ === "UnwindResume" ||
      kind.$ === "UnwindTerminate"
    );
  });
}
