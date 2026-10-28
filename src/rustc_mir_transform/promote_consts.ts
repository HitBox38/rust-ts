// Port of compiler/rustc_mir_transform/src/promote_consts.rs (lane mt-promote).
//
// PORT: `Q: qualifs::Qualif` type arguments are the impl tables of rustc_const_eval check_consts/qualifs.ts
// (`qualif_local::<qualifs::NeedsDrop>(l)` is `qualif_local(qualifs.NeedsDrop, l)`).
// PORT: `TempState` / `Candidate` are `Copy`; a `TempState::Defined` object belongs to one slot of `temps` and is only
// edited in place where upstream writes through `ref mut` (`Collector::visit_local`). Unit variants are shared frozen
// singletons. `Result<(), ()>` (`valid`) is `Result<null, null>`.
// PORT: `Validator` derefs to its `ConstCx`; `self.body` / `self.tcx` / `self.const_kind` / `self.typing_env` read
// `this.ccx.<field>` (the `deref` fn is ported).
// PORT: `IndexVec::push` returns the new index (`length - 1`); `basic_blocks.last_index()` is `length - 1` of the
// blocks (`None` only when empty, which `unwrap` turns into its panic). `&mut body[bb]` is `body.index_mut(bb)` (it
// invalidates the CFG caches, as upstream's `IndexMut`), `&body[bb]` is `body.index(bb)`.
// PORT: `usize::MAX` (the statement index of the promoted's root `Location`) is `Number.MAX_SAFE_INTEGER`: the
// location is only passed through the visitor, never compared or printed.
//! A pass that promotes borrows of constant rvalues.
//!
//! The rvalues considered constant are trees of temps, each with exactly one
//! initialization, and holding a constant value with no interior mutability.
//! They are placed into a new MIR constant body in `promoted` and the borrow
//! rvalue is replaced with a `Literal::Promoted` using the index into
//! `promoted` of that constant MIR.
//!
//! This pass assumes that every use is dominated by an initialization and can
//! otherwise silence errors, if move analysis runs after promotion on broken
//! MIR.

