// Port of compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs (lane borrowck-contract: declarations; fill
// lane bck-polonius-legacy, wave 26, plan-m4 D7).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// PORT: `LoanInvalidationsGenerator` is a hand class extending mir/visit.ts's `Visitor`.
import type { Dominators } from "../../../rustc_data_structures/graph/dominators/mod.ts";
import {
  BasicBlock,
  type Body,
  BorrowKind,
  type Location,
  type Operand,
  type Place,
  Place_from_Local,
  type Rvalue,
  type Statement,
  type Terminator,
} from "../../../rustc_middle/mir/mod.ts";
import { Visitor } from "../../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { ControlFlow } from "../../../rustc_ast_ir/visit.ts";
import { bug } from "../../../rustc_span/macros.ts";
import { assert } from "../../../std/panic.ts";
import type { BorrowSet } from "../../borrow_set.gen.ts";
import type { BorrowIndex } from "../../dataflow.gen.ts";
import { AccessDepth, LocalMutationIsAllowed, type ReadOrWrite, ReadKind, WriteKind } from "../../lib.gen.ts";
import { borrow_of_local_data, each_borrow_involving_path, is_active } from "../../path_utils.ts";
import type { PoloniusFacts } from "./facts.gen.ts";
import type { PoloniusLocationTable } from "./location.gen.ts";

export * from "./loan_invalidations.gen.ts";

/// Emit `loan_invalidated_at` facts.
// rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:19 emit_loan_invalidations
export function emit_loan_invalidations(tcx: TyCtxt, facts: PoloniusFacts, body: Body, location_table: PoloniusLocationTable, borrow_set: BorrowSet): void {
  const dominators = body.basic_blocks.dominators();
  const visitor = new LoanInvalidationsGenerator(tcx, facts, body, location_table, dominators, borrow_set);
  visitor.visit_body(body);
}

