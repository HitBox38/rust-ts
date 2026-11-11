// compiler/rustc_codegen_llvm/src/builder.rs: the SKELETON (lane cg-contract). The fill lane cg-builder (plan-m7 §8 wave 41)
// owns this file and ports builder.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: the struct `GenericBuilder` and the aliases `SBuilder` / `Builder`, `Builder`'s `Deref` impl (ported), and
// builder.rs's trait impls for `Builder` (`BuilderMethods`, `StaticBuilderMethods`, the `Has*` / `LayoutOfHelpers` /
// `FnAbiOfHelpers` forwarders) as typed stubs. The other trait impls for `Builder` (abi.rs, intrinsic.rs, asm.rs,
// debuginfo/mod.rs, coverageinfo/mod.rs) are typed stubs in those files.
//
// PORT (cg-contract), the representation (as context.ts's `GenericCx`):
// - `GenericBuilder<'a, 'll, CX: Borrow<SCx<'ll>>>` is the class `GenericBuilder<CX extends SCxBorrow>`; the aliases are
//   subclasses: `SBuilder extends GenericBuilder<SCx>` (`impl SBuilder`), `Builder extends GenericBuilder<FullCx>` (`impl
//   Builder`, every trait impl for `Builder`).
// - The field `cx` is `cx_`: `BuilderMethods::cx()` is a method of the same name, which generic code calls. Upstream's
//   `self.cx` (the field) is `this.cx_`, and `self.cx()` stays.
// - `impl Deref for Builder` (`Target = CodegenCx`, which `BuilderMethods: Deref<Target = Self::CodegenCx>` requires;
//   ssa-contract decision 3): `deref()` is ported, and auto-deref is realised as forwarders. Type side: `Builder`'s interface
//   extends `BuilderDeref`, `CodegenCx` without the members `Builder` has itself. Run time: lib.ts calls
//   `install_deref_methods(Builder, CodegenCx, (bx) => bx.cx_)` after every extension module is loaded, which defines on
//   `Builder.prototype` a forwarder to `this.cx_` for each member of `CodegenCx` that `Builder` lacks.
// - `BuilderMethods::build` / `append_block` (no `self`) are statics of `Builder`, so `Builder` itself is the
//   `BuilderMethodsStatic<LlvmTypes, CodegenCx, Builder>` that generic code takes as `Bx_` (ssa-contract decision 4).
// - `BuilderMethods` defaults that builder.rs does not override forward to `BuilderMethods_provided`.
// - `UNNAMED` (`c"".as_ptr()`) is `""`.
import type { Align, Scalar, Size, TargetDataLayout } from "../rustc_abi/lib.ts";
import type { WrappingRange } from "../rustc_abi/wrapping_range.ts";
import type { FncTree } from "../rustc_ast/expand/typetree.ts";
import type { UnrollAttr } from "../rustc_attr_ir/data_structures.gen.ts";
import type { AtomicRmwBinOp, IntPredicate, RealPredicate, SynchronizationScope } from "../rustc_codegen_ssa/common.ts";
import type { MemFlags } from "../rustc_codegen_ssa/lib.ts";
import type { OperandRef } from "../rustc_codegen_ssa/mir/operand.ts";
import type { PlaceRef, PlaceValue } from "../rustc_codegen_ssa/mir/place.ts";
import { BuilderMethods_provided, type BuilderMethods, type BuilderMethodsStatic, type OverflowOp, type ReturnSlot } from "../rustc_codegen_ssa/traits/builder.ts";
import type { StaticBuilderMethods } from "../rustc_codegen_ssa/traits/statics.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AtomicOrdering } from "../rustc_middle/ty/consts/int.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import {
  FnAbiOf_provided,
  type FnAbiError,
  type FnAbiRequest,
  type LayoutError,
  LayoutOf_provided,
  LayoutOfHelpers_provided,
  type MaybeResult,
  MaybeResult_T,
  type TyAndLayout,
} from "../rustc_middle/ty/layout.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { FnAbi } from "../rustc_target/callconv/mod.ts";
import type { Target } from "../rustc_target/spec/mod.ts";
import type { PolyFnSig } from "../rustc_type_ir/decls.ts";
import { unported } from "../std/panic.ts";
import type { Funclet, LlvmTypes } from "./common.ts";
import type { CodegenCx, FullCx, GenericCx, SCx, SCxBorrow } from "./context.ts";
import type * as llvm from "./llvm/mod.ts";
import type { BasicBlock, Type, Value } from "./llvm/mod.ts";

