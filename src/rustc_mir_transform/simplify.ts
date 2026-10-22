// Port of compiler/rustc_mir_transform/src/simplify.rs (lane mt-skeleton).
//
// PORT: the pass enums `SimplifyCfg` / `SimplifyLocals` are classes with one frozen instance per variant, tagged `$`
// (pass_manager.ts header). `&mut BasicBlock` / `&mut bool` out-parameters are `MutRef`s (PORTING §8); a `&mut
// Terminator` that is replaced whole (`*terminator = ..`) is a `MutRef<Terminator>`, one that is edited in place is the
// object. `std::mem::take` of a field is: read it, store the `Default` value.
//! A number of passes which remove various redundancies in the CFG.
//!
//! The `SimplifyCfg` pass gets rid of unnecessary blocks in the CFG, whereas the `SimplifyLocals`
//! gets rid of all the unnecessary local variable declarations.
//!
//! The `SimplifyLocals` pass is kinda expensive and therefore not very suitable to be run often.
//! Most of the passes should not care or be impacted in meaningful ways due to extra locals
//! either, so running the pass once, right before codegen, should suffice.
//!
//! On the other side of the spectrum, the `SimplifyCfg` pass is considerably cheap to run, thus
//! one should run it after every pass which may modify CFG in significant ways. This pass must
//! also be run before any analysis passes because it removes dead blocks, and some of these can be
//! ill-typed.
//!
//! The cause of this typing issue is typeck allowing most blocks whose end is not reachable have
//! an arbitrary return type, rather than having the usual () return type (as a note, typeck's
//! notion of reachability is in fact slightly weaker than MIR CFG reachability - see #31617). A
//! standard example of the situation is:
//!
//! ```rust
//!   fn example() {
//!       let _a: char = { return; };
//!   }
//! ```
//!
//! Here the block (`{ return; }`) has the return type `char`, rather than `()`, but the MIR we
//! naively generate still contains the `_a = ()` write in the unreachable block "after" the
//! return.
//!
//! **WARNING**: This is one of the few optimizations that runs on built and analysis MIR, and
//! so its effects may affect the type-checking, borrow-checking, and other analysis of MIR.
//! We must be extremely careful to only apply optimizations that preserve UB and all
//! non-determinism, since changes here can affect which programs compile in an insta-stable way.
//! The normal logic that a program with UB can be changed to do anything does not apply to
//! pre-"runtime" MIR!
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import {
  BasicBlock,
  type BasicBlockData,
  type Body,
  Local,
  Location,
  OUTERMOST_SOURCE_SCOPE,
  type Place,
  RETURN_PLACE,
  Rvalue,
  SourceInfo,
  START_BLOCK,
  type Statement,
  StmtDebugInfos,
  type StmtDebugInfo,
  SwitchTargets,
  type Terminator,
  TerminatorKind,
} from "../rustc_middle/mir/mod.ts";
import * as traversal from "../rustc_middle/mir/traversal.ts";
import { MutVisitor, type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debuginfo_locals } from "../rustc_mir_dataflow/debuginfo.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { type MutRef, replace_in_place } from "../std/mut_ref.ts";
import { panic, unreachable, unwrap } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

/** `std::mem::take(&mut x.after_last_stmt_debuginfos)` (`StmtDebugInfos: Default` is `StmtDebugInfos(None)`). */
function take_debuginfos(data: BasicBlockData): StmtDebugInfos {
  const taken = data.after_last_stmt_debuginfos;
  data.after_last_stmt_debuginfos = new StmtDebugInfos(undefined);
  return taken;
}

// rustc-type: compiler/rustc_mir_transform/src/simplify.rs:50 SimplifyCfg
export type SimplifyCfg_variant =
  | "Initial"
  | "PromoteConsts"
  | "RemoveFalseEdges"
  /// Runs at the beginning of "analysis to runtime" lowering, *before* drop elaboration.
  | "PostAnalysis"
  /// Runs at the end of "analysis to runtime" lowering, *after* drop elaboration.
  /// This is before the main optimization passes on runtime MIR kick in.
  | "PreOptimizations"
  | "Final"
  | "MakeShim"
  | "AfterUnreachableEnumBranching";

export class SimplifyCfg extends MirPass {
  readonly type_name = "rustc_mir_transform::simplify::SimplifyCfg";

  private constructor(readonly $: SimplifyCfg_variant) {
    super();
    Object.freeze(this);
  }

