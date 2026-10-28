// Port of compiler/rustc_mir_transform/src/instsimplify.rs (lane mt-opt1).
//
// PORT: the `&mut Rvalue` of an `Assign` statement is a `MutRef<Rvalue>` onto the statement's tuple slot
// (`field_mut(kind._0, 1)`), so `*rvalue = ..` stores a new rvalue there; `*kind = CastKind::IntToInt` writes the
// `Cast` rvalue's field. `*operand = ..` in `SimplifyUbCheck::visit_operand` replaces the visited operand object in
// place (`replace_in_place`). Copies of the `Copy` MIR objects (`*destination`, `terminator.source_info`) are `clone_*`
// (PORTING §8). `ConstValue`'s derived `PartialEq` (`field == Ok(first_val)`) is the intern key's
// (rust_ts/intern_key.ts).
//! Performs various peephole optimizations.
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { Integer } from "../rustc_abi/lib.ts";
import { IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { IndexVec } from "../rustc_index/vec.ts";
import { MutVisitor } from "../rustc_middle/mir/visit.ts";
import {
  type Body,
  CastKind,
  clone_ConstOperand,
  clone_Operand,
  clone_Place,
  clone_SourceInfo,
  ConstOperand,
  ConstValue,
  type Local,
  type LocalDecl,
  LocalDecl as LocalDeclC,
  type Location,
  Operand,
  Place,
  Place_from_Local,
  ProjectionElem,
  Rvalue,
  Statement,
  type Terminator,
  TerminatorKind,
  UnwindAction,
} from "../rustc_middle/mir/mod.ts";
import { Const as mir_Const } from "../rustc_middle/mir/consts.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { GenericArg, type GenericArg as GenericArgT, type GenericArgsRef, fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { fn_can_unwind, IntegerExt, ValidityRequirement } from "../rustc_middle/ty/layout.ts";
import { Ty, type TypingEnv } from "../rustc_middle/ty/mod.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { intern_key_eq } from "../rust_ts/intern_key.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { Const as ty_Const } from "../rustc_type_ir/sty/consts.ts";
import { PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { PLAIN } from "../std/fmt.ts";
import { field_mut, type MutRef, replace_in_place } from "../std/mut_ref.ts";
import { unwrap } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { simplify_duplicate_switch_targets } from "./simplify.ts";

// rustc-type: compiler/rustc_mir_transform/src/instsimplify.rs:17 InstSimplify
// PORT: a pass enum (pass_manager.ts header): one frozen instance per variant, tagged `$`.
export type InstSimplify_variant = "BeforeInline" | "AfterSimplifyCfg";
export class InstSimplify extends MirPass {
  readonly type_name = "rustc_mir_transform::instsimplify::InstSimplify";

  private constructor(readonly $: InstSimplify_variant) {
    super();
    Object.freeze(this);
  }

  static readonly BeforeInline = new InstSimplify("BeforeInline");
  static readonly AfterSimplifyCfg = new InstSimplify("AfterSimplifyCfg");

  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:23 name
  override name(): string {
    switch (this.$) {
      case "BeforeInline":
        return "InstSimplify-before-inline";
      case "AfterSimplifyCfg":
        return "InstSimplify-after-simplifycfg";
    }
  }

  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:30 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 1);
  }

  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:34 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const preserve_ub_checks =
      find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "RustcPreserveUbChecks" ? null : undefined)) !== undefined;
    if (!preserve_ub_checks) {
      new SimplifyUbCheck(tcx).visit_body(body);
    }
    const ctx = new InstSimplifyContext(tcx, body.local_decls, body.typing_env(tcx));
    for (const block of body.basic_blocks.as_mut()) {
      for (const statement of block.statements) {
        const kind = statement.kind;
        if (kind.$ !== "Assign") {
          continue;
        }
        const rvalue = field_mut(kind._0, 1);

        ctx.simplify_bool_cmp(rvalue);
        ctx.simplify_ref_deref(rvalue);
        ctx.simplify_ptr_aggregate(rvalue);
        ctx.simplify_cast(rvalue);
        ctx.simplify_repeated_aggregate(rvalue);
        ctx.simplify_repeat_once(rvalue);
      }

      const terminator = unwrap(block.terminator);
      ctx.simplify_primitive_clone(terminator, block.statements);
      ctx.simplify_size_or_align_of_val(terminator, block.statements);
      ctx.simplify_raw_eq(terminator, block.statements);
      ctx.simplify_intrinsic_assert(terminator);
      ctx.simplify_nounwind_call(terminator);
      simplify_duplicate_switch_targets(terminator);
    }
  }
}