// #[must_use]
export class GenericBuilder<CX extends SCxBorrow> {
  constructor(
    public llbuilder: llvm.Builder,
    /** `cx: &'a GenericCx<'ll, CX>` (header: `cx_`) */
    public cx_: GenericCx<CX>,
    public span: Span,
  ) {}

  // impl<'a, 'll, CX: Borrow<SCx<'ll>>> Drop for GenericBuilder<'a, 'll, CX>
  // Stub (cg-contract): GenericBuilder::drop
  drop(): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs drop");
  }
}

export class SBuilder extends GenericBuilder<SCx> {}

/// Empty string, to be used where LLVM expects an instruction name, indicating
/// that the instruction is to be left unnamed (i.e. numbered, in textual IR).
// FIXME(eddyb) pass `&CStr` directly to FFI once it's a thin pointer.
export const UNNAMED = "";

// impl<'ll, CX: Borrow<SCx<'ll>>> BackendTypes for GenericBuilder<'_, 'll, CX>: the same record as `GenericCx`'s,
// `LlvmTypes` (common.ts).

/** What `Builder` reaches by auto-deref to `CodegenCx` (header): its members but those `Builder` declares itself. */
type BuilderDeref = Omit<
  CodegenCx,
  | "_0"
  | "deref"
  | "deref_mut"
  | "data_layout"
  | "target_spec"
  | "tcx_"
  | "typing_env_"
  | "LayoutOfResult"
  | "FnAbiOfResult"
  | "layout_tcx_at_span"
  | "handle_layout_err"
  | "handle_fn_abi_err"
  | "layout_of"
  | "spanned_layout_of"
  | "fn_abi_of_fn_ptr"
  | "fn_abi_of_instance_no_deduced_attrs"
  | "fn_abi_of_instance"
>;

// Declaration merging: the deref'd members are members of `Builder` (header).
export interface Builder extends BuilderDeref {}

export class Builder extends GenericBuilder<FullCx> implements BuilderMethods<LlvmTypes, CodegenCx>, StaticBuilderMethods<LlvmTypes> {
  /** `cx: &'a CodegenCx<'ll, 'tcx>` */
  declare cx_: CodegenCx;

  // ---- impl abi::HasDataLayout for Builder (builder.rs:213) ----
  // Stub (cg-contract): HasDataLayout::data_layout
  data_layout(): TargetDataLayout {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs data_layout");
  }

  // ---- impl HasTyCtxt for Builder (builder.rs:219) ----
  // Stub (cg-contract): HasTyCtxt::tcx (`tcx_`)
  tcx_(): TyCtxt {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs tcx");
  }

  // ---- impl HasTypingEnv for Builder (builder.rs:226) ----
  // Stub (cg-contract): HasTypingEnv::typing_env (`typing_env_`)
  typing_env_(): TypingEnv {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs typing_env");
  }

  // ---- impl HasTargetSpec for Builder (builder.rs:232) ----
  // Stub (cg-contract): HasTargetSpec::target_spec
  target_spec(): Target {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs target_spec");
  }

  // ---- impl LayoutOfHelpers for Builder (builder.rs:239) ----
  // type LayoutOfResult = TyAndLayout<'tcx>; (the trait's default)
  get LayoutOfResult(): MaybeResult<TyAndLayout, TyAndLayout, never> {
    return MaybeResult_T;
  }
  // (provided) ty/layout.rs:740 layout_tcx_at_span -> LayoutOfHelpers_provided.layout_tcx_at_span
  layout_tcx_at_span(): Span {
    return LayoutOfHelpers_provided.layout_tcx_at_span(this);
  }
  // Stub (cg-contract): LayoutOfHelpers::handle_layout_err
  handle_layout_err(_err: LayoutError, _span: Span, _ty: Ty): never {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs handle_layout_err");
  }