  static readonly Initial = new SimplifyCfg("Initial");
  static readonly PromoteConsts = new SimplifyCfg("PromoteConsts");
  static readonly RemoveFalseEdges = new SimplifyCfg("RemoveFalseEdges");
  static readonly PostAnalysis = new SimplifyCfg("PostAnalysis");
  static readonly PreOptimizations = new SimplifyCfg("PreOptimizations");
  static readonly Final = new SimplifyCfg("Final");
  static readonly MakeShim = new SimplifyCfg("MakeShim");
  static readonly AfterUnreachableEnumBranching = new SimplifyCfg("AfterUnreachableEnumBranching");

  // impl SimplifyCfg { fn name(&self) } and impl MirPass for SimplifyCfg { fn name(&self) { self.name() } }: the
  // inherent fn takes precedence, so both are this method.
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:65 name
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:94 name
  override name(): string {
    switch (this.$) {
      case "Initial":
        return "SimplifyCfg-initial";
      case "PromoteConsts":
        return "SimplifyCfg-promote-consts";
      case "RemoveFalseEdges":
        return "SimplifyCfg-remove-false-edges";
      case "PostAnalysis":
        return "SimplifyCfg-post-analysis";
      case "PreOptimizations":
        return "SimplifyCfg-pre-optimizations";
      case "Final":
        return "SimplifyCfg-final";
      case "MakeShim":
        return "SimplifyCfg-make_shim";
      case "AfterUnreachableEnumBranching": {
        return "SimplifyCfg-after-unreachable-enum-branching";
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:98 policy
  policy(_ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(true);
  }

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:102 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // debug!("SimplifyCfg({:?}) - simplifying {:?}", self.name(), body.source);
    simplify_cfg(tcx, body);
  }
}

// rustc: compiler/rustc_mir_transform/src/simplify.rs:81 simplify_cfg
export function simplify_cfg(tcx: TyCtxt, body: Body): void {
  if (CfgSimplifier.new(tcx, body).simplify()) {
    // `simplify` returns that it changed something. We must invalidate the CFG caches as they
    // are not consistent with the modified CFG any more.
    body.basic_blocks.invalidate_cfg_cache();
  }
  remove_dead_blocks(body);

  // FIXME: Should probably be moved into some kind of pass manager
  // body.basic_blocks.as_mut_preserves_cfg().shrink_to_fit();  (capacity only)
  body.basic_blocks.as_mut_preserves_cfg();
}

// rustc-type: compiler/rustc_mir_transform/src/simplify.rs:108 CfgSimplifier
class CfgSimplifier {
  constructor(
    public preserve_switch_reads: boolean,
    public basic_blocks: BasicBlockData[],
    public pred_count: number[],
  ) {}

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:115 new
  static new(tcx: TyCtxt, body: Body): CfgSimplifier {
    const pred_count: number[] = new Array<number>(body.basic_blocks.deref().length).fill(0);

    // we can't use mir.predecessors() here because that counts
    // dead blocks, which we don't want to.
    pred_count[START_BLOCK] = 1;

    for (const [, data] of traversal.preorder(body)) {
      const term = data.terminator;
      if (term !== undefined) {
        for (const tgt of term.successors()) {
          pred_count[tgt]! += 1;
        }
      }
    }

    // Preserve `SwitchInt` reads on built and analysis MIR, or if `-Zmir-preserve-ub`.
    const preserve_switch_reads = body.phase.$ === "Built" || body.phase.$ === "Analysis" || tcx.sess.opts.unstable_opts.mir_preserve_ub;
    // Do not clear caches yet. The caller to `simplify` will do it if anything changed.
    const basic_blocks = body.basic_blocks.as_mut_preserves_cfg();

    return new CfgSimplifier(preserve_switch_reads, basic_blocks, pred_count);
  }

  /// Returns whether we actually simplified anything. In that case, the caller *must* invalidate
  /// the CFG caches of the MIR body.
  // #[must_use]
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:142 simplify
  simplify(): boolean {
    this.strip_nops();

    // Vec of the blocks that should be merged. We store the indices here, instead of the
    // statements itself to avoid moving the (relatively) large statements twice.
    // We do not push the statements directly into the target block (`bb`) as that is slower
    // due to additional reallocations
    const merged_blocks: BasicBlock[] = [];
    let outer_changed = false;
    for (;;) {
      const changed: MutRef<boolean> = { value: false };

      for (let i = 0; i < this.basic_blocks.length; i++) {
        const bb = BasicBlock.new(i);
        if (this.pred_count[bb] === 0) {
          continue;
        }

        // debug!("simplifying {:?}", bb);

        const terminator: MutRef<Terminator> = { value: unwrap(this.basic_blocks[bb]!.terminator, "invalid terminator state") };
        this.basic_blocks[bb]!.terminator = undefined;

        terminator.value.successors_mut((successor) => {
          this.collapse_goto_chain(successor, changed);
        });

        let inner_changed = true;
        merged_blocks.length = 0;
        while (inner_changed) {
          inner_changed = false;
          inner_changed = this.simplify_branch(terminator.value) || inner_changed;
          inner_changed = this.merge_successor(merged_blocks, terminator) || inner_changed;
          changed.value = changed.value || inner_changed;
        }

        let statements_to_merge = 0;
        for (const i of merged_blocks) statements_to_merge += this.basic_blocks[i]!.statements.length;

        if (statements_to_merge > 0) {
          const statements = this.basic_blocks[bb]!.statements;
          this.basic_blocks[bb]!.statements = [];
          // statements.reserve(statements_to_merge);  (capacity only)
          let parent_bb_last_debuginfos = take_debuginfos(this.basic_blocks[bb]!);
          for (const from of merged_blocks) {
            const stmt = this.basic_blocks[from]!.statements[0];
            if (stmt !== undefined) {
              stmt.debuginfos.prepend(parent_bb_last_debuginfos);
            }
            // statements.append(&mut self.basic_blocks[from].statements);
            const from_statements = this.basic_blocks[from]!.statements;
            for (const s of from_statements) statements.push(s);
            from_statements.length = 0;
            parent_bb_last_debuginfos = take_debuginfos(this.basic_blocks[from]!);
          }
          this.basic_blocks[bb]!.statements = statements;
          this.basic_blocks[bb]!.after_last_stmt_debuginfos = parent_bb_last_debuginfos;
        }

        this.basic_blocks[bb]!.terminator = terminator.value;
      }

      if (!changed.value) {
        break;
      }

      outer_changed = true;
    }

    return outer_changed;
  }

  /// This function will return `None` if
  /// * the block has statements
  /// * the block has a terminator other than `goto`
  /// * the block has no terminator (meaning some other part of the current optimization stole it)
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:214 take_terminator_if_simple_goto
  take_terminator_if_simple_goto(bb: BasicBlock): Terminator | undefined {
    const data = this.basic_blocks[bb]!;
    const terminator = data.terminator;
    if (terminator !== undefined && terminator.kind.$ === "Goto" && data.statements.length === 0) {
      data.terminator = undefined;
      return terminator;
    }
    // if `terminator` is None, this means we are in a loop. In that
    // case, let all the loop collapse to its entry.
    return undefined;
  }

  /// Collapse a goto chain starting from `start`
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:229 collapse_goto_chain
  collapse_goto_chain(start: MutRef<BasicBlock>, changed: MutRef<boolean>): void {
    // Using `SmallVec` here, because in some logs on libcore oli-obk saw many single-element
    // goto chains. We should probably benchmark different sizes.
    const terminators: [BasicBlock, Terminator][] = [];
    let current = start.value;
    // If each successor has only one predecessor, it's a trivial goto chain.
    // We can move all debuginfos to the last basic block.
    let trivial_goto_chain = true;
    let terminator: Terminator | undefined;
    while ((terminator = this.take_terminator_if_simple_goto(current)) !== undefined) {
      if (terminator.kind.$ !== "Goto") {
        unreachable();
      }
      const target = terminator.kind.target;
      trivial_goto_chain = trivial_goto_chain && this.pred_count[target] === 1;
      terminators.push([current, terminator]);
      current = target;
    }
    const last = current;
    changed.value = changed.value || start.value !== last;
    start.value = last;
    let popped: [BasicBlock, Terminator] | undefined;
    while ((popped = terminators.pop()) !== undefined) {
      const [current, terminator] = popped;
      const kind = terminator.kind;
      if (kind.$ !== "Goto") {
        unreachable();
      }
      if (trivial_goto_chain) {
        const pred_debuginfos = take_debuginfos(this.basic_blocks[current]!);
        const first = this.basic_blocks[last]!.statements[0];
        let debuginfos: StmtDebugInfos;
        if (first !== undefined) {
          debuginfos = first.debuginfos;
        } else {
          debuginfos = this.basic_blocks[last]!.after_last_stmt_debuginfos;
        }
        debuginfos.prepend(pred_debuginfos);
      }
      changed.value = changed.value || kind.target !== last;
      kind.target = last;
      // debug!("collapsing goto chain from {:?} to {:?}", current, target);

      if (this.pred_count[current] === 1) {
        // This is the last reference to current, so the pred-count to
        // to target is moved into the current block.
        this.pred_count[current] = 0;
      } else {
        this.pred_count[kind.target]! += 1;
        this.pred_count[current]! -= 1;
      }
      this.basic_blocks[current]!.terminator = terminator;
    }
  }

  // merge a block with 1 `goto` predecessor to its parent
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:281 merge_successor
  merge_successor(merged_blocks: BasicBlock[], terminator: MutRef<Terminator>): boolean {
    const kind = terminator.value.kind;
    let target: BasicBlock;
    if (kind.$ === "Goto" && this.pred_count[kind.target] === 1) {
      target = kind.target;
    } else {
      return false;
    }

    // debug!("merging block {:?} into {:?}", target, terminator);
    const taken = this.basic_blocks[target]!.terminator;
    this.basic_blocks[target]!.terminator = undefined;
    if (taken !== undefined) {
      terminator.value = taken;
    } else {
      // unreachable loop - this should not be possible, as we
      // don't strand blocks, but handle it correctly.
      return false;
    }

    merged_blocks.push(target);
    this.pred_count[target] = 0;

    return true;
  }

  // turn a branch with all successors identical to a goto
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:308 simplify_branch
  simplify_branch(terminator: Terminator): boolean {
    // Removing a `SwitchInt` terminator may remove reads that result in UB,
    // so we must not apply this optimization before borrowck or when
    // `-Zmir-preserve-ub` is set.
    if (this.preserve_switch_reads) {
      return false;
    }

    if (terminator.kind.$ !== "SwitchInt") {
      return false;
    }

    // `Itertools::all_equal_value`: `Ok(first)` if there is a first element and every element equals it.
    const succs = terminator.successors();
    const first = succs.next();
    if (first.done) {
      return false;
    }
    const first_succ = first.value;
    for (const s of succs) {
      if (s !== first_succ) {
        return false;
      }
    }

    const count = terminator.successors().len();
    this.pred_count[first_succ]! -= count - 1;

    // debug!("simplifying branch {:?}", terminator);
    terminator.kind = TerminatorKind.goto(first_succ);
    return true;
  }

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:332 strip_nops
  strip_nops(): void {
    for (const blk of this.basic_blocks) {
      blk.strip_nops();
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/simplify.rs:339 simplify_duplicate_switch_targets
export function simplify_duplicate_switch_targets(terminator: Terminator): void {
  const kind = terminator.kind;
  if (kind.$ === "SwitchInt") {
    const targets = kind.targets;
    const otherwise = targets.otherwise();
    if ([...targets.iter()].some((t) => t[1] === otherwise)) {
      kind.targets = SwitchTargets.new(
        [...targets.iter()].filter((t) => t[1] !== otherwise),
        targets.otherwise(),
      );
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/simplify.rs:351 remove_dead_blocks
export function remove_dead_blocks(body: Body): void {
  const should_deduplicate_unreachable = (bbdata: BasicBlockData): boolean => {
    // CfgSimplifier::simplify leaves behind some unreachable basic blocks without a
    // terminator. Those blocks will be deleted by remove_dead_blocks, but we run just
    // before then so we need to handle missing terminators.
    // We also need to prevent confusing cleanup and non-cleanup blocks. In practice we
    // don't emit empty unreachable cleanup blocks, so this simple check suffices.
    return bbdata.terminator !== undefined && bbdata.is_empty_unreachable() && !bbdata.is_cleanup;
  };

  const reachable = traversal.reachable_as_bitset(body);
  let empty_unreachable_blocks = 0;
  const blocks = body.basic_blocks.deref();
  for (let i = 0; i < blocks.length; i++) {
    if (should_deduplicate_unreachable(blocks[i]!) && reachable.contains(BasicBlock.new(i))) {
      empty_unreachable_blocks += 1;
    }
  }

  const num_blocks = blocks.length;
  if (num_blocks === reachable.count() && empty_unreachable_blocks <= 1) {
    return;
  }

  const basic_blocks = body.basic_blocks.as_mut();

  const replacements: BasicBlock[] = [];
  for (let i = 0; i < num_blocks; i++) replacements.push(BasicBlock.new(i));
  let orig_index = 0;
  let used_index = 0;
  let kept_unreachable: BasicBlock | undefined;
  let deduplicated_unreachable = false;
  // basic_blocks.raw.retain(|bbdata| { .. })
  const retain = (bbdata: BasicBlockData): boolean => {
    const orig_bb = BasicBlock.new(orig_index);
    if (!reachable.contains(orig_bb)) {
      orig_index += 1;
      return false;
    }

    const used_bb = BasicBlock.new(used_index);
    if (should_deduplicate_unreachable(bbdata)) {
      if (kept_unreachable === undefined) kept_unreachable = used_bb;
      const kept_unreachable_ = kept_unreachable;
      if (kept_unreachable_ !== used_bb) {
        replacements[orig_index] = kept_unreachable_;
        deduplicated_unreachable = true;
        orig_index += 1;
        return false;
      }
    }

    replacements[orig_index] = used_bb;
    used_index += 1;
    orig_index += 1;
    return true;
  };
  let w = 0;
  for (let r = 0; r < basic_blocks.length; r++) {
    const bbdata = basic_blocks[r]!;
    if (retain(bbdata)) basic_blocks[w++] = bbdata;
  }
  basic_blocks.length = w;

  // If we deduplicated unreachable blocks we erase their source_info as we
  // can no longer attribute their code to a particular location in the
  // source.
  if (deduplicated_unreachable) {
    basic_blocks[unwrap(kept_unreachable)]!.terminator_mut().source_info = new SourceInfo(DUMMY_SP, OUTERMOST_SOURCE_SCOPE);
  }

  for (const block of basic_blocks) {
    block.terminator_mut().successors_mut((target) => {
      target.value = replacements[BasicBlock.index(target.value)]!;
    });
  }
}

// rustc-type: compiler/rustc_mir_transform/src/simplify.rs:417 SimplifyLocals
export type SimplifyLocals_variant = "BeforeConstProp" | "AfterGVN" | "Final";

export class SimplifyLocals extends MirPass {
  readonly type_name = "rustc_mir_transform::simplify::SimplifyLocals";

  private constructor(readonly $: SimplifyLocals_variant) {
    super();
    Object.freeze(this);
  }

  static readonly BeforeConstProp = new SimplifyLocals("BeforeConstProp");
  static readonly AfterGVN = new SimplifyLocals("AfterGVN");
  static readonly Final = new SimplifyLocals("Final");

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:424 name
  override name(): string {
    switch (this.$) {
      case "BeforeConstProp":
        return "SimplifyLocals-before-const-prop";
      case "AfterGVN":
        return "SimplifyLocals-after-value-numbering";
      case "Final":
        return "SimplifyLocals-final";
    }
  }

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:432 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 1);
  }

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:436 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // trace!("running SimplifyLocals on {:?}", body.source);

    // First, we're going to get a count of *actual* uses for every `Local`.
    const used_locals = UsedLocals.new(body);

    // Next, we're going to remove any `Local` with zero actual uses. When we remove those
    // `Locals`, we're also going to subtract any uses of other `Locals` from the `used_locals`
    // count. For example, if we removed `_2 = discriminant(_1)`, then we'll subtract one from
    // `use_counts[_1]`. That in turn might make `_1` unused, so we loop until we hit a
    // fixedpoint where there are no more unused locals.
    remove_unused_definitions_helper(used_locals, body);

    // Finally, we'll actually do the work of shrinking `body.local_decls` and remapping the
    // `Local`s.
    const map = make_local_map(body.local_decls, used_locals);

    // Only bother running the `LocalUpdater` if we actually found locals to remove.
    if (map.some((l) => l === undefined)) {
      // Update references to all vars and tmps now
      const updater = new LocalUpdater(map, tcx);
      updater.visit_body_preserves_cfg(body);

      // body.local_decls.shrink_to_fit();  (capacity only)
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/simplify.rs:464 remove_unused_definitions
export function remove_unused_definitions(body: Body): void {
  // First, we're going to get a count of *actual* uses for every `Local`.
  const used_locals = UsedLocals.new(body);

  // Next, we're going to remove any `Local` with zero actual uses. When we remove those
  // `Locals`, we're also going to subtract any uses of other `Locals` from the `used_locals`
  // count. For example, if we removed `_2 = discriminant(_1)`, then we'll subtract one from
  // `use_counts[_1]`. That in turn might make `_1` unused, so we loop until we hit a
  // fixedpoint where there are no more unused locals.
  remove_unused_definitions_helper(used_locals, body);
}

/// Construct the mapping while swapping out unused stuff out from the `vec`.
// rustc: compiler/rustc_mir_transform/src/simplify.rs:477 make_local_map
function make_local_map<V>(local_decls: V[], used_locals: UsedLocals): (Local | undefined)[] {
  const map: (Local | undefined)[] = new Array<Local | undefined>(local_decls.length).fill(undefined);
  let used = Local.ZERO;

  for (let i = 0; i < local_decls.length; i++) {
    const alive_index = Local.new(i);
    // `is_used` treats the `RETURN_PLACE` and arguments as used.
    if (!used_locals.is_used(alive_index)) {
      continue;
    }

    map[alive_index] = used;
    if (alive_index !== used) {
      const tmp = local_decls[alive_index]!;
      local_decls[alive_index] = local_decls[used]!;
      local_decls[used] = tmp;
    }
    // used.increment_by(1);
    used = Local.new(Local.index(used) + 1);
  }
  local_decls.length = Local.index(used);
  return map;
}

// rustc-type: compiler/rustc_mir_transform/src/simplify.rs:501 UsedLocals
/// Keeps track of used & unused locals.
class UsedLocals extends Visitor {
  constructor(
    public increment: boolean,
    public use_count: number[],
    public always_used: DenseBitSet<Local>,
  ) {
    super();
  }

  /// Determines which locals are used & unused in the given body.
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:509 new
  static new(body: Body): UsedLocals {
    const always_used = debuginfo_locals(body);
    always_used.insert(RETURN_PLACE);
    for (const arg of body.args_iter()) {
      always_used.insert(arg);
    }
    const this_ = new UsedLocals(true, new Array<number>(body.local_decls.length).fill(0), always_used);
    this_.visit_body(body);
    return this_;
  }

  /// Checks if local is used.
  ///
  /// Return place, arguments, var debuginfo are always considered used.
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:527 is_used
  is_used(local: Local): boolean {
    // trace!("is_used({:?}): use_count: {:?}, always_used: {}", local, self.use_count[local], self.always_used.contains(local));
    // To keep things simple, we don't handle debugging information here, these are in DSE.
    return this.always_used.contains(local) || this.use_count[local] !== 0;
  }

  /// Updates the use counts to reflect the removal of given statement.
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:539 statement_removed
  statement_removed(statement: Statement): void {
    this.increment = false;

    // The location of the statement is irrelevant.
    const location = Location.START;
    this.visit_statement(statement, location);
  }

  /// Visits a left-hand side of an assignment.
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:548 visit_lhs
  visit_lhs(place: Place, location: Location): void {
    if (place.is_indirect()) {
      // A use, not a definition.
      this.visit_place(place, { $: "MutatingUse", _0: "Store" }, location);
    } else {
      // A definition. The base local itself is not visited, so this occurrence is not counted
      // toward its use count. There might be other locals still, used in an indexing
      // projection.
      this.super_projection(place.as_ref(), { $: "MutatingUse", _0: "Projection" }, location);
    }
  }

  // impl<'tcx> Visitor<'tcx> for UsedLocals
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:566 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    const kind = statement.kind;
    switch (kind.$) {
      case "Intrinsic":
      case "Coverage":
      case "FakeRead":
      case "PlaceMention":
      case "AscribeUserType": {
        this.super_statement(statement, location);
        break;
      }

      case "ConstEvalCounter":
      case "Nop":
      case "StorageLive":
      case "StorageDead":
        break;
      case "Assign": {
        const [place, rvalue] = kind._0;
        if (Rvalue.is_safe_to_remove(rvalue)) {
          this.visit_lhs(place, location);
          this.visit_rvalue(rvalue, location);
        } else {
          this.super_statement(statement, location);
        }
        break;
      }

      case "SetDiscriminant":
      case "BackwardIncompatibleDropHint": {
        this.visit_lhs(kind.place, location);
        break;
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:596 visit_local
  override visit_local(local: Local, ctx: PlaceContext, _location: Location): void {
    if (ctx.$ === "NonUse") {
      return;
    }
    if (this.increment) {
      this.use_count[local]! += 1;
    } else {
      if (this.use_count[local] === 0) {
        panic(`assertion \`left != right\` failed\n  left: 0\n right: 0`);
      }
      this.use_count[local]! -= 1;
    }
  }
}

/// Removes unused definitions. Updates the used locals to reflect the changes made.
// rustc: compiler/rustc_mir_transform/src/simplify.rs:610 remove_unused_definitions_helper
function remove_unused_definitions_helper(used_locals: UsedLocals, body: Body): void {
  // The use counts are updated as we remove the statements. A local might become unused
  // during the retain operation, leading to a temporary inconsistency (storage statements or
  // definitions referencing the local might remain). For correctness it is crucial that this
  // computation reaches a fixed point.

  let modified = true;
  while (modified) {
    modified = false;

    for (const data of body.basic_blocks.as_mut_preserves_cfg()) {
      // Remove unnecessary StorageLive and StorageDead annotations.
      for (const statement of data.statements) {
        let keep_statement: boolean;
        const kind = statement.kind;
        switch (kind.$) {
          case "StorageLive":
          case "StorageDead": {
            keep_statement = used_locals.is_used(kind._0);
            break;
          }
          case "Assign":
            keep_statement = used_locals.is_used(kind._0[0].local);
            break;
          case "SetDiscriminant":
          case "BackwardIncompatibleDropHint": {
            keep_statement = used_locals.is_used(kind.place.local);
            break;
          }
          default:
            continue;
        }
        if (keep_statement) {
          continue;
        }
        // trace!("removing statement {:?}", statement);
        modified = true;
        used_locals.statement_removed(statement);
        statement.make_nop(true);
      }
      data.strip_nops();
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/simplify.rs:647 LocalUpdater
class LocalUpdater extends MutVisitor {
  constructor(
    public map: (Local | undefined)[],
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
  ) {
    super();
  }

  // impl<'tcx> MutVisitor<'tcx> for LocalUpdater<'tcx>
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:653 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:657 visit_statement_debuginfo
  override visit_statement_debuginfo(stmt_debuginfo: StmtDebugInfo, location: Location): void {
    switch (stmt_debuginfo.$) {
      case "AssignRef": {
        const local = stmt_debuginfo._0;
        const place = stmt_debuginfo._1;
        let any = false;
        for (const local_ of place.as_ref().accessed_locals()) {
          if (this.map[local_] === undefined) {
            any = true;
            break;
          }
        }
        if (any) {
          replace_in_place<StmtDebugInfo>(stmt_debuginfo, { $: "InvalidAssign", _0: local });
        }
        break;
      }
      case "InvalidAssign":
        break;
    }
    this.super_statement_debuginfo(stmt_debuginfo, location);
  }

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:673 visit_local
  override visit_local(l: MutRef<Local>, _ctx: PlaceContext, _location: Location): void {
    l.value = unwrap(this.map[l.value]);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/simplify.rs:678 UsedInStmtLocals
export class UsedInStmtLocals extends Visitor {
  constructor(public locals: DenseBitSet<Local>) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:683 new
  static new(body: Body): UsedInStmtLocals {
    const this_ = new UsedInStmtLocals(DenseBitSet.new_empty<Local>(body.local_decls.length));
    this_.visit_body(body);
    return this_;
  }

  // rustc: compiler/rustc_mir_transform/src/simplify.rs:689 remove_unused_storage_annotations
  remove_unused_storage_annotations(body: Body): void {
    for (const data of body.basic_blocks.as_mut_preserves_cfg()) {
      // Remove unnecessary StorageLive and StorageDead annotations.
      for (const statement of data.statements) {
        let keep_statement: boolean;
        const kind = statement.kind;
        switch (kind.$) {
          case "StorageLive":
          case "StorageDead": {
            keep_statement = this.locals.contains(kind._0);
            break;
          }
          default:
            continue;
        }
        if (keep_statement) {
          continue;
        }
        statement.make_nop(true);
      }
    }
  }

  // impl<'tcx> Visitor<'tcx> for UsedInStmtLocals
  // rustc: compiler/rustc_mir_transform/src/simplify.rs:709 visit_local
  override visit_local(local: Local, context: PlaceContext, _location: Location): void {
    if (context.$ === "NonUse") {
      return;
    }
    this.locals.insert(local);
  }
}