import { check_consts } from "../rustc_const_eval/lib.ts";
import type { ConstCx } from "../rustc_const_eval/check_consts/mod.ts";
import type { Qualif } from "../rustc_const_eval/check_consts/qualifs.ts";
import { ConstOperand, Place } from "../rustc_middle/mir/syntax.gen.ts";
import {
  BasicBlockData,
  BasicBlock,
  Body,
  BorrowKind,
  clone_ConstOperand,
  clone_MirSource,
  clone_Rvalue,
  clone_SourceScopeData,
  clone_Terminator,
  Const,
  debug_BinOp,
  debug_Local,
  debug_Location,
  debug_Statement,
  debug_TerminatorKind,
  Local,
  LocalDecl,
  Location,
  Location_cmp,
  Operand,
  Place_from_Local,
  type PlaceRef,
  Promoted,
  RETURN_PLACE,
  type Rvalue,
  Rvalue as RvalueC,
  SourceInfo,
  START_BLOCK,
  Statement,
  StatementKind,
  Terminator,
  TerminatorKind,
  traversal,
  UnevaluatedConst,
  UnwindAction,
  type Either,
} from "../rustc_middle/mir/mod.ts";
import { MutVisitor, type PlaceContext, PlaceContext as PlaceContextC, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { Span, Spanned } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { type Debug, debug_struct, PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, assert_eq, assert_matches, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";

const { qualifs } = check_consts;

/// A `MirPass` for promotion.
///
/// Promotion is the extraction of promotable temps into separate MIR bodies so they can have
/// `'static` lifetime.
///
/// After this pass is run, `promoted_fragments` will hold the MIR body corresponding to each
/// newly created `Constant`.
// #[derive(Default)]: `PromoteTemps::default()` is `new PromoteTemps([])`.
// rustc-type: compiler/rustc_mir_transform/src/promote_consts.rs:40 PromoteTemps
export class PromoteTemps extends MirPass {
  readonly type_name = "rustc_mir_transform::promote_consts::PromoteTemps";

  constructor(
    // Must use `Cell` because `run_pass` takes `&self`, not `&mut self`.
    /** `Cell<IndexVec<Promoted, Body<'tcx>>>`: `run_pass` replaces it; `.into_inner()` is the field. */
    public promoted_fragments: Body[],
  ) {
    super();
  }

  // impl<'tcx> crate::MirPass<'tcx> for PromoteTemps<'tcx>

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:46 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // There's not really any point in promoting errorful MIR.
    //
    // This does not include MIR that failed const-checking, which we still try to promote.
    if (TypeVisitableExt.error_reported(body.return_ty(), fold_Ty).$ === "Err") {
      // debug!("PromoteTemps: MIR had errors");
      return;
    }
    if (body.source.promoted !== undefined) {
      return;
    }

    const ccx = check_consts.ConstCx.new(tcx, body);
    const [temps, all_candidates] = collect_temps_and_candidates(ccx);

    const promotable_candidates = validate_candidates(ccx, temps, all_candidates);

    const promoted = promote_candidates(body, tcx, temps, promotable_candidates);
    this.promoted_fragments = promoted;
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:67 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Implements promotion by extracting eligible values into separate constant MIR bodies.
    return PassPolicy.Required;
  }
}

/// State of a temporary during collection and promotion.
// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
// rustc-type: compiler/rustc_mir_transform/src/promote_consts.rs:75 TempState
type TempState =
  /// No references to this temp.
  | { readonly $: "Undefined" }
  /// One direct assignment and any number of direct uses.
  /// A borrow of this temp is promotable if the assigned
  /// value is qualified as constant.
  | { readonly $: "Defined"; location: Location; uses: number; valid: Result<null, null> }
  /// Any other combination of assignments/uses.
  | { readonly $: "Unpromotable" }
  /// This temp was part of an rvalue which got extracted
  /// during promotion and needs cleanup.
  | { readonly $: "PromotedOut" };
const TempState = {
  Undefined: Object.freeze({ $: "Undefined" as const }),
  Unpromotable: Object.freeze({ $: "Unpromotable" as const }),
  PromotedOut: Object.freeze({ $: "PromotedOut" as const }),
};
const debug_TempState: Debug<TempState> = (v, f) => {
  switch (v.$) {
    case "Defined":
      return debug_struct(f, "Defined", [
        ["location", debug_Location(v.location, f)],
        ["uses", `${v.uses}`],
        ["valid", v.valid.$ === "Ok" ? "Ok(())" : "Err(())"],
      ]);
    default:
      return v.$;
  }
};

/// A "root candidate" for promotion, which will become the
/// returned value in a promoted MIR, unless it's a subset
/// of a larger candidate.
// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
// rustc-type: compiler/rustc_mir_transform/src/promote_consts.rs:93 Candidate
interface Candidate {
  location: Location;
}

// rustc-type: compiler/rustc_mir_transform/src/promote_consts.rs:97 Collector
class Collector extends Visitor {
  constructor(
    public ccx: ConstCx,
    public temps: TempState[],
    public candidates: Candidate[],
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for Collector<'_, 'tcx>

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:105 visit_local
  override visit_local(index: Local, context: PlaceContext, location: Location): void {
    // We're only interested in temporaries and the return place
    switch (this.ccx.body.local_kind(index)) {
      case "Arg":
        return;
      case "Temp":
        if (this.ccx.body.local_decls[index]!.is_user_variable()) return;
        break;
      case "ReturnPointer":
        break;
    }

    // Ignore drops, if the temp gets promoted,
    // then it's constant and thus drop is noop.
    // Non-uses are also irrelevant.
    if (PlaceContextC.is_drop(context) || !PlaceContextC.is_use(context)) {
      // debug!(is_drop = context.is_drop(), is_use = context.is_use());
      return;
    }

    const temp = this.temps[index]!;
    // debug!(?temp);
    let next: TempState;
    switch (temp.$) {
      case "Undefined":
        if (context.$ === "MutatingUse" && (context._0 === "Store" || context._0 === "Call")) {
          next = { $: "Defined", location, uses: 0, valid: Err(null) };
        } else {
          next = TempState.Unpromotable;
        }
        break;
      case "Defined": {
        // We always allow borrows, even mutable ones, as we need
        // to promote mutable borrows of some ZSTs e.g., `&mut []`.
        let allowed_use: boolean;
        if ((context.$ === "MutatingUse" && context._0 === "Borrow") || context.$ === "NonMutatingUse") {
          allowed_use = true;
        } else {
          // PlaceContext::MutatingUse(_) | PlaceContext::NonUse(_)
          allowed_use = false;
        }
        // debug!(?allowed_use);
        if (allowed_use) {
          temp.uses += 1;
          return;
        }
        next = TempState.Unpromotable;
        break;
      }
      case "Unpromotable":
      case "PromotedOut":
        next = TempState.Unpromotable;
        break;
    }
    this.temps[index] = next;
    // debug!(?temp);
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:150 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, location: Location): void {
    this.super_rvalue(rvalue, location);

    if (rvalue.$ === "Ref") {
      this.candidates.push({ location });
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/promote_consts.rs:159 collect_temps_and_candidates
function collect_temps_and_candidates(ccx: ConstCx): [TempState[], Candidate[]] {
  const collector = new Collector(
    ccx,
    // `IndexVec::from_elem(TempState::Undefined, &ccx.body.local_decls)`
    ccx.body.local_decls.map((): TempState => TempState.Undefined),
    [],
  );
  for (const [bb, data] of traversal.reverse_postorder(ccx.body)) {
    collector.visit_basic_block_data(bb, data);
  }
  return [collector.temps, collector.candidates];
}

/// Checks whether locals that appear in a promotion context (`Candidate`) are actually promotable.
///
/// This wraps an `Item`, and has access to all fields of that `Item` via `Deref` coercion.
// rustc-type: compiler/rustc_mir_transform/src/promote_consts.rs:176 Validator
class Validator {
  constructor(
    public ccx: ConstCx,
    public temps: TempState[],
    /// For backwards compatibility, we are promoting function calls in `const`/`static`
    /// initializers. But we want to avoid evaluating code that might panic and that otherwise would
    /// not have been evaluated, so we only promote such calls in basic blocks that are guaranteed
    /// to execute. In other words, we only promote such calls in basic blocks that are definitely
    /// not dead code. Here we cache the result of computing that set of basic blocks.
    public promotion_safe_blocks: Set<BasicBlock> | undefined,
  ) {}

  // impl<'a, 'tcx> std::ops::Deref for Validator<'a, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:190 deref
  deref(): ConstCx {
    return this.ccx;
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:198 validate_candidate
  validate_candidate(candidate: Candidate): Result<null, Unpromotable> {
    const stmt_or_term = this.ccx.body.stmt_at(candidate.location);
    if (stmt_or_term.$ !== "Left") return bug();
    const statement = stmt_or_term._0;
    const assign = StatementKind.as_assign(statement.kind);
    if (assign === undefined || assign[1].$ !== "Ref") return bug();
    const kind = assign[1]._1;
    const place = assign[1]._2;

    // We can only promote interior borrows of promotable temps (non-temps
    // don't get promoted anyway).
    {
      const r = this.validate_local(place.local);
      if (r.$ === "Err") return r;
    }

    // The reference operation itself must be promotable.
    // (Needs to come after `validate_local` to avoid ICEs.)
    {
      const r = this.validate_ref(kind, place);
      if (r.$ === "Err") return r;
    }

    // We do not check all the projections (they do not get promoted anyway),
    // but we do stay away from promoting anything involving a dereference.
    if (place.projection.some((e) => e.$ === "Deref")) {
      return Err(Unpromotable);
    }

    return Ok(null);
  }

  // FIXME(eddyb) maybe cache this?
  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:220 qualif_local
  qualif_local(Q_: Qualif, local: Local): boolean {
    const t = this.temps[local]!;
    if (t.$ !== "Defined") {
      return false;
    }
    const loc = t.location;

    const stmt_or_term = this.ccx.body.stmt_at(loc);
    switch (stmt_or_term.$) {
      case "Left": {
        const statement = stmt_or_term._0;
        const assign = StatementKind.as_assign(statement.kind);
        if (assign === undefined) {
          return span_bug(statement.source_info.span, `${debug_Statement(statement, PLAIN)} is not an assignment`);
        }
        const rhs = assign[1];
        return qualifs.in_rvalue(Q_, this.ccx, (l) => this.qualif_local(Q_, l), rhs);
      }
      case "Right": {
        const terminator = stmt_or_term._0;
        assert_matches(terminator.kind, terminator.kind.$ === "Call", "TerminatorKind::Call { .. }", (k) => debug_TerminatorKind(k, PLAIN));
        const return_ty = this.ccx.body.local_decls[local]!.ty;
        return Q_.in_any_value_of_ty(this.ccx, return_ty);
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:241 validate_local
  validate_local(local: Local): Result<null, Unpromotable> {
    const t = this.temps[local]!;
    if (t.$ !== "Defined") {
      return Err(Unpromotable);
    }
    const { location: loc, uses, valid } = t;

    // We cannot promote things that need dropping, since the promoted value would not get
    // dropped.
    if (this.qualif_local(qualifs.NeedsDrop, local)) {
      return Err(Unpromotable);
    }

    if (valid.$ === "Ok") {
      return Ok(null);
    }

    let ok: Result<null, Unpromotable>;
    {
      const stmt_or_term = this.ccx.body.stmt_at(loc);
      switch (stmt_or_term.$) {
        case "Left": {
          const statement = stmt_or_term._0;
          const assign = StatementKind.as_assign(statement.kind);
          if (assign === undefined) {
            return span_bug(statement.source_info.span, `${debug_Statement(statement, PLAIN)} is not an assignment`);
          }
          const rhs = assign[1];
          ok = this.validate_rvalue(rhs);
          break;
        }
        case "Right": {
          const terminator = stmt_or_term._0;
          const kind = terminator.kind;
          switch (kind.$) {
            case "Call":
              ok = this.validate_call(kind.func, kind.args, loc.block);
              break;
            case "Yield":
              ok = Err(Unpromotable);
              break;
            default:
              return span_bug(terminator.source_info.span, `${debug_TerminatorKind(kind, PLAIN)} not promotable`);
          }
          break;
        }
      }
    }

    this.temps[local] = ok.$ === "Ok" ? { $: "Defined", location: loc, uses, valid: Ok(null) } : TempState.Unpromotable;

    return ok;
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:289 validate_place
  validate_place(place: PlaceRef): Result<null, Unpromotable> {
    const last = place.last_projection();
    if (last === undefined) {
      return this.validate_local(place.local);
    }
    const [place_base, elem] = last;

    // Validate topmost projection, then recurse.
    switch (elem.$) {
      // Recurse directly.
      case "ConstantIndex":
      case "Subslice":
      case "UnwrapUnsafeBinder":
        break;

      // Never recurse.
      case "PhantomDeref":
      case "OpaqueCast":
      case "Downcast":
        return Err(Unpromotable);

      case "Deref": {
        // When a static is used by-value, that gets desugared to `*STATIC_ADDR`,
        // and we need to be able to promote this. So check if this deref matches
        // that specific pattern.

        // We need to make sure this is a `Deref` of a local with no further projections.
        // Discussion can be found at
        // https://github.com/rust-lang/rust/pull/74945#discussion_r463063247
        let ok = false;
        const local = place_base.as_local();
        if (local !== undefined) {
          const t = this.temps[local]!;
          if (t.$ === "Defined") {
            const def_stmt: Either<Statement, Terminator> = this.ccx.body.stmt_at(t.location);
            if (def_stmt.$ === "Left") {
              const assign = StatementKind.as_assign(def_stmt._0.kind);
              if (assign !== undefined && assign[1].$ === "Use" && assign[1]._0.$ === "Constant") {
                const c = assign[1]._0._0;
                const did = c.check_static_ptr(this.ccx.tcx);
                ok =
                  did !== undefined &&
                  // Evaluating a promoted may not read statics except if it got
                  // promoted from a static (this is a CTFE check). So we
                  // can only promote static accesses inside statics.
                  this.ccx.const_kind !== undefined &&
                  this.ccx.const_kind.$ === "Static" &&
                  !this.ccx.tcx.is_thread_local_static(did) &&
                  // Extern statics can never be read by CTFE, even inside a static.
                  !this.ccx.tcx.is_foreign_item(did);
              }
            }
          }
        }
        if (ok) {
          // Recurse.
        } else {
          return Err(Unpromotable);
        }
        break;
      }
      case "Index": {
        const local = elem._0;
        // Only accept if we can predict the index and are indexing an array.
        let ok = false;
        const t = this.temps[local]!;
        if (t.$ === "Defined") {
          const loc = t.location;
          const stmt = this.ccx.body.stmt_at(loc);
          if (stmt.$ === "Left") {
            const assign = StatementKind.as_assign(stmt._0.kind);
            if (assign !== undefined && assign[1].$ === "Use" && assign[1]._0.$ === "Constant") {
              const c = assign[1]._0._0;
              let idx: number | undefined;
              if (
                this.should_evaluate_for_promotion_checks(c.const_) &&
                (idx = Const.try_eval_target_usize(c.const_, this.ccx.tcx, this.ccx.typing_env)) !== undefined
              ) {
                // Determine the type of the thing we are indexing.
                const k = place_base.ty(this.ccx.body, this.ccx.tcx).ty.kind();
                if (k.$ === "Array") {
                  // It's an array; determine its length.
                  const len = k._1.try_to_target_usize(this.ccx.tcx);
                  // If the index is in-bounds, go ahead.
                  ok = len !== undefined && idx < len;
                }
              }
            }
          }
        }
        if (ok) {
          const r = this.validate_local(local);
          if (r.$ === "Err") return r;
          // Recurse.
        } else {
          return Err(Unpromotable);
        }
        break;
      }

      case "Field": {
        const base_ty = place_base.ty(this.ccx.body, this.ccx.tcx).ty;
        if (base_ty.is_union()) {
          // No promotion of union field accesses.
          return Err(Unpromotable);
        }
        break;
      }
    }

    return this.validate_place(place_base);
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:367 validate_operand
  validate_operand(operand: Operand): Result<null, Unpromotable> {
    switch (operand.$) {
      case "Copy":
      case "Move":
        return this.validate_place(operand._0.as_ref());

      // `RuntimeChecks` behaves different in const-eval and runtime MIR,
      // so we do not promote it.
      case "RuntimeChecks":
        return Err(Unpromotable);

      // The qualifs for a constant (e.g. `HasMutInterior`) are checked in
      // `validate_rvalue` upon access.
      case "Constant": {
        const c = operand._0;
        const def_id = c.check_static_ptr(this.ccx.tcx);
        if (def_id !== undefined) {
          // Only allow statics (not consts) to refer to other statics.
          // FIXME(eddyb) does this matter at all for promotion?
          // FIXME(RalfJung) it makes little sense to not promote this in `fn`/`const fn`,
          // and in `const` this cannot occur anyway. The only concern is that we might
          // promote even `let x = &STATIC` which would be useless, but this applies to
          // promotion inside statics as well.
          const is_static = this.ccx.const_kind !== undefined && this.ccx.const_kind.$ === "Static";
          if (!is_static) {
            return Err(Unpromotable);
          }

          const is_thread_local = this.ccx.tcx.is_thread_local_static(def_id);
          if (is_thread_local) {
            return Err(Unpromotable);
          }
        }

        return Ok(null);
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:401 validate_ref
  validate_ref(kind: BorrowKind, place: Place): Result<null, Unpromotable> {
    switch (kind.$) {
      // Reject these borrow types just to be safe.
      // FIXME(RalfJung): could we allow them? Should we? No point in it until we have a
      // usecase.
      case "Fake":
        return Err(Unpromotable);

      case "Shared": {
        const has_mut_interior = this.qualif_local(qualifs.HasMutInterior, place.local);
        if (has_mut_interior) {
          return Err(Unpromotable);
        }
        break;
      }

      case "Mut": {
        if (kind.kind === "ClosureCapture") {
          return Err(Unpromotable);
        }
        // FIXME: consider changing this to only promote &mut [] for default borrows,
        // also forbidding two phase borrows
        // BorrowKind::Mut { kind: MutBorrowKind::Default | MutBorrowKind::TwoPhaseBorrow }
        const ty = place.ty(this.ccx.body, this.ccx.tcx).ty;

        // In theory, any zero-sized value could be borrowed
        // mutably without consequences. However, only &mut []
        // is allowed right now.
        const k = ty.kind();
        if (k.$ !== "Array") return Err(Unpromotable);
        const len = k._1;
        if (len.try_to_target_usize(this.ccx.tcx) !== 0n) return Err(Unpromotable);
        break;
      }
    }

    return Ok(null);
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:433 validate_rvalue
  validate_rvalue(rvalue: Rvalue): Result<null, Unpromotable> {
    switch (rvalue.$) {
      case "Use":
      case "Repeat":
      case "WrapUnsafeBinder": {
        if (rvalue.$ === "Use" && rvalue._1 === "No") {
          // This shouldn't actually happen, but just to be safe: we'll later add the promoted
          // with retagging, so don't promote anything that didn't already have retagging.
          return Err(Unpromotable);
        }
        const r = this.validate_operand(rvalue._0);
        if (r.$ === "Err") return r;
        break;
      }
      case "CopyForDeref": {
        const op: Operand = { $: "Copy", _0: rvalue._0 };
        const r = this.validate_operand(op);
        if (r.$ === "Err") return r;
        break;
      }

      case "Discriminant": {
        const r = this.validate_place(rvalue._0.as_ref());
        if (r.$ === "Err") return r;
        break;
      }

      case "ThreadLocalRef":
        return Err(Unpromotable);

      case "Cast": {
        // ptr-to-int casts are not possible in consts and thus not promotable
        if (rvalue._0.$ === "PointerExposeProvenance") return Err(Unpromotable);

        // all other casts including int-to-ptr casts are fine, they just use the integer value
        // at pointer type.
        const r = this.validate_operand(rvalue._1);
        if (r.$ === "Err") return r;
        break;
      }

      case "UnaryOp": {
        const op = rvalue._0;
        switch (op) {
          // These operations can never fail.
          case "Neg":
          case "Not":
          case "PtrMetadata":
            break;
        }

        const r = this.validate_operand(rvalue._1);
        if (r.$ === "Err") return r;
        break;
      }

      case "BinaryOp": {
        const op = rvalue._0;
        const [lhs, rhs] = rvalue._1;
        const lhs_ty = Operand.ty(lhs, this.ccx.body, this.ccx.tcx);

        const lk = lhs_ty.kind();
        if (lk.$ === "RawPtr" || lk.$ === "FnPtr") {
          // Raw and fn pointer operations are not allowed inside consts and thus not
          // promotable.
          assert_matches(
            op,
            op === "Eq" || op === "Ne" || op === "Le" || op === "Lt" || op === "Ge" || op === "Gt" || op === "Offset",
            "BinOp::Eq | BinOp::Ne | BinOp::Le | BinOp::Lt | BinOp::Ge | BinOp::Gt | BinOp::Offset",
            (o) => debug_BinOp(o, PLAIN),
          );
          return Err(Unpromotable);
        }

        switch (op) {
          case "Div":
          case "Rem": {
            if (lhs_ty.is_integral()) {
              const sz = lhs_ty.primitive_size(this.ccx.tcx);
              // Integer division: the RHS must be a non-zero const.
              let rhs_val;
              let v;
              if (
                rhs.$ === "Constant" &&
                this.should_evaluate_for_promotion_checks(rhs._0.const_) &&
                (v = Const.try_eval_scalar_int(rhs._0.const_, this.ccx.tcx, this.ccx.typing_env)) !== undefined &&
                // for the zero test, int vs uint does not matter
                v.to_uint(sz) !== 0n
              ) {
                rhs_val = v;
              } else {
                // value not known or 0 -- not okay
                return Err(Unpromotable);
              }
              // Furthermore, for signed division, we also have to exclude `int::MIN /
              // -1`.
              if (lhs_ty.is_signed() && rhs_val.to_int(sz) === -1n) {
                // The RHS is -1, so we have to be careful. But is the LHS int::MIN?
                let lhs_val;
                if (
                  lhs.$ === "Constant" &&
                  this.should_evaluate_for_promotion_checks(lhs._0.const_) &&
                  (lhs_val = Const.try_eval_scalar_int(lhs._0.const_, this.ccx.tcx, this.ccx.typing_env)) !== undefined &&
                  lhs_val.to_int(sz) !== sz.signed_int_min()
                ) {
                  // okay
                } else {
                  // value not known or int::MIN -- not okay
                  return Err(Unpromotable);
                }
              }
            }
            break;
          }
          // The remaining operations can never fail.
          case "Eq":
          case "Ne":
          case "Le":
          case "Lt":
          case "Ge":
          case "Gt":
          case "Cmp":
          case "Offset":
          case "Add":
          case "AddUnchecked":
          case "AddWithOverflow":
          case "Sub":
          case "SubUnchecked":
          case "SubWithOverflow":
          case "Mul":
          case "MulUnchecked":
          case "MulWithOverflow":
          case "BitXor":
          case "BitAnd":
          case "BitOr":
          case "Shl":
          case "ShlUnchecked":
          case "Shr":
          case "ShrUnchecked":
            break;
        }

        {
          const r = this.validate_operand(lhs);
          if (r.$ === "Err") return r;
        }
        {
          const r = this.validate_operand(rhs);
          if (r.$ === "Err") return r;
        }
        break;
      }

      case "RawPtr": {
        const place = rvalue._1;
        // We accept `&raw *`, i.e., raw reborrows -- creating a raw pointer is
        // no problem, only using it is.
        const last = place.as_ref().last_projection();
        if (last !== undefined && last[1].$ === "Deref") {
          const place_base = last[0];
          const base_ty = place_base.ty(this.ccx.body, this.ccx.tcx).ty;
          if (base_ty.kind().$ === "Ref") {
            return this.validate_place(place_base);
          }
        }
        return Err(Unpromotable);
      }

      case "Ref": {
        const kind = rvalue._1;
        const place = rvalue._2;
        // Special-case reborrows to be more like a copy of the reference.
        let place_simplified = place.as_ref();
        const last = place_simplified.last_projection();
        if (last !== undefined && last[1].$ === "Deref") {
          const place_base = last[0];
          const base_ty = place_base.ty(this.ccx.body, this.ccx.tcx).ty;
          if (base_ty.kind().$ === "Ref") {
            place_simplified = place_base;
          }
        }

        {
          const r = this.validate_place(place_simplified);
          if (r.$ === "Err") return r;
        }

        // Check that the reference is fine (using the original place!).
        // (Needs to come after `validate_place` to avoid ICEs.)
        {
          const r = this.validate_ref(kind, place);
          if (r.$ === "Err") return r;
        }
        break;
      }

      case "Reborrow":
        return Err(Unpromotable);

      case "Aggregate": {
        const operands = rvalue._1;
        for (const o of operands) {
          const r = this.validate_operand(o);
          if (r.$ === "Err") return r;
        }
        break;
      }
    }

    return Ok(null);
  }

  /// Computes the sets of blocks of this MIR that are definitely going to be executed
  /// if the function returns successfully. That makes it safe to promote calls in them
  /// that might fail.
  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:606 promotion_safe_blocks
  static promotion_safe_blocks(body: Body): Set<BasicBlock> {
    const safe_blocks = new Set<BasicBlock>();
    let safe_block = START_BLOCK;
    for (;;) {
      safe_blocks.add(safe_block);
      // Let's see if we can find another safe block.
      const kind = body.basic_blocks.deref()[safe_block]!.terminator_().kind;
      if (kind.$ === "Goto") {
        safe_block = kind.target;
      } else if ((kind.$ === "Call" && kind.target !== undefined) || kind.$ === "Drop") {
        // This calls a function or the destructor. `target` does not get executed if
        // the callee loops or panics. But in both cases the const already fails to
        // evaluate, so we are fine considering `target` a safe block for promotion.
        safe_block = kind.target!;
      } else if (kind.$ === "Assert") {
        // Similar to above, we only consider successful execution.
        safe_block = kind.target;
      } else {
        // No next safe block.
        break;
      }
    }
    return safe_blocks;
  }

  /// Returns whether the block is "safe" for promotion, which means it cannot be dead code.
  /// We use this to avoid promoting operations that can fail in dead code.
  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:636 is_promotion_safe_block
  is_promotion_safe_block(block: BasicBlock): boolean {
    const body = this.ccx.body;
    const safe_blocks = (this.promotion_safe_blocks ??= Validator.promotion_safe_blocks(body));
    return safe_blocks.has(block);
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:643 validate_call
  validate_call(callee: Operand, args: readonly Spanned<Operand>[], block: BasicBlock): Result<null, Unpromotable> {
    // Validate the operands. If they fail, there's no question -- we cannot promote.
    {
      const r = this.validate_operand(callee);
      if (r.$ === "Err") return r;
    }
    for (const arg of args) {
      const r = this.validate_operand(arg.node);
      if (r.$ === "Err") return r;
    }

    // Functions marked `#[rustc_promotable]` are explicitly allowed to be promoted, so we can
    // accept them at this point.
    const fn_ty = Operand.ty(callee, this.ccx.body, this.ccx.tcx);
    const fk = fn_ty.kind();
    if (fk.$ === "FnDef") {
      const def_id = fk._0;
      if (this.ccx.tcx.is_promotable_const_fn(def_id)) {
        return Ok(null);
      }
    }

    // Ideally, we'd stop here and reject the rest.
    // But for backward compatibility, we have to accept some promotion in const/static
    // initializers. Inline consts are explicitly excluded, they are more recent so we have no
    // backwards compatibility reason to allow more promotion inside of them.
    const ck = this.ccx.const_kind;
    const promote_all_fn = ck !== undefined && (ck.$ === "Static" || (ck.$ === "Const" && ck.allow_const_fn_promotion));
    if (!promote_all_fn) {
      return Err(Unpromotable);
    }
    // Make sure the callee is a `const fn`.
    let is_const_fn: boolean;
    switch (fk.$) {
      case "FnDef":
        is_const_fn = this.ccx.tcx.is_const_fn(fk._0);
        break;
      default:
        is_const_fn = false;
    }
    if (!is_const_fn) {
      return Err(Unpromotable);
    }
    // The problem is, this may promote calls to functions that panic.
    // We don't want to introduce compilation errors if there's a panic in a call in dead code.
    // So we ensure that this is not dead code.
    if (!this.is_promotion_safe_block(block)) {
      return Err(Unpromotable);
    }
    // This passed all checks, so let's accept.
    return Ok(null);
  }

  /// Can we try to evaluate a given constant at this point in compilation? Attempting to evaluate
  /// a const block before borrow-checking will result in a query cycle (#150464).
  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:698 should_evaluate_for_promotion_checks
  should_evaluate_for_promotion_checks(constant: Const): boolean {
    switch (constant.$) {
      // `Const::Ty` is always a `ConstKind::Param` right now and that can never be turned
      // into a mir value for promotion
      // FIXME(mgca): do we want uses of type_const to be normalized during promotion?
      case "Ty":
        return false;
      case "Val":
        return true;
      // Evaluating a MIR constant requires borrow-checking it. For inline consts, as of
      // #138499, this means borrow-checking its typeck root. Since borrow-checking the
      // typeck root requires promoting its constants, trying to evaluate an inline const here
      // will result in a query cycle. To avoid the cycle, we can't evaluate const blocks yet.
      // Other kinds of unevaluated's can cause query cycles too when they arise from
      // self-reference in user code; e.g. evaluating a constant can require evaluating a
      // const function that uses that constant, again requiring evaluation of the constant.
      // However, this form of cycle renders both the constant and function unusable in
      // general, so we don't need to special-case it here.
      case "Unevaluated": {
        const uc = constant._0;
        return this.ccx.tcx.def_kind(uc.def).$ !== "AnonConst" || this.ccx.tcx.anon_const_kind(uc.def) !== "NonTypeSystemInline";
      }
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/promote_consts.rs:195 Unpromotable
type Unpromotable = typeof Unpromotable;
const Unpromotable = Object.freeze({ $: "Unpromotable" as const });

// rustc: compiler/rustc_mir_transform/src/promote_consts.rs:722 validate_candidates
function validate_candidates(ccx: ConstCx, temps: TempState[], candidates: Candidate[]): Candidate[] {
  const validator = new Validator(ccx, temps, undefined);

  // `candidates.retain(|&candidate| validator.validate_candidate(candidate).is_ok())`
  return candidates.filter((candidate) => validator.validate_candidate(candidate).$ === "Ok");
}

// rustc-type: compiler/rustc_mir_transform/src/promote_consts.rs:733 Promoter
class Promoter extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public source: Body,
    public promoted: Body,
    public temps: TempState[],
    public extra_statements: [Location, Statement][],

    /// Used to assemble the required_consts list while building the promoted.
    public required_consts: ConstOperand[],

    /// If true, all nested temps are also kept in the
    /// source MIR, not moved to the promoted MIR.
    public keep_original: boolean,

    /// If true, add the new const (the promoted) to the required_consts of the parent MIR.
    /// This is initially false and then set by the visitor when it encounters a `Call` terminator.
    public add_to_required: boolean,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:753 new_block
  new_block(): BasicBlock {
    const span = this.promoted.span;
    const blocks = this.promoted.basic_blocks_mut();
    blocks.push(BasicBlockData.new(new Terminator(SourceInfo.outermost(span), TerminatorKind.Return), false));
    return BasicBlock.from_usize(blocks.length - 1);
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:764 assign
  assign(dest: Local, rvalue: Rvalue, span: Span): void {
    const last = BasicBlock.from_usize(unwrap(this.promoted.basic_blocks.deref().length > 0 ? this.promoted.basic_blocks.deref().length - 1 : undefined));
    const data = this.promoted.index_mut(last);
    data.statements.push(Statement.new(SourceInfo.outermost(span), { $: "Assign", _0: [Place_from_Local(dest), rvalue] }));
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:773 is_temp_kind
  is_temp_kind(local: Local): boolean {
    return this.source.local_kind(local) === "Temp";
  }

  /// Copies the initialization of this temp to the
  /// promoted MIR, recursing through temps.
  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:779 promote_temp
  promote_temp(temp: Local): Local {
    const old_keep_original = this.keep_original;
    let loc: Location;
    const state = this.temps[temp]!;
    if (state.$ === "Defined" && state.uses > 0) {
      if (state.uses > 1) {
        this.keep_original = true;
      }
      loc = state.location;
    } else {
      return span_bug(this.promoted.span, `${debug_Local(temp, PLAIN)} not promotable: ${debug_TempState(state, PLAIN)}`);
    }
    if (!this.keep_original) {
      this.temps[temp] = TempState.PromotedOut;
    }

    const num_stmts = this.source.index(loc.block).statements.length;
    this.promoted.local_decls.push(
      LocalDecl.new(this.source.local_decls[temp]!.ty, this.source.local_decls[temp]!.source_info.span),
    );
    const new_temp = Local.from_usize(this.promoted.local_decls.length - 1);

    // debug!("promote({:?} @ {:?}/{:?}, {:?})", temp, loc, num_stmts, self.keep_original);

    // First, take the Rvalue or Call out of the source MIR,
    // or duplicate it, depending on keep_original.
    if (loc.statement_index < num_stmts) {
      let rvalue: Rvalue;
      let source_info: SourceInfo;
      {
        const statement = this.source.index_mut(loc.block).statements[loc.statement_index]!;
        const kind = statement.kind;
        if (kind.$ !== "Assign") {
          return span_bug(statement.source_info.span, `${debug_Statement(statement, PLAIN)} is not an assignment`);
        }
        const rhs = kind._0[1];

        if (this.keep_original) {
          rvalue = clone_Rvalue(rhs);
        } else {
          const unit: Rvalue = {
            $: "Use",
            _0: { $: "Constant", _0: new ConstOperand(statement.source_info.span, undefined, Const.zero_sized(this.tcx_.types.unit)) },
            _1: "Yes",
          };
          // `mem::replace(rhs, unit)`
          rvalue = rhs;
          kind._0[1] = unit;
        }
        // `statement.source_info` (`SourceInfo: Copy`)
        source_info = statement.source_info;
      }

      this.visit_rvalue(rvalue, loc);
      this.assign(new_temp, rvalue, source_info.span);
    } else {
      let terminator: Terminator;
      if (this.keep_original) {
        terminator = clone_Terminator(this.source.index(loc.block).terminator_());
      } else {
        const terminator_ = this.source.index_mut(loc.block).terminator_mut();
        let target: BasicBlock;
        if (terminator_.kind.$ === "Call" && terminator_.kind.target !== undefined) {
          target = terminator_.kind.target;
        } else {
          return span_bug(terminator_.source_info.span, `${debug_TerminatorKind(terminator_.kind, PLAIN)} not promotable`);
        }
        // `mem::replace(&mut terminator.kind, TerminatorKind::goto(target))`
        const kind = terminator_.kind;
        terminator_.kind = TerminatorKind.goto(target);
        terminator = new Terminator(terminator_.source_info, kind);
      }

      const tk = terminator.kind;
      if (tk.$ === "Call") {
        const { func, args, call_source: desugar, fn_span } = tk;
        // This promoted involves a function call, so it may fail to evaluate. Let's
        // make sure it is added to `required_consts` so that failure cannot get lost.
        this.add_to_required = true;

        this.visit_operand(func, loc);
        for (const arg of args) {
          this.visit_operand(arg.node, loc);
        }

        const last = BasicBlock.from_usize(unwrap(this.promoted.basic_blocks.deref().length > 0 ? this.promoted.basic_blocks.deref().length - 1 : undefined));
        const new_target = this.new_block();

        const t = this.promoted.index_mut(last).terminator_mut();
        t.kind = {
          $: "Call",
          func,
          args,
          unwind: UnwindAction.Continue,
          destination: Place_from_Local(new_temp),
          target: new_target,
          call_source: desugar,
          fn_span,
        };
        t.source_info = SourceInfo.outermost(terminator.source_info.span);
      } else {
        return span_bug(terminator.source_info.span, `${debug_TerminatorKind(tk, PLAIN)} not promotable`);
      }
    }

    this.keep_original = old_keep_original;
    return new_temp;
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:890 promote_candidate
  promote_candidate(candidate: Candidate, next_promoted_index: Promoted): Body {
    const def = this.source.source.def_id();
    let rvalue: Rvalue;
    let promoted_op: ConstOperand;
    {
      const promoted = this.promoted;
      const tcx = this.tcx_;
      const promoted_operand = (ty: Ty, span: Span): ConstOperand => {
        promoted.span = span;
        promoted.local_decls[RETURN_PLACE] = LocalDecl.new(ty, span);
        const args = tcx.erase_and_anonymize_regions(RawList.identity_for_item(tcx, def), fold_GenericArgs);
        const uneval = new UnevaluatedConst(def, args, next_promoted_index);

        return new ConstOperand(span, undefined, { $: "Unevaluated", _0: uneval, _1: ty });
      };

      const blocks = this.source.basic_blocks.as_mut();
      const local_decls = this.source.local_decls;
      const loc = candidate.location;
      const statement = blocks[loc.block]!.statements[loc.statement_index]!;
      const kind = statement.kind;
      if (!(kind.$ === "Assign" && kind._0[1].$ === "Ref")) {
        return bug();
      }
      const ref = kind._0[1];
      const borrow_kind = ref._1;
      const place = ref._2;

      // Use the underlying local for this (necessarily interior) borrow.
      // debug_assert!(region.is_erased());
      const ty = local_decls[place.local]!.ty;
      const span = statement.source_info.span;

      const ref_ty = Ty.new_ref(tcx, tcx.lifetimes.re_erased, ty, BorrowKind.to_mutbl_lossy(borrow_kind));

      const projection = [{ $: "Deref" as const }, ...place.projection];
      place.projection = tcx.mk_place_elems(projection);

      // Create a temp to hold the promoted reference.
      // This is because `*r` requires `r` to be a local,
      // otherwise we would use the `promoted` directly.
      const promoted_ref_decl = LocalDecl.new(ref_ty, span);
      // `statement.source_info` (`SourceInfo: Copy`)
      promoted_ref_decl.source_info = statement.source_info;
      local_decls.push(promoted_ref_decl);
      const promoted_ref = Local.from_usize(local_decls.length - 1);
      this.temps.push(TempState.Unpromotable);
      assert_eq(Local.from_usize(this.temps.length - 1), promoted_ref, (l) => debug_Local(l, PLAIN));

      const promoted_operand_ = promoted_operand(ref_ty, span);
      const promoted_ref_statement = Statement.new(statement.source_info, {
        $: "Assign",
        _0: [
          Place_from_Local(promoted_ref),
          // We can retag here because we wouldn't promote non-retagged values (they get
          // rejected in validate_rvalue).
          // `promoted_operand` is `Copy`: the statement and `promoted_op` below get their own copies.
          { $: "Use", _0: { $: "Constant", _0: clone_ConstOperand(promoted_operand_) }, _1: "Yes" },
        ],
      });
      this.extra_statements.push([loc, promoted_ref_statement]);

      // `mem::replace(&mut place.local, promoted_ref)`
      const old_local = place.local;
      place.local = promoted_ref;
      rvalue = { $: "Ref", _0: tcx.lifetimes.re_erased, _1: borrow_kind, _2: new Place(old_local, RawList.empty()) };
      promoted_op = promoted_operand_;
    }

    assert_eq(this.new_block(), START_BLOCK, (b) => BasicBlock.debug(b, PLAIN));
    this.visit_rvalue(rvalue, new Location(START_BLOCK, Number.MAX_SAFE_INTEGER));

    const span = this.promoted.span;
    this.assign(RETURN_PLACE, rvalue, span);

    // Now that we did promotion, we know whether we'll want to add this to `required_consts` of
    // the surrounding MIR body.
    if (this.add_to_required) {
      unwrap(this.source.required_consts).push(promoted_op);
    }

    this.promoted.set_required_consts(this.required_consts);

    return this.promoted;
  }

  // Replaces all temporaries with their promoted counterparts.
  // impl<'a, 'tcx> MutVisitor<'tcx> for Promoter<'a, 'tcx>

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:988 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:992 visit_local
  override visit_local(local: MutRef<Local>, _: PlaceContext, _location: Location): void {
    if (this.is_temp_kind(local.value)) {
      local.value = this.promote_temp(local.value);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/promote_consts.rs:998 visit_const_operand
  override visit_const_operand(constant: ConstOperand, _location: Location): void {
    if (Const.is_required_const(constant.const_)) {
      // `*constant` (`ConstOperand: Copy`)
      this.required_consts.push(clone_ConstOperand(constant));
    }

    // Skipping `super_constant` as the visitor is otherwise only looking for locals.
  }
}

// rustc: compiler/rustc_mir_transform/src/promote_consts.rs:1007 promote_candidates
function promote_candidates(body: Body, tcx: TyCtxt, temps: TempState[], candidates: Candidate[]): Body[] {
  // Visit candidates in reverse, in case they're nested.
  // debug!(promote_candidates = ?candidates);

  // eagerly fail fast
  if (candidates.length === 0) {
    return [];
  }

  const promotions: Body[] = [];

  const extra_statements: [Location, Statement][] = [];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i]!;
    const { block, statement_index } = candidate.location;
    const kind = body.index(block).statements[statement_index]!.kind;
    let local: Local | undefined;
    if (kind.$ === "Assign" && (local = kind._0[0].as_local()) !== undefined) {
      if (temps[local]!.$ === "PromotedOut") {
        // Already promoted.
        continue;
      }
    }

    // Declare return place local so that `mir::Body::new` doesn't complain.
    const initial_locals = [LocalDecl.new(tcx.types.never, body.span)];

    const scope = clone_SourceScopeData(body.source_scopes[body.source_info(candidate.location).scope]!);
    scope.parent_scope = undefined;

    const promoted_ = Body.new(
      clone_MirSource(body.source), // `promoted` gets filled in below
      [],
      [scope],
      initial_locals,
      [],
      0,
      [],
      body.span,
      undefined,
      body.tainted_by_errors,
    );
    promoted_.phase = { $: "Analysis", _0: "Initial" };

    const promoter = new Promoter(tcx, body, promoted_, temps, extra_statements, [], false, false);

    const promoted = promoter.promote_candidate(candidate, Promoted.from_usize(promotions.length));
    promoted.source.promoted = Promoted.from_usize(promotions.length);
    promotions.push(promoted);
  }

  // Insert each of `extra_statements` before its indicated location, which
  // has to be done in reverse location order, to not invalidate the rest.
  extra_statements.sort((a, b) => Location_cmp(b[0], a[0]));
  for (const [loc, statement] of extra_statements) {
    body.index_mut(loc.block).statements.splice(loc.statement_index, 0, statement);
  }

  // Eliminate assignments to, and drops of promoted temps.
  const promoted = (index: Local): boolean => temps[index]!.$ === "PromotedOut";
  for (const block of body.basic_blocks_mut()) {
    block.retain_statements((statement) => {
      const kind = statement.kind;
      switch (kind.$) {
        case "Assign": {
          const index = kind._0[0].as_local();
          if (index !== undefined) {
            return !promoted(index);
          } else {
            return true;
          }
        }
        case "StorageLive":
        case "StorageDead":
          return !promoted(kind._0);
        default:
          return true;
      }
    });
    const terminator = block.terminator_mut();
    let index: Local | undefined;
    if (terminator.kind.$ === "Drop" && (index = terminator.kind.place.as_local()) !== undefined) {
      if (promoted(index)) {
        terminator.kind = TerminatorKind.goto(terminator.kind.target);
      }
    }
  }

  return promotions;
}