  // ---- impl FnAbiOfHelpers for Builder (builder.rs:246) ----
  // type FnAbiOfResult = &'tcx FnAbi<'tcx, Ty<'tcx>>; (the trait's default)
  get FnAbiOfResult(): MaybeResult<FnAbi<Ty>, FnAbi<Ty>, never> {
    return MaybeResult_T;
  }
  // Stub (cg-contract): FnAbiOfHelpers::handle_fn_abi_err
  handle_fn_abi_err(_err: FnAbiError, _span: Span, _fn_abi_request: FnAbiRequest): never {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs handle_fn_abi_err");
  }

  // ---- impl<'tcx, C: LayoutOfHelpers<'tcx>> LayoutOf<'tcx> for C {} (rustc_middle ty/layout.rs) ----
  // (provided) ty/layout.rs:764 layout_of -> LayoutOf_provided.layout_of
  layout_of(ty: Ty): TyAndLayout {
    return LayoutOf_provided.layout_of(this, ty);
  }
  // (provided) ty/layout.rs:773 spanned_layout_of -> LayoutOf_provided.spanned_layout_of
  spanned_layout_of(ty: Ty, span: Span): TyAndLayout {
    return LayoutOf_provided.spanned_layout_of(this, ty, span);
  }

  // ---- impl<'tcx, C: FnAbiOfHelpers<'tcx>> FnAbiOf<'tcx> for C {} (rustc_middle ty/layout.rs) ----
  // (provided) ty/layout.rs:1452 fn_abi_of_fn_ptr -> FnAbiOf_provided.fn_abi_of_fn_ptr
  fn_abi_of_fn_ptr(sig: PolyFnSig, extra_args: List<Ty>): FnAbi<Ty> {
    return FnAbiOf_provided.fn_abi_of_fn_ptr(this, sig, extra_args);
  }
  // (provided) ty/layout.rs:1481 fn_abi_of_instance_no_deduced_attrs -> FnAbiOf_provided.fn_abi_of_instance_no_deduced_attrs
  fn_abi_of_instance_no_deduced_attrs(instance: Instance, extra_args: List<Ty>): FnAbi<Ty> {
    return FnAbiOf_provided.fn_abi_of_instance_no_deduced_attrs(this, instance, extra_args);
  }
  // (provided) ty/layout.rs:1520 fn_abi_of_instance -> FnAbiOf_provided.fn_abi_of_instance
  fn_abi_of_instance(instance: Instance, extra_args: List<Ty>): FnAbi<Ty> {
    return FnAbiOf_provided.fn_abi_of_instance(this, instance, extra_args);
  }

  // impl<'ll, 'tcx> Deref for Builder<'_, 'll, 'tcx>
  // #[inline]
  // rustc: compiler/rustc_codegen_llvm/src/builder.rs:262 deref
  deref(): CodegenCx {
    return this.cx_;
  }

  // ---- impl BuilderMethods for Builder: the associated fns without `self` (header) ----
  // Stub (cg-contract): BuilderMethods::build
  static build(_cx: CodegenCx, _llbb: BasicBlock): Builder {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs build");
  }

  // Stub (cg-contract): BuilderMethods::append_block
  static append_block(_cx: CodegenCx, _llfn: Value, _name: string): BasicBlock {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs append_block");
  }

  // ---- impl BuilderMethods for Builder (builder.rs:289) ----
  // Stub (cg-contract): BuilderMethods::cx
  cx(): CodegenCx {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs cx");
  }

  // Stub (cg-contract): BuilderMethods::llbb
  llbb(): BasicBlock {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs llbb");
  }