// rustc-type: compiler/rustc_mir_transform/src/instsimplify.rs:69 InstSimplifyContext
class InstSimplifyContext {
  constructor(
    public tcx: TyCtxt,
    public local_decls: LocalDecl[],
    public typing_env: TypingEnv,
  ) {}

  /// Transform aggregates like [0, 0, 0, 0, 0] into [0; 5].
  /// GVN can also do this optimization, but GVN is only run at mir-opt-level 2 so having this in
  /// InstSimplify helps unoptimized builds.
  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:79 simplify_repeated_aggregate
  simplify_repeated_aggregate(rvalue: MutRef<Rvalue>): void {
    const rv = rvalue.value;
    if (!(rv.$ === "Aggregate" && rv._0.$ === "Array")) {
      return;
    }
    const fields = rv._1;
    if (fields.length < 5) {
      return;
    }
    const first_ = fields[0]!;
    const rest = fields.slice(1);
    if (first_.$ !== "Constant") {
      return;
    }
    const first = first_._0;
    const first_val_ = mir_Const.eval(first.const_, this.tcx, this.typing_env, first.span);
    if (first_val_.$ !== "Ok") {
      return;
    }
    const first_val = first_val_._0;
    if (
      rest.every((field_) => {
        if (field_.$ !== "Constant") {
          return false;
        }
        const field = mir_Const.eval(field_._0.const_, this.tcx, this.typing_env, field_._0.span);
        return field.$ === "Ok" && intern_key_eq(field._0, first_val);
      })
    ) {
      const len = ty_Const.from_target_usize(this.tcx, fields.length);
      rvalue.value = { $: "Repeat", _0: { $: "Constant", _0: clone_ConstOperand(first) }, _1: len };
    }
  }

  /// Transform boolean comparisons into logical operations.
  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:106 simplify_bool_cmp
  simplify_bool_cmp(rvalue: MutRef<Rvalue>): void {
    const rv = rvalue.value;
    if (!(rv.$ === "BinaryOp" && (rv._0 === "Eq" || rv._0 === "Ne"))) return;
    const op = rv._0;
    const [a, b] = rv._1;
    const ea = this.try_eval_bool(a);
    const eb = this.try_eval_bool(b);
    let new_rvalue: Rvalue;
    if (op === "Eq" && eb === true) {
      // Transform "Eq(a, true)" ==> "a"
      new_rvalue = { $: "Use", _0: clone_Operand(a), _1: "Yes" };
    } else if (op === "Ne" && eb === false) {
      // Transform "Ne(a, false)" ==> "a"
      new_rvalue = { $: "Use", _0: clone_Operand(a), _1: "Yes" };
    } else if (op === "Eq" && ea === true) {
      // Transform "Eq(true, b)" ==> "b"
      new_rvalue = { $: "Use", _0: clone_Operand(b), _1: "Yes" };
    } else if (op === "Ne" && ea === false) {
      // Transform "Ne(false, b)" ==> "b"
      new_rvalue = { $: "Use", _0: clone_Operand(b), _1: "Yes" };
    } else if (op === "Eq" && ea === false) {
      // Transform "Eq(false, b)" ==> "Not(b)"
      new_rvalue = { $: "UnaryOp", _0: "Not", _1: clone_Operand(b) };
    } else if (op === "Ne" && ea === true) {
      // Transform "Ne(true, b)" ==> "Not(b)"
      new_rvalue = { $: "UnaryOp", _0: "Not", _1: clone_Operand(b) };
    } else if (op === "Eq" && eb === false) {
      // Transform "Eq(a, false)" ==> "Not(a)"
      new_rvalue = { $: "UnaryOp", _0: "Not", _1: clone_Operand(a) };
    } else if (op === "Ne" && eb === true) {
      // Transform "Ne(a, true)" ==> "Not(a)"
      new_rvalue = { $: "UnaryOp", _0: "Not", _1: clone_Operand(a) };
    } else {
      return;
    }
    rvalue.value = new_rvalue;
  }

  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:137 try_eval_bool
  try_eval_bool(a_: Operand): boolean | undefined {
    const a = Operand.constant(a_);
    if (a === undefined) return undefined;
    if (mir_Const.ty(a.const_).is_bool()) {
      return mir_Const.try_to_bool(a.const_);
    } else {
      return undefined;
    }
  }

