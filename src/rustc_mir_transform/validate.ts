// Port of compiler/rustc_mir_transform/src/validate.rs (lane mt-validate).
//
//! Validates the MIR to ensure that invariants are upheld.
//
// PORT: `CfgChecker`, `TypeChecker` and `DebuginfoChecker` are classes extending rustc_middle mir/visit.ts's `Visitor`
// (D4). `crate::util` is rustc_const_eval's `util` (`use rustc_const_eval::util;` in lib.rs): util/mod.ts
// (`binop_right_homogeneous`, `relate_types`, `sub_types`, `most_packed_projection`).
// PORT: `MirPhase` comparisons (`PartialOrd`) go through `MirPhase_cmp`. `span_bug!` takes the pre-formatted message;
// `#[track_caller]` (the ICE's source location) has no JS equivalent (rustc_span macros.ts).
// PORT: this module is read lazily by pass_manager.ts (`validate_body`); it imports pass_manager.ts, never lib.ts.
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { FIRST_VARIANT, FieldIdx, VariantIdx } from "../rustc_abi/layout.ts";
import { Size } from "../rustc_abi/lib.ts";
import { IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { binop_right_homogeneous, most_packed_projection, relate_types, sub_types } from "../rustc_const_eval/util/mod.ts";
import { DefKind } from "../rustc_hir/def.ts";
import { Obligation } from "../rustc_infer/traits/mod.ts";
import { TraitErrors } from "../rustc_infer/traits/engine.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import {
  type BasicBlock,
  BasicBlock as BasicBlockC,
  type Body,
  debug_BasicBlock,
  debug_BasicBlockData,
  debug_BinOp,
  debug_CastKind,
  debug_Local,
  debug_Location,
  debug_Place,
  debug_PlaceRef,
  debug_PlaceTy,
  debug_ProjectionElem,
  debug_SourceScope,
  debug_StatementKind,
  debug_TerminatorKind,
  type Local,
  Location,
  type LocalDecl,
  MirPhase,
  MirPhase_cmp,
  Operand,
  type Place,
  type PlaceElem,
  type PlaceRef,
  ProjectionElem,
  Rvalue,
  type SourceScope,
  START_BLOCK,
  type Statement,
  type StmtDebugInfo,
  type Terminator,
  TerminatorKind,
  type UnwindAction,
  type VarDebugInfo,
  visit_with_Body,
} from "../rustc_middle/mir/mod.ts";
import { type CoroutineLayout, debug_CoroutineSavedLocal } from "../rustc_middle/mir/query.ts";
import { reachable_as_bitset } from "../rustc_middle/mir/traversal.ts";
import { type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import { CoverageKind, debug_CoverageKind } from "../rustc_middle/mir/coverage.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { ScalarInt } from "../rustc_middle/ty/consts/int.ts";
import { InstanceKind, debug_InstanceKind } from "../rustc_middle/ty/instance.ts";
import { fn_can_unwind } from "../rustc_middle/ty/layout.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { type Predicate, Predicate_upcast_from_TraitRef } from "../rustc_middle/ty/predicate.ts";
import { display_Ty, with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { debug_AdtDef, debug_Ty, fold_Predicate, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { DefId_eq, debug_DefId, type DefId } from "../rustc_span/def_id.ts";
import { debug_Symbol } from "../rustc_span/symbol.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { TyKind } from "../rustc_type_ir/decls.ts";
import { fold_tuple2 } from "../rustc_type_ir/fold.ts";
import { Variance } from "../rustc_type_ir/lib.ts";
import { as_interner, TraitRef } from "../rustc_type_ir/predicate.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import { PolyFnSig, UnsafeBinderInner_deref, debug_UnsafeBinderInner } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import { debuginfo_locals } from "../rustc_mir_dataflow/debuginfo.ts";
import { debug_vec, PLAIN } from "../std/fmt.ts";
import { assert, assert_eq, unwrap } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

/** `Body: TypeVisitable` (for `body.has_free_regions()`). */
const Body_visitable: TypeVisitable<Body> = { visit_with: (self, visitor) => visit_with_Body(self, visitor) };

const RUNTIME_INITIAL: MirPhase = { $: "Runtime", _0: "Initial" };
const RUNTIME_OPTIMIZED: MirPhase = { $: "Runtime", _0: "Optimized" };
const ANALYSIS_POST_CLEANUP: MirPhase = { $: "Analysis", _0: "PostCleanup" };

// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
// rustc-type: compiler/rustc_mir_transform/src/validate.rs:26 EdgeKind
type EdgeKind = "Unwind" | "Normal";
const EdgeKind = { Unwind: "Unwind", Normal: "Normal" } as const;
/** The derived `Debug` of `EdgeKind` (the variant name). */
const debug_EdgeKind = (v: EdgeKind): string => v;

// rustc-type: compiler/rustc_mir_transform/src/validate.rs:31 Validator
export class Validator extends MirPass {
  readonly type_name = "rustc_mir_transform::validate::Validator";

  constructor(
    /// Describes at which point in the pipeline this validation is happening.
    public when: string,
  ) {
    super();
  }

  // impl<'tcx> crate::MirPass<'tcx> for Validator
  // rustc: compiler/rustc_mir_transform/src/validate.rs:37 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // FIXME(JakobDegen): These bodies never instantiated in codegend anyway, so it's not
    // terribly important that they pass the validator. However, I think other passes might
    // still see them, in which case they might be surprised. It would probably be better if we
    // didn't put this through the MIR pipeline at all.
    if (body.source.instance.$ === "Intrinsic" || body.source.instance.$ === "Virtual") {
      return;
    }
    const def_id = body.source.def_id();
    const typing_env = body.typing_env(tcx);
    let can_unwind: boolean;
    if (MirPhase_cmp(body.phase, RUNTIME_INITIAL) <= 0) {
      // In this case `AbortUnwindingCalls` haven't yet been executed.
      can_unwind = true;
    } else if (!DefKind.is_fn_like(tcx.def_kind(def_id))) {
      can_unwind = true;
    } else {
      // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
      const body_ty = EarlyBinder.skip_binder(tcx.type_of(def_id) as EarlyBinder<Ty>);
      let body_abi: ExternAbi;
      const body_kind = body_ty.kind();
      switch (body_kind.$) {
        case "FnDef":
          body_abi = PolyFnSig.abi(body_ty.fn_sig(tcx));
          break;
        case "Closure":
          body_abi = ExternAbi.RustCall;
          break;
        case "CoroutineClosure":
          body_abi = ExternAbi.RustCall;
          break;
        case "Coroutine":
          body_abi = ExternAbi.Rust;
          break;
        // No need to do MIR validation on error bodies
        case "Error":
          return;
        default:
          return span_bug(body.span, `unexpected body ty: ${display_Ty(body_ty)}`);
      }

      can_unwind = fn_can_unwind(tcx, def_id, body_abi);
    }

    const cfg_checker = new CfgChecker(this.when, body, tcx, 0, reachable_as_bitset(body), new Set<bigint>(), can_unwind);
    cfg_checker.visit_body(body);
    cfg_checker.check_cleanup_control_flow();

    // Also run the TypeChecker.
    for (const [location, msg] of validate_types(tcx, typing_env, body, body)) {
      cfg_checker.fail(location, msg);
    }

    // Ensure that debuginfo records are not emitted for locals that are not in debuginfo.
    for (const [location, msg] of validate_debuginfos(body)) {
      cfg_checker.fail(location, msg);
    }

    if (body.phase.$ === "Runtime" && body.source.instance.$ === "Item" && TypeVisitableExt.has_free_regions(body, Body_visitable)) {
      cfg_checker.fail(Location.START, `Free regions in optimized ${MirPhase.name(body.phase)} MIR`);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:100 policy
  policy(_ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(true);
  }
}

/// This checker covers basic properties of the control-flow graph, (dis)allowed statements and terminators.
/// Everything checked here must be stable under substitution of generic parameters. In other words,
/// this is about the *structure* of the MIR, not the *contents*.
///
/// Everything that depends on types, or otherwise can be affected by generic parameters,
/// must be checked in `TypeChecker`.
// rustc-type: compiler/rustc_mir_transform/src/validate.rs:111 CfgChecker
class CfgChecker extends Visitor {
  constructor(
    public when: string,
    public body: Body,
    public tcx: TyCtxt,
    public unwind_edge_count: number,
    public reachable_blocks: DenseBitSet<BasicBlock>,
    public value_cache: Set<bigint>,
    // If `false`, then the MIR must not contain `UnwindAction::Continue` or
    // `TerminatorKind::Resume`.
    public can_unwind: boolean,
  ) {
    super();
  }

  // #[track_caller]
  // rustc: compiler/rustc_mir_transform/src/validate.rs:125 fail
  fail(location: Location, msg: string): void {
    // We might see broken MIR when other errors have already occurred.
    if (this.tcx.dcx().has_errors() === undefined) {
      span_bug(
        this.body.source_info(location).span,
        `broken MIR in ${debug_InstanceKind(this.body.source.instance, PLAIN)} (${this.when}) at ${debug_Location(location, PLAIN)}:\n${msg}`,
      );
    }
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:139 check_edge
  check_edge(location: Location, bb: BasicBlock, edge_kind: EdgeKind): void {
    if (bb === START_BLOCK) {
      this.fail(location, "start block must not have predecessors");
    }
    const blocks = this.body.basic_blocks.deref();
    // PORT: upstream's `if let Some(bb) = self.body.basic_blocks.get(bb)` shadows `bb` with the `BasicBlockData`, so
    // the message below prints the block data's `Debug`; here it is `bb_data`.
    const bb_data = blocks[bb];
    if (bb_data !== undefined) {
      const src = unwrap(blocks[location.block]);
      if (!src.is_cleanup && !bb_data.is_cleanup && edge_kind === EdgeKind.Normal) {
        // Non-cleanup blocks can jump to non-cleanup blocks along non-unwind edges
      } else if (src.is_cleanup && bb_data.is_cleanup && edge_kind === EdgeKind.Normal) {
        // Cleanup blocks can jump to cleanup blocks along non-unwind edges
      } else if (!src.is_cleanup && bb_data.is_cleanup && edge_kind === EdgeKind.Unwind) {
        // Non-cleanup blocks can jump to cleanup blocks along unwind edges
        this.unwind_edge_count += 1;
      } else {
        // All other jumps are invalid
        this.fail(
          location,
          `${debug_EdgeKind(edge_kind)} edge to ${debug_BasicBlockData(bb_data, PLAIN)} violates unwind invariants (cleanup ${src.is_cleanup} -> ${bb_data.is_cleanup})`,
        );
      }
    } else {
      this.fail(location, `encountered jump to invalid basic block ${debug_BasicBlock(bb, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:168 check_cleanup_control_flow
  check_cleanup_control_flow(): void {
    if (this.unwind_edge_count <= 1) {
      return;
    }
    const doms = this.body.basic_blocks.dominators();
    const post_contract_node = new Map<BasicBlock, BasicBlock>();
    // Reusing the allocation across invocations of the closure
    const dom_path: BasicBlock[] = [];
    const blocks = this.body.basic_blocks.deref();
    const get_post_contract_node = (bb_: BasicBlock): BasicBlock => {
      let bb = bb_;
      let root: BasicBlock;
      for (;;) {
        const r = post_contract_node.get(bb);
        if (r !== undefined) {
          root = r;
          break;
        }
        const parent = unwrap(doms.immediate_dominator(bb));
        dom_path.push(bb);
        if (!blocks[parent]!.is_cleanup) {
          root = bb;
          break;
        }
        bb = parent;
      }
      for (const bb of dom_path.splice(0)) {
        post_contract_node.set(bb, root);
      }
      return root;
    };

    const parent: (BasicBlock | undefined)[] = new Array<BasicBlock | undefined>(blocks.length).fill(undefined);
    for (let bb_ = 0 as BasicBlock; bb_ < blocks.length; bb_++) {
      const bb_data = blocks[bb_]!;
      if (!bb_data.is_cleanup || !this.reachable_blocks.contains(bb_)) {
        continue;
      }
      const bb = get_post_contract_node(bb_);
      for (const s_ of bb_data.terminator_().successors()) {
        const s = get_post_contract_node(s_);
        if (s === bb) {
          continue;
        }
        const e = parent[bb];
        if (e === undefined) {
          parent[bb] = s;
        } else if (e === s) {
          // ()
        } else {
          this.fail(
            BasicBlockC.start_location(bb),
            `Cleanup control flow violation: The blocks dominated by ${debug_BasicBlock(bb, PLAIN)} have edges to both ${debug_BasicBlock(s, PLAIN)} and ${debug_BasicBlock(e, PLAIN)}`,
          );
        }
      }
    }

    // Check for cycles
    const stack = new Set<BasicBlock>();
    // PORT: `parent` (the `&mut Option<BasicBlock>` of `iter_enumerated_mut`) is the slot `parent[bb0]`; the
    // `let Some(parent) = parent.take()` in the loop body shadows it only for the rest of that iteration, so every
    // `take()` reads the same slot, as upstream.
    for (let bb0 = 0 as BasicBlock; bb0 < parent.length; bb0++) {
      let bb = bb0;
      stack.clear();
      stack.add(bb);
      for (;;) {
        const parent_ = parent[bb0];
        parent[bb0] = undefined;
        if (parent_ === undefined) break;
        const no_cycle = !stack.has(parent_);
        stack.add(parent_);
        if (!no_cycle) {
          this.fail(
            BasicBlockC.start_location(bb),
            `Cleanup control flow violation: Cycle involving edge ${debug_BasicBlock(bb, PLAIN)} -> ${debug_BasicBlock(parent_, PLAIN)}`,
          );
          break;
        }
        bb = parent_;
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:246 check_unwind_edge
  check_unwind_edge(location: Location, unwind: UnwindAction): void {
    const is_cleanup = this.body.basic_blocks.deref()[location.block]!.is_cleanup;
    switch (unwind.$) {
      case "Cleanup": {
        if (is_cleanup) {
          this.fail(location, "`UnwindAction::Cleanup` in cleanup block");
        }
        this.check_edge(location, unwind._0, EdgeKind.Unwind);
        break;
      }
      case "Continue": {
        if (is_cleanup) {
          this.fail(location, "`UnwindAction::Continue` in cleanup block");
        }

        if (!this.can_unwind) {
          this.fail(location, "`UnwindAction::Continue` in no-unwind function");
        }
        break;
      }
      case "Terminate": {
        if (unwind._0 === "InCleanup") {
          if (!is_cleanup) {
            this.fail(location, "`UnwindAction::Terminate(InCleanup)` in a non-cleanup block");
          }
        }
        // `UnwindAction::Terminate(UnwindTerminateReason::Abi)` is allowed everywhere.
        break;
      }
      // These are allowed everywhere.
      case "Unreachable":
        break;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:277 is_critical_call_edge
  is_critical_call_edge(target: BasicBlock | undefined, unwind: UnwindAction): boolean {
    if (target === undefined) return false;
    return (unwind.$ === "Cleanup" || unwind.$ === "Terminate") && this.body.basic_blocks.predecessors()[target]!.length > 1;
  }

  // impl<'a, 'tcx> Visitor<'tcx> for CfgChecker<'a, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/validate.rs:285 visit_local
  override visit_local(local: Local, _context: PlaceContext, location: Location): void {
    if (local >= this.body.local_decls.length) {
      this.fail(location, `local ${debug_Local(local, PLAIN)} has no corresponding declaration in \`body.local_decls\``);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:294 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    const kind = statement.kind;
    switch (kind.$) {
      case "AscribeUserType": {
        if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
          this.fail(location, "`AscribeUserType` should have been removed after drop lowering phase");
        }
        break;
      }
      case "FakeRead": {
        if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
          this.fail(location, "`FakeRead` should have been removed after drop lowering phase");
        }
        break;
      }
      case "SetDiscriminant": {
        if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) < 0) {
          this.fail(location, "`SetDiscriminant`is not allowed until deaggregation");
        }
        break;
      }
      case "Coverage": {
        if (MirPhase_cmp(this.body.phase, ANALYSIS_POST_CLEANUP) >= 0 && CoverageKind.is_removed_after_analysis(kind._0)) {
          this.fail(location, `${debug_CoverageKind(kind._0, PLAIN)} should have been removed after analysis`);
        }
        break;
      }
      case "Assign":
      case "StorageLive":
      case "StorageDead":
      case "Intrinsic":
      case "ConstEvalCounter":
      case "PlaceMention":
      case "BackwardIncompatibleDropHint":
      case "Nop":
        break;
    }

    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:340 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    const kind = terminator.kind;
    switch (kind.$) {
      case "Goto": {
        this.check_edge(location, kind.target, EdgeKind.Normal);
        break;
      }
      case "SwitchInt": {
        const targets = kind.targets;
        for (const [, target] of targets.iter()) {
          this.check_edge(location, target, EdgeKind.Normal);
        }
        this.check_edge(location, targets.otherwise(), EdgeKind.Normal);

        this.value_cache.clear();
        for (const [value] of targets.iter()) this.value_cache.add(value);
        const has_duplicates = targets.iter().size_hint()[0] !== this.value_cache.size;
        if (has_duplicates) {
          this.fail(location, `duplicated values in \`SwitchInt\` terminator: ${debug_TerminatorKind(terminator.kind, PLAIN)}`);
        }
        break;
      }
      case "Drop": {
        this.check_edge(location, kind.target, EdgeKind.Normal);
        this.check_unwind_edge(location, kind.unwind);
        if (kind.drop !== undefined) {
          const drop = kind.drop;
          this.check_edge(location, drop, EdgeKind.Normal);
          if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
            this.fail(location, "`async drop` should have been removed after drop elaboration");
          }
        }
        break;
      }
      case "Call":
      case "TailCall": {
        const func = kind.func;
        const args = kind.args;
        // FIXME(explicit_tail_calls): refactor this & add tail-call specific checks
        if (terminator.kind.$ === "Call") {
          const { target, unwind, destination } = terminator.kind;
          if (target !== undefined) {
            this.check_edge(location, target, EdgeKind.Normal);
          }
          this.check_unwind_edge(location, unwind);

          // The code generation assumes that there are no critical call edges. The
          // assumption is used to simplify inserting code that should be executed along
          // the return edge from the call. FIXME(tmiasko): Since this is a strictly code
          // generation concern, the code generation should be responsible for handling
          // it.
          if (MirPhase_cmp(this.body.phase, RUNTIME_OPTIMIZED) >= 0 && this.is_critical_call_edge(target, unwind)) {
            this.fail(location, `encountered critical edge in \`Call\` terminator ${debug_TerminatorKind(terminator.kind, PLAIN)}`);
          }

          // The call destination place and Operand::Move place used as an argument might
          // be passed by a reference to the callee. Consequently they cannot be packed.
          if (most_packed_projection(this.tcx, this.body.local_decls, destination) !== undefined) {
            // This is bad! The callee will expect the memory to be aligned.
            this.fail(location, `encountered packed place in \`Call\` terminator destination: ${debug_TerminatorKind(terminator.kind, PLAIN)}`);
          }
        }

        for (const arg of args) {
          if (arg.node.$ === "Move") {
            const place = arg.node._0;
            if (most_packed_projection(this.tcx, this.body.local_decls, place) !== undefined) {
              // This is bad! The callee will expect the memory to be aligned.
              this.fail(location, `encountered \`Move\` of a packed place in \`Call\` terminator: ${debug_TerminatorKind(terminator.kind, PLAIN)}`);
            }

            // Call arguments are moved by reference, so they must be plain locals
            // or the contents of a box; other moved places violate MIR invariants.
            if (this.tcx.sess.opts.unstable_opts.validate_mir && MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) < 0) {
              const is_plain_local = place.projection.length === 0;
              const is_box_deref =
                place.projection.length === 1 && place.projection[0]!.$ === "Deref" && this.body.local_decls[place.local]!.ty.is_box();
              if (!is_plain_local && !is_box_deref) {
                this.fail(
                  location,
                  `encountered \`Move\` of a non-local, non-box place in \`Call\` terminator: ${debug_TerminatorKind(terminator.kind, PLAIN)}`,
                );
              }
            }
          }
        }

        const func_kind = Operand.ty(func, this.body.local_decls, this.tcx).kind();
        if (
          func_kind.$ === "FnDef" &&
          MirPhase_cmp(this.body.phase, RUNTIME_OPTIMIZED) >= 0 &&
          // PORT: the `codegen_fn_attrs` query value is `unknown` in queries.gen.ts.
          (this.tcx.codegen_fn_attrs(func_kind._0) as CodegenFnAttrs).inline.$ === "Force"
        ) {
          this.fail(location, "`#[rustc_force_inline]`-annotated function not inlined");
        }
        break;
      }
      case "Assert": {
        this.check_edge(location, kind.target, EdgeKind.Normal);
        this.check_unwind_edge(location, kind.unwind);
        break;
      }
      case "Yield": {
        if (this.body.coroutine === undefined) {
          this.fail(location, "`Yield` cannot appear outside coroutine bodies");
        }
        if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
          this.fail(location, "`Yield` should have been replaced by coroutine lowering");
        }
        this.check_edge(location, kind.resume, EdgeKind.Normal);
        if (kind.drop !== undefined) {
          this.check_edge(location, kind.drop, EdgeKind.Normal);
        }
        break;
      }
      case "FalseEdge": {
        if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
          this.fail(location, "`FalseEdge` should have been removed after drop elaboration");
        }
        this.check_edge(location, kind.real_target, EdgeKind.Normal);
        this.check_edge(location, kind.imaginary_target, EdgeKind.Normal);
        break;
      }
      case "FalseUnwind": {
        if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
          this.fail(location, "`FalseUnwind` should have been removed after drop elaboration");
        }
        this.check_edge(location, kind.real_target, EdgeKind.Normal);
        this.check_unwind_edge(location, kind.unwind);
        break;
      }
      case "InlineAsm": {
        for (const target of kind.targets) {
          this.check_edge(location, target, EdgeKind.Normal);
        }
        this.check_unwind_edge(location, kind.unwind);
        break;
      }
      case "CoroutineDrop": {
        if (this.body.coroutine === undefined) {
          this.fail(location, "`CoroutineDrop` cannot appear outside coroutine bodies");
        }
        if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
          this.fail(location, "`CoroutineDrop` should have been replaced by coroutine lowering");
        }
        break;
      }
      case "UnwindResume": {
        const bb = location.block;
        if (!this.body.basic_blocks.deref()[bb]!.is_cleanup) {
          this.fail(location, "Cannot `UnwindResume` from non-cleanup basic block");
        }
        if (!this.can_unwind) {
          this.fail(location, "Cannot `UnwindResume` in a function that cannot unwind");
        }
        break;
      }
      case "UnwindTerminate": {
        const bb = location.block;
        if (!this.body.basic_blocks.deref()[bb]!.is_cleanup) {
          this.fail(location, "Cannot `UnwindTerminate` from non-cleanup basic block");
        }
        break;
      }
      case "Return": {
        const bb = location.block;
        if (this.body.basic_blocks.deref()[bb]!.is_cleanup) {
          this.fail(location, "Cannot `Return` from cleanup basic block");
        }
        break;
      }
      case "Unreachable":
        break;
    }

    this.super_terminator(terminator, location);
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:543 visit_source_scope
  override visit_source_scope(scope: SourceScope): void {
    if (scope >= this.body.source_scopes.length) {
      this.tcx
        .dcx()
        .span_bug(
          this.body.span,
          `broken MIR in ${debug_InstanceKind(this.body.source.instance, PLAIN)} (${this.when}):\ninvalid source scope ${debug_SourceScope(scope, PLAIN)}`,
        );
    }
  }
}

