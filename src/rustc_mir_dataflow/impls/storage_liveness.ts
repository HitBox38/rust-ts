// Port of compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs (declared by lane dataflow-contract, filled by lane
// dataflow-impls). Notes:
// - The three analyses extend `AnalysisBase<DenseBitSet<Local>>` (framework/mod.ts).
// - PORT: `Cow<'a, DenseBitSet<Local>>` is the `DenseBitSet<Local>` (ownership erased; nobody mutates it).
// - `KillableLocals = FxHashMap<Location, SmallVec<[Local; 4]>>` is a `KeyedMap<Location, Local[]>` keyed by
//   `KillableLocals_key` (PORTING §5 composite keys); `.entry(loc).or_default().push(l)` gets-or-inserts `[]`.
// - The struct `KillableLocalsVisitor` and its `Visitor` impl are local to `MaybeRequiresStorage::new`, as upstream.

import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { assert_eq } from "../../std/panic.ts";
import { ResultsCursor } from "../framework/cursor.ts";
import { DebugWithContext_Local } from "../framework/fmt.ts";
import { AnalysisBase, type Domain, Domain_DenseBitSet, GenKill_DenseBitSet } from "../framework/mod.ts";
import type { Results } from "../framework/results.ts";
import { type BasicBlock, type Body, CallReturnPlaces, type Local, type Location, type Statement, type Terminator, traversal } from "../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../rustc_middle/mir/visit.ts";
import { MaybeBorrowedLocals } from "./borrowed_locals.ts";

const GK = GenKill_DenseBitSet<Local>();

