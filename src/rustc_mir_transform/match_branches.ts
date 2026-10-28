// Port of compiler/rustc_mir_transform/src/match_branches.rs (lane mt-opt2-c).
//
// PORT: the derived `PartialEq` of `StatementKind` / `TerminatorKind` (`all_equal`) is the intern key's
// (rust_ts/intern_key.ts `intern_key_eq`, precedent known_panics_lint.ts); `Place == Place` compares `local` and the
// interned `projection` list. `Itertools::all_equal` / `try_collect` are local loops. `SimplifyMatch` borrows `body`
// while the caller still reads it (`&'a Body` beside `&mut Body`): both are the same object here.
// PORT: unreachable_prop.rs's `remove_successors_from_switch` is not declared by the unreachable_prop.ts stub at this
// base (lane mt-opt2-a ports that file): `remove_successors_from_switch` below is a local stand-in that stops as
// UNPORTED; at integration it is replaced by `import { remove_successors_from_switch } from "./unreachable_prop.ts"`.
import { Integer, type Size } from "../rustc_abi/lib.ts";
import type { VariantIdx } from "../rustc_abi/layout.ts";
import { mk_eval_cx_for_const_val } from "../rustc_const_eval/const_eval/eval_queries.ts";
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import { InterpResult, Scalar } from "../rustc_middle/mir/interpret/mod.ts";
import {
  type BasicBlock,
  type Body,
  CastKind,
  Const,
  type ConstOperand,
  clone_ConstOperand,
  clone_Operand,
  clone_StatementKind,
  clone_TerminatorKind,
  type Local,
  type Location,
  Operand,
  type Place,
  Place_from_Local,
  type Rvalue,
  StatementKind,
  WithRetag,
} from "../rustc_middle/mir/mod.ts";
import { ScalarInt, ScalarInt_eq } from "../rustc_middle/ty/consts/int.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_LayoutError, IntegerExt, type TyAndLayout } from "../rustc_middle/ty/layout.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { borrowed_locals } from "../rustc_mir_dataflow/impls/borrowed_locals.ts";
import { intern_key_eq } from "../rust_ts/intern_key.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { unported, unreachable, unwrap } from "../std/panic.ts";
import { unwrap_result } from "../std/result.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";
import { simplify_cfg } from "./simplify.ts";

/** PORT: derived `PartialEq` of `mir::Place` (header). */
function place_eq(a: Place, b: Place): boolean {
  return a.local === b.local && a.projection === b.projection;
}

/** PORT: stand-in for unreachable_prop.rs:62 `remove_successors_from_switch` (header). */
function remove_successors_from_switch(
  _tcx: TyCtxt,
  _bb: BasicBlock,
  _body: Body,
  _patch: MirPatch,
  _is_unreachable_block: (bb: BasicBlock) => boolean,
): boolean {
  return unported("rustc_mir_transform::unreachable_prop::remove_successors_from_switch (lane mt-opt2-a)");
}

/// Unifies all targets into one basic block if each statement can have the same statement.
// rustc-type: compiler/rustc_mir_transform/src/match_branches.rs:15 MatchBranchSimplification
export class MatchBranchSimplification extends MirPass {
  readonly type_name = "rustc_mir_transform::match_branches::MatchBranchSimplification";