/// A faster version of the validation pass that only checks those things which may break when
/// instantiating any generic parameters.
///
/// `caller_body` is used to detect cycles in MIR inlining and MIR validation before
/// `optimized_mir` is available.
// rustc: compiler/rustc_mir_transform/src/validate.rs:561 validate_types
export function validate_types(tcx: TyCtxt, typing_env: TypingEnv, body: Body, caller_body: Body): [Location, string][] {
  const type_checker = new TypeChecker(body, caller_body, tcx, typing_env, []);
  // The type checker formats a bunch of strings with type names in it, but these strings
  // are not always going to be encountered on the error path since the inliner also uses
  // the validator, and there are certain kinds of inlining (even for valid code) that
  // can cause validation errors (mostly around where clauses and rigid projections).
  with_no_trimmed_paths(() => {
    type_checker.visit_body(body);
  });
  return type_checker.failures;
}

// rustc-type: compiler/rustc_mir_transform/src/validate.rs:578 TypeChecker
class TypeChecker extends Visitor {
  constructor(
    public body: Body,
    public caller_body: Body,
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public failures: [Location, string][],
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:587 fail
  fail(location: Location, msg: string): void {
    this.failures.push([location, msg]);
  }

  /// Check if src can be assigned into dest.
  /// This is not precise, it will accept some incorrect assignments.
  // rustc: compiler/rustc_mir_transform/src/validate.rs:593 mir_assign_valid_types
  mir_assign_valid_types(src: Ty, dest: Ty): boolean {
    // Fast path before we normalize.
    if (src === dest) {
      // Equal types, all is good.
      return true;
    }

    // We sometimes have to use `defining_opaque_types` for subtyping
    // to succeed here and figuring out how exactly that should work
    // is annoying. It is harmless enough to just not validate anything
    // in that case. We still check this after analysis as all opaque
    // types have been revealed at this point.
    if (TypeVisitableExt.has_opaque_types<[Ty, Ty]>([src, dest], fold_tuple2(fold_Ty, fold_Ty))) {
      return true;
    }

    // After borrowck subtyping should be fully explicit via
    // `Subtype` projections.
    const variance = MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0 ? Variance.Invariant : Variance.Covariant;

    return relate_types(this.tcx, this.typing_env, variance, src, dest);
  }

  /// Check that the given predicate definitely holds in the param-env of this MIR body.
  // PORT: `pred: impl Upcast<TyCtxt<'tcx>, ty::Predicate<'tcx>>` is the value with its `upcast` fn.
  // rustc: compiler/rustc_mir_transform/src/validate.rs:621 predicate_must_hold_modulo_regions
  predicate_must_hold_modulo_regions<P>(pred_: P, upcast: (from: P, tcx: TyCtxt) => Predicate): boolean {
    const pred: Predicate = upcast(pred_, this.tcx);

    // We sometimes have to use `defining_opaque_types` for predicates
    // to succeed here and figuring out how exactly that should work
    // is annoying. It is harmless enough to just not validate anything
    // in that case. We still check this after analysis as all opaque
    // types have been revealed at this point.
    if (!this.tcx.next_trait_solver_globally() && TypeVisitableExt.has_opaque_types(pred, fold_Predicate)) {
      return true;
    }

    const [infcx, param_env] = this.tcx.infer_ctxt().ignoring_regions().build_with_typing_env(this.typing_env);
    const ocx = ObligationCtxt.new(infcx);
    ocx.register_obligation(Obligation.new(this.tcx, ObligationCause.dummy(), param_env, pred, (p: Predicate) => p));
    return TraitErrors.no_errors(ocx.evaluate_obligations_error_on_ambiguity());
  }

  // impl<'a, 'tcx> Visitor<'tcx> for TypeChecker<'a, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/validate.rs:650 visit_operand
  override visit_operand(operand: Operand, location: Location): void {
    // This check is somewhat expensive, so only run it when -Zvalidate-mir is passed.
    if (this.tcx.sess.opts.unstable_opts.validate_mir && MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) < 0) {
      // `Operand::Copy` is only supposed to be used with `Copy` types.
      if (operand.$ === "Copy") {
        const place = operand._0;
        const ty = place.ty(this.body.local_decls, this.tcx).ty;

        if (!this.tcx.type_is_copy_modulo_regions(this.typing_env, ty)) {
          this.fail(location, `\`Operand::Copy\` with non-\`Copy\` type ${display_Ty(ty)}`);
        }
      }
    }

    this.super_operand(operand, location);
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:668 visit_projection_elem
  override visit_projection_elem(place_ref: PlaceRef, elem: PlaceElem, context: PlaceContext, location: Location): void {
    if (elem.$ === "Deref" && MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
      const base_ty = place_ref.ty(this.body.local_decls, this.tcx).ty;

      if (base_ty.is_box()) {
        this.fail(location, `${display_Ty(base_ty)} dereferenced after ElaborateBoxDerefs`);
      }
    } else if (elem.$ === "Field") {
      const f = elem._0;
      const ty = elem._1;
      const parent_ty = place_ref.ty(this.body.local_decls, this.tcx);
      const fail_out_of_bounds = (this_: TypeChecker, location: Location): void => {
        this_.fail(location, `Out of bounds field ${FieldIdx.debug(f, PLAIN)} for ${debug_PlaceTy(parent_ty, PLAIN)}`);
      };
      const check_equal = (this_: TypeChecker, location: Location, f_ty: Ty): void => {
        if (!this_.mir_assign_valid_types(ty, f_ty)) {
          this_.fail(
            location,
            `Field projection \`${debug_PlaceRef(place_ref, PLAIN)}.${FieldIdx.debug(f, PLAIN)}\` specified type \`${display_Ty(ty)}\`, but actual type is \`${display_Ty(f_ty)}\``,
          );
        }
      };

      const parent_kind = parent_ty.ty.kind();
      let kind: TyKind;
      if (parent_kind.$ === "Alias" && parent_kind._1.kind.$ === "Opaque") {
        const def_id = parent_kind._1.kind.def_id;
        const args = parent_kind._1.args;
        // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
        kind = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.type_of(def_id) as EarlyBinder<Ty>, this.tcx, args, fold_Ty)).kind();
      } else {
        kind = parent_kind;
      }

      switch (kind.$) {
        case "Tuple": {
          const fields = kind._0;
          const f_ty = fields[FieldIdx.as_usize(f)];
          if (f_ty === undefined) {
            fail_out_of_bounds(this, location);
            return;
          }
          check_equal(this, location, f_ty);
          break;
        }
        // Debug info is allowed to project into pattern types
        case "Pat":
          check_equal(this, location, kind._0);
          break;
        case "Adt": {
          const adt_def: AdtDef = kind._0;
          const args = kind._1;
          // see <https://github.com/rust-lang/rust/blob/7601adcc764d42c9f2984082b49948af652df986/compiler/rustc_middle/src/ty/layout.rs#L861-L864>
          if (this.tcx.is_lang_item(adt_def.did(), LangItem.DynMetadata)) {
            this.fail(
              location,
              `You can't project to field ${FieldIdx.debug(f, PLAIN)} of \`DynMetadata\` because layout is weird and thinks it doesn't have fields.`,
            );
          }

          if (adt_def.repr().simd() || adt_def.repr().is_scalable()) {
            this.fail(location, `Projecting into SIMD type ${debug_AdtDef(adt_def, PLAIN)} is banned by MCP#838`);
          }

          const var_ = parent_ty.variant_index ?? FIRST_VARIANT;
          const field = adt_def.variant(var_).fields[f];
          if (field === undefined) {
            fail_out_of_bounds(this, location);
            return;
          }
          check_equal(this, location, Unnormalized.skip_norm_wip(field.ty(this.tcx, args)));
          break;
        }
        case "Closure": {
          const args = kind._1.as_closure();
          const f_ty = ClosureArgs.upvar_tys(args)[FieldIdx.as_usize(f)];
          if (f_ty === undefined) {
            fail_out_of_bounds(this, location);
            return;
          }
          check_equal(this, location, f_ty);
          break;
        }
        case "CoroutineClosure": {
          const args = kind._1.as_coroutine_closure();
          const f_ty = CoroutineClosureArgs.upvar_tys(args)[FieldIdx.as_usize(f)];
          if (f_ty === undefined) {
            fail_out_of_bounds(this, location);
            return;
          }
          check_equal(this, location, f_ty);
          break;
        }
        case "Coroutine": {
          const def_id = kind._0;
          const args = kind._1;
          let f_ty: Ty;
          if (parent_ty.variant_index !== undefined) {
            const var_ = parent_ty.variant_index;
            // If we're currently validating an inlined copy of this body,
            // then it will no longer be parameterized over the original
            // args of the coroutine. Otherwise, we prefer to use this body
            // since we may be in the process of computing this MIR in the
            // first place.
            let layout: CoroutineLayout | undefined;
            if (DefId_eq(def_id, this.caller_body.source.def_id())) {
              layout = this.caller_body.coroutine_layout_raw() ?? coroutine_layout_ok(this.tcx, def_id, args);
            } else if (
              this.tcx.needs_coroutine_by_move_body_def_id(def_id) &&
              unwrap(CoroutineArgs.kind_ty(args.as_coroutine()).to_opt_closure_kind()) === "FnOnce" &&
              DefId_eq(this.caller_body.source.def_id(), this.tcx.coroutine_by_move_body_def_id(def_id))
            ) {
              // Same if this is the by-move body of a coroutine-closure.
              layout = this.caller_body.coroutine_layout_raw();
            } else {
              layout = coroutine_layout_ok(this.tcx, def_id, args);
            }

            if (layout === undefined) {
              this.fail(location, `No coroutine layout for ${debug_PlaceTy(parent_ty, PLAIN)}`);
              return;
            }

            const local = layout.variant_fields[var_]![f];
            if (local === undefined) {
              fail_out_of_bounds(this, location);
              return;
            }

            const f_ty_ = layout.field_tys[local];
            if (f_ty_ === undefined) {
              this.fail(location, `Out of bounds local ${debug_CoroutineSavedLocal(local, PLAIN)} for ${debug_PlaceTy(parent_ty, PLAIN)}`);
              return;
            }

            f_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(this.tcx, f_ty_.ty, fold_Ty), this.tcx, args, fold_Ty));
          } else {
            const f_ty_ = CoroutineArgs.upvar_tys(args.as_coroutine())[FieldIdx.index(f)];
            if (f_ty_ !== undefined) {
              f_ty = f_ty_;
            } else {
              fail_out_of_bounds(this, location);
              return;
            }
          }

          check_equal(this, location, f_ty);
          break;
        }
        default: {
          this.fail(location, `${debug_Ty(parent_ty.ty, PLAIN)} does not have fields`);
        }
      }
    } else if (elem.$ === "Index") {
      const index = elem._0;
      const indexed_ty = place_ref.ty(this.body.local_decls, this.tcx).ty;
      const k = indexed_ty.kind();
      if (k.$ === "Array" || k.$ === "Slice") {
        // ok
      } else {
        this.fail(location, `${debug_Ty(indexed_ty, PLAIN)} cannot be indexed`);
      }

      const index_ty = this.body.local_decls[index]!.ty;
      if (index_ty !== this.tcx.types.usize) {
        this.fail(location, `bad index (${display_Ty(index_ty)} != usize)`);
      }
    } else if (elem.$ === "ConstantIndex") {
      const { offset, min_length, from_end } = elem;
      const indexed_ty = place_ref.ty(this.body.local_decls, this.tcx).ty;
      const k = indexed_ty.kind();
      if (k.$ === "Array") {
        if (from_end) {
          this.fail(location, "arrays should not be indexed from end");
        }
      } else if (k.$ === "Slice") {
        // ok
      } else {
        this.fail(location, `${debug_Ty(indexed_ty, PLAIN)} cannot be indexed`);
      }

      if (from_end) {
        if (offset > min_length) {
          this.fail(location, `constant index with offset -${offset} out of bounds of min length ${min_length}`);
        }
      } else {
        if (offset >= min_length) {
          this.fail(location, `constant index with offset ${offset} out of bounds of min length ${min_length}`);
        }
      }
    } else if (elem.$ === "Subslice") {
      const { from, to, from_end } = elem;
      const indexed_ty = place_ref.ty(this.body.local_decls, this.tcx).ty;
      const k = indexed_ty.kind();
      if (k.$ === "Array") {
        if (from_end) {
          this.fail(location, "arrays should not be subsliced from end");
        }
      } else if (k.$ === "Slice") {
        if (!from_end) {
          this.fail(location, "slices should be subsliced from end");
        }
      } else {
        this.fail(location, `${debug_Ty(indexed_ty, PLAIN)} cannot be indexed`);
      }

      if (!from_end && from > to) {
        // PORT: upstream passes a plain string literal (no `format!`), so the braces are printed as is.
        this.fail(location, "backwards subslice {from}..{to}");
      }
    } else if (elem.$ === "OpaqueCast" && MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
      const ty = elem._0;
      this.fail(location, `explicit opaque type cast to \`${display_Ty(ty)}\` after \`PostAnalysisNormalize\``);
    } else if (elem.$ === "UnwrapUnsafeBinder") {
      const unwrapped_ty = elem._0;
      const binder_ty_ = place_ref.ty(this.body.local_decls, this.tcx);
      const k = binder_ty_.ty.kind();
      if (k.$ !== "UnsafeBinder") {
        this.fail(location, "WrapUnsafeBinder does not produce a ty::UnsafeBinder");
        return;
      }
      const binder_ty = k._0;
      const binder_inner_ty = this.tcx.instantiate_bound_regions_with_erased(UnsafeBinderInner_deref(binder_ty), fold_Ty);
      if (!this.mir_assign_valid_types(unwrapped_ty, binder_inner_ty)) {
        this.fail(location, `Cannot unwrap unsafe binder ${debug_UnsafeBinderInner(binder_ty, PLAIN)} into type ${display_Ty(unwrapped_ty)}`);
      }
    } else {
      // _ => {}
    }
    this.super_projection_elem(place_ref, elem, context, location);
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:919 visit_var_debug_info
  override visit_var_debug_info(debuginfo: VarDebugInfo): void {
    if (debuginfo.composite !== undefined) {
      const { ty, projection } = debuginfo.composite;
      if (ty.is_union() || ty.is_enum()) {
        this.fail(BasicBlockC.start_location(START_BLOCK), `invalid type ${display_Ty(ty)} in debuginfo for ${debug_Symbol(debuginfo.name, PLAIN)}`);
      }
      if (projection.length === 0) {
        this.fail(BasicBlockC.start_location(START_BLOCK), `invalid empty projection in debuginfo for ${debug_Symbol(debuginfo.name, PLAIN)}`);
      }
      if (projection.some((p) => !(p.$ === "Field"))) {
        this.fail(
          BasicBlockC.start_location(START_BLOCK),
          `illegal projection ${debug_vec(projection, PLAIN, (x, f) => debug_ProjectionElem(x, f, debug_Local, debug_Ty))} in debuginfo for ${debug_Symbol(debuginfo.name, PLAIN)}`,
        );
      }
    }
    const value = debuginfo.value;
    switch (value.$) {
      case "Const":
        break;
      case "Place": {
        const place = value._0;
        if (place.projection.some((p) => !ProjectionElem.can_use_in_debuginfo(p))) {
          this.fail(
            BasicBlockC.start_location(START_BLOCK),
            `illegal place ${debug_Place(place, PLAIN)} in debuginfo for ${debug_Symbol(debuginfo.name, PLAIN)}`,
          );
        }
        break;
      }
    }
    this.super_var_debug_info(debuginfo);
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:957 visit_place
  override visit_place(place: Place, cntxt: PlaceContext, location: Location): void {
    // Set off any `bug!`s in the type computation code
    place.ty(this.body.local_decls, this.tcx);

    if (
      MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0 &&
      place.projection.length > 1 &&
      !(cntxt.$ === "NonUse" && cntxt._0.$ === "VarDebugInfo") &&
      place.projection.slice(1).some((e) => e.$ === "Deref")
    ) {
      this.fail(
        location,
        `place ${debug_Place(place, PLAIN)} has deref as a later projection (it is only permitted as the first projection)`,
      );
    }

    // Ensure all downcast projections are followed by field projections.
    const projections_iter = place.projection[Symbol.iterator]();
    for (let it = projections_iter.next(); !it.done; it = projections_iter.next()) {
      const proj = it.value;
      if (proj.$ === "Downcast") {
        const next = projections_iter.next();
        if (!(!next.done && next.value.$ === "Field")) {
          this.fail(location, `place ${debug_Place(place, PLAIN)} has \`Downcast\` projection not followed by \`Field\``);
        }
      }
    }

    const local_info = this.body.local_decls[place.local]!.local_info;
    if (local_info.$ === "Set" && local_info._0.$ === "DerefTemp" && !place.is_indirect_first_projection()) {
      if (!(cntxt.$ === "MutatingUse" && cntxt._0 === "Store") || place.as_local() === undefined) {
        this.fail(location, "`DerefTemp` locals must only be dereferenced or directly assigned to");
      }
    }

    if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) < 0) {
      const i = place.projection.findIndex((elem) => elem.$ === "Subslice");
      if (i !== -1) {
        // `place.projection.get(i + 1..)` is always `Some` here (`i + 1 <= len`).
        const tail = place.projection.slice(i + 1);
        if (tail.some((elem) => elem.$ === "ConstantIndex" || elem.$ === "Subslice")) {
          this.fail(location, `place ${debug_Place(place, PLAIN)} has \`ConstantIndex\` or \`Subslice\` after \`Subslice\``);
        }
      }
    }

    this.super_place(place, cntxt, location);
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:1023 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    // PORT: `macro_rules! check_kinds { ($t:expr, $text:literal, $typat:pat) => .. }`: `text` formats the message
    // from `{:?}` of `$t`, `typat` is the pattern.
    const check_kinds = (t: Ty, text: (t: string) => string, typat: (k: TyKind) => boolean): void => {
      if (!typat(t.kind())) {
        this.fail(location, text(debug_Ty(t, PLAIN)));
      }
    };
    switch (rvalue.$) {
      case "Use":
        break;
      case "CopyForDeref": {
        if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
          this.fail(location, "`CopyForDeref` should have been removed in runtime MIR");
        }
        break;
      }
      case "Aggregate": {
        const kind = rvalue._0;
        const fields = rvalue._1;
        switch (kind.$) {
          case "Tuple":
            break;
          case "Array": {
            const dest = kind._0;
            for (const src of fields) {
              if (!this.mir_assign_valid_types(Operand.ty(src, this.body, this.tcx), dest)) {
                this.fail(location, "array field has the wrong type");
              }
            }
            break;
          }
          case "Adt": {
            const def_id = kind._0;
            const idx = kind._1;
            const args = kind._2;
            const field = kind._4;
            if (field !== undefined) {
              // PORT: the `adt_def` query value is `unknown` in queries.gen.ts.
              const adt_def = this.tcx.adt_def(def_id) as AdtDef;
              assert(adt_def.is_union(), "assertion failed: adt_def.is_union()");
              assert_eq(idx, FIRST_VARIANT, (v) => VariantIdx.debug(v, PLAIN));
              const dest_ty = this.tcx.normalize_erasing_regions(this.typing_env, adt_def.non_enum_variant().fields[field]!.ty(this.tcx, args), fold_Ty);
              if (fields.length === 1) {
                const field = fields[0]!;
                const src_ty = Operand.ty(field, this.body, this.tcx);
                if (!this.mir_assign_valid_types(src_ty, dest_ty)) {
                  this.fail(location, "union field has the wrong type");
                }
              } else {
                this.fail(location, "unions should have one initialized field");
              }
            } else {
              const adt_def = this.tcx.adt_def(def_id) as AdtDef;
              assert(!adt_def.is_union(), "assertion failed: !adt_def.is_union()");
              const variant = adt_def.variants()[idx]!;
              if (variant.fields.length !== fields.length) {
                this.fail(
                  location,
                  `adt ${debug_DefId_(def_id)} has the wrong number of initialized fields, expected ${fields.length}, found ${variant.fields.length}`,
                );
              }
              const n = Math.min(fields.length, variant.fields.length);
              for (let i = 0; i < n; i++) {
                const src = fields[i]!;
                const dest = variant.fields[i]!;
                const dest_ty = this.tcx.normalize_erasing_regions(this.typing_env, dest.ty(this.tcx, args), fold_Ty);
                if (!this.mir_assign_valid_types(Operand.ty(src, this.body, this.tcx), dest_ty)) {
                  this.fail(location, "adt field has the wrong type");
                }
              }
            }
            break;
          }
          case "Closure": {
            const upvars = ClosureArgs.upvar_tys(kind._1.as_closure());
            if (upvars.length !== fields.length) {
              this.fail(location, "closure has the wrong number of initialized fields");
            }
            const n = Math.min(fields.length, upvars.length);
            for (let i = 0; i < n; i++) {
              if (!this.mir_assign_valid_types(Operand.ty(fields[i]!, this.body, this.tcx), upvars[i]!)) {
                this.fail(location, "closure field has the wrong type");
              }
            }
            break;
          }
          case "Coroutine": {
            const upvars = CoroutineArgs.upvar_tys(kind._1.as_coroutine());
            if (upvars.length !== fields.length) {
              this.fail(location, "coroutine has the wrong number of initialized fields");
            }
            const n = Math.min(fields.length, upvars.length);
            for (let i = 0; i < n; i++) {
              if (!this.mir_assign_valid_types(Operand.ty(fields[i]!, this.body, this.tcx), upvars[i]!)) {
                this.fail(location, "coroutine field has the wrong type");
              }
            }
            break;
          }
          case "CoroutineClosure": {
            const upvars = CoroutineClosureArgs.upvar_tys(kind._1.as_coroutine_closure());
            if (upvars.length !== fields.length) {
              this.fail(location, "coroutine-closure has the wrong number of initialized fields");
            }
            const n = Math.min(fields.length, upvars.length);
            for (let i = 0; i < n; i++) {
              if (!this.mir_assign_valid_types(Operand.ty(fields[i]!, this.body, this.tcx), upvars[i]!)) {
                this.fail(location, "coroutine-closure field has the wrong type");
              }
            }
            break;
          }
          case "RawPtr": {
            const pointee_ty = kind._0;
            const mutability = kind._1;
            if (this.body.phase.$ !== "Runtime") {
              // It would probably be fine to support this in earlier phases, but at the
              // time of writing it's only ever introduced from intrinsic lowering, so
              // earlier things just `bug!` on it.
              this.fail(location, "RawPtr should be in runtime MIR only");
            }

            if (fields.length === 2) {
              const data_ptr = fields[0]!;
              const metadata = fields[1]!;
              const data_ptr_ty = Operand.ty(data_ptr, this.body, this.tcx);
              const metadata_ty = Operand.ty(metadata, this.body, this.tcx);
              const dk = data_ptr_ty.kind();
              if (dk.$ === "RawPtr") {
                const in_pointee = dk._0;
                const in_mut = dk._1;
                if (in_mut !== mutability) {
                  this.fail(location, "input and output mutability must match");
                }

                // FIXME: check `Thin` instead of `Sized`
                if (!in_pointee.is_sized(this.tcx, this.typing_env)) {
                  this.fail(location, "input pointer must be thin");
                }
              } else {
                this.fail(location, "first operand to raw pointer aggregate must be a raw pointer");
              }

              // FIXME: Check metadata more generally
              if (pointee_ty.is_slice()) {
                if (!this.mir_assign_valid_types(metadata_ty, this.tcx.types.usize)) {
                  this.fail(location, "slice metadata must be usize");
                }
              } else if (pointee_ty.is_sized(this.tcx, this.typing_env)) {
                if (metadata_ty !== this.tcx.types.unit) {
                  this.fail(location, "metadata for pointer-to-thin must be unit");
                }
              }
            } else {
              this.fail(location, "raw pointer aggregate must have 2 fields");
            }
            break;
          }
        }
        break;
      }
      case "Ref": {
        if (rvalue._1.$ === "Fake") {
          if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
            this.fail(location, "`Assign` statement with a `Fake` borrow should have been removed in runtime MIR");
          }
        }
        // Rvalue::Ref(..) => {}
        break;
      }
      case "Reborrow":
        break;
      case "BinaryOp": {
        const op = rvalue._0;
        const vals = rvalue._1;
        const a = Operand.ty(vals[0], this.body.local_decls, this.tcx);
        const b = Operand.ty(vals[1], this.body.local_decls, this.tcx);
        if (binop_right_homogeneous(op)) {
          if (op === "Eq" || op === "Lt" || op === "Le" || op === "Ne" || op === "Ge" || op === "Gt") {
            // The function pointer types can have lifetimes
            if (!this.mir_assign_valid_types(a, b)) {
              this.fail(location, `Cannot ${debug_BinOp(op, PLAIN)} compare incompatible types ${display_Ty(a)} and ${display_Ty(b)}`);
            }
          } else if (a !== b) {
            this.fail(location, `Cannot perform binary op ${debug_BinOp(op, PLAIN)} on unequal types ${display_Ty(a)} and ${display_Ty(b)}`);
          }
        }

        switch (op) {
          case "Offset": {
            check_kinds(a, (t) => `Cannot offset non-pointer type ${t}`, (k) => k.$ === "RawPtr");
            if (b !== this.tcx.types.isize && b !== this.tcx.types.usize) {
              this.fail(location, `Cannot offset by non-isize type ${display_Ty(b)}`);
            }
            break;
          }
          case "Eq":
          case "Lt":
          case "Le":
          case "Ne":
          case "Ge":
          case "Gt": {
            for (const x of [a, b]) {
              check_kinds(
                x,
                (t) => `Cannot ${debug_BinOp(op, PLAIN)} compare type ${t}`,
                (k) =>
                  k.$ === "Bool" || k.$ === "Char" || k.$ === "Int" || k.$ === "Uint" || k.$ === "Float" || k.$ === "RawPtr" || k.$ === "FnPtr",
              );
            }
            break;
          }
          case "Cmp": {
            for (const x of [a, b]) {
              check_kinds(x, (t) => `Cannot three-way compare non-integer type ${t}`, (k) => k.$ === "Char" || k.$ === "Uint" || k.$ === "Int");
            }
            break;
          }
          case "AddUnchecked":
          case "AddWithOverflow":
          case "SubUnchecked":
          case "SubWithOverflow":
          case "MulUnchecked":
          case "MulWithOverflow":
          case "Shl":
          case "ShlUnchecked":
          case "Shr":
          case "ShrUnchecked": {
            for (const x of [a, b]) {
              check_kinds(x, (t) => `Cannot ${debug_BinOp(op, PLAIN)} non-integer type ${t}`, (k) => k.$ === "Uint" || k.$ === "Int");
            }
            break;
          }
          case "BitAnd":
          case "BitOr":
          case "BitXor": {
            for (const x of [a, b]) {
              check_kinds(
                x,
                (t) => `Cannot perform bitwise op ${debug_BinOp(op, PLAIN)} on type ${t}`,
                (k) => k.$ === "Uint" || k.$ === "Int" || k.$ === "Bool",
              );
            }
            break;
          }
          case "Add":
          case "Sub":
          case "Mul":
          case "Div":
          case "Rem": {
            for (const x of [a, b]) {
              check_kinds(
                x,
                (t) => `Cannot perform arithmetic ${debug_BinOp(op, PLAIN)} on type ${t}`,
                (k) => k.$ === "Uint" || k.$ === "Int" || k.$ === "Float",
              );
            }
            break;
          }
        }
        break;
      }
      case "UnaryOp": {
        const op = rvalue._0;
        const a = Operand.ty(rvalue._1, this.body.local_decls, this.tcx);
        switch (op) {
          case "Neg": {
            check_kinds(a, (t) => `Cannot negate type ${t}`, (k) => k.$ === "Int" || k.$ === "Float");
            break;
          }
          case "Not": {
            check_kinds(a, (t) => `Cannot binary not type ${t}`, (k) => k.$ === "Int" || k.$ === "Uint" || k.$ === "Bool");
            break;
          }
          case "PtrMetadata": {
            check_kinds(a, (t) => `Cannot PtrMetadata non-pointer non-reference type ${t}`, (k) => k.$ === "RawPtr" || k.$ === "Ref");
            break;
          }
        }
        break;
      }
      case "Cast": {
        const kind = rvalue._0;
        const target_type = rvalue._2;
        const op_ty = Operand.ty(rvalue._1, this.body, this.tcx);
        const kind_dbg = (): string => debug_CastKind(kind, PLAIN);
        switch (kind.$) {
          // FIXME: Add Checks for these
          case "PointerWithExposedProvenance":
          case "PointerExposeProvenance":
            break;
          case "PointerCoercion": {
            const coercion = kind._0;
            switch (coercion.$) {
              case "ReifyFnPointer": {
                // FIXME: check signature compatibility.
                check_kinds(op_ty, (t) => `CastKind::${kind_dbg()} input must be a fn item, not ${t}`, (k) => k.$ === "FnDef");
                check_kinds(target_type, (t) => `CastKind::${kind_dbg()} output must be a fn pointer, not ${t}`, (k) => k.$ === "FnPtr");
                break;
              }
              case "UnsafeFnPointer": {
                // FIXME: check safety and signature compatibility.
                check_kinds(op_ty, (t) => `CastKind::${kind_dbg()} input must be a fn pointer, not ${t}`, (k) => k.$ === "FnPtr");
                check_kinds(target_type, (t) => `CastKind::${kind_dbg()} output must be a fn pointer, not ${t}`, (k) => k.$ === "FnPtr");
                break;
              }
              case "ClosureFnPointer": {
                // FIXME: check safety, captures, and signature compatibility.
                check_kinds(op_ty, (t) => `CastKind::${kind_dbg()} input must be a closure, not ${t}`, (k) => k.$ === "Closure");
                check_kinds(target_type, (t) => `CastKind::${kind_dbg()} output must be a fn pointer, not ${t}`, (k) => k.$ === "FnPtr");
                break;
              }
              case "MutToConstPointer": {
                // FIXME: check same pointee?
                check_kinds(
                  op_ty,
                  (t) => `CastKind::${kind_dbg()} input must be a raw mut pointer, not ${t}`,
                  (k) => k.$ === "RawPtr" && k._1 === "Mut",
                );
                check_kinds(
                  target_type,
                  (t) => `CastKind::${kind_dbg()} output must be a raw const pointer, not ${t}`,
                  (k) => k.$ === "RawPtr" && k._1 === "Not",
                );
                if (MirPhase_cmp(this.body.phase, ANALYSIS_POST_CLEANUP) >= 0) {
                  this.fail(location, `After borrowck, MIR disallows ${kind_dbg()}`);
                }
                break;
              }
              case "ArrayToPointer": {
                // FIXME: Check pointee types
                check_kinds(op_ty, (t) => `CastKind::${kind_dbg()} input must be a raw pointer, not ${t}`, (k) => k.$ === "RawPtr");
                check_kinds(target_type, (t) => `CastKind::${kind_dbg()} output must be a raw pointer, not ${t}`, (k) => k.$ === "RawPtr");
                if (MirPhase_cmp(this.body.phase, ANALYSIS_POST_CLEANUP) >= 0) {
                  this.fail(location, `After borrowck, MIR disallows ${kind_dbg()}`);
                }
                break;
              }
              case "Unsize": {
                // Pointers being unsize coerced should at least implement
                // `CoerceUnsized`.
                if (
                  !this.predicate_must_hold_modulo_regions(
                    TraitRef.new(
                      as_interner(this.tcx),
                      this.tcx.require_lang_item(LangItem.CoerceUnsized, this.body.source_info(location).span),
                      [op_ty, target_type],
                    ),
                    Predicate_upcast_from_TraitRef,
                  )
                ) {
                  this.fail(location, `Unsize coercion, but \`${display_Ty(op_ty)}\` isn't coercible to \`${display_Ty(target_type)}\``);
                }
                break;
              }
            }
            break;
          }
          case "IntToInt":
          case "IntToFloat": {
            const input_valid = op_ty.is_integral() || op_ty.is_char() || op_ty.is_bool();
            const target_valid = target_type.is_numeric() || target_type.is_char();
            if (!input_valid || !target_valid) {
              this.fail(location, `Wrong cast kind ${kind_dbg()} for the type ${display_Ty(op_ty)}`);
            }
            break;
          }
          case "FnPtrToPtr": {
            check_kinds(op_ty, (t) => `CastKind::${kind_dbg()} input must be a fn pointer, not ${t}`, (k) => k.$ === "FnPtr");
            check_kinds(target_type, (t) => `CastKind::${kind_dbg()} output must be a raw pointer, not ${t}`, (k) => k.$ === "RawPtr");
            break;
          }
          case "PtrToPtr": {
            check_kinds(op_ty, (t) => `CastKind::${kind_dbg()} input must be a raw pointer, not ${t}`, (k) => k.$ === "RawPtr");
            check_kinds(target_type, (t) => `CastKind::${kind_dbg()} output must be a raw pointer, not ${t}`, (k) => k.$ === "RawPtr");
            break;
          }
          case "FloatToFloat":
          case "FloatToInt": {
            if (!op_ty.is_floating_point() || !target_type.is_numeric()) {
              this.fail(location, `Trying to cast non 'Float' as ${kind_dbg()} into ${debug_Ty(target_type, PLAIN)}`);
            }
            break;
          }
          case "Transmute":
          case "BoxDerefTransmute": {
            // Unlike `mem::transmute`, a MIR `Transmute` is well-formed
            // for any two `Sized` types, just potentially UB to run.

            if (!this.tcx.normalize_erasing_regions(this.typing_env, Unnormalized.new_wip(op_ty), fold_Ty).is_sized(this.tcx, this.typing_env)) {
              this.fail(location, `Cannot transmute from non-\`Sized\` type ${display_Ty(op_ty)}`);
            }
            if (
              !this.tcx.normalize_erasing_regions(this.typing_env, Unnormalized.new_wip(target_type), fold_Ty).is_sized(this.tcx, this.typing_env)
            ) {
              this.fail(location, `Cannot transmute to non-\`Sized\` type ${debug_Ty(target_type, PLAIN)}`);
            }

            if (kind.$ === "BoxDerefTransmute") {
              if (!target_type.is_raw_ptr()) {
                this.fail(location, `Cannot BoxDerefTransmute to non-pointer type ${display_Ty(target_type)}`);
              }
            }
            break;
          }
          case "Subtype": {
            if (!sub_types(this.tcx, this.typing_env, op_ty, target_type)) {
              this.fail(location, `Failed subtyping ${display_Ty(op_ty)} and ${display_Ty(target_type)}`);
            }
            break;
          }
        }
        break;
      }
      case "Repeat":
      case "ThreadLocalRef":
      case "RawPtr":
      case "Discriminant":
        break;

      case "WrapUnsafeBinder": {
        const unwrapped_ty = Operand.ty(rvalue._0, this.body, this.tcx);
        const k = rvalue._1.kind();
        if (k.$ !== "UnsafeBinder") {
          this.fail(location, "WrapUnsafeBinder does not produce a ty::UnsafeBinder");
          return;
        }
        const binder_ty = k._0;
        const binder_inner_ty = this.tcx.instantiate_bound_regions_with_erased(UnsafeBinderInner_deref(binder_ty), fold_Ty);
        if (!this.mir_assign_valid_types(unwrapped_ty, binder_inner_ty)) {
          this.fail(location, `Cannot wrap ${display_Ty(unwrapped_ty)} into unsafe binder ${debug_UnsafeBinderInner(binder_ty, PLAIN)}`);
        }
        break;
      }
    }
    this.super_rvalue(rvalue, location);
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:1487 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    const kind = statement.kind;
    switch (kind.$) {
      case "Assign": {
        const [dest, rvalue] = kind._0;
        // LHS and RHS of the assignment must have the same type.
        const left_ty = dest.ty(this.body.local_decls, this.tcx).ty;
        const right_ty = Rvalue.ty(rvalue, this.body.local_decls, this.tcx);

        if (!this.mir_assign_valid_types(right_ty, left_ty)) {
          this.fail(
            location,
            `encountered \`${debug_StatementKind(statement.kind, PLAIN)}\` with incompatible types:\nleft-hand side has type: ${display_Ty(left_ty)}\nright-hand side has type: ${display_Ty(right_ty)}`,
          );
        }

        const local = dest.as_local();
        if (local !== undefined) {
          const local_info = this.body.local_decls[local]!.local_info;
          if (local_info.$ === "Set" && local_info._0.$ === "DerefTemp" && !(rvalue.$ === "CopyForDeref")) {
            this.fail(location, "assignment to a `DerefTemp` must use `CopyForDeref`");
          }
        }
        break;
      }
      case "AscribeUserType": {
        if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
          this.fail(location, "`AscribeUserType` should have been removed after drop lowering phase");
        }
        break;
      }
      case "FakeRead": {
        if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
          this.fail(location, "`FakeRead` should have been removed after drop lowering phase");
        }
        break;
      }
      case "Intrinsic": {
        const intrinsic = kind._0;
        switch (intrinsic.$) {
          case "Assume": {
            const ty = Operand.ty(intrinsic._0, this.body.local_decls, this.tcx);
            if (!ty.is_bool()) {
              this.fail(location, `\`assume\` argument must be \`bool\`, but got: \`${display_Ty(ty)}\``);
            }
            break;
          }
          case "CopyNonOverlapping": {
            const { src, dst, count } = intrinsic._0;
            const src_ty = Operand.ty(src, this.body.local_decls, this.tcx);
            const src_deref = src_ty.builtin_deref(true);
            let op_src_ty: Ty;
            if (src_deref !== undefined) {
              op_src_ty = src_deref;
            } else {
              this.fail(location, `Expected src to be ptr in copy_nonoverlapping, got: ${display_Ty(src_ty)}`);
              return;
            }
            const dst_ty = Operand.ty(dst, this.body.local_decls, this.tcx);
            const dst_deref = dst_ty.builtin_deref(true);
            let op_dst_ty: Ty;
            if (dst_deref !== undefined) {
              op_dst_ty = dst_deref;
            } else {
              this.fail(location, `Expected dst to be ptr in copy_nonoverlapping, got: ${display_Ty(dst_ty)}`);
              return;
            }
            // since CopyNonOverlapping is parametrized by 1 type,
            // we only need to check that they are equal and not keep an extra parameter.
            if (!this.mir_assign_valid_types(op_src_ty, op_dst_ty)) {
              this.fail(location, `bad arg (${display_Ty(op_src_ty)} != ${display_Ty(op_dst_ty)})`);
            }

            const op_cnt_ty = Operand.ty(count, this.body.local_decls, this.tcx);
            if (op_cnt_ty !== this.tcx.types.usize) {
              this.fail(location, `bad arg (${display_Ty(op_cnt_ty)} != usize)`);
            }
            break;
          }
        }
        break;
      }
      case "SetDiscriminant": {
        const place = kind.place;
        if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) < 0) {
          this.fail(location, "`SetDiscriminant`is not allowed until deaggregation");
        }
        const pty = place.ty(this.body.local_decls, this.tcx).ty;
        const pk = pty.kind();
        if (!(pk.$ === "Adt" || pk.$ === "Coroutine" || (pk.$ === "Alias" && pk._1.kind.$ === "Opaque"))) {
          this.fail(location, `\`SetDiscriminant\` is only allowed on ADTs and coroutines, not ${display_Ty(pty)}`);
        }
        break;
      }
      case "StorageLive":
      case "StorageDead":
      case "Coverage":
      case "ConstEvalCounter":
      case "PlaceMention":
      case "BackwardIncompatibleDropHint":
      case "Nop":
        break;
    }

    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:1604 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    const kind = terminator.kind;
    switch (kind.$) {
      case "SwitchInt": {
        const { targets, discr } = kind;
        const switch_ty = Operand.ty(discr, this.body.local_decls, this.tcx);

        const target_width = this.tcx.sess.target.pointer_width;

        const sk = switch_ty.kind();
        let bits: number;
        switch (sk.$) {
          case "Uint":
            bits = unwrap(UintTy.bit_width(UintTy.normalize(sk._0, target_width)));
            break;
          case "Int":
            bits = unwrap(IntTy.bit_width(IntTy.normalize(sk._0, target_width)));
            break;
          case "Char":
            bits = 32;
            break;
          case "Bool":
            bits = 1;
            break;
          default:
            // PORT: `{:?}` of the `TyKind` is `{:?}` of the `Ty` (`impl Debug for Ty` prints its kind; this runs
            // under `with_no_trimmed_paths!`).
            return bug(`unhandled type: ${debug_Ty(switch_ty, PLAIN)}`);
        }
        const size = Size.from_bits(bits);

        for (const [value] of targets.iter()) {
          if (ScalarInt.try_from_uint(value, size) === undefined) {
            this.fail(location, `the value 0x${value.toString(16)} is not a proper ${display_Ty(switch_ty)}`);
          }
        }
        break;
      }
      case "Call":
      case "TailCall": {
        const func_ty = Operand.ty(kind.func, this.body.local_decls, this.tcx);
        const fk = func_ty.kind();
        if (fk.$ === "FnPtr" || fk.$ === "FnDef") {
          // ok
        } else {
          this.fail(location, `encountered non-callable type ${display_Ty(func_ty)} in \`${TerminatorKind.name(terminator.kind)}\` terminator`);
        }

        if (terminator.kind.$ === "TailCall") {
          // FIXME(explicit_tail_calls): implement tail-call specific checks here (such
          // as signature matching, forbidding closures, etc)
        }
        break;
      }
      case "Assert": {
        const cond_ty = Operand.ty(kind.cond, this.body.local_decls, this.tcx);
        if (cond_ty !== this.tcx.types.bool) {
          this.fail(location, `encountered non-boolean condition of type ${display_Ty(cond_ty)} in \`Assert\` terminator`);
        }
        break;
      }
      case "Goto":
      case "Drop":
      case "Yield":
      case "FalseEdge":
      case "FalseUnwind":
      case "InlineAsm":
      case "CoroutineDrop":
      case "UnwindResume":
      case "UnwindTerminate":
      case "Return":
      case "Unreachable":
        break;
    }

    this.super_terminator(terminator, location);
  }

  // rustc: compiler/rustc_mir_transform/src/validate.rs:1673 visit_local_decl
  override visit_local_decl(local: Local, local_decl: LocalDecl): void {
    const local_info = local_decl.local_info;
    if (local_info.$ === "Set" && local_info._0.$ === "DerefTemp") {
      if (MirPhase_cmp(this.body.phase, RUNTIME_INITIAL) >= 0) {
        this.fail(BasicBlockC.start_location(START_BLOCK), "`DerefTemp` should have been removed in runtime MIR");
      } else if (local_decl.ty.builtin_deref(true) === undefined) {
        this.fail(BasicBlockC.start_location(START_BLOCK), "`DerefTemp` should only be used for dereferenceable types");
      }
    }

    this.super_local_decl(local, local_decl);
  }
}

