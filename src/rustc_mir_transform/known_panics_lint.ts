//! A lint that checks for known panics like overflows, division by zero,
//! out-of-bound access etc. Uses const propagation to determine the values of
//! operands during checks.
//
// Port of compiler/rustc_mir_transform/src/known_panics_lint.rs (lane mt-kpl-ubchecks).
//
// PORT: `ConstPropagator` and `CanConstProp` are classes extending rustc_middle mir/visit.ts's `Visitor` (D4).
// `Option<()>` is `null` (Some(())) / `undefined` (None) (precedent rustc_session config.ts). `&mut Value` (`project_mut`,
// `access_mut`) is a `MutRef<Value>` view onto the slot (PORTING §8). `Value` objects are never shared between slots
// (every assigned value is built fresh), so `Value::Aggregate`'s `variant` is mutated in place (`SetDiscriminant`).
// The interpreter values (`ImmTy`, `OpTy`) and `InterpCx<DummyMachine>` come from rustc_const_eval (D8): reached through
// its `lib.ts` at call time.
import { Size, type TargetDataLayout } from "../rustc_abi/lib.ts";
import { FieldIdx, VariantIdx } from "../rustc_abi/layout.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { const_eval, interpret } from "../rustc_const_eval/lib.ts";
import type { DummyMachine } from "../rustc_const_eval/const_eval/dummy_machine.ts";
import type { ImmTy, InterpCx } from "../rustc_const_eval/interpret/mod.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { DefKind } from "../rustc_hir/def.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { IndexVec } from "../rustc_index/vec.ts";
import { UNCONDITIONAL_PANIC } from "../rustc_lint_defs/builtin.ts";
import { InterpErrorKind, InterpResult, Scalar, interp_ok } from "../rustc_middle/mir/interpret/mod.ts";
import {
  type AssertKind,
  type AssertMessage,
  type BasicBlock,
  type BasicBlockData,
  BinOp,
  type Body,
  type ConstOperand,
  debug_Local,
  type Local,
  type LocalDecl,
  type Location,
  type Operand,
  Operand as OperandC,
  type Place,
  type PlaceElem,
  Place_from_Local,
  type Rvalue,
  Rvalue as RvalueC,
  type SourceInfo,
  SourceScope,
  START_BLOCK,
  type Statement,
  type Terminator,
  type UnOp,
} from "../rustc_middle/mir/mod.ts";
import { fold_Const as fold_mir_Const } from "../rustc_middle/mir/consts.ts";
import { visit_with_ConstOperand, visit_with_Rvalue } from "../rustc_middle/mir/syntax.gen.ts";
import { debug_PlaceContext, type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import { ConstInt, debug_ConstInt, ScalarInt } from "../rustc_middle/ty/consts/int.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import type { LayoutError, TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { HasAttrs_DefId, type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import type { TypeVisitable } from "../rustc_type_ir/visit.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { type Debug, type Fmt, PLAIN } from "../std/fmt.ts";
import { field_mut, type MutRef } from "../std/mut_ref.ts";
import { assert, unwrap } from "../std/panic.ts";
import { intern_key_eq } from "../rust_ts/intern_key.ts";
import { AssertLint_diagnostic, type AssertLintKind, AssertLintKind_lint, ConstNIsZero_diagnostic } from "./diagnostics.ts";
import { MirLint } from "./pass_manager.ts";

/** `impl TypeVisitable for ConstOperand` (derived, syntax.gen.ts) as a D4 descriptor. */
const ConstOperand_visitable: TypeVisitable<ConstOperand> = { visit_with: (self, visitor) => visit_with_ConstOperand(self, visitor) };
/** `impl TypeVisitable for Rvalue` (derived, syntax.gen.ts) as a D4 descriptor. */
const Rvalue_visitable: TypeVisitable<Rvalue> = { visit_with: (self, visitor) => visit_with_Rvalue(self, visitor) };

// rustc-type: compiler/rustc_mir_transform/src/known_panics_lint.rs:30 KnownPanicsLint
export class KnownPanicsLint extends MirLint {
  readonly type_name = "rustc_mir_transform::known_panics_lint::KnownPanicsLint";

  // impl<'tcx> crate::MirLint<'tcx> for KnownPanicsLint
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:33 run_lint
  run_lint(tcx: TyCtxt, body: Body): void {
    if (body.tainted_by_errors !== undefined) {
      return;
    }

    const def_id = body.source.def_id().expect_local();
    const def_kind = tcx.def_kind(def_id);
    const is_fn_like = DefKind.is_fn_like(def_kind);
    const is_assoc_const = def_kind.$ === "AssocConst";

    // Only run const prop on functions, methods, closures and associated constants
    if (!is_fn_like && !is_assoc_const) {
      // skip anon_const/statics/consts because they'll be evaluated by miri anyway
      // trace!("KnownPanicsLint skipped for {:?}", def_id);
      return;
    }

    // FIXME(welseywiser) const prop doesn't work on coroutines because of query cycles
    // computing their layout.
    if (tcx.is_coroutine(LocalDefId.to_def_id(def_id))) {
      // trace!("KnownPanicsLint skipped for coroutine {:?}", def_id);
      return;
    }

    // trace!("KnownPanicsLint starting for {:?}", def_id);

    const linter = ConstPropagator.new(body, tcx);
    linter.visit_body(body);

    // trace!("KnownPanicsLint done for {:?}", def_id);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/known_panics_lint.rs:81 Value
// #[derive(Debug, Clone)]
// PORT: the derived `Debug` is only read by `trace!` and the skipped `cfg!(debug_assertions)` block of
// `ensure_not_propagated`, so it is not ported.
type Value =
  | { readonly $: "Immediate"; _0: ImmTy }
  | { readonly $: "Aggregate"; variant: VariantIdx; fields: Value[] }
  | { readonly $: "Uninit" };
const Value = {
  Uninit: Object.freeze({ $: "Uninit" as const }) as Value,

  // impl<'tcx> From<ImmTy<'tcx>> for Value<'tcx>
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:88 from
  from(v: ImmTy): Value {
    return { $: "Immediate", _0: v };
  },

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:94 project
  project(self: Value, proj: readonly PlaceElem[], prop: ConstPropagator): Value | undefined {
    let this_ = self;
    for (const proj_ of proj) {
      if (proj_.$ === "Field" && this_.$ === "Aggregate") {
        this_ = this_.fields[proj_._0] ?? Value.Uninit;
      } else if (proj_.$ === "Index" && this_.$ === "Aggregate") {
        const fields = this_.fields;
        const idx_v = prop.get_const(Place_from_Local(proj_._0));
        if (idx_v === undefined) return undefined;
        const idx_imm = Value.immediate(idx_v);
        if (idx_imm === undefined) return undefined;
        const idx_u64 = InterpResult.discard_err(prop.ecx.read_target_usize(idx_imm));
        if (idx_u64 === undefined) return undefined;
        // `u64::try_into::<u32>().ok()?`
        if (idx_u64 > 0xffff_ffffn) return undefined;
        const idx = Number(idx_u64);
        if (idx <= FieldIdx.MAX_AS_U32) {
          this_ = fields[FieldIdx.from_u32(idx)] ?? Value.Uninit;
        } else {
          return undefined;
        }
      } else if (proj_.$ === "ConstantIndex" && !proj_.from_end && this_.$ === "Aggregate") {
        const offset = proj_.offset;
        // `u64::try_into::<u32>().ok()?`
        if (offset > 0xffff_ffff) return undefined;
        this_ = this_.fields[FieldIdx.from_u32(offset)] ?? Value.Uninit;
      } else {
        return undefined;
      }
    }
    return this_;
  },

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:126 project_mut
  project_mut(self: MutRef<Value>, proj: readonly PlaceElem[]): MutRef<Value> | undefined {
    let this_ = self;
    for (const proj_ of proj) {
      const val = this_.value;
      if (proj_.$ === "Field" && val.$ === "Aggregate") {
        const fields = val.fields;
        IndexVec.ensure_contains_elem(fields, proj_._0, () => Value.Uninit);
        this_ = field_mut(fields, proj_._0);
      } else if (proj_.$ === "Field" && val.$ === "Uninit") {
        this_.value = { $: "Aggregate", variant: VariantIdx.ZERO, fields: [] };
        const r = Value.project_mut(this_, [proj_]);
        if (r === undefined) return undefined;
        this_ = r;
      } else {
        return undefined;
      }
    }
    return this_;
  },

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:144 immediate
  immediate(self: Value): ImmTy | undefined {
    switch (self.$) {
      case "Immediate":
        return self._0;
      default:
        return undefined;
    }
  },
};

// rustc-type: compiler/rustc_mir_transform/src/known_panics_lint.rs:68 ConstPropagator
/// Visits MIR nodes, performs const propagation
/// and runs lint checks as it goes
class ConstPropagator extends Visitor {
  constructor(
    public ecx: InterpCx<DummyMachine>,
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public worklist: BasicBlock[],
    public visited_blocks: DenseBitSet<BasicBlock>,
    public locals: Value[],
    public body: Body,
    public written_only_inside_own_block_locals: Set<Local>,
    public can_const_prop: ConstPropMode[],
  ) {
    super();
  }

  // impl<'tcx> LayoutOfHelpers<'tcx> for ConstPropagator<'_, 'tcx>
  // PORT: `LayoutOf::layout_of` on `self` is only reached from the skipped `cfg!(debug_assertions)` block of
  // `ensure_not_propagated`; the helper methods are kept as plain methods.
  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:156 handle_layout_err
  handle_layout_err(err: LayoutError, _1: Span, _2: Ty): LayoutError {
    return err;
  }

  // impl HasDataLayout for ConstPropagator<'_, '_>
  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:163 data_layout
  data_layout(): TargetDataLayout {
    return this.tcx.data_layout();
  }

  // impl<'tcx> ty::layout::HasTyCtxt<'tcx> for ConstPropagator<'_, 'tcx>
  // PORT (layout-contract): `tcx()` is `tcx_()` (the field keeps its name).
  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:170 tcx
  tcx_(): TyCtxt {
    return this.tcx;
  }

  // impl<'tcx> ty::layout::HasTypingEnv<'tcx> for ConstPropagator<'_, 'tcx>
  // PORT (layout-contract): `typing_env()` is `typing_env_()` (the field keeps its name).
  // #[inline]
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:177 typing_env
  typing_env_(): TypingEnv {
    return this.typing_env;
  }

  // impl<'mir, 'tcx> ConstPropagator<'mir, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:183 new
  static new(body: Body, tcx: TyCtxt): ConstPropagator {
    const def_id = body.source.def_id();
    // FIXME(#132279): This is used during the phase transition from analysis
    // to runtime, so we have to manually specify the correct typing mode.
    const typing_env = TypingEnv.post_analysis(tcx, body.source.def_id());
    const can_const_prop = CanConstProp.check(tcx, typing_env, body);
    const ecx = interpret.InterpCx.new(tcx, tcx.def_span(def_id), typing_env, new const_eval.DummyMachine());

    return new ConstPropagator(
      ecx,
      tcx,
      typing_env,
      [START_BLOCK],
      DenseBitSet.new_empty(body.basic_blocks.deref().length),
      body.local_decls.map(() => Value.Uninit),
      body,
      new Set(),
      can_const_prop,
    );
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:204 local_decls
  local_decls(): LocalDecl[] {
    return this.body.local_decls;
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:208 get_const
  get_const(place: Place): Value | undefined {
    return Value.project(this.locals[place.local]!, place.projection, this);
  }

  /// Remove `local` from the pool of `Locals`. Allows writing to them,
  /// but not reading from them anymore.
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:214 remove_const
  remove_const(local: Local): void {
    this.locals[local] = Value.Uninit;
    this.written_only_inside_own_block_locals.delete(local);
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:219 access_mut
  access_mut(place: Place): MutRef<Value> | undefined {
    switch (this.can_const_prop[place.local]!) {
      case "NoPropagation":
        return undefined;
      case "OnlyInsideOwnBlock":
        this.written_only_inside_own_block_locals.add(place.local);
        break;
      case "FullConstProp":
        break;
    }
    return Value.project_mut(field_mut(this.locals, place.local), place.projection);
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:230 lint_root
  lint_root(source_info: SourceInfo): HirId | undefined {
    return SourceScope.lint_root(source_info.scope, this.body.source_scopes);
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:234 use_ecx
  use_ecx<T>(f: (this_: ConstPropagator) => InterpResult<T>): T | undefined {
    return InterpResult.discard_err(
      InterpResult.inspect_err_info(f(this), (err) => {
        // trace!("InterpCx operation failed: {:?}", err);
        // Some errors shouldn't come up because creating them causes
        // an allocation, which we should avoid. When that happens,
        // dedicated error variants should be introduced instead.
        // PORT: the message is a thunk, formatted only on failure (`assert!` formats lazily).
        const formatted = InterpErrorKind.formatted_string(err.kind());
        assert(!formatted, () => `known panics lint encountered formatting error: ${err.to_string()}`);
      }),
    );
  }

  /// Returns the value, if any, of evaluating `c`.
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:254 eval_constant
  eval_constant(c: ConstOperand): ImmTy | undefined {
    // FIXME we need to revisit this for #67176
    if (TypeVisitableExt.has_param(c, ConstOperand_visitable)) {
      return undefined;
    }

    // Normalization needed b/c known panics lint runs in
    // `mir_drops_elaborated_and_const_checked`, which happens before
    // optimized MIR. Only after optimizing the MIR can we guarantee
    // that the `PostAnalysisNormalize` pass has happened and that the body's consts
    // are normalized, so any call to resolve before that needs to be
    // manually normalized.
    const val_ = this.tcx.try_normalize_erasing_regions(this.typing_env, Unnormalized.new_wip(c.const_), fold_mir_Const);
    if (val_.$ === "Err") return undefined;
    const val = val_._0;

    const op = this.use_ecx((this_) => this_.ecx.eval_mir_constant(val, c.span, undefined));
    if (op === undefined) return undefined;
    // `.as_mplace_or_imm().right()`
    const e = op.as_mplace_or_imm();
    return e.$ === "Right" ? e._0 : undefined;
  }

  /// Returns the value, if any, of evaluating `place`.
  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:278 eval_place
  eval_place(place: Place): ImmTy | undefined {
    const v = this.get_const(place);
    if (v === undefined) return undefined;
    switch (v.$) {
      case "Immediate":
        // `imm.clone()` (PORT: interpreter values are shared, interp-contract decision 4)
        return v._0;
      case "Aggregate":
        return undefined;
      case "Uninit":
        return undefined;
    }
  }

  /// Returns the value, if any, of evaluating `op`. Calls upon `eval_constant`
  /// or `eval_place`, depending on the variant of `Operand` used.
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:288 eval_operand
  eval_operand(op: Operand): ImmTy | undefined {
    switch (op.$) {
      case "RuntimeChecks":
        return undefined;
      case "Constant":
        return this.eval_constant(op._0);
      case "Move":
      case "Copy":
        return this.eval_place(op._0);
    }
  }

  // PORT: `assert_kind: AssertKind<impl Debug>` takes the `Debug` of the operand type (`debug_P`), as
  // `AssertLint_diagnostic` does.
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:296 report_assert_as_lint
  report_assert_as_lint<P>(location: Location, lint_kind: AssertLintKind, assert_kind: AssertKind<P>, debug_P: Debug<P>): void {
    const source_info = this.body.source_info(location);
    const lint_root = this.lint_root(source_info);
    if (lint_root !== undefined) {
      const span = source_info.span;
      this.tcx.emit_node_span_lint(
        AssertLintKind_lint(lint_kind),
        lint_root,
        span,
        AssertLint_diagnostic({ span, assert_kind, lint_kind }, debug_P),
      );
    }
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:314 check_unary_op
  check_unary_op(op: UnOp, arg_: Operand, location: Location): null | undefined {
    const arg = this.eval_operand(arg_);
    if (arg === undefined) return undefined;
    // The only operator that can overflow is `Neg`.
    if (op === "Neg" && arg.layout.ty.is_integral()) {
      // Compute this as `0 - arg` so we can use `SubWithOverflow` to check for overflow.
      const r = this.use_ecx((this_): InterpResult<[ImmTy, boolean]> => {
        const arg_r = this_.ecx.read_immediate(arg);
        if (arg_r.$ === "Err") return arg_r;
        const arg_ = arg_r._0;
        const res = this_.ecx.binary_op("SubWithOverflow", interpret.ImmTy.from_int(0n, arg_.layout), arg_);
        if (res.$ === "Err") return res;
        const [_res, overflow] = interpret.Immediate.to_scalar_pair(res._0.imm);
        const overflow_b = Scalar.to_bool(overflow);
        if (overflow_b.$ === "Err") return overflow_b;
        return interp_ok([arg_, overflow_b._0]);
      });
      if (r === undefined) return undefined;
      const [arg2, overflow] = r;
      if (overflow) {
        this.report_assert_as_lint(
          location,
          "ArithmeticOverflow",
          { $: "OverflowNeg", _0: arg2.to_const_int() },
          debug_ConstInt,
        );
        return undefined;
      }
    }

    return null;
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:340 check_binary_op
  check_binary_op(op_: BinOp, left: Operand, right: Operand, location: Location): null | undefined {
    const r_ = this.eval_operand(right);
    const r = r_ === undefined ? undefined : this.use_ecx((this_) => this_.ecx.read_immediate(r_));
    const l_ = this.eval_operand(left);
    const l = l_ === undefined ? undefined : this.use_ecx((this_) => this_.ecx.read_immediate(l_));
    // Check for exceeding shifts *even if* we cannot evaluate the LHS.
    if (op_ === "Shr" || op_ === "Shl") {
      // `r.clone()?`
      if (r === undefined) return undefined;
      // We need the type of the LHS. We cannot use `place_layout` as that is the type
      // of the result, which for checked binops is not the same!
      const left_ty = OperandC.ty(left, this.local_decls(), this.tcx);
      const left_layout = this.ecx.layout_of(left_ty);
      if (left_layout.$ === "Err") return undefined;
      const left_size = left_layout._0.size;
      const right_size = r.layout.size;
      const r_bits = InterpResult.discard_err(Scalar.to_bits(interpret.Immediate.to_scalar(r.imm), right_size));
      if (r_bits !== undefined && r_bits >= BigInt(left_size.bits())) {
        // debug!("check_binary_op: reporting assert for {:?}", location);
        const panic: AssertKind<ConstInt> = {
          $: "Overflow",
          _0: op_,
          // Invent a dummy value, the diagnostic ignores it anyway
          _1: new ConstInt(unwrap(ScalarInt.try_from_uint(1n, left_size)), left_ty.is_signed(), left_ty.is_ptr_sized_integral()),
          _2: r.to_const_int(),
        };
        this.report_assert_as_lint(location, "ArithmeticOverflow", panic, debug_ConstInt);
        return undefined;
      }
    }

    // Div/Rem are handled via the assertions they trigger.
    // But for Add/Sub/Mul, those assertions only exist in debug builds, and we want to
    // lint in release builds as well, so we check on the operation instead.
    // So normalize to the "overflowing" operator, and then ensure that it
    // actually is an overflowing operator.
    const op = BinOp.wrapping_to_overflowing(op_) ?? op_;
    // The remaining operators are handled through `wrapping_to_overflowing`.
    if (l !== undefined && r !== undefined && l.layout.ty.is_integral() && BinOp.is_overflowing(op)) {
      const overflow = this.use_ecx((this_) => {
        const res = this_.ecx.binary_op(op, l, r);
        if (res.$ === "Err") return res;
        const [_res, overflow] = interpret.Immediate.to_scalar_pair(res._0.imm);
        return Scalar.to_bool(overflow);
      });
      // `self.use_ecx(..)?` inside the `let` chain
      if (overflow === undefined) return undefined;
      if (overflow) {
        this.report_assert_as_lint(
          location,
          "ArithmeticOverflow",
          { $: "Overflow", _0: op, _1: l.to_const_int(), _2: r.to_const_int() },
          debug_ConstInt,
        );
        return undefined;
      }
    }

    return null;
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:403 check_rvalue
  check_rvalue(rvalue: Rvalue, location: Location): null | undefined {
    // Perform any special handling for specific Rvalue types.
    // Generally, checks here fall into one of two categories:
    //   1. Additional checking to provide useful lints to the user
    //        - In this case, we will do some validation and then fall through to the
    //          end of the function which evals the assignment.
    //   2. Working around bugs in other parts of the compiler
    //        - In this case, we'll return `None` from this function to stop evaluation.
    switch (rvalue.$) {
      // Additional checking: give lints to the user if an overflow would occur.
      // We do this here and not in the `Assert` terminator as that terminator is
      // only sometimes emitted (overflow checks can be disabled), but we want to always
      // lint.
      case "UnaryOp": {
        // trace!("checking UnaryOp(op = {:?}, arg = {:?})", op, arg);
        if (this.check_unary_op(rvalue._0, rvalue._1, location) === undefined) return undefined;
        break;
      }
      case "BinaryOp": {
        // trace!("checking BinaryOp(op = {:?}, left = {:?}, right = {:?})", op, left, right);
        if (this.check_binary_op(rvalue._0, rvalue._1[0], rvalue._1[1], location) === undefined) return undefined;
        break;
      }

      // Do not try creating references (#67862)
      case "RawPtr":
      case "Ref":
      case "Reborrow": {
        const place = rvalue.$ === "RawPtr" ? rvalue._1 : rvalue._2;
        // trace!("skipping RawPtr | Ref | Reborrow for {:?}", place);

        // This may be creating mutable references or immutable references to cells.
        // If that happens, the pointed to value could be mutated via that reference.
        // Since we aren't tracking references, the const propagator loses track of what
        // value the local has right now.
        // Thus, all locals that have their reference taken
        // must not take part in propagation.
        this.remove_const(place.local);

        return undefined;
      }
      case "ThreadLocalRef": {
        // trace!("skipping ThreadLocalRef({:?})", def_id);

        return undefined;
      }

      // There's no other checking to do at this time.
      case "Aggregate":
      case "Use":
      case "CopyForDeref":
      case "Repeat":
      case "Cast":
      case "Discriminant":
      case "WrapUnsafeBinder":
        break;
    }

    // FIXME we need to revisit this for #67176
    if (TypeVisitableExt.has_param(rvalue, Rvalue_visitable)) {
      return undefined;
    }
    if (!RvalueC.ty(rvalue, this.local_decls(), this.tcx).is_sized(this.tcx, this.typing_env)) {
      // the interpreter doesn't support unsized locals (only unsized arguments),
      // but rustc does (in a kinda broken way), so we have to skip them here
      return undefined;
    }

    return null;
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:468 check_assertion
  check_assertion(expected_: boolean, msg_: AssertMessage, cond: Operand, location: Location): void {
    const value = this.eval_operand(cond);
    if (value === undefined) return;
    // trace!("assertion on {:?} should be {:?}", value, expected);

    const expected = Scalar.from_bool(expected_);
    const value_const = this.use_ecx((this_) => this_.ecx.read_scalar(value));
    if (value_const === undefined) return;

    // PORT: `Scalar`'s derived `PartialEq` is the intern key's (rust_ts/intern_key.ts).
    if (!intern_key_eq(expected, value_const)) {
      // Poison all places this operand references so that further code
      // doesn't use the invalid value
      const place = OperandC.place(cond);
      if (place !== undefined) {
        this.remove_const(place.local);
      }

      const eval_to_int = (op: Operand): DbgVal<ConstInt> => {
        // This can be `None` if the lhs wasn't const propagated and we just
        // triggered the assert on the value of the rhs.
        const op_ = this.eval_operand(op);
        const imm = op_ === undefined ? undefined : InterpResult.discard_err(this.ecx.read_immediate(op_));
        return imm === undefined ? DbgVal.Underscore : { $: "Val", _0: imm.to_const_int() };
      };
      let msg: AssertKind<DbgVal<ConstInt>>;
      switch (msg_.$) {
        case "DivisionByZero":
          msg = { $: "DivisionByZero", _0: eval_to_int(msg_._0) };
          break;
        case "RemainderByZero":
          msg = { $: "RemainderByZero", _0: eval_to_int(msg_._0) };
          break;
        case "Overflow": {
          const bin_op = msg_._0;
          if (bin_op === "Div" || bin_op === "Rem") {
            // Division overflow is *UB* in the MIR, and different than the
            // other overflow checks.
            msg = { $: "Overflow", _0: bin_op, _1: eval_to_int(msg_._1), _2: eval_to_int(msg_._2) };
            break;
          }
          // Remaining overflow errors are already covered by checks on the binary operators.
          return;
        }
        case "BoundsCheck": {
          const len = eval_to_int(msg_.len);
          const index = eval_to_int(msg_.index);
          msg = { $: "BoundsCheck", len, index };
          break;
        }
        // Remaining overflow errors are already covered by checks on the binary operators.
        case "OverflowNeg":
          return;
        // Need proper const propagator for these.
        default:
          return;
      }
      this.report_assert_as_lint(location, "UnconditionalPanic", msg, (v, f) => debug_DbgVal(v, f, debug_ConstInt));
    }
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:529 ensure_not_propagated
  ensure_not_propagated(_local: Local): void {
    // PORT: the body is a `cfg!(debug_assertions)` block (skipped: rustc ships without debug assertions).
  }

  // #[instrument(level = "trace", skip(self), ret)]
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:543 eval_rvalue
  eval_rvalue(rvalue: Rvalue, dest: Place): null | undefined {
    if (dest.projection.length !== 0) {
      return undefined;
    }
    // use rustc_middle::mir::Rvalue::*;
    const layout = this.ecx.layout_of(dest.ty(this.body, this.tcx).ty);
    if (layout.$ === "Err") return undefined;
    // trace!(?layout);

    let val: Value;
    switch (rvalue.$) {
      case "ThreadLocalRef":
        return undefined;

      case "Use":
      case "WrapUnsafeBinder": {
        const v = this.eval_operand(rvalue._0);
        if (v === undefined) return undefined;
        val = Value.from(v);
        break;
      }

      case "CopyForDeref":
      case "Reborrow": {
        const place = rvalue.$ === "CopyForDeref" ? rvalue._0 : rvalue._2;
        const v = this.eval_place(place);
        if (v === undefined) return undefined;
        val = Value.from(v);
        break;
      }

      case "BinaryOp": {
        const bin_op = rvalue._0;
        const left_ = this.eval_operand(rvalue._1[0]);
        if (left_ === undefined) return undefined;
        const left = this.use_ecx((this_) => this_.ecx.read_immediate(left_));
        if (left === undefined) return undefined;

        const right_ = this.eval_operand(rvalue._1[1]);
        if (right_ === undefined) return undefined;
        const right = this.use_ecx((this_) => this_.ecx.read_immediate(right_));
        if (right === undefined) return undefined;

        const v = this.use_ecx((this_) => this_.ecx.binary_op(bin_op, left, right));
        if (v === undefined) return undefined;
        if (v.layout.backend_repr.$ === "ScalarPair") {
          // FIXME `Value` should properly support pairs in `Immediate`... but currently
          // it does not.
          const [val_, overflow] = v.to_pair(this.ecx);
          val = {
            $: "Aggregate",
            variant: VariantIdx.ZERO,
            fields: [Value.from(val_), Value.from(overflow)],
          };
        } else {
          val = Value.from(v);
        }
        break;
      }

      case "UnaryOp": {
        const un_op = rvalue._0;
        const operand = this.eval_operand(rvalue._1);
        if (operand === undefined) return undefined;
        const v = this.use_ecx((this_) => this_.ecx.read_immediate(operand));
        if (v === undefined) return undefined;

        const v2 = this.use_ecx((this_) => this_.ecx.unary_op(un_op, v));
        if (v2 === undefined) return undefined;
        val = Value.from(v2);
        break;
      }

      case "Aggregate": {
        const kind = rvalue._0;
        val = {
          $: "Aggregate",
          fields: rvalue._1.map((field): Value => {
            const v = this.eval_operand(field);
            return v === undefined ? Value.Uninit : { $: "Immediate", _0: v };
          }),
          variant: kind.$ === "Adt" ? kind._1 : VariantIdx.ZERO,
        };
        break;
      }

      case "Repeat": {
        // trace!(?op, ?n);
        return undefined;
      }

      case "Ref":
      case "RawPtr":
        return undefined;

      case "Cast": {
        const kind = rvalue._0;
        const value_ = rvalue._1;
        const to_ = rvalue._2;
        switch (kind.$) {
          case "IntToInt":
          case "IntToFloat": {
            const value1 = this.eval_operand(value_);
            if (value1 === undefined) return undefined;
            const value = InterpResult.discard_err(this.ecx.read_immediate(value1));
            if (value === undefined) return undefined;
            const to = this.ecx.layout_of(to_);
            if (to.$ === "Err") return undefined;
            const res = InterpResult.discard_err(this.ecx.int_to_int_or_float(value, to._0));
            if (res === undefined) return undefined;
            val = Value.from(res);
            break;
          }
          case "FloatToFloat":
          case "FloatToInt": {
            const value1 = this.eval_operand(value_);
            if (value1 === undefined) return undefined;
            const value = InterpResult.discard_err(this.ecx.read_immediate(value1));
            if (value === undefined) return undefined;
            const to = this.ecx.layout_of(to_);
            if (to.$ === "Err") return undefined;
            const res = InterpResult.discard_err(this.ecx.float_to_float_or_int(value, to._0));
            if (res === undefined) return undefined;
            val = Value.from(res);
            break;
          }
          case "Transmute":
          case "Subtype": {
            const value = this.eval_operand(value_);
            if (value === undefined) return undefined;
            const to_r = this.ecx.layout_of(to_);
            if (to_r.$ === "Err") return undefined;
            const to = to_r._0;
            // `offset` for immediates only supports scalar/scalar-pair ABIs,
            // so bail out if the target is not one.
            const a = value.layout.backend_repr;
            const b = to.backend_repr;
            if (a.$ === "Scalar" && b.$ === "Scalar") {
              // ok
            } else if (a.$ === "ScalarPair" && b.$ === "ScalarPair") {
              // ok
            } else {
              return undefined;
            }

            const res = InterpResult.discard_err(value.offset(Size.ZERO, to, this.ecx));
            if (res === undefined) return undefined;
            val = Value.from(res);
            break;
          }
          default:
            return undefined;
        }
        break;
      }

      case "Discriminant": {
        const place = rvalue._0;
        const c = this.get_const(place);
        if (c === undefined) return undefined;
        let variant: VariantIdx;
        switch (c.$) {
          case "Immediate": {
            const op = c._0;
            const v = this.use_ecx((this_) => this_.ecx.read_discriminant(op));
            if (v === undefined) return undefined;
            variant = v;
            break;
          }
          case "Aggregate":
            variant = c.variant;
            break;
          case "Uninit":
            return undefined;
        }
        const imm = this.use_ecx((this_) =>
          this_.ecx.discriminant_for_variant(place.ty(this_.local_decls(), this_.tcx).ty, variant),
        );
        if (imm === undefined) return undefined;
        val = Value.from(imm);
        break;
      }
    }
    // trace!(?val);

    const slot = this.access_mut(dest);
    if (slot === undefined) return undefined;
    slot.value = val;

    return null;
  }

  // impl<'tcx> Visitor<'tcx> for ConstPropagator<'_, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:670 visit_body
  override visit_body(body: Body): void {
    for (;;) {
      const bb = this.worklist.pop();
      if (bb === undefined) break;
      if (!this.visited_blocks.insert(bb)) {
        continue;
      }

      const data = body.basic_blocks.deref()[bb]!;
      this.visit_basic_block_data(bb, data);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:681 visit_operand
  override visit_operand(operand: Operand, location: Location): void {
    this.super_operand(operand, location);
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:685 visit_const_operand
  override visit_const_operand(constant: ConstOperand, location: Location): void {
    // trace!("visit_const_operand: {:?}", constant);
    this.super_const_operand(constant, location);
    this.eval_constant(constant);
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:691 visit_assign
  override visit_assign(place: Place, rvalue: Rvalue, location: Location): void {
    this.super_assign(place, rvalue, location);

    if (this.check_rvalue(rvalue, location) === undefined) return;

    const mode = this.can_const_prop[place.local]!;
    // Do nothing if the place is indirect.
    if (place.is_indirect()) {
      // (nothing)
    } else if (mode === "NoPropagation") {
      this.ensure_not_propagated(place.local);
    } else {
      if (this.eval_rvalue(rvalue, place) === undefined) {
        // Const prop failed, so erase the destination, ensuring that whatever happens
        // from here on, does not know about the previous value.
        // This is important in case we have
        // ```rust
        // let mut x = 42;
        // x = SOME_MUTABLE_STATIC;
        // // x must now be uninit
        // ```
        // FIXME: we overzealously erase the entire local, because that's easier to
        // implement.
        // trace!(
        //     "propagation into {:?} failed.
        //     Nuking the entire site from orbit, it's the only way to be sure",
        //     place,
        // );
        this.remove_const(place.local);
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:723 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    // trace!("visit_statement: {:?}", statement);

    // We want to evaluate operands before any change to the assigned-to value,
    // so we recurse first.
    this.super_statement(statement, location);

    const kind = statement.kind;
    switch (kind.$) {
      case "SetDiscriminant": {
        const place = kind.place;
        const variant_index = kind.variant_index;
        const mode = this.can_const_prop[place.local]!;
        // Do nothing if the place is indirect.
        if (place.is_indirect()) {
          // (nothing)
        } else if (mode === "NoPropagation") {
          this.ensure_not_propagated(place.local);
        } else {
          const slot = this.access_mut(place);
          const v = slot === undefined ? undefined : slot.value;
          if (v !== undefined && v.$ === "Aggregate") {
            v.variant = variant_index;
          } else {
            this.remove_const(place.local);
          }
        }
        break;
      }
      case "StorageLive": {
        this.remove_const(kind._0);
        break;
      }
      case "StorageDead": {
        this.remove_const(kind._0);
        break;
      }
      default:
        break;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:754 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    this.super_terminator(terminator, location);
    const kind = terminator.kind;
    switch (kind.$) {
      case "Assert": {
        this.check_assertion(kind.expected, kind.msg, kind.cond, location);
        break;
      }
      case "SwitchInt": {
        const value = this.eval_operand(kind.discr);
        if (value !== undefined) {
          const value_const = this.use_ecx((this_) => this_.ecx.read_scalar(value));
          if (value_const !== undefined) {
            const constant = InterpResult.discard_err(Scalar.to_bits(value_const, Scalar.size(value_const)));
            if (constant !== undefined) {
              // We managed to evaluate the discriminant, so we know we only need to visit
              // one target.
              const target = kind.targets.target_for_value(constant);
              this.worklist.push(target);
              return;
            }
          }
        }
        // We failed to evaluate the discriminant, fallback to visiting all successors.
        break;
      }
      case "Call": {
        const fn_def = OperandC.const_fn_def(kind.func);
        if (fn_def !== undefined) {
          const [def_id, generic_args] = fn_def;
          for (let index = 0; index < generic_args.length; index++) {
            const arg = generic_args[index]!;
            const arg_kind = GenericArg.kind(arg);
            if (arg_kind.$ === "Const") {
              const ct = arg_kind._0;
              // PORT: the `generics_of` query value is `unknown` in queries.gen.ts.
              const generics = this.tcx.generics_of(def_id) as Generics;
              const param_def = generics.param_at(index, this.tcx);

              if (
                param_def.kind.$ === "Const" &&
                find_attr(HasAttrs_DefId.get_attrs(param_def.def_id, this.tcx), (k) =>
                  k.$ === "RustcPanicsWhenZero" ? true : undefined,
                ) !== undefined &&
                ct.try_to_target_usize(this.tcx) === 0n
              ) {
                // We managed to figure-out that the value of a
                // `#[rustc_panics_when_zero]` const-generic parameter is zero.
                //
                // Let's report it as an unconditional panic.
                const source_info = this.body.source_info(location);
                const lint_root = this.lint_root(source_info);
                if (lint_root !== undefined) {
                  this.tcx.emit_node_span_lint(
                    UNCONDITIONAL_PANIC,
                    lint_root,
                    source_info.span,
                    ConstNIsZero_diagnostic({
                      const_param_span: source_info.span,
                      const_param_name: param_def.name,
                    }),
                  );
                }
              }
            }
          }
        }
        break;
      }
      // None of these have Operands to const-propagate.
      case "Goto":
      case "UnwindResume":
      case "UnwindTerminate":
      case "Return":
      case "TailCall":
      case "Unreachable":
      case "Drop":
      case "Yield":
      case "CoroutineDrop":
      case "FalseEdge":
      case "FalseUnwind":
      case "InlineAsm":
        break;
    }

    // `self.worklist.extend(terminator.successors())`
    for (const s of terminator.successors()) this.worklist.push(s);
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:823 visit_basic_block_data
  override visit_basic_block_data(block: BasicBlock, data: BasicBlockData): void {
    this.super_basic_block_data(block, data);

    // We remove all Locals which are restricted in propagation to their containing blocks and
    // which were modified in the current block.
    // Take it out of the ecx so we can get a mutable reference to the ecx for `remove_const`.
    const written_only_inside_own_block_locals = this.written_only_inside_own_block_locals;
    this.written_only_inside_own_block_locals = new Set();

    // This loop can get very hot for some bodies: it check each local in each bb.
    // To avoid this quadratic behaviour, we only clear the locals that were modified inside
    // the current block.
    // The order in which we remove consts does not matter.
    // #[allow(rustc::potential_query_instability)]
    for (const local of written_only_inside_own_block_locals) {
      // debug_assert_eq!(self.can_const_prop[local], ConstPropMode::OnlyInsideOwnBlock);
      this.remove_const(local);
    }
    written_only_inside_own_block_locals.clear();
    this.written_only_inside_own_block_locals = written_only_inside_own_block_locals;

    // PORT: the `cfg!(debug_assertions)` block (an `ensure_not_propagated` sweep) is skipped.
  }
}

// rustc-type: compiler/rustc_mir_transform/src/known_panics_lint.rs:488 DbgVal
// (local to `check_assertion`)
type DbgVal<T> = { readonly $: "Val"; _0: T } | { readonly $: "Underscore" };
const DbgVal = { Underscore: Object.freeze({ $: "Underscore" as const }) };
// impl<T: std::fmt::Debug> std::fmt::Debug for DbgVal<T>
// rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:493 fmt
function debug_DbgVal<T>(self: DbgVal<T>, fmt: Fmt, debug_T: Debug<T>): string {
  switch (self.$) {
    case "Val":
      return debug_T(self._0, fmt);
    case "Underscore":
      return "_";
  }
}

/// The maximum number of bytes that we'll allocate space for a local or the return value.
/// Needed for #66397, because otherwise we eval into large places and that can cause OOM or just
/// Severely regress performance.
const MAX_ALLOC_LIMIT: number = 1024;

// rustc-type: compiler/rustc_mir_transform/src/known_panics_lint.rs:863 ConstPropMode
/// The mode that `ConstProp` is allowed to run in for a given `Local`.
// #[derive(Clone, Copy, Debug, PartialEq)]
type ConstPropMode =
  /// The `Local` can be propagated into and reads of this `Local` can also be propagated.
  | "FullConstProp"
  /// The `Local` can only be propagated into and from its own block.
  | "OnlyInsideOwnBlock"
  /// The `Local` cannot be part of propagation at all. Any statement
  /// referencing it either for reading or writing will not get propagated.
  | "NoPropagation";

// rustc-type: compiler/rustc_mir_transform/src/known_panics_lint.rs:875 CanConstProp
/// A visitor that determines locals in a MIR body
/// that can be const propagated
class CanConstProp extends Visitor {
  constructor(
    public can_const_prop: ConstPropMode[],
    // False at the beginning. Once set, no more assignments are allowed to that local.
    public found_assignment: DenseBitSet<Local>,
  ) {
    super();
  }

  /// Returns true if `local` can be propagated
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:883 check
  static check(tcx: TyCtxt, typing_env: TypingEnv, body: Body): ConstPropMode[] {
    const cpv = new CanConstProp(
      body.local_decls.map((): ConstPropMode => "FullConstProp"),
      DenseBitSet.new_empty(body.local_decls.length),
    );
    for (let local = 0 as Local; local < cpv.can_const_prop.length; local++) {
      const ty = body.local_decls[local]!.ty;
      if (ty.is_async_drop_in_place_coroutine(tcx)) {
        // No const propagation for async drop coroutine (AsyncDropGlue).
        // Otherwise, tcx.layout_of(typing_env.as_query_input(ty)) will be called
        // (early layout request for async drop coroutine) to calculate layout size.
        // Layout for `async_drop_in_place<T>::{closure}` may only be known with known T.
        cpv.can_const_prop[local] = "NoPropagation";
        continue;
      } else if (ty.is_union()) {
        // Unions are incompatible with the current implementation of
        // const prop because Rust has no concept of an active
        // variant of a union
        cpv.can_const_prop[local] = "NoPropagation";
      } else {
        const layout = tcx.layout_of(typing_env.as_query_input(ty));
        if (layout.$ === "Ok" && layout._0.size.bytes() < Size.from_bytes(MAX_ALLOC_LIMIT).bytes()) {
          // (nothing)
        }
        // Either the layout fails to compute, then we can't use this local anyway
        // or the local is too large, then we don't want to.
        else {
          cpv.can_const_prop[local] = "NoPropagation";
          continue;
        }
      }
    }
    // Consider that arguments are assigned on entry.
    for (const arg of body.args_iter()) {
      cpv.found_assignment.insert(arg);
    }
    cpv.visit_body(body);
    return cpv.can_const_prop;
  }

  // impl<'tcx> Visitor<'tcx> for CanConstProp
  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:928 visit_place
  override visit_place(place: Place, context_: PlaceContext, loc: Location): void {
    // use rustc_middle::mir::visit::PlaceContext::*;
    let context = context_;

    // Dereferencing just read the address of `place.local`.
    if (place.projection.length > 0 && place.projection[0]!.$ === "Deref") {
      context = { $: "NonMutatingUse", _0: "Copy" };
    }

    this.visit_local(place.local, context, loc);
    this.visit_projection(place.as_ref(), context, loc);
  }

  // rustc: compiler/rustc_mir_transform/src/known_panics_lint.rs:940 visit_local
  override visit_local(local: Local, context: PlaceContext, _2: Location): void {
    // use rustc_middle::mir::visit::PlaceContext::*;
    if (
      context.$ === "MutatingUse" &&
      // These are just stores, where the storing is not propagatable, but there may be later
      // mutations of the same local via `Store`
      (context._0 === "Call" ||
        context._0 === "AsmOutput" ||
        // Actual store that can possibly even propagate a value
        context._0 === "Store" ||
        context._0 === "SetDiscriminant")
    ) {
      if (!this.found_assignment.insert(local)) {
        switch (this.can_const_prop[local]!) {
          // If the local can only get propagated in its own block, then we don't have
          // to worry about multiple assignments, as we'll nuke the const state at the
          // end of the block anyway, and inside the block we overwrite previous
          // states as applicable.
          case "OnlyInsideOwnBlock":
            break;
          case "NoPropagation":
            break;
          case "FullConstProp": {
            // trace!(
            //     "local {:?} can't be propagated because of multiple assignments. Previous state: {:?}",
            //     local, other,
            // );
            this.can_const_prop[local] = "OnlyInsideOwnBlock";
            break;
          }
        }
      }
    }
    // Reading constants is allowed an arbitrary number of times
    else if (
      (context.$ === "NonMutatingUse" &&
        (context._0 === "Copy" || context._0 === "Move" || context._0 === "Inspect" || context._0 === "PlaceMention")) ||
      context.$ === "NonUse"
    ) {
      // (nothing)
    }
    // These could be propagated with a smarter analysis or just some careful thinking about
    // whether they'd be fine right now.
    else if (
      (context.$ === "MutatingUse" && (context._0 === "Yield" || context._0 === "Drop")) ||
      // These can't ever be propagated under any scheme, as we can't reason about indirect
      // mutation.
      (context.$ === "NonMutatingUse" &&
        (context._0 === "SharedBorrow" || context._0 === "FakeBorrow" || context._0 === "RawBorrow")) ||
      (context.$ === "MutatingUse" && (context._0 === "Borrow" || context._0 === "RawBorrow"))
    ) {
      // trace!("local {:?} can't be propagated because it's used: {:?}", local, context);
      this.can_const_prop[local] = "NoPropagation";
    } else {
      // MutatingUse(MutatingUseContext::Projection) | NonMutatingUse(NonMutatingUseContext::Projection)
      bug(`visit_place should not pass ${debug_PlaceContext(context, PLAIN)} for ${debug_Local(local, PLAIN)}`);
    }
  }
}
