// Port of compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs: DECLARED (lane dataflow-contract). Every fn is a
// stub for lane `dataflow-impls` (plan-m4 §5 wave 22).
//
// How to fill a stub: replace the body with the upstream logic and turn `// stub-df: <path>:<line> <name> (lane ..)` into
// the marker `// rustc: <path>:<line> <name>`. Notes:
// - The three analyses extend `AnalysisBase<DenseBitSet<Local>>` (framework/mod.ts).
// - PORT: `Cow<'a, DenseBitSet<Local>>` is the `DenseBitSet<Local>` (ownership erased; nobody mutates it).
// - `KillableLocals = FxHashMap<Location, SmallVec<[Local; 4]>>` is a `KeyedMap<Location, Local[]>` keyed by
//   `KillableLocals_key` (PORTING §5 composite keys); `.entry(loc).or_default().push(l)` gets-or-inserts `[]`.
// - The struct `KillableLocalsVisitor` and its `Visitor` impl are local to `MaybeRequiresStorage::new` upstream; they
//   are declared at module level until the fill lane moves them inside `new`. PORT(contract): extends mir Visitor
//   (pending mir-contract, D4): `visit_local` overrides mir-contract's `Visitor` (`visit_basic_block_data` from it).

import type { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { unported } from "../../std/panic.ts";
import type { ResultsCursor } from "../framework/cursor.ts";
import { DebugWithContext_Local } from "../framework/fmt.ts";
import { AnalysisBase, type Domain, Domain_DenseBitSet } from "../framework/mod.ts";
import type { Results } from "../framework/results.ts";
import type { BasicBlock, Body, CallReturnPlaces, Local, Location, Statement, Terminator } from "../pending.ts";
import type { MaybeBorrowedLocals } from "./borrowed_locals.ts";

// PORT(contract): pending mir-contract (mir/visit.rs `PlaceContext`).
type PlaceContext = { readonly __pending_mir: "PlaceContext" };

/// The set of locals in a MIR body that do not have `StorageLive`/`StorageDead` annotations.
///
/// These locals have fixed storage for the duration of the body.
// stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:15 always_storage_live_locals (lane dataflow-impls)
export function always_storage_live_locals(_body: Body): DenseBitSet<Local> {
  return unported("rustc_mir_dataflow::impls::storage_liveness::always_storage_live_locals");
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:29 MaybeStorageLive
export class MaybeStorageLive extends AnalysisBase<DenseBitSet<Local>> {
  constructor(public always_live_locals: DenseBitSet<Local>) {
    super();
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:34 new (lane dataflow-impls)
  static new(_always_live_locals: DenseBitSet<Local>): MaybeStorageLive {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeStorageLive::new");
  }

  // ---- impl Analysis for MaybeStorageLive ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);

  readonly NAME = "maybe_storage_live";

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:44 bottom_value (lane dataflow-impls)
  bottom_value(_body: Body): DenseBitSet<Local> {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeStorageLive::bottom_value");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:49 initialize_start_block (lane dataflow-impls)
  initialize_start_block(_body: Body, _state: DenseBitSet<Local>): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeStorageLive::initialize_start_block");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:57 apply_primary_statement_effect (lane dataflow-impls)
  apply_primary_statement_effect(_state: DenseBitSet<Local>, _stmt: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeStorageLive::apply_primary_statement_effect");
  }
}

// rustc-type: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:71 MaybeStorageDead
export class MaybeStorageDead extends AnalysisBase<DenseBitSet<Local>> {
  constructor(public always_live_locals: DenseBitSet<Local>) {
    super();
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:76 new (lane dataflow-impls)
  static new(_always_live_locals: DenseBitSet<Local>): MaybeStorageDead {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeStorageDead::new");
  }

  // ---- impl Analysis for MaybeStorageDead ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);

  readonly NAME = "maybe_storage_dead";

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:86 bottom_value (lane dataflow-impls)
  bottom_value(_body: Body): DenseBitSet<Local> {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeStorageDead::bottom_value");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:91 initialize_start_block (lane dataflow-impls)
  initialize_start_block(_body: Body, _state: DenseBitSet<Local>): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeStorageDead::initialize_start_block");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:101 apply_primary_statement_effect (lane dataflow-impls)
  apply_primary_statement_effect(_state: DenseBitSet<Local>, _stmt: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeStorageDead::apply_primary_statement_effect");
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

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:126 new (lane dataflow-impls)
  static new(_body: Body, _borrowed_locals: Results<DenseBitSet<Local>, MaybeBorrowedLocals>): MaybeRequiresStorage {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeRequiresStorage::new");
  }

  // ---- impl Analysis for MaybeRequiresStorage ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);

  readonly NAME = "requires_storage";

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:164 bottom_value (lane dataflow-impls)
  bottom_value(_body: Body): DenseBitSet<Local> {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeRequiresStorage::bottom_value");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:169 initialize_start_block (lane dataflow-impls)
  initialize_start_block(_body: Body, _state: DenseBitSet<Local>): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeRequiresStorage::initialize_start_block");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:177 apply_early_statement_effect (lane dataflow-impls)
  override apply_early_statement_effect(_state: DenseBitSet<Local>, _stmt: Statement, _loc: Location): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeRequiresStorage::apply_early_statement_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:210 apply_primary_statement_effect (lane dataflow-impls)
  apply_primary_statement_effect(_state: DenseBitSet<Local>, _stmt: Statement, _loc: Location): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeRequiresStorage::apply_primary_statement_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:243 apply_early_terminator_effect (lane dataflow-impls)
  override apply_early_terminator_effect(_state: DenseBitSet<Local>, _terminator: Terminator, _loc: Location): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeRequiresStorage::apply_early_terminator_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:298 apply_primary_terminator_effect (lane dataflow-impls)
  override apply_primary_terminator_effect(_state: DenseBitSet<Local>, _terminator: Terminator, _loc: Location): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeRequiresStorage::apply_primary_terminator_effect");
  }

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:338 apply_call_return_effect (lane dataflow-impls)
  override apply_call_return_effect(_state: DenseBitSet<Local>, _block: BasicBlock, _return_places: CallReturnPlaces): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeRequiresStorage::apply_call_return_effect");
  }

  /// Kill locals that are fully moved and have not been borrowed.
  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:350 check_for_move (lane dataflow-impls)
  check_for_move(_state: DenseBitSet<Local>, _loc: Location): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeRequiresStorage::check_for_move");
  }
}

// (local to `MaybeRequiresStorage::new` upstream, see the header)
// rustc-type: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:130 KillableLocalsVisitor
class KillableLocalsVisitor {
  constructor(
    public borrowed_locals_cursor: ResultsCursor<DenseBitSet<Local>, MaybeBorrowedLocals>,
    public killable_locals: KillableLocals,
  ) {}

  // ---- impl Visitor for KillableLocalsVisitor ----

  // stub-df: compiler/rustc_mir_dataflow/src/impls/storage_liveness.rs:136 visit_local (lane dataflow-impls)
  visit_local(_local: Local, _context: PlaceContext, _loc: Location): void {
    return unported("rustc_mir_dataflow::impls::storage_liveness::MaybeRequiresStorage::new::KillableLocalsVisitor::visit_local");
  }
}

/** Keeps the module-private declarations referenced for the fill lane. */
export const _storage_liveness_decls = { KillableLocals_key, KillableLocalsVisitor, KeyedMap };
