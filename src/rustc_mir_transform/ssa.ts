// Port of compiler/rustc_mir_transform/src/ssa.rs (lane mt-opt1).
//
// PORT: `IndexVec<Local, Set1<DefLocation>>` is a `Set1<DefLocation>[]`; `Set1::insert(&mut self, ..)` takes a `{ value }`
// view onto the slot (`field_mut(assignments, local)`) and the derived `PartialEq` of `DefLocation` (`DefLocation_eq`).
// `SsaLocals::assignments` returns the filtered items as an array (the iterator is consumed at once by its callers).
// `std::mem::take(&mut ssa.direct_uses)` reads the vector and leaves an empty one. `#[cfg(debug_assertions)]` blocks
// are kept as comments (rustc ships without debug assertions). `MaybeUninitializedLocals` extends `AnalysisBase`
// (rustc_mir_dataflow framework/mod.ts), as the dataflow impls do.
//! We denote as "SSA" the set of locals that verify the following properties:
//! 1/ They are only assigned-to once, either as a function parameter, or in an assign statement;
//! 2/ This single assignment dominates all uses;
//!
//! As we do not track indirect assignments, a local that has its address taken (via a borrow or raw
//! borrow operator) is considered non-SSA. However, it is UB to modify through an immutable borrow
//! of a `Freeze` local. Those can still be considered to be SSA.
import type { Dominators } from "../rustc_data_structures/graph/dominators/mod.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { IndexVec } from "../rustc_index/vec.ts";
import { debug_Set1, Set1 } from "../rustc_middle/middle/resolve_bound_vars.ts";
import {
  type BasicBlock,
  type Body,
  CallReturnPlaces,
  DefLocation,
  debug_DefLocation,
  type Local,
  Location,
  type Place,
  RETURN_PLACE,
  type Rvalue,
  type Statement,
  StatementKind,
  traversal,
} from "../rustc_middle/mir/mod.ts";
import { type PlaceContext, PlaceContext as PlaceContextC, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { TypingEnv } from "../rustc_middle/ty/mod.ts";
import { DebugWithContext_Local } from "../rustc_mir_dataflow/framework/fmt.ts";
import { AnalysisBase, type Domain, Domain_DenseBitSet } from "../rustc_mir_dataflow/framework/mod.ts";
import { bug } from "../rustc_span/macros.ts";
import { type Debug, debug_list, debug_struct } from "../std/fmt.ts";
import { field_mut } from "../std/mut_ref.ts";
import { assert } from "../std/panic.ts";

/** PORT: the derived `PartialEq` of `Location` (header). */
function Location_eq(a: Location, b: Location): boolean {
  return a.block === b.block && a.statement_index === b.statement_index;
}

/** PORT: the derived `PartialEq` of `DefLocation` (header). */
function DefLocation_eq(a: DefLocation, b: DefLocation): boolean {
  switch (a.$) {
    case "Argument":
      return b.$ === "Argument";
    case "Assignment":
      return b.$ === "Assignment" && Location_eq(a._0, b._0);
    case "CallReturn":
      return b.$ === "CallReturn" && a.call === b.call && a.target === b.target;
  }
}

// rustc-type: compiler/rustc_mir_transform/src/ssa.rs:20 SsaLocals
export class SsaLocals {
  constructor(
    /// Assignments to each local. This defines whether the local is SSA.
    public assignments_: Set1<DefLocation>[],
    /// We visit the body in reverse postorder, to ensure each local is assigned before it is used.
    /// We remember the order in which we saw the assignments to compute the SSA values in a single
    /// pass.
    public assignment_order: Local[],
    /// Copy equivalence classes between locals. See `copy_classes` for documentation.
    public copy_classes_: Local[],
    /// Number of "direct" uses of each local, i.e. uses that are not dereferences.
    /// We ignore non-uses (Storage statements, debuginfo).
    public direct_uses: number[],
    /// Set of SSA locals that are immutably borrowed.
    public borrowed_locals_: DenseBitSet<Local>,
  ) {}

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:37 new
  static new(tcx: TyCtxt, body: Body, typing_env: TypingEnv): SsaLocals {
    const assignment_order: Local[] = [];

    const assignments = IndexVec.from_elem<Set1<DefLocation>, unknown>(Set1.Empty, body.local_decls);
    const dominators = body.basic_blocks.dominators();

    const direct_uses = IndexVec.from_elem(0, body.local_decls);
    const borrowed_locals = DenseBitSet.new_empty<Local>(body.local_decls.length);
    const visitor = new SsaVisitor(body, dominators, assignments, assignment_order, direct_uses, borrowed_locals);

    for (const local of body.args_iter()) {
      visitor.assignments[local] = { $: "One", _0: DefLocation.Argument };
      visitor.assignment_order.push(local);
    }

    // For SSA assignments, a RPO visit will see the assignment before it sees any use.
    // We only visit reachable nodes: computing `dominates` on an unreachable node ICEs.
    for (const [bb, data] of traversal.reverse_postorder(body)) {
      visitor.visit_basic_block_data(bb, data);
    }

    for (const var_debug_info of body.var_debug_info) {
      visitor.visit_var_debug_info(var_debug_info);
    }

    // The immutability of shared borrows only works on `Freeze` locals. If the visitor found
    // borrows, we need to check the types. For raw pointers and mutable borrows, the locals
    // have already been marked as non-SSA.
    // debug!(?visitor.borrowed_locals);
    for (const local of visitor.borrowed_locals.iter()) {
      if (!body.local_decls[local]!.ty.is_freeze(tcx, typing_env)) {
        visitor.assignments[local] = Set1.Many;
      }
    }

    // debug!(?visitor.assignments);
    // debug!(?visitor.direct_uses);

    const kept = visitor.assignment_order.filter((local) => visitor.assignments[local]!.$ === "One");
    visitor.assignment_order.length = 0;
    visitor.assignment_order.push(...kept);
    // debug!(?visitor.assignment_order);

    const ssa = new SsaLocals(
      visitor.assignments,
      visitor.assignment_order,
      // This is filled by `compute_copy_classes`.
      [],
      visitor.direct_uses,
      visitor.borrowed_locals,
    );
    compute_copy_classes(ssa, body);
    return ssa;
  }

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:103 num_locals
  num_locals(): number {
    return this.assignments_.length;
  }

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:107 locals
  *locals(): Generator<Local, undefined, unknown> {
    for (let l = 0; l < this.assignments_.length; l++) yield l as Local;
    return undefined;
  }

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:111 is_ssa
  is_ssa(local: Local): boolean {
    return this.assignments_[local]!.$ === "One";
  }

  /// Return the number of uses if a local that are not "Deref".
  // rustc: compiler/rustc_mir_transform/src/ssa.rs:116 num_direct_uses
  num_direct_uses(local: Local): number {
    return this.direct_uses[local]!;
  }

  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/ssa.rs:121 assignment_dominates
  assignment_dominates(dominators: Dominators<BasicBlock>, local: Local, location: Location): boolean {
    const a = this.assignments_[local]!;
    switch (a.$) {
      case "One":
        return DefLocation.dominates(a._0, location, dominators);
      default:
        return false;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:133 assignments
  assignments(body: Body): [Local, Rvalue, Location][] {
    const out: [Local, Rvalue, Location][] = [];
    for (const local of this.assignment_order) {
      const a = this.assignments_[local]!;
      if (a.$ === "One" && a._0.$ === "Assignment") {
        const loc = a._0._0;
        const stmt_ = body.stmt_at(loc);
        if (stmt_.$ !== "Left") continue;
        const stmt = stmt_._0;
        // `loc` must point to a direct assignment to `local`.
        const assign = StatementKind.as_assign(stmt.kind);
        if (assign === undefined) return bug();
        const [target, rvalue] = assign;
        assert(target.as_local() === local, "assertion `left == right` failed");
        out.push([local, rvalue, loc]);
      }
    }
    return out;
  }

  /// Compute the equivalence classes for locals, based on copy statements.
  ///
  /// The returned vector maps each local to the one it copies. In the following case:
  ///   _a = &mut _0
  ///   _b = move? _a
  ///   _c = move? _a
  ///   _d = move? _c
  /// We return the mapping
  ///   _a => _a // not a copy so, represented by itself
  ///   _b => _a
  ///   _c => _a
  ///   _d => _a // transitively through _c
  ///
  /// Exception: we do not see through the return place, as it cannot be instantiated.
  // rustc: compiler/rustc_mir_transform/src/ssa.rs:164 copy_classes
  copy_classes(): readonly Local[] {
    return this.copy_classes_;
  }

  /// Set of SSA locals that are immutably borrowed.
  // rustc: compiler/rustc_mir_transform/src/ssa.rs:169 borrowed_locals
  borrowed_locals(): DenseBitSet<Local> {
    return this.borrowed_locals_;
  }

  /// Make a property uniform on a copy equivalence class by removing elements.
  // rustc: compiler/rustc_mir_transform/src/ssa.rs:174 meet_copy_equivalence
  meet_copy_equivalence(property: DenseBitSet<Local>): void {
    // Consolidate to have a local iff all its copies are.
    //
    // `copy_classes` defines equivalence classes between locals. The `local`s that recursively
    // move/copy the same local all have the same `head`.
    this.copy_classes_.forEach((head, local) => {
      // If any copy does not have `property`, then the head is not.
      if (!property.contains(local as Local)) {
        property.remove(head);
      }
    });
    this.copy_classes_.forEach((head, local) => {
      // If any copy does not have `property`, then the head doesn't either,
      // then no copy has `property`.
      if (!property.contains(head)) {
        property.remove(local as Local);
      }
    });

    // Verify that we correctly computed equivalence classes.
    // #[cfg(debug_assertions)]
    // for (local, &head) in self.copy_classes.iter_enumerated() {
    //     assert_eq!(property.contains(local), property.contains(head));
    // }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/ssa.rs:201 SsaVisitor
class SsaVisitor extends Visitor {
  constructor(
    public body: Body,
    public dominators: Dominators<BasicBlock>,
    public assignments: Set1<DefLocation>[],
    public assignment_order: Local[],
    public direct_uses: number[],
    // Track locals that are immutably borrowed, so we can check their type is `Freeze` later.
    public borrowed_locals: DenseBitSet<Local>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:212 check_dominates
  check_dominates(local: Local, loc: Location): void {
    const set = this.assignments[local]!;
    let assign_dominates: boolean;
    switch (set.$) {
      case "Empty":
      case "Many":
        assign_dominates = false;
        break;
      case "One":
        assign_dominates = DefLocation.dominates(set._0, loc, this.dominators);
        break;
    }
    // We are visiting a use that is not dominated by an assignment.
    // Either there is a cycle involved, or we are reading for uninitialized local.
    // Bail out.
    if (!assign_dominates) {
      this.assignments[local] = Set1.Many;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:228 visit_local
  override visit_local(local: Local, ctxt: PlaceContext, loc: Location): void {
    if (PlaceContextC.may_observe_address(ctxt)) {
      this.borrowed_locals.insert(local);
    }
    switch (ctxt.$) {
      case "MutatingUse":
        if (ctxt._0 === "Projection") return bug();
        // Anything can happen with raw pointers, so remove them.
        this.assignments[local] = Set1.Many;
        break;
      case "NonMutatingUse":
        if (ctxt._0 === "Projection") return bug();
        if (ctxt._0 === "RawBorrow") {
          // Anything can happen with raw pointers, so remove them.
          this.assignments[local] = Set1.Many;
        } else if (ctxt._0 === "SharedBorrow" || ctxt._0 === "FakeBorrow") {
          // Immutable borrows are ok, but we need to delay a check that the type is `Freeze`.
          this.check_dominates(local, loc);
          this.direct_uses[local]! += 1;
        } else {
          this.check_dominates(local, loc);
          this.direct_uses[local]! += 1;
        }
        break;
      case "NonUse":
        break;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:255 visit_place
  override visit_place(place: Place, ctxt: PlaceContext, loc: Location): void {
    let location: DefLocation | undefined;
    if (ctxt.$ === "MutatingUse" && ctxt._0 === "Store") {
      location = { $: "Assignment", _0: loc };
    } else if (ctxt.$ === "MutatingUse" && ctxt._0 === "Call") {
      const call = loc.block;
      const kind = this.body.basic_blocks.deref()[call]!.terminator_().kind;
      if (kind.$ !== "Call") {
        return bug();
      }
      location = { $: "CallReturn", call, target: kind.target };
    } else {
      location = undefined;
    }
    const local = place.as_local();
    if (location !== undefined && local !== undefined) {
      Set1.insert(field_mut(this.assignments, local), location, DefLocation_eq);
      if (this.assignments[local]!.$ === "One") {
        // Only record if SSA-like, to avoid growing the vector needlessly.
        this.assignment_order.push(local);
      }
    } else if (place.projection[0]?.$ === "Deref") {
      // Do not do anything for debuginfo.
      if (PlaceContextC.is_use(ctxt)) {
        // Only change the context if it is a real use, not a "use" in debuginfo.
        const new_ctxt: PlaceContext = { $: "NonMutatingUse", _0: "Copy" };

        this.visit_projection(place.as_ref(), new_ctxt, loc);
        this.check_dominates(place.local, loc);
      }
    } else {
      this.visit_projection(place.as_ref(), ctxt, loc);
      this.visit_local(place.local, ctxt, loc);
    }
  }
}

// #[instrument(level = "trace", skip(ssa, body))]
// rustc: compiler/rustc_mir_transform/src/ssa.rs:296 compute_copy_classes
function compute_copy_classes(ssa: SsaLocals, body: Body): void {
  const direct_uses = ssa.direct_uses;
  ssa.direct_uses = [];
  const copies = IndexVec.from_fn_n<Local, Local>((l) => l, body.local_decls.length);

  for (const [local, rvalue, _] of ssa.assignments(body)) {
    if (!(rvalue.$ === "Use" && (rvalue._0.$ === "Copy" || rvalue._0.$ === "Move"))) {
      continue;
    }
    const place = rvalue._0._0;

    const rhs = place.as_local();
    if (rhs === undefined) continue;
    const local_ty = body.local_decls[local]!.ty;
    const rhs_ty = body.local_decls[rhs]!.ty;
    if (local_ty !== rhs_ty) {
      // FIXME(#112651): This can be removed afterwards.
      // trace!("skipped `{local:?} = {rhs:?}` due to subtyping: {local_ty} != {rhs_ty}");
      continue;
    }

    if (!ssa.is_ssa(rhs)) {
      continue;
    }

    // We visit in `assignment_order`, i.e. reverse post-order, so `rhs` has been
    // visited before `local`, and we just have to copy the representing local.
    const head = copies[rhs]!;

    // When propagating from `head` to `local` we need to ensure that changes to the address
    // are not observable, so at most one the locals involved can be borrowed. Additionally, we
    // need to ensure that the definition of `head` dominates all uses of `local`. When `local`
    // is borrowed, there might exist an indirect use of `local` that isn't dominated by the
    // definition, so we have to reject copy propagation.
    if (ssa.borrowed_locals().contains(local)) {
      continue;
    }

    if (local === RETURN_PLACE) {
      // `_0` is special, we cannot rename it. Instead, rename the class of `rhs` to
      // `RETURN_PLACE`. This is only possible if the class head is a temporary, not an
      // argument.
      if (body.local_kind(head) !== "Temp") {
        continue;
      }
      for (let i = 0; i < copies.length; i++) {
        if (copies[i] === head) {
          copies[i] = RETURN_PLACE;
        }
      }
    } else {
      copies[local] = head;
    }
    direct_uses[rhs]! -= 1;
  }

  // debug!(?copies);
  // debug!(?direct_uses);

  // Invariant: `copies` must point to the head of an equivalence class.
  // #[cfg(debug_assertions)]
  // for &head in copies.iter() {
  //     assert_eq!(copies[head], head);
  // }
  // debug_assert_eq!(copies[RETURN_PLACE], RETURN_PLACE);

  ssa.direct_uses = direct_uses;
  ssa.copy_classes_ = copies;
}

// rustc-type: compiler/rustc_mir_transform/src/ssa.rs:364 StorageLiveLocals
// #[derive(Debug)]
export class StorageLiveLocals {
  constructor(
    /// Set of "StorageLive" statements for each local.
    public storage_live: Set1<DefLocation>[],
  ) {}

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:370 new
  static new(body: Body, always_storage_live_locals: DenseBitSet<Local>): StorageLiveLocals {
    const storage_live = IndexVec.from_elem<Set1<DefLocation>, unknown>(Set1.Empty, body.local_decls);
    for (const local of always_storage_live_locals.iter()) {
      storage_live[local] = { $: "One", _0: DefLocation.Argument };
    }
    const blocks = body.basic_blocks.deref();
    for (let block = 0; block < blocks.length; block++) {
      const bbdata = blocks[block]!;
      bbdata.statements.forEach((statement: Statement, statement_index: number) => {
        if (statement.kind.$ === "StorageLive") {
          const local = statement.kind._0;
          Set1.insert(
            field_mut(storage_live, local),
            { $: "Assignment", _0: new Location(block as BasicBlock, statement_index) },
            DefLocation_eq,
          );
        }
      });
    }
    // debug!(?storage_live);
    return new StorageLiveLocals(storage_live);
  }

  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/ssa.rs:391 has_single_storage
  has_single_storage(local: Local): boolean {
    return this.storage_live[local]!.$ === "One";
  }
}
export const debug_StorageLiveLocals: Debug<StorageLiveLocals> = (v, f) =>
  debug_struct(f, "StorageLiveLocals", [
    ["storage_live", debug_list(f, v.storage_live.map((s) => debug_Set1(s, f, debug_DefLocation)))],
  ]);

/// A dataflow analysis that tracks locals that are maybe uninitialized.
///
/// This is a simpler analysis than `MaybeUninitializedPlaces`, because it does not track
/// individual fields.
// rustc-type: compiler/rustc_mir_transform/src/ssa.rs:400 MaybeUninitializedLocals
export class MaybeUninitializedLocals extends AnalysisBase<DenseBitSet<Local>> {
  // ---- impl Analysis for MaybeUninitializedLocals ----

  // type Domain = DenseBitSet<Local>;
  readonly Domain: Domain<DenseBitSet<Local>> = Domain_DenseBitSet(DebugWithContext_Local);

  readonly NAME = "maybe_uninit_locals";

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:407 bottom_value
  bottom_value(body: Body): DenseBitSet<Local> {
    // bottom = all locals are initialized.
    return DenseBitSet.new_empty<Local>(body.local_decls.length);
  }

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:412 initialize_start_block
  initialize_start_block(body: Body, state: DenseBitSet<Local>): void {
    // All locals start as uninitialized...
    state.insert_all();
    // ...except for arguments, which are definitely initialized.
    for (const arg of body.args_iter()) {
      state.remove(arg);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:421 apply_primary_statement_effect
  apply_primary_statement_effect(state: DenseBitSet<Local>, statement: Statement, _location: Location): void {
    const kind = statement.kind;
    switch (kind.$) {
      // An assignment makes a local initialized.
      case "Assign": {
        const local = kind._0[0].as_local();
        if (local !== undefined) {
          state.remove(local);
        }
        break;
      }
      // Storage{Live,Dead} makes a local uninitialized.
      case "StorageLive":
      case "StorageDead":
        state.insert(kind._0);
        break;
      default:
        break;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/ssa.rs:442 apply_call_return_effect
  override apply_call_return_effect(state: DenseBitSet<Local>, _block: BasicBlock, return_places: CallReturnPlaces): void {
    // The return place of a call is initialized.
    CallReturnPlaces.for_each(return_places, (place) => {
      const local = place.as_local();
      if (local !== undefined) {
        state.remove(local);
      }
    });
  }
}