  /// Transform `&(*a)` ==> `a`.
  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:143 simplify_ref_deref
  simplify_ref_deref(rvalue: MutRef<Rvalue>): void {
    const rv = rvalue.value;
    let place;
    if (rv.$ === "Ref") {
      place = rv._2;
    } else if (rv.$ === "RawPtr") {
      place = rv._1;
    } else {
      return;
    }
    const lp = place.as_ref().last_projection();
    if (
      lp !== undefined &&
      lp[1].$ === "Deref" &&
      Rvalue.ty(rv, this.local_decls, this.tcx) === lp[0].ty(this.local_decls, this.tcx).ty
    ) {
      const base = lp[0];
      rvalue.value = {
        $: "Use",
        _0: {
          $: "Copy",
          _0: new Place(base.local, this.tcx.mk_place_elems(base.projection)),
        },
        // This might have been a two-phase borrow, which we should not upgrade
        // to a full `&mut` reborrow.
        // FIXME: Once Stacked Borrows is fully removed, we can use `Yes` here as
        // Tree Borrows treats two-phase and full borrows the same.
        _1: rv.$ === "Ref" && rv._1.$ === "Mut" && rv._1.kind === "TwoPhaseBorrow" ? "No" : "Yes",
      };
    }
  }

  /// Transform `Aggregate(RawPtr, [p, ()])` ==> `Cast(PtrToPtr, p)`.
  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:170 simplify_ptr_aggregate
  simplify_ptr_aggregate(rvalue: MutRef<Rvalue>): void {
    const rv = rvalue.value;
    if (rv.$ === "Aggregate" && rv._0.$ === "RawPtr") {
      const pointee_ty = rv._0._0;
      const mutability = rv._0._1;
      const meta_ty = Operand.ty(rv._1[1]!, this.local_decls, this.tcx);
      if (meta_ty.is_unit()) {
        // The mutable borrows we're holding prevent printing `rvalue` here
        const fields = rv._1;
        rv._1 = [];
        const _meta = unwrap(fields.pop());
        const data = unwrap(fields.pop());
        const ptr_ty = Ty.new_ptr(this.tcx, pointee_ty, mutability);
        rvalue.value = { $: "Cast", _0: CastKind.PtrToPtr, _1: data, _2: ptr_ty };
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:184 simplify_cast
  simplify_cast(rvalue: MutRef<Rvalue>): void {
    const rv = rvalue.value;
    if (rv.$ !== "Cast") return;
    const kind = rv._0;
    const operand = rv._1;
    const cast_ty = rv._2;

    const operand_ty = Operand.ty(operand, this.local_decls, this.tcx);
    if (operand_ty === cast_ty) {
      rvalue.value = { $: "Use", _0: clone_Operand(operand), _1: "Yes" };
    } else if (kind.$ === "Transmute") {
      // Transmuting an integer to another integer is just a signedness cast
      const ok = operand_ty.kind();
      const ck = cast_ty.kind();
      let int: IntTy | undefined;
      let uint: UintTy | undefined;
      if (ok.$ === "Int" && ck.$ === "Uint") {
        int = ok._0;
        uint = ck._0;
      } else if (ok.$ === "Uint" && ck.$ === "Int") {
        uint = ok._0;
        int = ck._0;
      }
      if (int !== undefined && uint !== undefined && IntTy.bit_width(int) === UintTy.bit_width(uint)) {
        // The width check isn't strictly necessary, as different widths
        // are UB and thus we'd be allowed to turn it into a cast anyway.
        // But let's keep the UB around for codegen to exploit later.
        // (If `CastKind::Transmute` ever becomes *not* UB for mismatched sizes,
        // then the width check is necessary for big-endian correctness.)
        rv._0 = CastKind.IntToInt;
      }
    }
  }

  /// Simplify `[x; 1]` to just `[x]`.
  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:206 simplify_repeat_once
  simplify_repeat_once(rvalue: MutRef<Rvalue>): void {
    const rv = rvalue.value;
    if (rv.$ === "Repeat" && rv._1.try_to_target_usize(this.tcx) === 1n) {
      const operand = rv._0;
      rvalue.value = {
        $: "Aggregate",
        _0: { $: "Array", _0: Operand.ty(operand, this.local_decls, this.tcx) },
        _1: [clone_Operand(operand)],
      };
    }
  }

  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:217 simplify_primitive_clone
  simplify_primitive_clone(terminator: Terminator, statements: Statement[]): void {
    const kind = terminator.kind;
    if (kind.$ !== "Call" || kind.target === undefined) {
      return;
    }
    const func = kind.func;
    const args = kind.args;
    const destination = kind.destination;
    const destination_block = kind.target;

    // It's definitely not a clone if there are multiple arguments
    if (args.length !== 1) return;
    const arg = args[0]!;

    // Only bother looking more if it's easy to know what we're calling
    const fd = Operand.const_fn_def(func);
    if (fd === undefined) return;
    const fn_def_id = fd[0];

    // These types are easily available from locals, so check that before
    // doing DefId lookups to figure out what we're actually calling.
    const arg_ty = Operand.ty(arg.node, this.local_decls, this.tcx);

    const ak = arg_ty.kind();
    if (!(ak.$ === "Ref" && ak._2 === "Not")) return;
    const inner_ty = ak._1;

    if (!this.tcx.is_lang_item(fn_def_id, LangItem.CloneFn) || !inner_ty.is_trivially_pure_clone_copy()) {
      return;
    }

    const arg_place = Operand.place(arg.node);
    if (arg_place === undefined) return;

    statements.push(
      Statement.new(clone_SourceInfo(terminator.source_info), {
        $: "Assign",
        _0: [
          clone_Place(destination),
          {
            $: "Use",
            _0: { $: "Copy", _0: arg_place.project_deeper([ProjectionElem.Deref], this.tcx) },
            _1: "Yes",
          },
        ],
      }),
    );
    terminator.kind = TerminatorKind.goto(destination_block);
  }

  /// Simplify `size_of_val` and `align_of_val` if we don't actually need
  /// to look at the value in order to calculate the result:
  /// - For `Sized` types we can always do this for both,
  /// - For `align_of_val::<[T]>` we can return `align_of::<T>()`, since it
  ///   doesn't depend on the slice's length and the elements are sized.
  ///
  /// This is here so it can run after inlining, where it's more useful.
  /// (LowerIntrinsics is done in cleanup, before the optimization passes.)
  ///
  /// Note that we intentionally just produce the lang item constants so this
  /// works on generic types and avoids any risk of layout calculation cycles.
  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:273 simplify_size_or_align_of_val
  simplify_size_or_align_of_val(terminator: Terminator, statements: Statement[]): void {
    const source_info = terminator.source_info;
    const kind = terminator.kind;
    if (kind.$ === "Call" && kind.target !== undefined && kind.args.length === 1) {
      const fd = Operand.const_fn_def(kind.func);
      if (fd === undefined) return;
      const [fn_def_id, generics] = fd;
      const destination = kind.destination;
      const destination_block = kind.target;
      let lang_item: LangItem;
      if (this.tcx.is_intrinsic(fn_def_id, sym.size_of_val)) {
        lang_item = LangItem.SizeOf;
      } else if (this.tcx.is_intrinsic(fn_def_id, sym.align_of_val)) {
        lang_item = LangItem.AlignOf;
      } else {
        return;
      }
      const generic_ty = generics.type_at(0);
      let ty: Ty;
      const gk = generic_ty.kind();
      if (generic_ty.is_sized(this.tcx, this.typing_env)) {
        ty = generic_ty;
      } else if (lang_item === LangItem.AlignOf && gk.$ === "Slice") {
        ty = gk._0;
      } else {
        return;
      }

      const const_def_id = this.tcx.require_lang_item(lang_item, source_info.span);
      const const_op = Operand.unevaluated_constant(this.tcx, const_def_id, [GenericArg.from_Ty(ty)], source_info.span);
      statements.push(
        Statement.new(clone_SourceInfo(source_info), {
          $: "Assign",
          _0: [clone_Place(destination), { $: "Use", _0: const_op, _1: "Yes" }],
        }),
      );
      terminator.kind = TerminatorKind.goto(destination_block);
    }
  }

  /// Simplify `raw_eq` intrinsic calls to `Eq` when the type has the size of a primitive.
  ///
  /// For example, replace `raw_eq::<[u8; 4]>(a, b)` with `Eq(Transmute(a), Transmute(b))`.
  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:324 simplify_raw_eq
  simplify_raw_eq(terminator: Terminator, statements: Statement[]): void {
    const tcx = this.tcx;
    const source_info = terminator.source_info;
    const span = source_info.span;
    const kind = terminator.kind;
    if (!(kind.$ === "Call" && kind.target !== undefined && kind.args.length === 2)) return;
    const args = kind.args;
    const destination = kind.destination;
    const destination_block = kind.target;
    const fd = Operand.const_fn_def(kind.func);
    if (fd === undefined) return;
    const [fn_def_id, generics] = fd;
    if (!tcx.is_intrinsic(fn_def_id, sym.raw_eq)) return;
    const generic_ty = generics.type_at(0);
    const layout_ = tcx.layout_of(this.typing_env.as_query_input(generic_ty));
    if (layout_.$ !== "Ok") return;
    const layout = layout_._0;
    const integer_ = Integer.from_size(layout.size);
    if (integer_.$ !== "Ok") return;
    const integer = integer_._0;
    {
      const ref_ty = Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, generic_ty);
      const uint_ty = IntegerExt.to_ty(integer, tcx, false);

      const transmute_operand = (op: Operand): Operand => {
        const ref_local = IndexVec.push<Local, LocalDecl>(this.local_decls, LocalDeclC.new(ref_ty, span));
        statements.push(
          Statement.new(clone_SourceInfo(source_info), {
            $: "Assign",
            _0: [Place_from_Local(ref_local), { $: "Use", _0: clone_Operand(op), _1: "Yes" }],
          }),
        );
        const place = Place_from_Local(ref_local).project_deeper([ProjectionElem.Deref], tcx);
        const int_local = IndexVec.push<Local, LocalDecl>(this.local_decls, LocalDeclC.new(uint_ty, span));
        statements.push(
          Statement.new(clone_SourceInfo(source_info), {
            $: "Assign",
            _0: [Place_from_Local(int_local), { $: "Cast", _0: CastKind.Transmute, _1: { $: "Copy", _0: place }, _2: uint_ty }],
          }),
        );
        return { $: "Move", _0: Place_from_Local(int_local) };
      };
      const lhs_op = transmute_operand(args[0]!.node);
      const rhs_op = transmute_operand(args[1]!.node);
      statements.push(
        Statement.new(clone_SourceInfo(source_info), {
          $: "Assign",
          _0: [clone_Place(destination), { $: "BinaryOp", _0: "Eq", _1: [lhs_op, rhs_op] }],
        }),
      );
      terminator.kind = TerminatorKind.goto(destination_block);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:378 simplify_nounwind_call
  simplify_nounwind_call(terminator: Terminator): void {
    const kind = terminator.kind;
    if (kind.$ !== "Call") {
      return;
    }
    const func = kind.func;

    const fd = Operand.const_fn_def(func);
    if (fd === undefined) {
      return;
    }
    const def_id = fd[0];

    // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
    const body_ty = EarlyBinder.skip_binder(this.tcx.type_of(def_id) as EarlyBinder<Ty>);
    let body_abi: ExternAbi;
    switch (body_ty.kind().$) {
      case "FnDef":
        body_abi = PolyFnSig.abi(body_ty.fn_sig(this.tcx));
        break;
      case "Closure":
        body_abi = ExternAbi.RustCall;
        break;
      case "Coroutine":
        body_abi = ExternAbi.Rust;
        break;
      default:
        return bug(`unexpected body ty: ${debug_Ty(body_ty, PLAIN)}`);
    }

    if (!fn_can_unwind(this.tcx, def_id, body_abi)) {
      kind.unwind = UnwindAction.Unreachable;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:400 simplify_intrinsic_assert
  simplify_intrinsic_assert(terminator: Terminator): void {
    const kind = terminator.kind;
    if (!(kind.$ === "Call" && kind.target !== undefined)) {
      return;
    }
    const func = kind.func;
    const target_block = kind.target;
    const func_ty = Operand.ty(func, this.local_decls, this.tcx);
    const r = resolve_rust_intrinsic(this.tcx, func_ty);
    if (r === undefined) {
      return;
    }
    const [intrinsic_name, args] = r;
    // The intrinsics we are interested in have one generic parameter
    if (args.length < 1) return;
    const arg = args[0]!;

    const known_is_valid = intrinsic_assert_panics(this.tcx, this.typing_env, arg, intrinsic_name);
    switch (known_is_valid) {
      // We don't know the layout or it's not validity assertion at all, don't touch it
      case undefined:
        break;
      case true: {
        // If we know the assert panics, indicate to later opts that the call diverges
        kind.target = undefined;
        break;
      }
      case false: {
        // If we know the assert does not panic, turn the call into a Goto
        terminator.kind = TerminatorKind.goto(target_block);
        break;
      }
    }
  }
}

// rustc: compiler/rustc_mir_transform/src/instsimplify.rs:430 intrinsic_assert_panics
function intrinsic_assert_panics(
  tcx: TyCtxt,
  typing_env: TypingEnv,
  arg: GenericArgT,
  intrinsic_name: Symbol,
): boolean | undefined {
  const requirement = ValidityRequirement.from_intrinsic(intrinsic_name);
  if (requirement === undefined) return undefined;
  const ty = GenericArg.expect_ty(arg);
  const r = tcx.check_validity_requirement([requirement, typing_env.as_query_input(ty)]);
  if (r.$ !== "Ok") return undefined;
  return !r._0;
}

// rustc: compiler/rustc_mir_transform/src/instsimplify.rs:441 resolve_rust_intrinsic
function resolve_rust_intrinsic(tcx: TyCtxt, func_ty: Ty): [Symbol, GenericArgsRef] | undefined {
  const k = func_ty.kind();
  if (k.$ !== "FnDef") return undefined;
  const def_id = k._0;
  const args = k._1;
  const intrinsic = tcx.intrinsic(def_id);
  if (intrinsic === undefined) return undefined;
  return [intrinsic.name, unwrap(Binder.no_bound_vars(args, fold_GenericArgs))];
}

// rustc-type: compiler/rustc_mir_transform/src/instsimplify.rs:450 SimplifyUbCheck
class SimplifyUbCheck extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:455 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/instsimplify.rs:459 visit_operand
  override visit_operand(operand: Operand, _: Location): void {
    if (operand.$ === "RuntimeChecks" && operand._0 === "UbChecks") {
      replace_in_place<Operand>(operand, {
        $: "Constant",
        _0: new ConstOperand(DUMMY_SP, undefined, {
          $: "Val",
          _0: ConstValue.from_bool(this.tcx_.sess.ub_checks()),
          _1: this.tcx_.types.bool,
        }),
      });
    }
  }
}