  // rustc: compiler/rustc_mir_transform/src/match_branches.rs:18 policy
  policy(ctx: PassCtx): PassPolicy {
    // Enable only under -Zmir-opt-level=2 as this can make programs less debuggable.
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  // rustc: compiler/rustc_mir_transform/src/match_branches.rs:23 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const typing_env = body.typing_env(tcx);
    let changed = false;
    const n = body.basic_blocks.deref().length;
    for (let bb = 0 as BasicBlock; bb < n; bb = (bb + 1) as BasicBlock) {
      if (!candidate_match(body, bb)) {
        continue;
      }
      // PORT: `changed |= f()` evaluates `f()` unconditionally.
      changed = simplify_match(tcx, typing_env, body, bb) || changed;
    }

    if (changed) {
      simplify_cfg(tcx, body);
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/match_branches.rs:39 SimplifyMatch
class SimplifyMatch {
  constructor(
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public patch: MirPatch,
    public body: Body,
    public switch_bb: BasicBlock,
    public discr: Operand,
    public discr_local_: Local | undefined,
    public discr_ty: Ty,
    public borrowed_locals: DenseBitSet<Local> | undefined,
  ) {}

  // rustc: compiler/rustc_mir_transform/src/match_branches.rs:52 discr_local
  discr_local(): Local {
    if (this.discr_local_ === undefined) {
      // Introduce a temporary for the discriminant value.
      const source_info = this.body.basic_blocks.deref()[this.switch_bb]!.terminator_().source_info;
      this.discr_local_ = this.patch.new_temp(this.discr_ty, source_info.span);
    }
    return this.discr_local_;
  }

  /// Unifies the assignments if all rvalues are constants and equal.
  // rustc: compiler/rustc_mir_transform/src/match_branches.rs:61 unify_if_equal_const
  unify_if_equal_const(dest: Place, consts: readonly [bigint, ConstOperand][], otherwise: ConstOperand | undefined): StatementKind | undefined {
    const [, first_const, others] = split_first_case(consts, otherwise);
    const first_scalar_int = Const.try_eval_scalar_int(first_const.const_, this.tcx, this.typing_env);
    if (first_scalar_int === undefined) return undefined;
    if (
      others.every((const_) => {
        const v = Const.try_eval_scalar_int(const_.const_, this.tcx, this.typing_env);
        return v !== undefined && ScalarInt_eq(v, first_scalar_int);
      })
    ) {
      return {
        $: "Assign",
        _0: [
          dest,
          // We didn't remember the `WithRetag` of the original assignments, so in case
          // one of them had "no", we also have to use "no" here.
          { $: "Use", _0: { $: "Constant", _0: clone_ConstOperand(first_const) }, _1: WithRetag.No },
        ],
      };
    } else {
      return undefined;
    }
  }

  /// If a source block is found that switches between two blocks that are exactly
  /// the same modulo const bool assignments (e.g., one assigns true another false
  /// to the same place), unify a target block statements into the source block,
  /// using Eq / Ne comparison with switch value where const bools value differ.
  ///
  /// For example:
  ///
  /// ```ignore (MIR)
  /// bb0: {
  ///     switchInt(move _3) -> [42_isize: bb1, otherwise: bb2];
  /// }
  ///
  /// bb1: {
  ///     _2 = const true;
  ///     goto -> bb3;
  /// }
  ///
  /// bb2: {
  ///     _2 = const false;
  ///     goto -> bb3;
  /// }
  /// ```
  ///
  /// into:
  ///
  /// ```ignore (MIR)
  /// bb0: {
  ///    _2 = Eq(move _3, const 42_isize);
  ///    goto -> bb3;
  /// }
  /// ```
  // rustc: compiler/rustc_mir_transform/src/match_branches.rs:114 unify_by_eq_op
  unify_by_eq_op(dest: Place, consts: readonly [bigint, ConstOperand][], otherwise: ConstOperand | undefined): StatementKind | undefined {
    // FIXME: extend to any case.
    const [first_case, first_const, others] = split_first_case(consts, otherwise);
    if (!first_const.ty().is_bool()) {
      return undefined;
    }
    const first_bool = Const.try_eval_bool(first_const.const_, this.tcx, this.typing_env);
    if (first_bool === undefined) return undefined;
    if (others.every((const_) => Const.try_eval_bool(const_.const_, this.tcx, this.typing_env) === !first_bool)) {
      // Make value conditional on switch condition.
      const size = unwrap_result(this.tcx.layout_of(this.typing_env.as_query_input(this.discr_ty)), debug_LayoutError).size;
      const const_cmp = Operand.const_from_scalar(this.tcx, this.discr_ty, Scalar.from_uint(first_case, size), DUMMY_SP);
      const op = first_bool ? "Eq" : "Ne";
      const rval: Rvalue = { $: "BinaryOp", _0: op, _1: [{ $: "Copy", _0: Place_from_Local(this.discr_local()) }, const_cmp] };
      return { $: "Assign", _0: [dest, rval] };
    } else {
      return undefined;
    }
  }

  /// Unifies the assignments if all rvalues can be cast from the discriminant value by IntToInt.
  ///
  /// For example:
  ///
  /// ```ignore (MIR)
  /// bb0: {
  ///     switchInt(_1) -> [1: bb2, 2: bb3, 3: bb4, otherwise: bb1];
  /// }
  ///
  /// bb1: {
  ///     unreachable;
  /// }
  ///
  /// bb2: {
  ///     _0 = const 1_i16;
  ///     goto -> bb5;
  /// }
  ///
  /// bb3: {
  ///     _0 = const 2_i16;
  ///     goto -> bb5;
  /// }
  ///
  /// bb4: {
  ///     _0 = const 3_i16;
  ///     goto -> bb5;
  /// }
  /// ```
  ///
  /// into:
  ///
  /// ```ignore (MIR)
  /// bb0: {
  ///    _0 = _1 as i16 (IntToInt);
  ///    goto -> bb5;
  /// }
  /// ```
  // rustc: compiler/rustc_mir_transform/src/match_branches.rs:186 unify_by_int_to_int
  unify_by_int_to_int(dest: Place, consts: readonly [bigint, ConstOperand][]): StatementKind | undefined {
    const [, first_const] = consts[0]!;
    if (!first_const.ty().is_integral()) {
      return undefined;
    }
    const discr_layout = unwrap_result(this.tcx.layout_of(this.typing_env.as_query_input(this.discr_ty)), debug_LayoutError);
    if (
      consts.every(([case_, const_]) => {
        const scalar_int = Const.try_eval_scalar_int(const_.const_, this.tcx, this.typing_env);
        if (scalar_int === undefined) {
          return false;
        }
        return can_cast(this.tcx, case_, discr_layout, const_.ty(), scalar_int);
      })
    ) {
      const operand: Operand = { $: "Copy", _0: Place_from_Local(this.discr_local()) };
      let rval: Rvalue;
      if (first_const.ty() === this.discr_ty) {
        rval = { $: "Use", _0: operand, _1: WithRetag.No };
      } else {
        rval = { $: "Cast", _0: CastKind.IntToInt, _1: operand, _2: first_const.ty() };
      }
      return { $: "Assign", _0: [dest, rval] };
    } else {
      return undefined;
    }
  }

  /// This is primarily used to unify these copy statements that simplified the canonical enum clone method by GVN.
  /// The GVN simplified
  /// ```ignore (syntax-highlighting-only)
  /// match a {
  ///     Foo::A(x) => Foo::A(*x),
  ///     Foo::B => Foo::B
  /// }
  /// ```
  /// to
  /// ```ignore (syntax-highlighting-only)
  /// match a {
  ///     Foo::A(_x) => a, // copy a
  ///     Foo::B => Foo::B
  /// }
  /// ```
  /// This will simplify into a copy statement.
  // rustc: compiler/rustc_mir_transform/src/match_branches.rs:232 unify_by_copy
  unify_by_copy(dest: Place, rvals: readonly [bigint, Rvalue][]): StatementKind | undefined {
    const bbs = this.body.basic_blocks.deref();
    // Check if the copy source matches the following pattern.
    // _2 = discriminant(*_1); // "*_1" is the expected the copy source.
    // switchInt(move _2) -> [0: bb3, 1: bb2, otherwise: bb1];
    const stmts = bbs[this.switch_bb]!.statements;
    const last = stmts[stmts.length - 1];
    if (last === undefined) return undefined;
    if (last.kind.$ !== "Assign" || last.kind._0[1].$ !== "Discriminant") {
      return undefined;
    }
    const discr_place = last.kind._0[0];
    const copy_src_place = last.kind._0[1]._0;
    const self_discr_place = Operand.place(this.discr);
    if (!(self_discr_place !== undefined && place_eq(self_discr_place, discr_place))) {
      return undefined;
    }
    const src_ty = copy_src_place.ty(this.body.local_decls_(), this.tcx);
    if (!src_ty.ty.is_enum() || src_ty.variant_index !== undefined) {
      return undefined;
    }
    const dest_ty = dest.ty(this.body.local_decls_(), this.tcx);
    if (dest_ty.ty !== src_ty.ty || dest_ty.variant_index !== undefined) {
      return undefined;
    }
    const dest_kind = dest_ty.ty.kind();
    if (dest_kind.$ !== "Adt") {
      return undefined;
    }
    const def = dest_kind._0;

    if (copy_src_place.is_indirect()) {
      // If the src place is indirect, only permit generating the copy when the dest place is
      // never borrowed.
      const borrowed_locals_ = (this.borrowed_locals ??= borrowed_locals(this.body));
      if (borrowed_locals_.contains(dest.local)) {
        return undefined;
      }
    } else if (copy_src_place.local === dest.local) {
      // Also forbid the case where the source and dest are fields of the same local
      return undefined;
    }

    for (const [case_, rvalue] of rvals) {
      if (rvalue.$ === "Use" && rvalue._0.$ === "Constant" && rvalue._0._0.const_.$ === "Val") {
        // Check if `_3 = const Foo::B` can be transformed to `_3 = copy *_1`.
        const constant = rvalue._0._0;
        const const_ = rvalue._0._0.const_._0;
        const ty = rvalue._0._0.const_._1;
        const r = mk_eval_cx_for_const_val(this.tcx.at(constant.span), this.typing_env, const_, ty);
        if (r === undefined) return undefined;
        const [ecx, op] = r;
        const variant = InterpResult.discard_err(ecx.read_discriminant(op));
        if (variant === undefined) return undefined;
        if (!(def.variants()[variant]!.fields.length === 0)) {
          return undefined;
        }
        const discr = ty.discriminant_for_variant(this.tcx, variant);
        if (discr === undefined) return undefined;
        const { val } = discr;
        if (val !== case_) {
          return undefined;
        }
      } else if (rvalue.$ === "Use" && rvalue._0.$ === "Copy" && place_eq(rvalue._0._0, copy_src_place)) {
        // nothing
      } else if (rvalue.$ === "Aggregate" && rvalue._0.$ === "Adt" && rvalue._0._4 === undefined && rvalue._1.length === 0 && aggregate_discr_matches(this.tcx, src_ty.ty, rvalue._0._1, case_)) {
        // Check if `_3 = Foo::B` can be transformed to `_3 = copy *_1`.
      } else {
        return undefined;
      }
    }
    // We didn't remember the `WithRetag` of the original assignments, so in case
    // one of them had "no", we also have to use "no" here.
    return { $: "Assign", _0: [dest, { $: "Use", _0: { $: "Copy", _0: copy_src_place }, _1: WithRetag.No }] };
  }

  /// Returns a new statement if we can use the statement replace all statements.
  // rustc: compiler/rustc_mir_transform/src/match_branches.rs:317 try_unify_stmts
  try_unify_stmts(index: number, stmts: readonly [bigint, StatementKind][], otherwise: StatementKind | undefined): StatementKind | undefined {
    const new_stmt0 = identical_stmts(stmts, otherwise);
    if (new_stmt0 !== undefined) {
      return new_stmt0;
    }

    const ca = candidate_assign(stmts, otherwise);
    if (ca === undefined) return undefined;
    const [dest, rvals, otherwise_] = ca;
    const cc = candidate_const(rvals, otherwise_);
    if (cc !== undefined) {
      const [consts, otherwise__] = cc;
      const new_stmt1 = this.unify_if_equal_const(dest, consts, otherwise__);
      if (new_stmt1 !== undefined) {
        return new_stmt1;
      }
      const new_stmt2 = this.unify_by_eq_op(dest, consts, otherwise__);
      if (new_stmt2 !== undefined) {
        return new_stmt2;
      }
      // Requires the otherwise is unreachable.
      if (otherwise__ === undefined) {
        const new_stmt3 = this.unify_by_int_to_int(dest, consts);
        if (new_stmt3 !== undefined) {
          return new_stmt3;
        }
      }
    }

    // We only know the first statement is safe to introduce new dereferences.
    if (
      index === 0 &&
      // We cannot create overlapping assignments.
      dest.is_stable_offset() &&
      // Requires the otherwise is unreachable.
      otherwise_ === undefined
    ) {
      const new_stmt4 = this.unify_by_copy(dest, rvals);
      if (new_stmt4 !== undefined) {
        return new_stmt4;
      }
    }
    return undefined;
  }
}

/** The guard of the `Rvalue::Aggregate(AggregateKind::Adt(..))` arm of `unify_by_copy` (`let Some(Discr { val, .. }) = .. && val == case`). */
function aggregate_discr_matches(tcx: TyCtxt, src_ty: Ty, variant_index: VariantIdx, case_: bigint): boolean {
  const discr = src_ty.discriminant_for_variant(tcx, variant_index);
  return discr !== undefined && discr.val === case_;
}

/// Returns the first case target if all targets have an equal number of statements and identical destination.
// rustc: compiler/rustc_mir_transform/src/match_branches.rs:358 candidate_match
function candidate_match(body: Body, switch_bb: BasicBlock): boolean {
  // use itertools::Itertools;
  const kind = body.basic_blocks.deref()[switch_bb]!.terminator_().kind;
  if (!(kind.$ === "SwitchInt" && (kind.discr.$ === "Copy" || kind.discr.$ === "Move"))) {
    // Only optimize switch int statements
    return false;
  }
  const targets = kind.targets;
  // We require that the possible target blocks don't contain this block.
  if (targets.all_targets().includes(switch_bb)) {
    return false;
  }
  // We require that the possible target blocks all be distinct.
  if (!targets.is_distinct()) {
    return false;
  }
  // Check that destinations are identical, and if not, then don't optimize this block
  let first: [number, unknown] | undefined;
  for (const bb of targets.all_targets()) {
    const bbdata = body.basic_blocks.deref()[bb]!;
    if (bbdata.is_empty_unreachable()) continue;
    const item: [number, unknown] = [bbdata.statements.length, bbdata.terminator_().kind];
    if (first === undefined) {
      first = item;
    } else if (!(first[0] === item[0] && intern_key_eq(first[1], item[1]))) {
      return false;
    }
  }
  return true;
}

// rustc: compiler/rustc_mir_transform/src/match_branches.rs:385 simplify_match
function simplify_match(tcx: TyCtxt, typing_env: TypingEnv, body: Body, switch_bb: BasicBlock): boolean {
  const kind = body.basic_blocks.deref()[switch_bb]!.terminator_().kind;
  if (kind.$ !== "SwitchInt") unreachable();
  const discr = kind.discr;
  const targets = kind.targets;
  const simplify_match = new SimplifyMatch(tcx, typing_env, MirPatch.new(body), body, switch_bb, discr, undefined, Operand.ty(discr, body.local_decls_(), tcx), undefined);
  const reachable_cases = [...targets.iter()].filter(([, bb]) => !body.basic_blocks.deref()[bb]!.is_empty_unreachable());
  const new_stmts: StatementKind[] = [];
  const otherwise = body.basic_blocks.deref()[targets.otherwise()]!.is_empty_unreachable() ? undefined : targets.otherwise();
  // We can patch the terminator to goto because there is a single target.
  if ((reachable_cases.length === 1 && otherwise === undefined) || (reachable_cases.length === 0 && otherwise !== undefined)) {
    const patch = simplify_match.patch;
    remove_successors_from_switch(tcx, switch_bb, body, patch, (bb) => body.basic_blocks.deref()[bb]!.is_empty_unreachable());
    patch.apply(body);
    return true;
  }
  const first = reachable_cases[0];
  if (first === undefined) {
    return false;
  }
  const [, first_case_bb] = first;
  const stmt_len = body.basic_blocks.deref()[first_case_bb]!.statements.length;
  const cases: [bigint, StatementKind][] = [];
  // Check at each position in the basic blocks whether these statements can be unified.
  for (let index = 0; index < stmt_len; index++) {
    cases.length = 0;
    const otherwise_ = otherwise === undefined ? undefined : body.basic_blocks.deref()[otherwise]!.statements[index]!.kind;
    for (const [case_, bb] of reachable_cases) {
      cases.push([case_, body.basic_blocks.deref()[bb]!.statements[index]!.kind]);
    }
    const new_stmt = simplify_match.try_unify_stmts(index, cases, otherwise_);
    if (new_stmt === undefined) {
      return false;
    }
    new_stmts.push(new_stmt);
  }
  // Take ownership of items now that we know we can optimize.
  const discr_ = clone_Operand(discr);

  const statement_index = body.basic_blocks.deref()[switch_bb]!.statements.length;
  const parent_end: Location = { block: switch_bb, statement_index } as Location;
  const patch = simplify_match.patch;
  if (simplify_match.discr_local_ !== undefined) {
    patch.add_statement(parent_end, { $: "StorageLive", _0: simplify_match.discr_local_ });
    patch.add_assign(parent_end, Place_from_Local(simplify_match.discr_local_), { $: "Use", _0: discr_, _1: WithRetag.No });
  }
  for (const new_stmt of new_stmts) {
    patch.add_statement(parent_end, new_stmt);
  }
  if (simplify_match.discr_local_ !== undefined) {
    patch.add_statement(parent_end, { $: "StorageDead", _0: simplify_match.discr_local_ });
  }
  patch.patch_terminator(switch_bb, clone_TerminatorKind(body.basic_blocks.deref()[first_case_bb]!.terminator_().kind));
  patch.apply(body);
  return true;
}

/// Check if the cast constant using `IntToInt` is equal to the target constant.
// rustc: compiler/rustc_mir_transform/src/match_branches.rs:465 can_cast
function can_cast(tcx: TyCtxt, src_val: bigint, src_layout: TyAndLayout, cast_ty: Ty, target_scalar: ScalarInt): boolean {
  const from_scalar = unwrap(ScalarInt.try_from_uint(src_val, src_layout.size));
  let v: bigint;
  const src_kind = src_layout.ty.kind();
  switch (src_kind.$) {
    case "Uint":
      v = from_scalar.to_uint(src_layout.size);
      break;
    case "Int":
      // PORT: `as u128` of the `i128`.
      v = BigInt.asUintN(128, from_scalar.to_int(src_layout.size));
      break;
    // We can also transform the values of other integer representations (such as char),
    // although this may not be practical in real-world scenarios.
    default:
      return false;
  }
  let size: Size;
  const cast_kind = cast_ty.kind();
  switch (cast_kind.$) {
    case "Int":
      size = Integer.size(IntegerExt.from_int_ty(tcx, cast_kind._0));
      break;
    case "Uint":
      size = Integer.size(IntegerExt.from_uint_ty(tcx, cast_kind._0));
      break;
    default:
      return false;
  }
  v = size.truncate(v);
  const cast_scalar = unwrap(ScalarInt.try_from_uint(v, size));
  return ScalarInt_eq(cast_scalar, target_scalar);
}

// rustc: compiler/rustc_mir_transform/src/match_branches.rs:490 candidate_assign
function candidate_assign(
  stmts: readonly [bigint, StatementKind][],
  otherwise: StatementKind | undefined,
): [Place, [bigint, Rvalue][], Rvalue | undefined] | undefined {
  const [, first_stmt] = stmts[0]!;
  const fa = StatementKind.as_assign(first_stmt);
  if (fa === undefined) return undefined;
  const [dest] = fa;
  let otherwise_: Rvalue | undefined;
  if (otherwise !== undefined) {
    const oa = StatementKind.as_assign(otherwise);
    if (oa === undefined) {
      return undefined;
    }
    const [otherwise_dest, rval] = oa;
    if (!place_eq(otherwise_dest, dest)) {
      return undefined;
    }
    otherwise_ = rval;
  } else {
    otherwise_ = undefined;
  }
  const rvals: [bigint, Rvalue][] = [];
  for (const [case_, stmt] of stmts) {
    const a = StatementKind.as_assign(stmt);
    if (a === undefined) return undefined;
    const [other_dest, rval] = a;
    if (!place_eq(other_dest, dest)) {
      return undefined;
    }
    rvals.push([case_, rval]);
  }
  return [dest, rvals, otherwise_];
}

// Returns all ConstOperands if all Rvalues are ConstOperands.
// rustc: compiler/rustc_mir_transform/src/match_branches.rs:521 candidate_const
function candidate_const(
  rvals: readonly [bigint, Rvalue][],
  otherwise: Rvalue | undefined,
): [[bigint, ConstOperand][], ConstOperand | undefined] | undefined {
  // We ignore the retag mode here, which means the `Use` we insert later must be without retag.
  let otherwise_: ConstOperand | undefined;
  if (otherwise !== undefined) {
    if (!(otherwise.$ === "Use" && otherwise._0.$ === "Constant")) {
      return undefined;
    }
    otherwise_ = otherwise._0._0;
  } else {
    otherwise_ = undefined;
  }
  const consts: [bigint, ConstOperand][] = [];
  for (const [case_, rval] of rvals) {
    if (!(rval.$ === "Use" && rval._0.$ === "Constant")) return undefined;
    consts.push([case_, rval._0._0]);
  }
  return [consts, otherwise_];
}

// Returns the first case and others (including otherwise if present).
// rustc: compiler/rustc_mir_transform/src/match_branches.rs:545 split_first_case
function split_first_case<T>(stmts: readonly [bigint, T][], otherwise: T | undefined): [bigint, T, T[]] {
  const [first_case, first] = stmts[0]!;
  const others = stmts.slice(1).map(([, val]) => val);
  if (otherwise !== undefined) others.push(otherwise);
  return [first_case, first, others];
}

// If all statements are identical, we can optimize.
// rustc: compiler/rustc_mir_transform/src/match_branches.rs:554 identical_stmts
function identical_stmts(stmts: readonly [bigint, StatementKind][], otherwise: StatementKind | undefined): StatementKind | undefined {
  // use itertools::Itertools;
  const [, first_stmt, others] = split_first_case(stmts, otherwise);
  if (others.every((s) => intern_key_eq(first_stmt, s))) {
    return clone_StatementKind(first_stmt);
  }
  return undefined;
}