// rustc-type: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:32 LoanInvalidationsGenerator
export class LoanInvalidationsGenerator extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public facts: PoloniusFacts,
    public body: Body,
    public location_table: PoloniusLocationTable,
    public dominators: Dominators<BasicBlock>,
    public borrow_set: BorrowSet,
  ) {
    super();
  }

  /// Visits the whole MIR and generates `invalidates()` facts.
  /// Most of the code implementing this was stolen from `borrow_check/mod.rs`.
  // impl Visitor for LoanInvalidationsGenerator
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:44 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    this.check_activations(location);

    const kind = statement.kind;
    switch (kind.$) {
      case "Assign": {
        const [lhs, rhs] = kind._0;
        this.consume_rvalue(location, rhs);

        this.mutate_place(location, lhs, { $: "Shallow", _0: undefined });
        break;
      }
      case "FakeRead": {
        // Only relevant for initialized/liveness/safety checks.
        break;
      }
      case "Intrinsic": {
        const intrinsic = kind._0;
        switch (intrinsic.$) {
          case "Assume": {
            const op = intrinsic._0;
            this.consume_operand(location, op);
            break;
          }
          case "CopyNonOverlapping": {
            const { src, dst, count } = intrinsic._0;
            this.consume_operand(location, src);
            this.consume_operand(location, dst);
            this.consume_operand(location, count);
            break;
          }
        }
        break;
      }
      // Only relevant for mir typeck
      case "AscribeUserType":
      // Only relevant for liveness and unsafeck
      case "PlaceMention":
      // Doesn't have any language semantics
      case "Coverage":
      // Does not actually affect borrowck
      case "StorageLive":
      // Does not affect borrowck
      case "BackwardIncompatibleDropHint":
        break;
      case "StorageDead": {
        const local = kind._0;
        this.access_place(
          location,
          Place_from_Local(local),
          [{ $: "Shallow", _0: undefined }, { $: "Write", _0: WriteKind.StorageDeadOrDrop }],
          LocalMutationIsAllowed.Yes,
        );
        break;
      }
      case "ConstEvalCounter":
      case "Nop":
      case "SetDiscriminant":
        bug("Statement not allowed in this MIR phase");
    }

    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:94 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    this.check_activations(location);

    const kind = terminator.kind;
    switch (kind.$) {
      case "SwitchInt": {
        const discr = kind.discr;
        this.consume_operand(location, discr);
        break;
      }
      case "Drop": {
        const { place: drop_place, replace } = kind;
        const write_kind = replace ? WriteKind.Replace : WriteKind.StorageDeadOrDrop;
        this.access_place(location, drop_place, [AccessDepth.Drop, { $: "Write", _0: write_kind }], LocalMutationIsAllowed.Yes);
        break;
      }
      case "Call": {
        const { func, args, destination } = kind;
        this.consume_operand(location, func);
        for (const arg of args) {
          this.consume_operand(location, arg.node);
        }
        this.mutate_place(location, destination, AccessDepth.Deep);
        break;
      }
      case "TailCall": {
        const { func, args } = kind;
        this.consume_operand(location, func);
        for (const arg of args) {
          this.consume_operand(location, arg.node);
        }
        break;
      }
      case "Assert": {
        const { cond, msg } = kind;
        this.consume_operand(location, cond);
        if (msg.$ === "BoundsCheck") {
          const { len, index } = msg;
          this.consume_operand(location, len);
          this.consume_operand(location, index);
        }
        break;
      }
      case "Yield": {
        const { value, resume, resume_arg } = kind;
        this.consume_operand(location, value);

        // Invalidate all borrows of local places
        const borrow_set = this.borrow_set;
        const resume_ = this.location_table.start_index(BasicBlock.start_location(resume));
        for (const [i, data] of borrow_set.iter_enumerated()) {
          if (borrow_of_local_data(data.borrowed_place)) {
            this.facts.loan_invalidated_at.push([resume_, i]);
          }
        }

        this.mutate_place(location, resume_arg, AccessDepth.Deep);
        break;
      }
      case "UnwindResume":
      case "Return":
      case "CoroutineDrop": {
        // Invalidate all borrows of local places
        const borrow_set = this.borrow_set;
        const start = this.location_table.start_index(location);
        for (const [i, data] of borrow_set.iter_enumerated()) {
          if (borrow_of_local_data(data.borrowed_place)) {
            this.facts.loan_invalidated_at.push([start, i]);
          }
        }
        break;
      }
      case "InlineAsm": {
        const operands = kind.operands;
        for (const op of operands) {
          switch (op.$) {
            case "In": {
              const value = op.value;
              this.consume_operand(location, value);
              break;
            }
            case "Out": {
              const place = op.place;
              if (place !== undefined) {
                this.mutate_place(location, place, { $: "Shallow", _0: undefined });
              }
              break;
            }
            case "InOut": {
              const { in_value, out_place } = op;
              this.consume_operand(location, in_value);
              if (out_place !== undefined) {
                this.mutate_place(location, out_place, { $: "Shallow", _0: undefined });
              }
              break;
            }
            case "Const":
            case "SymFn":
            case "SymStatic":
            case "Label":
              break;
          }
        }
        break;
      }
      case "Goto":
      case "UnwindTerminate":
      case "Unreachable":
      case "FalseEdge":
      case "FalseUnwind":
        // no data used, thus irrelevant to borrowck
        break;
    }

    this.super_terminator(terminator, location);
  }

  // impl LoanInvalidationsGenerator
  /// Simulates mutation of a place.
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:213 mutate_place
  mutate_place(location: Location, place: Place, kind: AccessDepth): void {
    this.access_place(location, place, [kind, { $: "Write", _0: WriteKind.Mutate }], LocalMutationIsAllowed.ExceptUpvars);
  }

  /// Simulates consumption of an operand.
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:223 consume_operand
  consume_operand(location: Location, operand: Operand): void {
    switch (operand.$) {
      case "Copy": {
        const place = operand._0;
        this.access_place(location, place, [AccessDepth.Deep, { $: "Read", _0: ReadKind.Copy }], LocalMutationIsAllowed.No);
        break;
      }
      case "Move": {
        const place = operand._0;
        this.access_place(location, place, [AccessDepth.Deep, { $: "Write", _0: WriteKind.Move }], LocalMutationIsAllowed.Yes);
        break;
      }
      case "Constant":
      case "RuntimeChecks":
        break;
    }
  }

  // Simulates consumption of an rvalue
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:246 consume_rvalue
  consume_rvalue(location: Location, rvalue: Rvalue): void {
    switch (rvalue.$) {
      case "Ref": {
        const bk = rvalue._1;
        const place = rvalue._2;
        let access_kind: [AccessDepth, ReadOrWrite];
        if (bk.$ === "Fake" && bk._0 === "Shallow") {
          access_kind = [{ $: "Shallow", _0: "FakeBorrow" }, { $: "Read", _0: { $: "Borrow", _0: bk } }];
        } else if (bk.$ === "Shared" || (bk.$ === "Fake" && bk._0 === "Deep")) {
          access_kind = [AccessDepth.Deep, { $: "Read", _0: { $: "Borrow", _0: bk } }];
        } else {
          // BorrowKind::Mut { .. }
          const wk: WriteKind = { $: "MutableBorrow", _0: bk };
          if (BorrowKind.is_two_phase_borrow(bk)) {
            access_kind = [AccessDepth.Deep, { $: "Reservation", _0: wk }];
          } else {
            access_kind = [AccessDepth.Deep, { $: "Write", _0: wk }];
          }
        }

        this.access_place(location, place, access_kind, LocalMutationIsAllowed.No);
        break;
      }

      case "Reborrow": {
        const mutability = rvalue._1;
        const place = rvalue._2;
        const access_kind: [AccessDepth, ReadOrWrite] = [
          AccessDepth.Deep,
          mutability === "Mut"
            ? { $: "Reservation", _0: { $: "MutableBorrow", _0: { $: "Mut", kind: "TwoPhaseBorrow" } } }
            : { $: "Read", _0: { $: "Borrow", _0: BorrowKind.Shared } },
        ];

        this.access_place(location, place, access_kind, LocalMutationIsAllowed.No);
        break;
      }

      case "RawPtr": {
        const kind = rvalue._0;
        const place = rvalue._1;
        let access_kind: [AccessDepth, ReadOrWrite];
        switch (kind) {
          case "Mut":
            access_kind = [AccessDepth.Deep, { $: "Write", _0: { $: "MutableBorrow", _0: { $: "Mut", kind: "Default" } } }];
            break;
          case "Const":
            access_kind = [AccessDepth.Deep, { $: "Read", _0: { $: "Borrow", _0: BorrowKind.Shared } }];
            break;
          case "FakeForPtrMetadata":
            access_kind = [{ $: "Shallow", _0: "ArrayLength" }, { $: "Read", _0: ReadKind.Copy }];
            break;
        }

        this.access_place(location, place, access_kind, LocalMutationIsAllowed.No);
        break;
      }

      case "ThreadLocalRef":
        break;

      case "Use":
      case "Repeat": {
        const operand = rvalue._0;
        this.consume_operand(location, operand);
        break;
      }
      case "UnaryOp":
      case "Cast": {
        const operand = rvalue._1;
        this.consume_operand(location, operand);
        break;
      }

      case "Discriminant": {
        const place = rvalue._0;
        this.access_place(location, place, [{ $: "Shallow", _0: undefined }, { $: "Read", _0: ReadKind.Copy }], LocalMutationIsAllowed.No);
        break;
      }

      case "BinaryOp": {
        const [operand1, operand2] = rvalue._1;
        this.consume_operand(location, operand1);
        this.consume_operand(location, operand2);
        break;
      }

      case "Aggregate": {
        const operands = rvalue._1;
        for (const operand of operands) {
          this.consume_operand(location, operand);
        }
        break;
      }

      case "WrapUnsafeBinder": {
        const op = rvalue._0;
        this.consume_operand(location, op);
        break;
      }

      case "CopyForDeref":
        bug("`CopyForDeref` in borrowck");
    }
  }

  /// Simulates an access to a place.
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:339 access_place
  access_place(location: Location, place: Place, kind: [AccessDepth, ReadOrWrite], _is_local_mutation_allowed: LocalMutationIsAllowed): void {
    const [sd, rw] = kind;
    // note: not doing check_access_permissions checks because they don't generate invalidates
    this.check_access_for_conflict(location, place, sd, rw);
  }

  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:351 check_access_for_conflict
  check_access_for_conflict(location: Location, place: Place, sd: AccessDepth, rw: ReadOrWrite): void {
    // debug!(
    //     "check_access_for_conflict(location={:?}, place={:?}, sd={:?}, rw={:?})",
    //     location, place, sd, rw,
    // );
    each_borrow_involving_path(
      this,
      this.tcx,
      this.body,
      [sd, place],
      this.borrow_set,
      (_) => true,
      (this_, borrow_index, borrow): ControlFlow<null> => {
        // PORT: `match (rw, borrow.kind)`: an if-chain in upstream arm order.
        const borrow_kind = borrow.kind;
        // Obviously an activation is compatible with its own
        // reservation (or even prior activating uses of same
        // borrow); so don't check if they interfere.
        //
        // NOTE: *reservations* do conflict with themselves;
        // thus aren't injecting unsoundness w/ this check.)
        if (rw.$ === "Activation" && rw._1 === borrow_index) {
          // Activating a borrow doesn't generate any invalidations, since we
          // have already taken the reservation
        } else if (
          (rw.$ === "Read" && (borrow_kind.$ === "Fake" || borrow_kind.$ === "Shared")) ||
          (rw.$ === "Read" && rw._0.$ === "Borrow" && rw._0._0.$ === "Fake" && rw._0._0._0 === "Shallow" && borrow_kind.$ === "Mut")
        ) {
          // Reads don't invalidate shared or shallow borrows
        } else if (rw.$ === "Read" && borrow_kind.$ === "Mut") {
          // Reading from mere reservations of mutable-borrows is OK.
          if (!is_active(this_.dominators, borrow, location)) {
            // If the borrow isn't active yet, reads don't invalidate it
            assert(BorrowKind.is_two_phase_borrow(borrow.kind), "assertion failed: borrow.kind.is_two_phase_borrow()");
            return ControlFlow.CONTINUE;
          }

          // Unique and mutable borrows are invalidated by reads from any
          // involved path
          this_.emit_loan_invalidated_at(borrow_index, location);
        } else {
          // (Reservation(_) | Activation(_, _) | Write(_), _)
          // unique or mutable borrows are invalidated by writes.
          // Reservations count as writes since we need to check
          // that activating the borrow will be OK
          // FIXME(bob_twinkles) is this actually the right thing to do?
          this_.emit_loan_invalidated_at(borrow_index, location);
        }
        return ControlFlow.CONTINUE;
      },
    );
  }

  /// Generates a new `loan_invalidated_at(L, B)` fact.
  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:417 emit_loan_invalidated_at
  emit_loan_invalidated_at(b: BorrowIndex, l: Location): void {
    const lidx = this.location_table.start_index(l);
    this.facts.loan_invalidated_at.push([lidx, b]);
  }

  // rustc: compiler/rustc_borrowck/src/polonius/legacy/loan_invalidations.rs:422 check_activations
  check_activations(location: Location): void {
    // Two-phase borrow support: For each activation that is newly
    // generated at this statement, check if it interferes with
    // another borrow.
    for (const borrow_index of this.borrow_set.activations_at_location(location)) {
      const borrow = this.borrow_set.index(borrow_index);

      // only mutable borrows should be 2-phase
      let is_mut: boolean;
      switch (borrow.kind.$) {
        case "Shared":
        case "Fake":
          is_mut = false;
          break;
        case "Mut":
          is_mut = true;
          break;
      }
      assert(
        is_mut,
        "assertion failed: match borrow.kind {\n    BorrowKind::Shared | BorrowKind::Fake(_) => false,\n    BorrowKind::Mut { .. } => true,\n}",
      );

      this.access_place(
        location,
        borrow.borrowed_place,
        [AccessDepth.Deep, { $: "Activation", _0: { $: "MutableBorrow", _0: borrow.kind }, _1: borrow_index }],
        LocalMutationIsAllowed.No,
      );

      // We do not need to call `check_if_path_or_subpath_is_moved`
      // again, as we already called it when we made the
      // initial reservation.
    }
  }
}