/// The set of locals in a MIR body that do not have `StorageLive`/`StorageDead` annotations.
///
/// These locals have fixed storage for the duration of the body.
// rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:15 always_storage_live_locals
export function always_storage_live_locals(body: Body): DenseBitSet<Local> {
  const always_live_locals = DenseBitSet.new_filled<Local>(body.local_decls.length);

  for (const block of body.basic_blocks.deref()) {
    for (const statement of block.statements) {
      if (statement.kind.$ === "StorageLive" || statement.kind.$ === "StorageDead") {
        const l = statement.kind._0;
        always_live_locals.remove(l);
      }
    }
  }

  return always_live_locals;
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:29 MaybeStorageLive
export class MaybeStorageLive extends AnalysisBase<DenseBitSet<Local>> {
  constructor(public always_live_locals: DenseBitSet<Local>) {
    super();
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:34 new
  static new(always_live_locals: DenseBitSet<Local>): MaybeStorageLive {
    return new MaybeStorageLive(always_live_locals);
  }

  // ---- impl Analysis for MaybeStorageLive ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);

  readonly NAME = "maybe_storage_live";

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:44 bottom_value
  bottom_value(body: Body): DenseBitSet<Local> {
    // bottom = dead
    return DenseBitSet.new_empty<Local>(body.local_decls.length);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:49 initialize_start_block
  initialize_start_block(body: Body, state: DenseBitSet<Local>): void {
    state.union(this.always_live_locals);

    for (const arg of body.args_iter()) {
      state.insert(arg);
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:57 apply_primary_statement_effect
  apply_primary_statement_effect(state: DenseBitSet<Local>, stmt: Statement, _2: Location): void {
    switch (stmt.kind.$) {
      case "StorageLive":
        GK.gen_(state, stmt.kind._0);
        break;
      case "StorageDead":
        GK.kill(state, stmt.kind._0);
        break;
      default:
        break;
    }
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:71 MaybeStorageDead
export class MaybeStorageDead extends AnalysisBase<DenseBitSet<Local>> {
  constructor(public always_live_locals: DenseBitSet<Local>) {
    super();
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:76 new
  static new(always_live_locals: DenseBitSet<Local>): MaybeStorageDead {
    return new MaybeStorageDead(always_live_locals);
  }

  // ---- impl Analysis for MaybeStorageDead ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);

  readonly NAME = "maybe_storage_dead";

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:86 bottom_value
  bottom_value(body: Body): DenseBitSet<Local> {
    // bottom = live
    return DenseBitSet.new_empty<Local>(body.local_decls.length);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:91 initialize_start_block
  initialize_start_block(body: Body, state: DenseBitSet<Local>): void {
    assert_eq(body.local_decls.length, this.always_live_locals.domain_size(), String);
    // Do not iterate on return place and args, as they are trivially always live.
    for (const local of body.vars_and_temps_iter()) {
      if (!this.always_live_locals.contains(local)) {
        state.insert(local);
      }
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:101 apply_primary_statement_effect
  apply_primary_statement_effect(state: DenseBitSet<Local>, stmt: Statement, _2: Location): void {
    switch (stmt.kind.$) {
      case "StorageLive":
        GK.kill(state, stmt.kind._0);
        break;
      case "StorageDead":
        GK.gen_(state, stmt.kind._0);
        break;
      default:
        break;
    }
  }
}

/// For each location, records which locals can be killed by `MaybeRequiresStorage`.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:116 KillableLocals
type KillableLocals = KeyedMap<Location, Local[]>;
/** The key of a `Location` in `KillableLocals` (derived `Hash` + `Eq`). */
function KillableLocals_key(loc: Location): string {
  return `${loc.block}:${loc.statement_index}`;
}

/// Dataflow analysis that determines whether each local requires storage at a
/// given location; i.e. whether its storage can go away without being observed.
// rustc-type: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:120 MaybeRequiresStorage
export class MaybeRequiresStorage extends AnalysisBase<DenseBitSet<Local>> {
  constructor(
    /// Used to kill locals that are fully moved and have not been borrowed.
    public killable_locals: KillableLocals,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:126 new
  static new(body: Body, borrowed_locals: Results<DenseBitSet<Local>, MaybeBorrowedLocals>): MaybeRequiresStorage {
    // rustc-type: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:130 KillableLocalsVisitor
    class KillableLocalsVisitor extends Visitor {
      constructor(
        public borrowed_locals_cursor: ResultsCursor<DenseBitSet<Local>, MaybeBorrowedLocals>,
        public killable_locals: KillableLocals,
      ) {
        super();
      }

      // ---- impl Visitor for KillableLocalsVisitor ----

      // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:136 visit_local
      override visit_local(local: Local, context: PlaceContext, loc: Location): void {
        if (context.$ === "NonMutatingUse" && context._0 === "Move") {
          this.borrowed_locals_cursor.seek_before_primary_effect(loc);
          if (!this.borrowed_locals_cursor.get().contains(local)) {
            let v = this.killable_locals.get(loc);
            if (v === undefined) {
              v = [];
              this.killable_locals.set(loc, v);
            }
            v.push(local);
          }
        }
      }
    }

    const visitor = new KillableLocalsVisitor(
      ResultsCursor.new_borrowing(body, borrowed_locals),
      new KeyedMap<Location, Local[]>(KillableLocals_key),
    );

    for (const [bb, data] of traversal.reachable(body)) {
      visitor.visit_basic_block_data(bb, data);
    }

    return new MaybeRequiresStorage(visitor.killable_locals);
  }

  // ---- impl Analysis for MaybeRequiresStorage ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);

  readonly NAME = "requires_storage";

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:164 bottom_value
  bottom_value(body: Body): DenseBitSet<Local> {
    // bottom = dead
    return DenseBitSet.new_empty<Local>(body.local_decls.length);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:169 initialize_start_block
  initialize_start_block(body: Body, state: DenseBitSet<Local>): void {
    // The resume argument is live on function entry (we don't care about
    // the `self` argument)
    for (const arg of body.args_iter().slice(1)) {
      state.insert(arg);
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:177 apply_early_statement_effect
  override apply_early_statement_effect(state: DenseBitSet<Local>, stmt: Statement, _loc: Location): void {
    // If a place is borrowed in a statement, it needs storage for that statement.
    MaybeBorrowedLocals.gen_statement(state, stmt);

    const kind = stmt.kind;
    switch (kind.$) {
      case "StorageDead":
        GK.kill(state, kind._0);
        break;

      case "Assign": {
        const place = kind._0[0];
        GK.gen_(state, place.local);
        break;
      }
      case "SetDiscriminant": {
        GK.gen_(state, kind.place.local);
        break;
      }

      // Nothing to do for these. Match exhaustively so this fails to compile when new
      // variants are added.
      case "AscribeUserType":
      case "PlaceMention":
      case "Coverage":
      case "FakeRead":
      case "ConstEvalCounter":
      case "Nop":
      case "Intrinsic":
      case "BackwardIncompatibleDropHint":
      case "StorageLive":
        break;
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:210 apply_primary_statement_effect
  apply_primary_statement_effect(state: DenseBitSet<Local>, stmt: Statement, loc: Location): void {
    // If we move from a place then it only stops needing storage *after* that statement.
    this.check_for_move(state, loc);

    const kind = stmt.kind;
    switch (kind.$) {
      // If a place is assigned to in a statement, it needs storage after that statement.
      // Even if the place was moved from in the rvalue (e.g. `x = x + 1` or `x = f(move x)`),
      // the assignment restores a valid value into the place.
      case "Assign": {
        const place = kind._0[0];
        GK.gen_(state, place.local);
        break;
      }
      case "SetDiscriminant": {
        GK.gen_(state, kind.place.local);
        break;
      }

      case "StorageDead":
      case "AscribeUserType":
      case "PlaceMention":
      case "Coverage":
      case "FakeRead":
      case "ConstEvalCounter":
      case "Nop":
      case "Intrinsic":
      case "BackwardIncompatibleDropHint":
      case "StorageLive":
        break;
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:243 apply_early_terminator_effect
  override apply_early_terminator_effect(state: DenseBitSet<Local>, terminator: Terminator, _loc: Location): void {
    // If a place is borrowed in a terminator, it needs storage for that terminator.
    MaybeBorrowedLocals.gen_terminator(state, terminator);

    const kind = terminator.kind;
    switch (kind.$) {
      case "Call": {
        GK.gen_(state, kind.destination.local);
        break;
      }

      // Note that we do *not* gen the `resume_arg` of `Yield` terminators. The reason for
      // that is that a `yield` will return from the function, and `resume_arg` is written
      // only when the coroutine is later resumed. Unlike `Call`, this doesn't require the
      // place to have storage *before* the yield, only after.
      case "Yield":
        break;

      case "InlineAsm": {
        for (const op of kind.operands) {
          switch (op.$) {
            case "Out":
            case "InOut": {
              const place = op.$ === "Out" ? op.place : op.out_place;
              if (place !== undefined) {
                GK.gen_(state, place.local);
              }
              break;
            }
            case "In":
            case "Const":
            case "SymFn":
            case "SymStatic":
            case "Label":
              break;
          }
        }
        break;
      }

      // Nothing to do for these. Match exhaustively so this fails to compile when new
      // variants are added.
      case "UnwindTerminate":
      case "Assert":
      case "Drop":
      case "FalseEdge":
      case "FalseUnwind":
      case "CoroutineDrop":
      case "Goto":
      case "UnwindResume":
      case "Return":
      case "TailCall":
      case "SwitchInt":
      case "Unreachable":
        break;
    }
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:298 apply_primary_terminator_effect
  override apply_primary_terminator_effect(state: DenseBitSet<Local>, terminator: Terminator, loc: Location): void {
    const kind = terminator.kind;
    switch (kind.$) {
      // For call terminators the destination requires storage for the call
      // and after the call returns successfully, but not after a panic.
      // Since `propagate_call_unwind` doesn't exist, we have to kill the
      // destination here, and then gen it again in `call_return_effect`.
      case "Call": {
        GK.kill(state, kind.destination.local);
        break;
      }

      // The same applies to InlineAsm outputs.
      case "InlineAsm": {
        CallReturnPlaces.for_each({ $: "InlineAsm", _0: kind.operands }, (place) => GK.kill(state, place.local));
        break;
      }

      // Nothing to do for these. Match exhaustively so this fails to compile when new
      // variants are added.
      case "Yield":
      case "UnwindTerminate":
      case "Assert":
      case "Drop":
      case "FalseEdge":
      case "FalseUnwind":
      case "CoroutineDrop":
      case "Goto":
      case "UnwindResume":
      case "Return":
      case "TailCall":
      case "SwitchInt":
      case "Unreachable":
        break;
    }

    this.check_for_move(state, loc);
  }

  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:338 apply_call_return_effect
  override apply_call_return_effect(state: DenseBitSet<Local>, _block: BasicBlock, return_places: CallReturnPlaces): void {
    CallReturnPlaces.for_each(return_places, (place) => GK.gen_(state, place.local));
  }

  /// Kill locals that are fully moved and have not been borrowed.
  // rustc: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:350 check_for_move
  check_for_move(state: DenseBitSet<Local>, loc: Location): void {
    const locals = this.killable_locals.get(loc);
    if (locals !== undefined) {
      for (const l of locals) {
        GK.kill(state, l);
      }
    }
  }
}
