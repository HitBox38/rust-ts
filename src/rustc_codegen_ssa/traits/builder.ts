// Port of compiler/rustc_codegen_ssa/src/traits/builder.rs (lane ssa-contract). Conventions: backend.ts's header.
//
// PORT (ssa-contract):
// - `BuilderMethods<'a, 'tcx>` is `BuilderMethods<B, Cx>`: `B` the shared associated types (the `CodegenCx: CodegenMethods
//   <Value = Self::Value, ...>` bound is the one `B` for both), `Cx` the type `Self::CodegenCx` (default
//   `CodegenMethods<B>`, enough for generic code).
// - `Deref<Target = Self::CodegenCx>`: the builder interface extends `CodegenMethods<B>`, so `bx.type_i8()`,
//   `bx.const_usize(..)`, `bx.sess()` read as upstream; an implementing builder forwards those members to its `cx`.
// - The associated fns without `self` (`build`, `append_block`) are the static side of an implementing class,
//   `BuilderMethodsStatic<B, Cx, Bx>`; where upstream writes `Bx::build(cx, llbb)`, generic code takes that static side
//   as a parameter (`Bx_`), as PORTING §5 passes trait functions for generic code.
// - `cases: impl ExactSizeIterator<Item = ..>` is a readonly array (the length is its `len()`; nothing upstream relies
//   on laziness: the items are plain values).
// - `u64` counts and indices: `write_operand_repeatedly`'s `count` is a `bigint` (an array length); `extract_value`/
//   `insert_value`'s `idx` is an aggregate field index, so a `number` (PORTING §5). `u128` case values are `bigint`.
import { Align, BackendRepr, type Scalar, type Size } from "../../rustc_abi/lib.ts";
import type { WrappingRange } from "../../rustc_abi/wrapping_range.ts";
import { clone_TypeTree, type FncTree, TypeTree } from "../../rustc_ast/expand/typetree.ts";
import type { UnrollAttr } from "../../rustc_attr_ir/data_structures.gen.ts";
import type { CodegenFnAttrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import type { BinOp } from "../../rustc_middle/mir/syntax.ts";
import type { AtomicOrdering } from "../../rustc_middle/ty/consts/int.ts";
import type { Instance } from "../../rustc_middle/ty/instance.ts";
import type { FnAbiOf, LayoutOf, TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import { typetree_from_ty } from "../../rustc_middle/ty/typetree.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { FnAbi } from "../../rustc_target/callconv/mod.ts";
import { type Debug, debug_option, PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, assert_matches } from "../../std/panic.ts";
import { bin_op_to_icmp_predicate } from "../base.ts";
import { type AtomicRmwBinOp, debug_TypeKind, IntPredicate, type RealPredicate, type SynchronizationScope, TypeKind } from "../common.ts";
import { MemFlags } from "../lib.ts";
import { type OperandRef, OperandValue } from "../mir/operand.ts";
import { PlaceRef, type PlaceValue } from "../mir/place.ts";
import type { AbiBuilderMethods } from "./abi.ts";
import type { AsmBuilderMethods } from "./asm.ts";
import type { BackendTypes } from "./backend.ts";
import type { CoverageInfoBuilderMethods } from "./coverageinfo.ts";
import type { DebugInfoBuilderMethods } from "./debuginfo.ts";
import type { IntrinsicCallBuilderMethods } from "./intrinsic.ts";
import type { CodegenMethods } from "./mod.ts";
import type { StaticBuilderMethods } from "./statics.ts";
import type { ArgAbiBuilderMethods } from "./type_.ts";

// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
export type OverflowOp = "Add" | "Sub" | "Mul";
export const OverflowOp = { Add: "Add", Sub: "Sub", Mul: "Mul" } as const;
export const debug_OverflowOp: Debug<OverflowOp> = (v) => v;

/// The location of the return value for the call.
// #[derive(Copy, Clone, Debug)]
export type ReturnSlot<V> =
  | { readonly $: "Direct" }
  /// The return value will be passed via sret (e.g. `PassMode::Indirect`).
  | { readonly $: "Indirect"; _0: V };
export const ReturnSlot = {
  /** Shared frozen singleton of the unit variant. */
  Direct: Object.freeze({ $: "Direct" }) as { readonly $: "Direct" },

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:46 is_indirect
  is_indirect<V>(self: ReturnSlot<V>): boolean {
    return self.$ === "Indirect";
  },
} as const;

/** The associated fns of `BuilderMethods` that take no `self` (header): the static side of an implementing class. */
export interface BuilderMethodsStatic<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>> {
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:80 build
  build(cx: Cx, llbb: B["BasicBlock"]): Bx;

  // FIXME(eddyb) replace uses of this with `append_sibling_block`.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:88 append_block
  append_block(cx: Cx, llfn: B["Function"], name: string): B["BasicBlock"];
}

// rustc-trait: compiler/rustc_codegen_ssa/src/traits/builder.rs:51 BuilderMethods
export interface BuilderMethods<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>>
  extends LayoutOf<TyAndLayout, never>,
    FnAbiOf<TyAndLayout, never, FnAbi<Ty>, never>,
    CodegenMethods<B>,
    CoverageInfoBuilderMethods,
    DebugInfoBuilderMethods<B>,
    ArgAbiBuilderMethods<B>,
    AbiBuilderMethods<B>,
    IntrinsicCallBuilderMethods<B>,
    AsmBuilderMethods<B>,
    StaticBuilderMethods<B> {
  // `BackendTypes` is a supertrait of both `CodegenMethods` and
  // `BuilderMethods`. This bound ensures all impls agree on the associated
  // types within.
  // type CodegenCx: CodegenMethods<'tcx, Value = Self::Value, ...>; (the type parameter `Cx`)

  // fn build(cx: &'a Self::CodegenCx, llbb: Self::BasicBlock) -> Self; (BuilderMethodsStatic.build)

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:82 cx
  cx(): Cx;
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:83 llbb
  llbb(): B["BasicBlock"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:85 set_span
  set_span(span: Span): void;

  // fn append_block(cx, llfn, name) -> Self::BasicBlock; (BuilderMethodsStatic.append_block)

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:90 append_sibling_block
  append_sibling_block(name: string): B["BasicBlock"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:92 switch_to_block
  switch_to_block(llbb: B["BasicBlock"]): void;

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:94 ret_void
  ret_void(): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:95 ret
  ret(v: B["Value"]): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:96 br
  br(dest: B["BasicBlock"]): void;
  // (provided) traits/builder.rs:97 br_with_attrs -> BuilderMethods_provided.br_with_attrs
  br_with_attrs(dest: B["BasicBlock"], loop_hint_attrs: readonly UnrollAttr[]): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:100 cond_br
  cond_br(cond: B["Value"], then_llbb: B["BasicBlock"], else_llbb: B["BasicBlock"]): void;

  // Conditional with expectation.
  //
  // This function is opt-in for back ends.
  //
  // The default implementation calls `self.expect()` before emitting the branch
  // by calling `self.cond_br()`
  // (provided) traits/builder.rs:113 cond_br_with_expect -> BuilderMethods_provided.cond_br_with_expect
  cond_br_with_expect(cond: B["Value"], then_llbb: B["BasicBlock"], else_llbb: B["BasicBlock"], expect: boolean | undefined): void;

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:126 switch
  switch(v: B["Value"], else_llbb: B["BasicBlock"], cases: readonly (readonly [bigint, B["BasicBlock"]])[]): void;

  // This is like `switch()`, but every case has a bool flag indicating whether it's cold.
  //
  // Default implementation throws away the cold flags and calls `switch()`.
  // (provided) traits/builder.rs:136 switch_with_weights -> BuilderMethods_provided.switch_with_weights
  switch_with_weights(
    v: B["Value"],
    else_llbb: B["BasicBlock"],
    else_is_cold: boolean,
    cases: readonly (readonly [bigint, B["BasicBlock"], boolean])[],
  ): void;

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:146 invoke
  invoke(
    llty: B["FunctionSignature"],
    fn_attrs: CodegenFnAttrs | undefined,
    fn_abi: FnAbi<Ty> | undefined,
    llfn: B["Value"],
    return_slot: ReturnSlot<B["Value"]>,
    args: readonly B["Value"][],
    then: B["BasicBlock"],
    catch_: B["BasicBlock"],
    funclet: B["Funclet"] | undefined,
    instance: Instance | undefined,
  ): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:159 unreachable
  unreachable(): void;

  /// Like [`Self::unreachable`], but for use in the middle of a basic block.
  // (provided) traits/builder.rs:162 unreachable_nonterminator -> BuilderMethods_provided.unreachable_nonterminator
  unreachable_nonterminator(): void;

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:171 add
  add(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:172 fadd
  fadd(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:173 fadd_fast
  fadd_fast(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:174 fadd_algebraic
  fadd_algebraic(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:175 sub
  sub(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:176 fsub
  fsub(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:177 fsub_fast
  fsub_fast(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:178 fsub_algebraic
  fsub_algebraic(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:179 mul
  mul(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:180 fmul
  fmul(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:181 fmul_fast
  fmul_fast(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:182 fmul_algebraic
  fmul_algebraic(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:183 udiv
  udiv(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:184 exactudiv
  exactudiv(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:185 sdiv
  sdiv(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:186 exactsdiv
  exactsdiv(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:187 fdiv
  fdiv(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:188 fdiv_fast
  fdiv_fast(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:189 fdiv_algebraic
  fdiv_algebraic(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:190 urem
  urem(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:191 srem
  srem(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:192 frem
  frem(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:193 frem_fast
  frem_fast(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:194 frem_algebraic
  frem_algebraic(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  /// Generate a left-shift. Both operands must have the same size. The right operand must be
  /// interpreted as unsigned and can be assumed to be less than the size of the left operand.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:197 shl
  shl(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  /// Generate a logical right-shift. Both operands must have the same size. The right operand
  /// must be interpreted as unsigned and can be assumed to be less than the size of the left
  /// operand.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:201 lshr
  lshr(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  /// Generate an arithmetic right-shift. Both operands must have the same size. The right operand
  /// must be interpreted as unsigned and can be assumed to be less than the size of the left
  /// operand.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:205 ashr
  ashr(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // (provided) traits/builder.rs:206 unchecked_sadd -> BuilderMethods_provided.unchecked_sadd
  unchecked_sadd(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // (provided) traits/builder.rs:209 unchecked_uadd -> BuilderMethods_provided.unchecked_uadd
  unchecked_uadd(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // (provided) traits/builder.rs:212 unchecked_suadd -> BuilderMethods_provided.unchecked_suadd
  unchecked_suadd(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // (provided) traits/builder.rs:215 unchecked_ssub -> BuilderMethods_provided.unchecked_ssub
  unchecked_ssub(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // (provided) traits/builder.rs:218 unchecked_usub -> BuilderMethods_provided.unchecked_usub
  unchecked_usub(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // (provided) traits/builder.rs:221 unchecked_susub -> BuilderMethods_provided.unchecked_susub
  unchecked_susub(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // (provided) traits/builder.rs:224 unchecked_smul -> BuilderMethods_provided.unchecked_smul
  unchecked_smul(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // (provided) traits/builder.rs:227 unchecked_umul -> BuilderMethods_provided.unchecked_umul
  unchecked_umul(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // (provided) traits/builder.rs:230 unchecked_sumul -> BuilderMethods_provided.unchecked_sumul
  unchecked_sumul(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:235 and
  and(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:236 or
  or(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  /// Defaults to [`Self::or`], but guarantees `(lhs & rhs) == 0` so some backends
  /// can emit something more helpful for optimizations.
  // (provided) traits/builder.rs:239 or_disjoint -> BuilderMethods_provided.or_disjoint
  or_disjoint(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:242 xor
  xor(lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:243 neg
  neg(v: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:244 fneg
  fneg(v: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:245 not
  not(v: B["Value"]): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:247 checked_binop
  checked_binop(oop: OverflowOp, ty: Ty, lhs: B["Value"], rhs: B["Value"]): [B["Value"], B["Value"]];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:255 from_immediate
  from_immediate(val: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:256 to_immediate_scalar
  to_immediate_scalar(val: B["Value"], scalar: Scalar): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:258 alloca
  alloca(size: Size, align: Align): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:259 alloca_with_ty
  alloca_with_ty(layout: TyAndLayout): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:261 load
  load(ty: B["Type"], ptr: B["Value"], align: Align): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:262 volatile_load
  volatile_load(ty: B["Type"], ptr: B["Value"], align: Align): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:263 atomic_load
  atomic_load(ty: B["Type"], ptr: B["Value"], order: AtomicOrdering, volatile: boolean, size: Size): B["Value"];
  // (provided) traits/builder.rs:271 load_from_place -> BuilderMethods_provided.load_from_place
  load_from_place(ty: B["Type"], place: PlaceValue<B["Value"]>): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:275 load_operand
  load_operand(place: PlaceRef<B["Value"]>): OperandRef<B["Value"]>;

  /// Called for Rvalue::Repeat when the elem is neither a ZST nor optimizable using memset.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:279 write_operand_repeatedly
  write_operand_repeatedly(elem: OperandRef<B["Value"]>, count: bigint, dest: PlaceRef<B["Value"]>): void;

  /// Emits an `assume` that the integer value `imm` of type `ty` is contained in `range`.
  ///
  /// This *always* emits the assumption, so you probably want to check the
  /// optimization level and `Scalar::is_always_valid` before calling it.
  // (provided) traits/builder.rs:290 assume_integer_range -> BuilderMethods_provided.assume_integer_range
  assume_integer_range(imm: B["Value"], ty: B["Type"], range: WrappingRange): void;

  /// Emits an `assume` that the `val` of pointer type is non-null.
  ///
  /// You may want to check the optimization level before bothering calling this.
  // (provided) traits/builder.rs:310 assume_nonnull -> BuilderMethods_provided.assume_nonnull
  assume_nonnull(val: B["Value"]): void;

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:320 range_metadata
  range_metadata(load: B["Value"], range: WrappingRange): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:321 nonnull_metadata
  nonnull_metadata(load: B["Value"]): void;

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:323 store
  store(val: B["Value"], ptr: B["Value"], align: Align): B["Value"];
  // (provided) traits/builder.rs:324 store_to_place -> BuilderMethods_provided.store_to_place
  store_to_place(val: B["Value"], place: PlaceValue<B["Value"]>): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:328 store_with_flags
  store_with_flags(val: B["Value"], ptr: B["Value"], align: Align, flags: MemFlags): B["Value"];
  // (provided) traits/builder.rs:335 store_to_place_with_flags -> BuilderMethods_provided.store_to_place_with_flags
  store_to_place_with_flags(val: B["Value"], place: PlaceValue<B["Value"]>, flags: MemFlags): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:344 atomic_store
  atomic_store(val: B["Value"], ptr: B["Value"], order: AtomicOrdering, volatile: boolean, size: Size): void;

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:353 gep
  gep(ty: B["Type"], ptr: B["Value"], indices: readonly B["Value"][]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:354 inbounds_gep
  inbounds_gep(ty: B["Type"], ptr: B["Value"], indices: readonly B["Value"][]): B["Value"];
  // (provided) traits/builder.rs:360 inbounds_nuw_gep -> BuilderMethods_provided.inbounds_nuw_gep
  inbounds_nuw_gep(ty: B["Type"], ptr: B["Value"], indices: readonly B["Value"][]): B["Value"];
  // (provided) traits/builder.rs:368 ptradd -> BuilderMethods_provided.ptradd
  ptradd(ptr: B["Value"], offset: B["Value"]): B["Value"];
  // (provided) traits/builder.rs:371 inbounds_ptradd -> BuilderMethods_provided.inbounds_ptradd
  inbounds_ptradd(ptr: B["Value"], offset: B["Value"]): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:375 trunc
  trunc(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  /// Produces the same value as [`Self::trunc`] (and defaults to that),
  /// but is UB unless the *zero*-extending the result can reproduce `val`.
  // (provided) traits/builder.rs:378 unchecked_utrunc -> BuilderMethods_provided.unchecked_utrunc
  unchecked_utrunc(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  /// Produces the same value as [`Self::trunc`] (and defaults to that),
  /// but is UB unless the *sign*-extending the result can reproduce `val`.
  // (provided) traits/builder.rs:383 unchecked_strunc -> BuilderMethods_provided.unchecked_strunc
  unchecked_strunc(val: B["Value"], dest_ty: B["Type"]): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:387 sext
  sext(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:388 fptoui_sat
  fptoui_sat(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:389 fptosi_sat
  fptosi_sat(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:390 fptoui
  fptoui(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:391 fptosi
  fptosi(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:392 uitofp
  uitofp(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:393 sitofp
  sitofp(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:394 fptrunc
  fptrunc(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:395 fpext
  fpext(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:396 ptrtoint
  ptrtoint(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:397 inttoptr
  inttoptr(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:398 bitcast
  bitcast(val: B["Value"], dest_ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:399 intcast
  intcast(val: B["Value"], dest_ty: B["Type"], is_signed: boolean): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:400 pointercast
  pointercast(val: B["Value"], dest_ty: B["Type"]): B["Value"];

  // (provided) traits/builder.rs:402 cast_float_to_int -> BuilderMethods_provided.cast_float_to_int
  cast_float_to_int(signed: boolean, x: B["Value"], dest_ty: B["Type"]): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:425 icmp
  icmp(op: IntPredicate, lhs: B["Value"], rhs: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:426 fcmp
  fcmp(op: RealPredicate, lhs: B["Value"], rhs: B["Value"]): B["Value"];

  /// Returns `-1` if `lhs < rhs`, `0` if `lhs == rhs`, and `1` if `lhs > rhs`.
  // (provided) traits/builder.rs:429 three_way_compare -> BuilderMethods_provided.three_way_compare
  three_way_compare(ty: Ty, lhs: B["Value"], rhs: B["Value"]): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:466 memcpy
  memcpy(
    dst: B["Value"],
    dst_align: Align,
    src: B["Value"],
    src_align: Align,
    size: B["Value"],
    flags: MemFlags,
    tt: FncTree | undefined,
  ): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:476 memmove
  memmove(dst: B["Value"], dst_align: Align, src: B["Value"], src_align: Align, size: B["Value"], flags: MemFlags): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:485 memset
  memset(ptr: B["Value"], fill_byte: B["Value"], size: B["Value"], align: Align, flags: MemFlags): void;

  // Produce a value from calling the `vscale` intrinsic (containing the `vscale` multiplier that
  // a scalable vector's element size and count can be multiplied by to get the real size of the
  // vector)
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:497 vscale
  vscale(ty: B["Type"]): B["Value"];

  /// *Typed* copy for non-overlapping places.
  ///
  /// Has a default implementation in terms of `memcpy`, but specific backends
  /// can override to do something smarter if possible.
  ///
  /// (For example, typed load-stores with alias metadata.)
  // (provided) traits/builder.rs:505 typed_place_copy -> BuilderMethods_provided.typed_place_copy
  typed_place_copy(dst: PlaceValue<B["Value"]>, src: PlaceValue<B["Value"]>, layout: TyAndLayout): void;

  // (provided) traits/builder.rs:514 typed_place_copy_with_flags -> BuilderMethods_provided.typed_place_copy_with_flags
  typed_place_copy_with_flags(dst: PlaceValue<B["Value"]>, src: PlaceValue<B["Value"]>, layout: TyAndLayout, flags: MemFlags): void;

  /// *Typed* swap for non-overlapping places.
  ///
  /// Avoids `alloca`s for Immediates and ScalarPairs.
  ///
  /// FIXME: Maybe do something smarter for Ref types too?
  /// For now, the `typed_swap_nonoverlapping` intrinsic just doesn't call this for those
  /// cases (in non-debug), preferring the fallback body instead.
  // (provided) traits/builder.rs:562 typed_place_swap -> BuilderMethods_provided.typed_place_swap
  typed_place_swap(left: PlaceValue<B["Value"]>, right: PlaceValue<B["Value"]>, layout: TyAndLayout): void;

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:579 select
  select(cond: B["Value"], then_val: B["Value"], else_val: B["Value"]): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:586 va_arg
  va_arg(list: B["Value"], ty: B["Type"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:587 extract_element
  extract_element(vec: B["Value"], idx: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:588 vector_splat
  vector_splat(num_elts: number, elt: B["Value"]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:589 extract_value
  extract_value(agg_val: B["Value"], idx: number): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:590 insert_value
  insert_value(agg_val: B["Value"], elt: B["Value"], idx: number): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:592 set_personality_fn
  set_personality_fn(personality: B["Function"]): void;

  // These are used by everyone except msvc and wasm EH
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:595 cleanup_landing_pad
  cleanup_landing_pad(pers_fn: B["Function"]): [B["Value"], B["Value"]];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:596 filter_landing_pad
  filter_landing_pad(pers_fn: B["Function"]): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:597 resume
  resume(exn0: B["Value"], exn1: B["Value"]): void;

  // These are used by msvc and wasm EH
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:600 cleanup_pad
  cleanup_pad(parent: B["Value"] | undefined, args: readonly B["Value"][]): B["Funclet"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:601 cleanup_ret
  cleanup_ret(funclet: B["Funclet"], unwind: B["BasicBlock"] | undefined): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:602 catch_pad
  catch_pad(parent: B["Value"], args: readonly B["Value"][]): B["Funclet"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:603 catch_switch
  catch_switch(parent: B["Value"] | undefined, unwind: B["BasicBlock"] | undefined, handlers: readonly B["BasicBlock"][]): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:609 get_funclet_cleanuppad
  get_funclet_cleanuppad(funclet: B["Funclet"]): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:611 atomic_cmpxchg
  atomic_cmpxchg(
    dst: B["Value"],
    cmp: B["Value"],
    src: B["Value"],
    order: AtomicOrdering,
    failure_order: AtomicOrdering,
    weak: boolean,
  ): [B["Value"], B["Value"]];
  /// `ret_ptr` indicates whether the return type (which is also the type `dst` points to)
  /// is a pointer or the same type as `src`.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:622 atomic_rmw
  atomic_rmw(op: AtomicRmwBinOp, dst: B["Value"], src: B["Value"], order: AtomicOrdering, ret_ptr: boolean): B["Value"];
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:630 atomic_fence
  atomic_fence(order: AtomicOrdering, scope: SynchronizationScope): void;
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:631 set_invariant_load
  set_invariant_load(load: B["Value"]): void;

  /// Called for `StorageLive`
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:634 lifetime_start
  lifetime_start(ptr: B["Value"], size: Size): void;

  /// Called for `StorageDead`
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:637 lifetime_end
  lifetime_end(ptr: B["Value"], size: Size): void;

  /// "Finally codegen the call"
  ///
  /// ## Arguments
  ///
  /// `caller_attrs` are the attributes of the surrounding caller; they have nothing to do with
  /// the callee.
  ///
  /// The `caller_attrs`, `fn_abi`, and `callee_instance` arguments are Options because they are
  /// advisory. They relate to optional codegen enhancements like LLVM CFI, and do not affect ABI
  /// per se. Any ABI-related transformations should be handled by different, earlier stages of
  /// codegen. For instance, in the caller of `BuilderMethods::call`.
  ///
  /// This means that a codegen backend which disregards `fn_attrs`, `fn_abi`, and `instance`
  /// should still do correct codegen, and code should not be miscompiled if they are omitted.
  /// It is not a miscompilation in this sense if it fails to run under CFI, other sanitizers, or
  /// in the context of other compiler-enhanced security features.
  ///
  /// The typical case that they are None is during the codegen of intrinsics and lang-items,
  /// as those are "fake functions" with only a trivial ABI if any, et cetera.
  ///
  /// `return_slot` must be `ReturnSlot::Indirect` if an argument uses `PassMode::Indirect`.
  ///
  /// ## Return
  ///
  /// Must return the value the function will return so it can be written to the destination.
  /// For calls with an indirect return, the returned value is meaningless and must not be
  /// used: the return value lives in the return slot.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:666 call
  call(
    llty: B["FunctionSignature"],
    caller_attrs: CodegenFnAttrs | undefined,
    fn_abi: FnAbi<Ty> | undefined,
    fn_val: B["Value"],
    return_slot: ReturnSlot<B["Value"]>,
    args: readonly B["Value"][],
    funclet: B["Funclet"] | undefined,
    callee_instance: Instance | undefined,
  ): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:678 tail_call
  tail_call(
    llty: B["FunctionSignature"],
    caller_attrs: CodegenFnAttrs | undefined,
    fn_abi: FnAbi<Ty>,
    llfn: B["Value"],
    return_slot: ReturnSlot<B["Value"]>,
    args: readonly B["Value"][],
    funclet: B["Funclet"] | undefined,
    callee_instance: Instance | undefined,
  ): void;

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:690 zext
  zext(val: B["Value"], dest_ty: B["Type"]): B["Value"];

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:692 apply_attrs_to_cleanup_callsite
  apply_attrs_to_cleanup_callsite(llret: B["Value"]): void;
}

/** The provided methods of `BuilderMethods` (PORTING §8; `self` first). An implementing builder forwards each
 *  `(provided)` member it does not override here. */
export const BuilderMethods_provided = {
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:97 br_with_attrs
  br_with_attrs<B extends BackendTypes>(self: BuilderMethods<B>, dest: B["BasicBlock"], _loop_hint_attrs: readonly UnrollAttr[]): void {
    self.br(dest);
  },

  // Conditional with expectation.
  //
  // This function is opt-in for back ends.
  //
  // The default implementation calls `self.expect()` before emitting the branch
  // by calling `self.cond_br()`
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:113 cond_br_with_expect
  cond_br_with_expect<B extends BackendTypes>(
    self: BuilderMethods<B>,
    cond: B["Value"],
    then_llbb: B["BasicBlock"],
    else_llbb: B["BasicBlock"],
    expect: boolean | undefined,
  ): void {
    if (expect !== undefined) {
      cond = self.expect(cond, expect);
    }
    self.cond_br(cond, then_llbb, else_llbb);
  },

  // This is like `switch()`, but every case has a bool flag indicating whether it's cold.
  //
  // Default implementation throws away the cold flags and calls `switch()`.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:136 switch_with_weights
  switch_with_weights<B extends BackendTypes>(
    self: BuilderMethods<B>,
    v: B["Value"],
    else_llbb: B["BasicBlock"],
    _else_is_cold: boolean,
    cases: readonly (readonly [bigint, B["BasicBlock"], boolean])[],
  ): void {
    self.switch(
      v,
      else_llbb,
      cases.map(([val, bb, _]) => [val, bb] as const),
    );
  },

  /// Like [`Self::unreachable`], but for use in the middle of a basic block.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:162 unreachable_nonterminator
  unreachable_nonterminator<B extends BackendTypes>(self: BuilderMethods<B>): void {
    // This is the preferred LLVM incantation for this per
    // https://llvm.org/docs/Frontend/PerformanceTips.html#other-things-to-consider
    // Other backends may override if they have a better way.
    const const_true = self.cx().const_bool(true);
    const poison_ptr = self.const_poison(self.cx().type_ptr());
    self.store(const_true, poison_ptr, Align.ONE);
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:206 unchecked_sadd
  unchecked_sadd<B extends BackendTypes>(self: BuilderMethods<B>, lhs: B["Value"], rhs: B["Value"]): B["Value"] {
    return self.add(lhs, rhs);
  },
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:209 unchecked_uadd
  unchecked_uadd<B extends BackendTypes>(self: BuilderMethods<B>, lhs: B["Value"], rhs: B["Value"]): B["Value"] {
    return self.add(lhs, rhs);
  },
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:212 unchecked_suadd
  unchecked_suadd<B extends BackendTypes>(self: BuilderMethods<B>, lhs: B["Value"], rhs: B["Value"]): B["Value"] {
    return self.unchecked_sadd(lhs, rhs);
  },
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:215 unchecked_ssub
  unchecked_ssub<B extends BackendTypes>(self: BuilderMethods<B>, lhs: B["Value"], rhs: B["Value"]): B["Value"] {
    return self.sub(lhs, rhs);
  },
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:218 unchecked_usub
  unchecked_usub<B extends BackendTypes>(self: BuilderMethods<B>, lhs: B["Value"], rhs: B["Value"]): B["Value"] {
    return self.sub(lhs, rhs);
  },
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:221 unchecked_susub
  unchecked_susub<B extends BackendTypes>(self: BuilderMethods<B>, lhs: B["Value"], rhs: B["Value"]): B["Value"] {
    return self.unchecked_ssub(lhs, rhs);
  },
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:224 unchecked_smul
  unchecked_smul<B extends BackendTypes>(self: BuilderMethods<B>, lhs: B["Value"], rhs: B["Value"]): B["Value"] {
    return self.mul(lhs, rhs);
  },
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:227 unchecked_umul
  unchecked_umul<B extends BackendTypes>(self: BuilderMethods<B>, lhs: B["Value"], rhs: B["Value"]): B["Value"] {
    return self.mul(lhs, rhs);
  },
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:230 unchecked_sumul
  unchecked_sumul<B extends BackendTypes>(self: BuilderMethods<B>, lhs: B["Value"], rhs: B["Value"]): B["Value"] {
    // Which to default to is a fairly arbitrary choice,
    // but this is what slice layout was using before.
    return self.unchecked_smul(lhs, rhs);
  },

  /// Defaults to [`Self::or`], but guarantees `(lhs & rhs) == 0` so some backends
  /// can emit something more helpful for optimizations.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:239 or_disjoint
  or_disjoint<B extends BackendTypes>(self: BuilderMethods<B>, lhs: B["Value"], rhs: B["Value"]): B["Value"] {
    return self.or(lhs, rhs);
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:271 load_from_place
  load_from_place<B extends BackendTypes>(self: BuilderMethods<B>, ty: B["Type"], place: PlaceValue<B["Value"]>): B["Value"] {
    assert_eq(place.llextra, undefined, (v) => debug_option(v, PLAIN, self.debug_Value));
    return self.load(ty, place.llval, place.align);
  },

  /// Emits an `assume` that the integer value `imm` of type `ty` is contained in `range`.
  ///
  /// This *always* emits the assumption, so you probably want to check the
  /// optimization level and `Scalar::is_always_valid` before calling it.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:290 assume_integer_range
  assume_integer_range<B extends BackendTypes>(self: BuilderMethods<B>, imm: B["Value"], ty: B["Type"], range: WrappingRange): void {
    const { start, end } = range;

    // Perhaps one day we'll be able to use assume operand bundles for this,
    // but for now this encoding with a single icmp+assume is best per
    // <https://github.com/llvm/llvm-project/issues/123278#issuecomment-2597440158>
    let shifted: B["Value"];
    if (start === 0n) {
      shifted = imm;
    } else {
      const low = self.const_uint_big(ty, start);
      shifted = self.sub(imm, low);
    }
    const width = self.const_uint_big(ty, BigInt.asUintN(128, end - start));
    const cmp = self.icmp(IntPredicate.IntULE, shifted, width);
    self.assume(cmp);
  },

  /// Emits an `assume` that the `val` of pointer type is non-null.
  ///
  /// You may want to check the optimization level before bothering calling this.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:310 assume_nonnull
  assume_nonnull<B extends BackendTypes>(self: BuilderMethods<B>, val: B["Value"]): void {
    // Arguably in LLVM it'd be better to emit an assume operand bundle instead
    // <https://llvm.org/docs/LangRef.html#assume-operand-bundles>
    // but this works fine for all backends.

    const null_ = self.const_null(self.type_ptr());
    const is_null = self.icmp(IntPredicate.IntNE, val, null_);
    self.assume(is_null);
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:324 store_to_place
  store_to_place<B extends BackendTypes>(self: BuilderMethods<B>, val: B["Value"], place: PlaceValue<B["Value"]>): B["Value"] {
    assert_eq(place.llextra, undefined, (v) => debug_option(v, PLAIN, self.debug_Value));
    return self.store(val, place.llval, place.align);
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:335 store_to_place_with_flags
  store_to_place_with_flags<B extends BackendTypes>(
    self: BuilderMethods<B>,
    val: B["Value"],
    place: PlaceValue<B["Value"]>,
    flags: MemFlags,
  ): B["Value"] {
    assert_eq(place.llextra, undefined, (v) => debug_option(v, PLAIN, self.debug_Value));
    return self.store_with_flags(val, place.llval, place.align, flags);
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:360 inbounds_nuw_gep
  inbounds_nuw_gep<B extends BackendTypes>(
    self: BuilderMethods<B>,
    ty: B["Type"],
    ptr: B["Value"],
    indices: readonly B["Value"][],
  ): B["Value"] {
    return self.inbounds_gep(ty, ptr, indices);
  },
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:368 ptradd
  ptradd<B extends BackendTypes>(self: BuilderMethods<B>, ptr: B["Value"], offset: B["Value"]): B["Value"] {
    return self.gep(self.cx().type_i8(), ptr, [offset]);
  },
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:371 inbounds_ptradd
  inbounds_ptradd<B extends BackendTypes>(self: BuilderMethods<B>, ptr: B["Value"], offset: B["Value"]): B["Value"] {
    return self.inbounds_gep(self.cx().type_i8(), ptr, [offset]);
  },

  /// Produces the same value as [`Self::trunc`] (and defaults to that),
  /// but is UB unless the *zero*-extending the result can reproduce `val`.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:378 unchecked_utrunc
  unchecked_utrunc<B extends BackendTypes>(self: BuilderMethods<B>, val: B["Value"], dest_ty: B["Type"]): B["Value"] {
    return self.trunc(val, dest_ty);
  },
  /// Produces the same value as [`Self::trunc`] (and defaults to that),
  /// but is UB unless the *sign*-extending the result can reproduce `val`.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:383 unchecked_strunc
  unchecked_strunc<B extends BackendTypes>(self: BuilderMethods<B>, val: B["Value"], dest_ty: B["Type"]): B["Value"] {
    return self.trunc(val, dest_ty);
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:402 cast_float_to_int
  cast_float_to_int<B extends BackendTypes>(self: BuilderMethods<B>, signed: boolean, x: B["Value"], dest_ty: B["Type"]): B["Value"] {
    const in_ty = self.cx().val_ty(x);
    let float_ty: B["Type"], int_ty: B["Type"];
    if (self.cx().type_kind(dest_ty) === TypeKind.Vector && self.cx().type_kind(in_ty) === TypeKind.Vector) {
      [float_ty, int_ty] = [self.cx().element_type(in_ty), self.cx().element_type(dest_ty)];
    } else {
      [float_ty, int_ty] = [in_ty, dest_ty];
    }
    const float_kind = self.cx().type_kind(float_ty);
    assert_matches(
      float_kind,
      float_kind === "Half" || float_kind === "Float" || float_kind === "Double" || float_kind === "FP128",
      "TypeKind::Half | TypeKind::Float | TypeKind::Double | TypeKind::FP128",
      (v) => debug_TypeKind(v, PLAIN),
    );
    assert_eq(self.cx().type_kind(int_ty), TypeKind.Integer, (v) => debug_TypeKind(v, PLAIN));

    if (signed) {
      return self.fptosi_sat(x, dest_ty);
    } else {
      return self.fptoui_sat(x, dest_ty);
    }
  },

  /// Returns `-1` if `lhs < rhs`, `0` if `lhs == rhs`, and `1` if `lhs > rhs`.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:429 three_way_compare
  three_way_compare<B extends BackendTypes>(self: BuilderMethods<B>, ty: Ty, lhs: B["Value"], rhs: B["Value"]): B["Value"] {
    // FIXME: This implementation was designed around LLVM's ability to optimize, but `cg_llvm`
    // overrides this to just use `@llvm.scmp`/`ucmp` since LLVM 20. This default impl should be
    // reevaluated with respect to the remaining backends like cg_gcc, whether they might use
    // specialized implementations as well, or continue to use a generic implementation here.
    // use std::cmp::Ordering;
    const pred = (op: BinOp): IntPredicate => bin_op_to_icmp_predicate(op, ty.is_signed());
    if (self.cx().sess().opts.optimize === "No") {
      // This actually generates tighter assembly, and is a classic trick:
      // <https://graphics.stanford.edu/~seander/bithacks.html#CopyIntegerSign>.
      // However, as of 2023-11 it optimized worse in LLVM in things like derived
      // `PartialOrd`, so we were only using it in debug. Since LLVM now uses its own
      // intrinsics, it may be be worth trying it in optimized builds for other backends.
      const is_gt = self.icmp(pred("Gt"), lhs, rhs);
      const gtext = self.zext(is_gt, self.type_i8());
      const is_lt = self.icmp(pred("Lt"), lhs, rhs);
      const ltext = self.zext(is_lt, self.type_i8());
      return self.unchecked_ssub(gtext, ltext);
    } else {
      // These operations were better optimized by LLVM, before `@llvm.scmp`/`ucmp` in 20.
      // See <https://github.com/rust-lang/rust/pull/63767>.
      const is_lt = self.icmp(pred("Lt"), lhs, rhs);
      const is_ne = self.icmp(pred("Ne"), lhs, rhs);
      const ge = self.select(
        is_ne,
        self.cx().const_i8(/* Ordering::Greater as i8 */ 1),
        self.cx().const_i8(/* Ordering::Equal as i8 */ 0),
      );
      return self.select(is_lt, self.cx().const_i8(/* Ordering::Less as i8 */ -1), ge);
    }
  },

  /// *Typed* copy for non-overlapping places.
  ///
  /// Has a default implementation in terms of `memcpy`, but specific backends
  /// can override to do something smarter if possible.
  ///
  /// (For example, typed load-stores with alias metadata.)
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:505 typed_place_copy
  typed_place_copy<B extends BackendTypes>(
    self: BuilderMethods<B>,
    dst: PlaceValue<B["Value"]>,
    src: PlaceValue<B["Value"]>,
    layout: TyAndLayout,
  ): void {
    self.typed_place_copy_with_flags(dst, src, layout, MemFlags.empty());
  },

  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:514 typed_place_copy_with_flags
  typed_place_copy_with_flags<B extends BackendTypes>(
    self: BuilderMethods<B>,
    dst: PlaceValue<B["Value"]>,
    src: PlaceValue<B["Value"]>,
    layout: TyAndLayout,
    flags: MemFlags,
  ): void {
    assert(layout.is_sized(), "cannot typed-copy an unsigned type");
    assert(src.llextra === undefined, "cannot directly copy from unsized values");
    assert(dst.llextra === undefined, "cannot directly copy into unsized values");
    if (MemFlags.contains(flags, MemFlags.NONTEMPORAL)) {
      // HACK(nox): This is inefficient but there is no nontemporal memcpy.
      const ty = self.backend_type(layout);
      const val = self.load_from_place(ty, src);
      self.store_to_place_with_flags(val, dst, flags);
    } else if (self.sess().opts.optimize === "No" && BackendRepr.is_scalar_or_simd(layout.backend_repr)) {
      // If we're not optimizing, the aliasing information from `memcpy`
      // isn't useful, so just load-store the value for smaller code.
      const temp = self.load_operand(src.with_type(layout));
      OperandValue.store_with_flags(temp.val, self, dst.with_type(layout), flags);
    } else if (!layout.is_zst()) {
      let tt = typetree_from_ty(self.tcx_(), layout.ty);
      // We seem to pass all values to memcpy with one more indirection.
      tt = tt.add_indirection();
      const fnc_tree: FncTree = { args: [clone_TypeTree(tt), tt], ret: TypeTree.new() };
      let bytes = self.const_usize(layout.size.bytes_u64());
      // FIXME(rustc_scalable_vector/stdarch_aarch64_sve): Scalable vectors aren't
      // actually sized, but we pretend they are. Here we have to hack around that.
      if (layout.peel_transparent_wrappers_from_non_1zst(self).ty.is_scalable_vector()) {
        const vscale = self.vscale(self.type_i64());
        bytes = self.mul(vscale, bytes);
      } else {
        // bytes
      }
      self.memcpy(dst.llval, dst.align, src.llval, src.align, bytes, flags, fnc_tree);
    }
  },

  /// *Typed* swap for non-overlapping places.
  ///
  /// Avoids `alloca`s for Immediates and ScalarPairs.
  ///
  /// FIXME: Maybe do something smarter for Ref types too?
  /// For now, the `typed_swap_nonoverlapping` intrinsic just doesn't call this for those
  /// cases (in non-debug), preferring the fallback body instead.
  // rustc: compiler/rustc_codegen_ssa/src/traits/builder.rs:562 typed_place_swap
  typed_place_swap<B extends BackendTypes>(
    self: BuilderMethods<B>,
    left: PlaceValue<B["Value"]>,
    right: PlaceValue<B["Value"]>,
    layout: TyAndLayout,
  ): void {
    let temp = self.load_operand(left.with_type(layout));
    if (temp.val.$ === "Ref") {
      // The SSA value isn't stand-alone, so we need to copy it elsewhere
      const alloca = PlaceRef.alloca(self, layout);
      self.typed_place_copy(alloca.val, left, layout);
      temp = self.load_operand(alloca);
    }
    self.typed_place_copy(left, right, layout);
    OperandValue.store(temp.val, self, right.with_type(layout));
  },
};