/** `self.tcx.coroutine_layout(def_id, args).ok()`. */
function coroutine_layout_ok(tcx: TyCtxt, def_id: DefId, args: Parameters<TyCtxt["coroutine_layout"]>[1]): CoroutineLayout | undefined {
  const r = tcx.coroutine_layout(def_id, args);
  return r.$ === "Ok" ? r._0 : undefined;
}

/** `{:?}` of a `DefId`. */
function debug_DefId_(def_id: DefId): string {
  return debug_DefId(def_id, PLAIN);
}

// rustc: compiler/rustc_mir_transform/src/validate.rs:1692 validate_debuginfos
export function validate_debuginfos(body: Body): [Location, string][] {
  const debuginfo_checker = new DebuginfoChecker(debuginfo_locals(body), []);
  debuginfo_checker.visit_body(body);
  return debuginfo_checker.failures;
}

// rustc-type: compiler/rustc_mir_transform/src/validate.rs:1699 DebuginfoChecker
class DebuginfoChecker extends Visitor {
  constructor(
    public debuginfo_locals: DenseBitSet<Local>,
    public failures: [Location, string][],
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for DebuginfoChecker
  // rustc: compiler/rustc_mir_transform/src/validate.rs:1705 visit_statement_debuginfo
  override visit_statement_debuginfo(stmt_debuginfo: StmtDebugInfo, location: Location): void {
    let local: Local;
    switch (stmt_debuginfo.$) {
      case "AssignRef":
      case "InvalidAssign":
        local = stmt_debuginfo._0;
        break;
    }
    if (!this.debuginfo_locals.contains(local)) {
      this.failures.push([location, `${debug_Local(local, PLAIN)} is not in debuginfo`]);
    }
  }
}