  // Stub (cg-contract): BuilderMethods::set_span
  set_span(_span: Span): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs set_span");
  }

  // Stub (cg-contract): BuilderMethods::append_sibling_block
  append_sibling_block(_name: string): BasicBlock {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs append_sibling_block");
  }

  // Stub (cg-contract): BuilderMethods::switch_to_block
  switch_to_block(_llbb: BasicBlock): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs switch_to_block");
  }

  // Stub (cg-contract): BuilderMethods::ret_void
  ret_void(): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs ret_void");
  }

  // Stub (cg-contract): BuilderMethods::ret
  ret(_v: Value): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs ret");
  }

  // Stub (cg-contract): BuilderMethods::br
  br(_dest: BasicBlock): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs br");
  }

  // Stub (cg-contract): BuilderMethods::br_with_attrs
  br_with_attrs(_dest: BasicBlock, _loop_hint_attrs: readonly UnrollAttr[]): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs br_with_attrs");
  }

  // Stub (cg-contract): BuilderMethods::cond_br
  cond_br(_cond: Value, _then_llbb: BasicBlock, _else_llbb: BasicBlock): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs cond_br");
  }

  // (provided) BuilderMethods::cond_br_with_expect -> BuilderMethods_provided.cond_br_with_expect
  cond_br_with_expect(cond: Value, then_llbb: BasicBlock, else_llbb: BasicBlock, expect: boolean | undefined): void {
    return BuilderMethods_provided.cond_br_with_expect(this, cond, then_llbb, else_llbb, expect);
  }

  // Stub (cg-contract): BuilderMethods::switch
  switch(_v: Value, _else_llbb: BasicBlock, _cases: readonly (readonly [bigint, BasicBlock])[]): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs switch");
  }

  // Stub (cg-contract): BuilderMethods::switch_with_weights
  switch_with_weights(_v: Value, _else_llbb: BasicBlock, _else_is_cold: boolean, _cases: readonly (readonly [bigint, BasicBlock, boolean])[]): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs switch_with_weights");
  }

  // Stub (cg-contract): BuilderMethods::invoke
  invoke(_llty: Type, _fn_attrs: CodegenFnAttrs | undefined, _fn_abi: FnAbi<Ty> | undefined, _llfn: Value, _return_slot: ReturnSlot<Value>, _args: readonly Value[], _then: BasicBlock, _catch_: BasicBlock, _funclet: Funclet | undefined, _instance: Instance | undefined): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs invoke");
  }

  // Stub (cg-contract): BuilderMethods::unreachable
  unreachable(): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unreachable");
  }

  // (provided) BuilderMethods::unreachable_nonterminator -> BuilderMethods_provided.unreachable_nonterminator
  unreachable_nonterminator(): void {
    return BuilderMethods_provided.unreachable_nonterminator(this);
  }

  // Stub (cg-contract): BuilderMethods::add
  add(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs add");
  }

  // Stub (cg-contract): BuilderMethods::fadd
  fadd(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fadd");
  }

  // Stub (cg-contract): BuilderMethods::fadd_fast
  fadd_fast(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fadd_fast");
  }

  // Stub (cg-contract): BuilderMethods::fadd_algebraic
  fadd_algebraic(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fadd_algebraic");
  }

  // Stub (cg-contract): BuilderMethods::sub
  sub(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs sub");
  }

  // Stub (cg-contract): BuilderMethods::fsub
  fsub(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fsub");
  }

  // Stub (cg-contract): BuilderMethods::fsub_fast
  fsub_fast(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fsub_fast");
  }

  // Stub (cg-contract): BuilderMethods::fsub_algebraic
  fsub_algebraic(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fsub_algebraic");
  }

  // Stub (cg-contract): BuilderMethods::mul
  mul(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs mul");
  }

  // Stub (cg-contract): BuilderMethods::fmul
  fmul(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fmul");
  }

  // Stub (cg-contract): BuilderMethods::fmul_fast
  fmul_fast(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fmul_fast");
  }

  // Stub (cg-contract): BuilderMethods::fmul_algebraic
  fmul_algebraic(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fmul_algebraic");
  }

  // Stub (cg-contract): BuilderMethods::udiv
  udiv(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs udiv");
  }

  // Stub (cg-contract): BuilderMethods::exactudiv
  exactudiv(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs exactudiv");
  }

  // Stub (cg-contract): BuilderMethods::sdiv
  sdiv(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs sdiv");
  }

  // Stub (cg-contract): BuilderMethods::exactsdiv
  exactsdiv(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs exactsdiv");
  }

  // Stub (cg-contract): BuilderMethods::fdiv
  fdiv(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fdiv");
  }

  // Stub (cg-contract): BuilderMethods::fdiv_fast
  fdiv_fast(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fdiv_fast");
  }

  // Stub (cg-contract): BuilderMethods::fdiv_algebraic
  fdiv_algebraic(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fdiv_algebraic");
  }

  // Stub (cg-contract): BuilderMethods::urem
  urem(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs urem");
  }

  // Stub (cg-contract): BuilderMethods::srem
  srem(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs srem");
  }

  // Stub (cg-contract): BuilderMethods::frem
  frem(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs frem");
  }

  // Stub (cg-contract): BuilderMethods::frem_fast
  frem_fast(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs frem_fast");
  }

  // Stub (cg-contract): BuilderMethods::frem_algebraic
  frem_algebraic(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs frem_algebraic");
  }

  // Stub (cg-contract): BuilderMethods::shl
  shl(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs shl");
  }

  // Stub (cg-contract): BuilderMethods::lshr
  lshr(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs lshr");
  }

  // Stub (cg-contract): BuilderMethods::ashr
  ashr(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs ashr");
  }

  // Stub (cg-contract): BuilderMethods::unchecked_sadd
  unchecked_sadd(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unchecked_sadd");
  }

  // Stub (cg-contract): BuilderMethods::unchecked_uadd
  unchecked_uadd(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unchecked_uadd");
  }

  // Stub (cg-contract): BuilderMethods::unchecked_suadd
  unchecked_suadd(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unchecked_suadd");
  }

  // Stub (cg-contract): BuilderMethods::unchecked_ssub
  unchecked_ssub(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unchecked_ssub");
  }

  // Stub (cg-contract): BuilderMethods::unchecked_usub
  unchecked_usub(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unchecked_usub");
  }

  // Stub (cg-contract): BuilderMethods::unchecked_susub
  unchecked_susub(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unchecked_susub");
  }

  // Stub (cg-contract): BuilderMethods::unchecked_smul
  unchecked_smul(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unchecked_smul");
  }

  // Stub (cg-contract): BuilderMethods::unchecked_umul
  unchecked_umul(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unchecked_umul");
  }

  // Stub (cg-contract): BuilderMethods::unchecked_sumul
  unchecked_sumul(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unchecked_sumul");
  }

  // Stub (cg-contract): BuilderMethods::and
  and(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs and");
  }

  // Stub (cg-contract): BuilderMethods::or
  or(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs or");
  }

  // Stub (cg-contract): BuilderMethods::or_disjoint
  or_disjoint(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs or_disjoint");
  }

  // Stub (cg-contract): BuilderMethods::xor
  xor(_lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs xor");
  }

  // Stub (cg-contract): BuilderMethods::neg
  neg(_v: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs neg");
  }

  // Stub (cg-contract): BuilderMethods::fneg
  fneg(_v: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fneg");
  }

  // Stub (cg-contract): BuilderMethods::not
  not(_v: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs not");
  }

  // Stub (cg-contract): BuilderMethods::checked_binop
  checked_binop(_oop: OverflowOp, _ty: Ty, _lhs: Value, _rhs: Value): [Value, Value] {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs checked_binop");
  }

  // Stub (cg-contract): BuilderMethods::from_immediate
  from_immediate(_val: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs from_immediate");
  }

  // Stub (cg-contract): BuilderMethods::to_immediate_scalar
  to_immediate_scalar(_val: Value, _scalar: Scalar): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs to_immediate_scalar");
  }

  // Stub (cg-contract): BuilderMethods::alloca
  alloca(_size: Size, _align: Align): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs alloca");
  }

  // Stub (cg-contract): BuilderMethods::alloca_with_ty
  alloca_with_ty(_layout: TyAndLayout): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs alloca_with_ty");
  }

  // Stub (cg-contract): BuilderMethods::load
  load(_ty: Type, _ptr: Value, _align: Align): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs load");
  }

  // Stub (cg-contract): BuilderMethods::volatile_load
  volatile_load(_ty: Type, _ptr: Value, _align: Align): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs volatile_load");
  }

  // Stub (cg-contract): BuilderMethods::atomic_load
  atomic_load(_ty: Type, _ptr: Value, _order: AtomicOrdering, _volatile: boolean, _size: Size): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs atomic_load");
  }

  // (provided) BuilderMethods::load_from_place -> BuilderMethods_provided.load_from_place
  load_from_place(ty: Type, place: PlaceValue<Value>): Value {
    return BuilderMethods_provided.load_from_place(this, ty, place);
  }

  // Stub (cg-contract): BuilderMethods::load_operand
  load_operand(_place: PlaceRef<Value>): OperandRef<Value> {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs load_operand");
  }

  // Stub (cg-contract): BuilderMethods::write_operand_repeatedly
  write_operand_repeatedly(_elem: OperandRef<Value>, _count: bigint, _dest: PlaceRef<Value>): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs write_operand_repeatedly");
  }

  // (provided) BuilderMethods::assume_integer_range -> BuilderMethods_provided.assume_integer_range
  assume_integer_range(imm: Value, ty: Type, range: WrappingRange): void {
    return BuilderMethods_provided.assume_integer_range(this, imm, ty, range);
  }

  // (provided) BuilderMethods::assume_nonnull -> BuilderMethods_provided.assume_nonnull
  assume_nonnull(val: Value): void {
    return BuilderMethods_provided.assume_nonnull(this, val);
  }

  // Stub (cg-contract): BuilderMethods::range_metadata
  range_metadata(_load: Value, _range: WrappingRange): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs range_metadata");
  }

  // Stub (cg-contract): BuilderMethods::nonnull_metadata
  nonnull_metadata(_load: Value): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs nonnull_metadata");
  }

  // Stub (cg-contract): BuilderMethods::store
  store(_val: Value, _ptr: Value, _align: Align): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs store");
  }

  // (provided) BuilderMethods::store_to_place -> BuilderMethods_provided.store_to_place
  store_to_place(val: Value, place: PlaceValue<Value>): Value {
    return BuilderMethods_provided.store_to_place(this, val, place);
  }

  // Stub (cg-contract): BuilderMethods::store_with_flags
  store_with_flags(_val: Value, _ptr: Value, _align: Align, _flags: MemFlags): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs store_with_flags");
  }

  // (provided) BuilderMethods::store_to_place_with_flags -> BuilderMethods_provided.store_to_place_with_flags
  store_to_place_with_flags(val: Value, place: PlaceValue<Value>, flags: MemFlags): Value {
    return BuilderMethods_provided.store_to_place_with_flags(this, val, place, flags);
  }

  // Stub (cg-contract): BuilderMethods::atomic_store
  atomic_store(_val: Value, _ptr: Value, _order: AtomicOrdering, _volatile: boolean, _size: Size): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs atomic_store");
  }

  // Stub (cg-contract): BuilderMethods::gep
  gep(_ty: Type, _ptr: Value, _indices: readonly Value[]): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs gep");
  }

  // Stub (cg-contract): BuilderMethods::inbounds_gep
  inbounds_gep(_ty: Type, _ptr: Value, _indices: readonly Value[]): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs inbounds_gep");
  }

  // Stub (cg-contract): BuilderMethods::inbounds_nuw_gep
  inbounds_nuw_gep(_ty: Type, _ptr: Value, _indices: readonly Value[]): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs inbounds_nuw_gep");
  }

  // (provided) BuilderMethods::ptradd -> BuilderMethods_provided.ptradd
  ptradd(ptr: Value, offset: Value): Value {
    return BuilderMethods_provided.ptradd(this, ptr, offset);
  }

  // (provided) BuilderMethods::inbounds_ptradd -> BuilderMethods_provided.inbounds_ptradd
  inbounds_ptradd(ptr: Value, offset: Value): Value {
    return BuilderMethods_provided.inbounds_ptradd(this, ptr, offset);
  }

  // Stub (cg-contract): BuilderMethods::trunc
  trunc(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs trunc");
  }

  // Stub (cg-contract): BuilderMethods::unchecked_utrunc
  unchecked_utrunc(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unchecked_utrunc");
  }

  // Stub (cg-contract): BuilderMethods::unchecked_strunc
  unchecked_strunc(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs unchecked_strunc");
  }

  // Stub (cg-contract): BuilderMethods::sext
  sext(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs sext");
  }

  // Stub (cg-contract): BuilderMethods::fptoui_sat
  fptoui_sat(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fptoui_sat");
  }

  // Stub (cg-contract): BuilderMethods::fptosi_sat
  fptosi_sat(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fptosi_sat");
  }

  // Stub (cg-contract): BuilderMethods::fptoui
  fptoui(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fptoui");
  }

  // Stub (cg-contract): BuilderMethods::fptosi
  fptosi(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fptosi");
  }

  // Stub (cg-contract): BuilderMethods::uitofp
  uitofp(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs uitofp");
  }

  // Stub (cg-contract): BuilderMethods::sitofp
  sitofp(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs sitofp");
  }

  // Stub (cg-contract): BuilderMethods::fptrunc
  fptrunc(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fptrunc");
  }

  // Stub (cg-contract): BuilderMethods::fpext
  fpext(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fpext");
  }

  // Stub (cg-contract): BuilderMethods::ptrtoint
  ptrtoint(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs ptrtoint");
  }

  // Stub (cg-contract): BuilderMethods::inttoptr
  inttoptr(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs inttoptr");
  }

  // Stub (cg-contract): BuilderMethods::bitcast
  bitcast(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs bitcast");
  }

  // Stub (cg-contract): BuilderMethods::intcast
  intcast(_val: Value, _dest_ty: Type, _is_signed: boolean): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs intcast");
  }

  // Stub (cg-contract): BuilderMethods::pointercast
  pointercast(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs pointercast");
  }

  // (provided) BuilderMethods::cast_float_to_int -> BuilderMethods_provided.cast_float_to_int
  cast_float_to_int(signed: boolean, x: Value, dest_ty: Type): Value {
    return BuilderMethods_provided.cast_float_to_int(this, signed, x, dest_ty);
  }

  // Stub (cg-contract): BuilderMethods::icmp
  icmp(_op: IntPredicate, _lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs icmp");
  }

  // Stub (cg-contract): BuilderMethods::fcmp
  fcmp(_op: RealPredicate, _lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs fcmp");
  }

  // Stub (cg-contract): BuilderMethods::three_way_compare
  three_way_compare(_ty: Ty, _lhs: Value, _rhs: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs three_way_compare");
  }

  // Stub (cg-contract): BuilderMethods::memcpy
  memcpy(_dst: Value, _dst_align: Align, _src: Value, _src_align: Align, _size: Value, _flags: MemFlags, _tt: FncTree | undefined): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs memcpy");
  }

  // Stub (cg-contract): BuilderMethods::memmove
  memmove(_dst: Value, _dst_align: Align, _src: Value, _src_align: Align, _size: Value, _flags: MemFlags): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs memmove");
  }

  // Stub (cg-contract): BuilderMethods::memset
  memset(_ptr: Value, _fill_byte: Value, _size: Value, _align: Align, _flags: MemFlags): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs memset");
  }

  // Stub (cg-contract): BuilderMethods::vscale
  vscale(_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs vscale");
  }

  // (provided) BuilderMethods::typed_place_copy -> BuilderMethods_provided.typed_place_copy
  typed_place_copy(dst: PlaceValue<Value>, src: PlaceValue<Value>, layout: TyAndLayout): void {
    return BuilderMethods_provided.typed_place_copy(this, dst, src, layout);
  }

  // (provided) BuilderMethods::typed_place_copy_with_flags -> BuilderMethods_provided.typed_place_copy_with_flags
  typed_place_copy_with_flags(dst: PlaceValue<Value>, src: PlaceValue<Value>, layout: TyAndLayout, flags: MemFlags): void {
    return BuilderMethods_provided.typed_place_copy_with_flags(this, dst, src, layout, flags);
  }

  // (provided) BuilderMethods::typed_place_swap -> BuilderMethods_provided.typed_place_swap
  typed_place_swap(left: PlaceValue<Value>, right: PlaceValue<Value>, layout: TyAndLayout): void {
    return BuilderMethods_provided.typed_place_swap(this, left, right, layout);
  }

  // Stub (cg-contract): BuilderMethods::select
  select(_cond: Value, _then_val: Value, _else_val: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs select");
  }

  // Stub (cg-contract): BuilderMethods::va_arg
  va_arg(_list: Value, _ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs va_arg");
  }

  // Stub (cg-contract): BuilderMethods::extract_element
  extract_element(_vec: Value, _idx: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs extract_element");
  }

  // Stub (cg-contract): BuilderMethods::vector_splat
  vector_splat(_num_elts: number, _elt: Value): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs vector_splat");
  }

  // Stub (cg-contract): BuilderMethods::extract_value
  extract_value(_agg_val: Value, _idx: number): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs extract_value");
  }

  // Stub (cg-contract): BuilderMethods::insert_value
  insert_value(_agg_val: Value, _elt: Value, _idx: number): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs insert_value");
  }

  // Stub (cg-contract): BuilderMethods::set_personality_fn
  set_personality_fn(_personality: Value): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs set_personality_fn");
  }

  // Stub (cg-contract): BuilderMethods::cleanup_landing_pad
  cleanup_landing_pad(_pers_fn: Value): [Value, Value] {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs cleanup_landing_pad");
  }

  // Stub (cg-contract): BuilderMethods::filter_landing_pad
  filter_landing_pad(_pers_fn: Value): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs filter_landing_pad");
  }

  // Stub (cg-contract): BuilderMethods::resume
  resume(_exn0: Value, _exn1: Value): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs resume");
  }

  // Stub (cg-contract): BuilderMethods::cleanup_pad
  cleanup_pad(_parent: Value | undefined, _args: readonly Value[]): Funclet {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs cleanup_pad");
  }

  // Stub (cg-contract): BuilderMethods::cleanup_ret
  cleanup_ret(_funclet: Funclet, _unwind: BasicBlock | undefined): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs cleanup_ret");
  }

  // Stub (cg-contract): BuilderMethods::catch_pad
  catch_pad(_parent: Value, _args: readonly Value[]): Funclet {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs catch_pad");
  }

  // Stub (cg-contract): BuilderMethods::catch_switch
  catch_switch(_parent: Value | undefined, _unwind: BasicBlock | undefined, _handlers: readonly BasicBlock[]): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs catch_switch");
  }

  // Stub (cg-contract): BuilderMethods::get_funclet_cleanuppad
  get_funclet_cleanuppad(_funclet: Funclet): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs get_funclet_cleanuppad");
  }

  // Stub (cg-contract): BuilderMethods::atomic_cmpxchg
  atomic_cmpxchg(_dst: Value, _cmp: Value, _src: Value, _order: AtomicOrdering, _failure_order: AtomicOrdering, _weak: boolean): [Value, Value] {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs atomic_cmpxchg");
  }

  // Stub (cg-contract): BuilderMethods::atomic_rmw
  atomic_rmw(_op: AtomicRmwBinOp, _dst: Value, _src: Value, _order: AtomicOrdering, _ret_ptr: boolean): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs atomic_rmw");
  }

  // Stub (cg-contract): BuilderMethods::atomic_fence
  atomic_fence(_order: AtomicOrdering, _scope: SynchronizationScope): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs atomic_fence");
  }

  // Stub (cg-contract): BuilderMethods::set_invariant_load
  set_invariant_load(_load: Value): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs set_invariant_load");
  }

  // Stub (cg-contract): BuilderMethods::lifetime_start
  lifetime_start(_ptr: Value, _size: Size): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs lifetime_start");
  }

  // Stub (cg-contract): BuilderMethods::lifetime_end
  lifetime_end(_ptr: Value, _size: Size): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs lifetime_end");
  }

  // Stub (cg-contract): BuilderMethods::call
  call(_llty: Type, _caller_attrs: CodegenFnAttrs | undefined, _fn_abi: FnAbi<Ty> | undefined, _fn_val: Value, _return_slot: ReturnSlot<Value>, _args: readonly Value[], _funclet: Funclet | undefined, _callee_instance: Instance | undefined): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs call");
  }

  // Stub (cg-contract): BuilderMethods::tail_call
  tail_call(_llty: Type, _caller_attrs: CodegenFnAttrs | undefined, _fn_abi: FnAbi<Ty>, _llfn: Value, _return_slot: ReturnSlot<Value>, _args: readonly Value[], _funclet: Funclet | undefined, _callee_instance: Instance | undefined): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs tail_call");
  }

  // Stub (cg-contract): BuilderMethods::zext
  zext(_val: Value, _dest_ty: Type): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs zext");
  }

  // Stub (cg-contract): BuilderMethods::apply_attrs_to_cleanup_callsite
  apply_attrs_to_cleanup_callsite(_llret: Value): void {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs apply_attrs_to_cleanup_callsite");
  }

  // ---- impl StaticBuilderMethods for Builder (builder.rs:1568) ----
  // Stub (cg-contract): StaticBuilderMethods::get_static
  get_static(_def_id: DefId): Value {
    return unported("cg-builder: compiler/rustc_codegen_llvm/src/builder.rs get_static");
  }
}

/** `Builder`'s static side is `BuilderMethodsStatic` (header), checked here without a cast. */
export const Builder_static: BuilderMethodsStatic<LlvmTypes, CodegenCx, Builder> = Builder;
