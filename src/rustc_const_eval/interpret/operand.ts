//! Functions concerning immediate values and operands, and reading from operands.
//! All high-level functions to read from memory work on operands as sources.
// Port of compiler/rustc_const_eval/src/interpret/operand.rs (declared by lane interp-contract, filled by lane
// interp-place-operand, plan-m4 wave 23c). Representation notes: interpret/eval_context.ts's header and
// docs/handoff/interp-contract.md.
import { BackendRepr, type HasDataLayout, Primitive, Scalar as abi_Scalar, Size, debug_BackendRepr, debug_Size } from "../../rustc_abi/lib.ts";
import { Namespace } from "../../rustc_hir/def.ts";
import { InterpCx, from_known_layout } from "./eval_context.ts";
import { type Machine } from "./machine.ts";
import { ImmTy, OpTy, type Operand, debug_Immediate, debug_Operand } from "./operand.gen.ts";
import { MemPlaceMeta } from "./place.ts";
import { OffsetMode, type Projectable } from "./projection.ts";
import {
  type AllocId,
  type InterpResult,
  Scalar,
  alloc_range,
  debug_AllocId,
  debug_Scalar,
  interp_ok,
  InterpErrorInfo_from_ErrorHandled,
  InterpErrorInfo_from_InterpErrorKind,
  lower_hex_Scalar,
  Pointer,
  CtfeProvenance,
  CtfeProvenance_from_AllocId,
  Pointer_Option_from_Pointer,
  Scalar_from_ScalarInt,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { fold_Const } from "../../rustc_middle/mir/consts.ts";
import { type ConstValue, type Either, type Local, type Operand as mir_Operand, type Place as mir_Place } from "../../rustc_middle/mir/mod.ts";
import { ConstInt, ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { with_ } from "../../rustc_middle/ty/context/tls.ts";
import { type HasTyCtxt, type HasTypingEnv, type TyAndLayout, debug_LayoutError, debug_TyAndLayout_Ty } from "../../rustc_middle/ty/layout.ts";
import { Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { FmtPrinter, display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { type PrintResult } from "../../rustc_middle/ty/print/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { type Fmt, PLAIN, PRETTY, debug_struct } from "../../std/fmt.ts";
import { type MutRef } from "../../std/mut_ref.ts";
import { Panic, assert, assert_eq, assert_matches, panic, unwrap } from "../../std/panic.ts";
import { Err, unwrap_result } from "../../std/result.ts";
import { from_utf8 } from "../../std/str.ts";
import { MPlaceTy, PlaceTy, debug_MemPlaceMeta } from "./place.gen.ts";
import { Frame } from "./stack.gen.ts";
import * as gen from "./operand.gen.ts";
/** PORT: `std::cmp::Ordering` as its `i8` discriminant (`Less` = -1, `Equal` = 0, `Greater` = 1). */
type Ordering = -1 | 0 | 1;

export * from "./operand.gen.ts";

/**
 * PORT: `assert_eq!(left, right, "{msg}")` (core's `assert_failed_inner`, `AssertKind::Eq` with args). Not an upstream
 * fn; place.ts uses it too.
 */
export function assert_eq_msg<T>(left: T, right: T, debug: (v: T) => string, eq: (a: T, b: T) => boolean, msg: () => string): void {
  if (!eq(left, right)) {
    throw new Panic(`assertion \`left == right\` failed: ${msg()}\n  left: ${debug(left)}\n right: ${debug(right)}`);
  }
}
/** PORT: `Size`'s derived `PartialEq` (decision: `Size` `==` compares `.bytes()`). */
export const size_eq = (a: Size, b: Size): boolean => a.bytes() === b.bytes();
const debug_size = (v: Size): string => debug_Size(v, PLAIN);
const debug_u64 = (v: number): string => String(v);

declare module "./operand.gen.ts" {
  interface ImmTy {
    // operand.rs:252 (lane interp-place-operand)
    deref(): Immediate;
    // operand.rs:342 (lane interp-place-operand)
    to_scalar_int(): InterpResult<ScalarInt>;
    // operand.rs:349 (lane interp-place-operand)
    to_const_int(): ConstInt;
    // operand.rs:358 (lane interp-place-operand)
    to_pair(cx: HasTyCtxt & HasTypingEnv): [ImmTy, ImmTy];
    // operand.rs:370 (lane interp-place-operand)
    offset_(offset: Size, layout: TyAndLayout, cx: HasDataLayout): ImmTy;
    // operand.rs:445 (lane interp-place-operand)
    layout_(): TyAndLayout;
    // operand.rs:450 (lane interp-place-operand)
    meta(): MemPlaceMeta;
    // operand.rs:455 (lane interp-place-operand)
    offset_with_meta(offset: Size, _mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<ImmTy>;
    // operand.rs:468 (lane interp-place-operand)
    to_op(_ecx: InterpCx): InterpResult<OpTy>;
  }
}

declare module "./operand.gen.ts" {
  namespace ImmTy {
    // operand.rs:259 (lane interp-place-operand)
    function from_scalar(val: Scalar, layout: TyAndLayout): ImmTy;
    // operand.rs:266 (lane interp-place-operand)
    function from_scalar_pair(a: Scalar, b: Scalar, layout: TyAndLayout): ImmTy;
    // operand.rs:276 (lane interp-place-operand)
    function from_immediate(imm: Immediate, layout: TyAndLayout): ImmTy;
    // operand.rs:291 (lane interp-place-operand)
    function uninit(layout: TyAndLayout): ImmTy;
    // operand.rs:297 (lane interp-place-operand)
    function from_scalar_int(s: ScalarInt, layout: TyAndLayout): ImmTy;
    // operand.rs:302 (lane interp-place-operand)
    function from_uint(i: bigint, layout: TyAndLayout): ImmTy;
    // operand.rs:307 (lane interp-place-operand)
    function from_int(i: bigint, layout: TyAndLayout): ImmTy;
    // operand.rs:312 (lane interp-place-operand)
    function from_bool(b: boolean, tcx: TyCtxt): ImmTy;
    // operand.rs:321 (lane interp-place-operand)
    function from_ordering(c: Ordering, tcx: TyCtxt): ImmTy;
    // operand.rs:329 (lane interp-place-operand)
    function from_pair(a: ImmTy, b: ImmTy, cx: HasTyCtxt & HasTypingEnv): ImmTy;
  }
}

declare module "./operand.gen.ts" {
  interface OpTy {
    // operand.rs:517 (lane interp-place-operand)
    op_(): Operand;
    // operand.rs:521 (lane interp-place-operand)
    is_immediate_uninit(): boolean;
    // operand.rs:528 (lane interp-place-operand)
    layout_(): TyAndLayout;
    // operand.rs:533 (lane interp-place-operand)
    meta(): MemPlaceMeta;
    // operand.rs:543 (lane interp-place-operand)
    offset_with_meta(offset: Size, mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<OpTy>;
    // operand.rs:564 (lane interp-place-operand)
    to_op(_ecx: InterpCx): InterpResult<OpTy>;
  }
}

declare module "./eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // operand.rs:577 (lane interp-place-operand)
    read_immediate_from_mplace_raw(mplace: MPlaceTy): InterpResult<ImmTy | undefined>;
    // operand.rs:642 (lane interp-place-operand)
    read_immediate_raw(src: Projectable): InterpResult<Either<MPlaceTy, ImmTy>>;
    // operand.rs:662 (lane interp-place-operand)
    read_immediate(op: Projectable): InterpResult<ImmTy>;
    // operand.rs:685 (lane interp-place-operand)
    read_scalar(op: Projectable): InterpResult<Scalar>;
    // operand.rs:696 (lane interp-place-operand)
    read_pointer(op: Projectable): InterpResult<Pointer<CtfeProvenance | undefined>>;
    // operand.rs:703 (lane interp-place-operand)
    read_target_usize(op: Projectable): InterpResult<bigint>;
    // operand.rs:710 (lane interp-place-operand)
    read_target_isize(op: Projectable): InterpResult<bigint>;
    // operand.rs:718 (lane interp-place-operand)
    read_str(mplace: MPlaceTy): InterpResult<string>;
    // operand.rs:727 (lane interp-place-operand)
    local_to_op(local: Local, layout: TyAndLayout | undefined): InterpResult<OpTy>;
    // operand.rs:750 (lane interp-place-operand)
    ghost_local_in_frame_to_op(frame: Frame, local: Local): InterpResult<OpTy>;
    // operand.rs:763 (lane interp-place-operand)
    place_to_op(place: PlaceTy): InterpResult<OpTy>;
    // operand.rs:787 (lane interp-place-operand)
    eval_place_to_op(mir_place: mir_Place, layout: TyAndLayout | undefined): InterpResult<OpTy>;
    // operand.rs:837 (lane interp-place-operand)
    eval_operand(mir_op: mir_Operand, layout: TyAndLayout | undefined): InterpResult<OpTy>;
    // operand.rs:871 (lane interp-place-operand)
    const_val_to_op(val_val: ConstValue, ty: Ty, layout: TyAndLayout | undefined): InterpResult<OpTy>;
  }
}

export interface Immediate_methods {
  // operand.rs:51 (lane interp-place-operand)
  new_pointer_with_meta(ptr: Pointer<CtfeProvenance | undefined>, meta: MemPlaceMeta, cx: HasDataLayout): Immediate;
  // operand.rs:63 (lane interp-place-operand)
  new_slice(ptr: Pointer<CtfeProvenance | undefined>, len: bigint, cx: HasDataLayout): Immediate;
  // operand.rs:70 (lane interp-place-operand)
  new_dyn_trait(val: Pointer<CtfeProvenance | undefined>, vtable: Pointer<CtfeProvenance | undefined>, cx: HasDataLayout): Immediate;
  // operand.rs:83 (lane interp-place-operand)
  to_scalar(self: Immediate): Scalar;
  // operand.rs:93 (lane interp-place-operand)
  to_scalar_int(self: Immediate): ScalarInt;
  // operand.rs:99 (lane interp-place-operand)
  to_scalar_pair(self: Immediate): [Scalar, Scalar];
  // operand.rs:110 (lane interp-place-operand)
  to_scalar_and_meta(self: Immediate): [Scalar, MemPlaceMeta];
  // operand.rs:119 (lane interp-place-operand)
  assert_matches_abi(self: Immediate, abi: BackendRepr, msg: string, cx: HasDataLayout): void;
  // operand.rs:167 (lane interp-place-operand)
  clear_provenance(self: MutRef<Immediate>): InterpResult;
  // operand.rs:181 (lane interp-place-operand)
  has_provenance(self: Immediate): boolean;
}
export type Immediate = gen.Immediate;
export const Immediate = gen.Immediate as typeof gen.Immediate & Immediate_methods;

// impl From<Scalar<Prov>> for Immediate
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:45 from
export function Immediate_from_Scalar(val: Scalar): Immediate {
  return { $: "Scalar", _0: val };
}

// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:51 new_pointer_with_meta
Immediate.new_pointer_with_meta = function (ptr: Pointer<CtfeProvenance | undefined>, meta: MemPlaceMeta, cx: HasDataLayout): Immediate {
  const ptr_ = Scalar.from_maybe_pointer(ptr, cx);
  switch (meta.$) {
    case "None":
      return Immediate_from_Scalar(ptr_);
    case "Meta":
      return { $: "ScalarPair", _0: ptr_, _1: meta._0 };
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:63 new_slice
Immediate.new_slice = function (ptr: Pointer<CtfeProvenance | undefined>, len: bigint, cx: HasDataLayout): Immediate {
  return { $: "ScalarPair", _0: Scalar.from_maybe_pointer(ptr, cx), _1: Scalar.from_target_usize(len, cx) };
};

// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:70 new_dyn_trait
Immediate.new_dyn_trait = function (val: Pointer<CtfeProvenance | undefined>, vtable: Pointer<CtfeProvenance | undefined>, cx: HasDataLayout): Immediate {
  return { $: "ScalarPair", _0: Scalar.from_maybe_pointer(val, cx), _1: Scalar.from_maybe_pointer(vtable, cx) };
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:83 to_scalar
Immediate.to_scalar = function (self: Immediate): Scalar {
  switch (self.$) {
    case "Scalar":
      return self._0;
    case "ScalarPair":
      return bug("Got a scalar pair where a scalar was expected");
    case "Uninit":
      return bug("Got uninit where a scalar was expected");
  }
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:93 to_scalar_int
Immediate.to_scalar_int = function (self: Immediate): ScalarInt {
  return unwrap_result(Scalar.try_to_scalar_int(Immediate.to_scalar(self)), (v: Scalar<AllocId>, f: Fmt) => debug_Scalar(v, f, debug_AllocId));
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:99 to_scalar_pair
Immediate.to_scalar_pair = function (self: Immediate): [Scalar, Scalar] {
  switch (self.$) {
    case "ScalarPair":
      return [self._0, self._1];
    case "Scalar":
      return bug("Got a scalar where a scalar pair was expected");
    case "Uninit":
      return bug("Got uninit where a scalar pair was expected");
  }
};

/// Returns the scalar from the first component and optionally the 2nd component as metadata.
// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:110 to_scalar_and_meta
Immediate.to_scalar_and_meta = function (self: Immediate): [Scalar, MemPlaceMeta] {
  switch (self.$) {
    case "ScalarPair":
      return [self._0, { $: "Meta", _0: self._1 }];
    case "Scalar":
      return [self._0, MemPlaceMeta.None];
    case "Uninit":
      return bug("Got uninit where a scalar or scalar pair was expected");
  }
};

/// Assert that this immediate is a valid value for the given ABI.
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:119 assert_matches_abi
Immediate.assert_matches_abi = function (self: Immediate, abi: BackendRepr, msg: string, cx: HasDataLayout): void {
  if (self.$ === "Scalar" && abi.$ === "Scalar") {
    const scalar = self._0;
    const s = abi._0;
    assert_eq_msg(Scalar.size(scalar), abi_Scalar.size(s, cx), debug_size, size_eq, () => `${msg}: scalar value has wrong size`);
    if (!(abi_Scalar.primitive(s).$ === "Pointer")) {
      // This is not a pointer, it should not carry provenance.
      assert(scalar.$ === "Int", `${msg}: scalar value should be an integer, but has provenance`);
    }
  } else if (self.$ === "ScalarPair" && abi.$ === "ScalarPair") {
    const a_val = self._0;
    const b_val = self._1;
    const { a, b } = abi;
    assert_eq_msg(Scalar.size(a_val), abi_Scalar.size(a, cx), debug_size, size_eq, () => `${msg}: first component of scalar pair has wrong size`);
    if (!(abi_Scalar.primitive(a).$ === "Pointer")) {
      assert(a_val.$ === "Int", `${msg}: first component of scalar pair should be an integer, but has provenance`);
    }
    assert_eq_msg(Scalar.size(b_val), abi_Scalar.size(b, cx), debug_size, size_eq, () => `${msg}: second component of scalar pair has wrong size`);
    if (!(abi_Scalar.primitive(b).$ === "Pointer")) {
      assert(b_val.$ === "Int", `${msg}: second component of scalar pair should be an integer, but has provenance`);
    }
  } else if (self.$ === "Uninit") {
    assert(BackendRepr.is_sized(abi), `${msg}: unsized immediates are not a thing`);
  } else {
    bug(`${msg}: value ${debug_Immediate(self, PLAIN)} does not match ABI ${debug_BackendRepr(abi, PLAIN)})`);
  }
};

// PORT: `&mut self` is a `MutRef<Immediate>` (the immediate values are shared, never mutated in place).
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:167 clear_provenance
Immediate.clear_provenance = function (self: MutRef<Immediate>): InterpResult {
  const imm = self.value;
  switch (imm.$) {
    case "Scalar": {
      const s = { value: imm._0 };
      const r = Scalar.clear_provenance(s);
      self.value = { $: "Scalar", _0: s.value };
      if (r.$ === "Err") return r;
      break;
    }
    case "ScalarPair": {
      const a = { value: imm._0 };
      const b = { value: imm._1 };
      let r = Scalar.clear_provenance(a);
      self.value = { $: "ScalarPair", _0: a.value, _1: b.value };
      if (r.$ === "Err") return r;
      r = Scalar.clear_provenance(b);
      self.value = { $: "ScalarPair", _0: a.value, _1: b.value };
      if (r.$ === "Err") return r;
      break;
    }
    case "Uninit":
      break;
  }
  return interp_ok(undefined);
};

// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:181 has_provenance
Immediate.has_provenance = function (self: Immediate): boolean {
  switch (self.$) {
    case "Scalar":
      return self._0.$ === "Ptr";
    case "ScalarPair":
      return self._0.$ === "Ptr" || self._1.$ === "Ptr";
    case "Uninit":
      return false;
  }
};

// impl Display for ImmTy
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:201 fmt
export function display_ImmTy(self: ImmTy, f: Fmt): string {
  /// Helper function for printing a scalar to a FmtPrinter
  // rustc: compiler/rustc_const_eval/src/interpret/operand.rs:203 print_scalar
  function print_scalar(p: FmtPrinter, s: Scalar, ty: Ty): PrintResult {
    switch (s.$) {
      case "Int":
        return p.pretty_print_const_scalar_int(s._0, ty, true);
      case "Ptr":
        // Just print the ptr value. `pretty_print_const_scalar_ptr` would also try to
        // print what is points to, which would fail since it has no access to the local
        // memory.
        return p.pretty_print_const_pointer(s._0, ty);
    }
  }
  return with_((tcx) => {
    const imm = self.imm;
    switch (imm.$) {
      case "Scalar": {
        const s = imm._0;
        const ty = /* tcx.lift( */ self.layout.ty /* ) */;
        const r = FmtPrinter.print_string(tcx, Namespace.ValueNS, (p) => print_scalar(p, s, ty));
        // PORT: the `?` turns the print error into `fmt::Error`, which `format!` reports as this panic.
        if (r.$ === "Err") return panic("a Display implementation returned an error unexpectedly: Error");
        return r._0;
      }
      case "ScalarPair":
        // FIXME(oli-obk): at least print tuples and slices nicely
        return `(${lower_hex_Scalar(imm._0, PLAIN)}, ${lower_hex_Scalar(imm._1, PLAIN)}): ${display_Ty(self.layout.ty)}`;
      case "Uninit":
        return `uninit: ${display_Ty(self.layout.ty)}`;
    }
  });
}

// impl Debug for ImmTy
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:240 fmt
export function debug_ImmTy(self: ImmTy, f: Fmt): string {
  // Printing `layout` results in too much noise; just print a nice version of the type.
  return debug_struct(f, "ImmTy", [
    ["imm", debug_Immediate(self.imm, f)],
    ["ty", display_Ty(self.layout.ty)],
  ]);
}

// impl Deref for ImmTy
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:252 deref
ImmTy.prototype.deref = function (this: ImmTy): Immediate {
  return this.imm;
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:259 from_scalar
(ImmTy as { from_scalar: typeof ImmTy.from_scalar }).from_scalar = function (val: Scalar, layout: TyAndLayout): ImmTy {
  // debug_assert!(layout.backend_repr.is_scalar(), "`ImmTy::from_scalar` on non-scalar layout");
  // debug_assert_eq!(val.size(), layout.size);
  return new ImmTy(Immediate_from_Scalar(val), layout);
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:266 from_scalar_pair
(ImmTy as { from_scalar_pair: typeof ImmTy.from_scalar_pair }).from_scalar_pair = function (a: Scalar, b: Scalar, layout: TyAndLayout): ImmTy {
  // debug_assert!(
  //     matches!(layout.backend_repr, BackendRepr::ScalarPair { .. }),
  //     "`ImmTy::from_scalar_pair` on non-scalar-pair layout"
  // );
  const imm: Immediate = { $: "ScalarPair", _0: a, _1: b };
  return new ImmTy(imm, layout);
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:276 from_immediate
(ImmTy as { from_immediate: typeof ImmTy.from_immediate }).from_immediate = function (imm: Immediate, layout: TyAndLayout): ImmTy {
  // Without a `cx` we cannot call `assert_matches_abi`.
  // debug_assert!(
  //     match (imm, layout.backend_repr) {
  //         (Immediate::Scalar(..), BackendRepr::Scalar(..)) => true,
  //         (Immediate::ScalarPair { .. }, BackendRepr::ScalarPair { .. }) => true,
  //         (Immediate::Uninit, _) if layout.is_sized() => true,
  //         _ => false,
  //     },
  //     "immediate {imm:?} does not fit to layout {layout:?}",
  // );
  return new ImmTy(imm, layout);
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:291 uninit
(ImmTy as { uninit: typeof ImmTy.uninit }).uninit = function (layout: TyAndLayout): ImmTy {
  // debug_assert!(layout.is_sized(), "immediates must be sized");
  return new ImmTy(Immediate.Uninit, layout);
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:297 from_scalar_int
(ImmTy as { from_scalar_int: typeof ImmTy.from_scalar_int }).from_scalar_int = function (s: ScalarInt, layout: TyAndLayout): ImmTy {
  return ImmTy.from_scalar(Scalar_from_ScalarInt(s), layout);
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:302 from_uint
(ImmTy as { from_uint: typeof ImmTy.from_uint }).from_uint = function (i: bigint, layout: TyAndLayout): ImmTy {
  return ImmTy.from_scalar(Scalar.from_uint(i, layout.size), layout);
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:307 from_int
(ImmTy as { from_int: typeof ImmTy.from_int }).from_int = function (i: bigint, layout: TyAndLayout): ImmTy {
  return ImmTy.from_scalar(Scalar.from_int(i, layout.size), layout);
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:312 from_bool
(ImmTy as { from_bool: typeof ImmTy.from_bool }).from_bool = function (b: boolean, tcx: TyCtxt): ImmTy {
  // Can use any typing env, since `bool` is always monomorphic.
  const layout = unwrap_result(tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(tcx.types.bool)), debug_LayoutError);
  return ImmTy.from_scalar(Scalar.from_bool(b), layout);
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:321 from_ordering
(ImmTy as { from_ordering: typeof ImmTy.from_ordering }).from_ordering = function (c: Ordering, tcx: TyCtxt): ImmTy {
  // Can use any typing env, since `Ordering` is always monomorphic.
  const ty = tcx.ty_ordering_enum(DUMMY_SP);
  const layout = unwrap_result(tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(ty)), debug_LayoutError);
  return ImmTy.from_scalar({ $: "Int", _0: ScalarInt.from_Ordering(c) }, layout);
};

// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:329 from_pair
(ImmTy as { from_pair: typeof ImmTy.from_pair }).from_pair = function (a: ImmTy, b: ImmTy, cx: HasTyCtxt & HasTypingEnv): ImmTy {
  const layout = unwrap_result(
    cx.tcx_().layout_of(cx.typing_env_().as_query_input(Ty.new_tup(cx.tcx_(), [a.layout.ty, b.layout.ty]))),
    debug_LayoutError,
  );
  return ImmTy.from_scalar_pair(Immediate.to_scalar(a.imm), Immediate.to_scalar(b.imm), layout);
};

/// Return the immediate as a `ScalarInt`. Ensures that it has the size that the layout of the
/// immediate indicates.
// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:342 to_scalar_int
ImmTy.prototype.to_scalar_int = function (this: ImmTy): InterpResult<ScalarInt> {
  const r = Scalar.to_scalar_int(Immediate.to_scalar(this.imm));
  if (r.$ === "Err") return r;
  const s = r._0;
  assert_eq_msg(s.size(), this.layout.size, debug_size, size_eq, () => "scalar immediate size does not match layout");
  return interp_ok(s);
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:349 to_const_int
ImmTy.prototype.to_const_int = function (this: ImmTy): ConstInt {
  assert(this.layout.ty.is_integral(), "assertion failed: self.layout.ty.is_integral()");
  const int = Immediate.to_scalar_int(this.imm);
  assert_eq(int.size(), this.layout.size, debug_size, size_eq);
  return ConstInt.new(int, this.layout.ty.is_signed(), this.layout.ty.is_ptr_sized_integral());
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:358 to_pair
ImmTy.prototype.to_pair = function (this: ImmTy, cx: HasTyCtxt & HasTypingEnv): [ImmTy, ImmTy] {
  const layout = this.layout;
  const [val0, val1] = Immediate.to_scalar_pair(this.imm);
  return [ImmTy.from_scalar(val0, layout.field(cx, 0)), ImmTy.from_scalar(val1, layout.field(cx, 1))];
};

/// Compute the "sub-immediate" that is located within the `base` at the given offset with the
/// given layout.
// Not called `offset` to avoid confusion with the trait method.
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:370 offset_
ImmTy.prototype.offset_ = function (this: ImmTy, offset: Size, layout: TyAndLayout, cx: HasDataLayout): ImmTy {
  // Verify that the input matches its type.
  // PORT: `if cfg!(debug_assertions) { self.assert_matches_abi(..) }` is skipped (rustc ships without debug assertions).
  // `ImmTy` have already been checked to be in-bounds, so we can just check directly if this
  // remains in-bounds. This cannot actually be violated since projections are type-checked
  // and bounds-checked.
  if (!(offset.add(layout.size).bytes() <= this.layout.size.bytes())) {
    panic(
      `attempting to project to field at offset ${offset.bytes()} with size ${layout.size.bytes()} into immediate with layout ${debug_TyAndLayout_Ty(this.layout, PRETTY)}`,
    );
  }
  // This makes several assumptions about what layouts we will encounter; we match what
  // codegen does as good as we can (see `extract_field` in `rustc_codegen_ssa/src/mir/operand.rs`).
  const self_imm = this.imm;
  const self_repr = this.layout.backend_repr;
  let inner_val: Immediate;
  if (self_imm.$ === "Uninit") {
    // If the entire value is uninit, then so is the field (can happen in ConstProp).
    inner_val = Immediate.Uninit;
  } else if (layout.is_uninhabited()) {
    // If the field is uninhabited, we can forget the data (can happen in ConstProp).
    // `enum S { A(!), B, C }` is an example of an enum with Scalar layout that
    // has an uninhabited variant, which means this case is possible.
    inner_val = Immediate.Uninit;
  } else if (layout.is_zst()) {
    // the field contains no information, can be left uninit
    // (Scalar/ScalarPair can contain even aligned ZST, not just 1-ZST)
    inner_val = Immediate.Uninit;
  } else if (
    // some fieldless enum variants can have non-zero size but still `Aggregate` ABI... try
    // to detect those here and also give them no data
    layout.backend_repr.$ === "Memory" &&
    layout.variants.$ === "Single" &&
    layout.fields.$ === "Arbitrary" &&
    layout.fields.offsets.length === 0
  ) {
    inner_val = Immediate.Uninit;
  } else if (size_eq(layout.size, this.layout.size)) {
    // the field covers the entire type
    assert_eq(offset.bytes(), 0, debug_u64);
    inner_val = self_imm;
  } else if (self_imm.$ === "ScalarPair" && self_repr.$ === "ScalarPair") {
    // extract fields from types with `ScalarPair` ABI
    const b_offset = self_repr.b_offset;
    let v: Scalar;
    if (offset.bytes() === 0) {
      v = self_imm._0;
    } else {
      assert_eq(offset, b_offset, debug_size, size_eq);
      v = self_imm._1;
    }
    inner_val = Immediate_from_Scalar(v);
  } else {
    // everything else is a bug
    inner_val = bug(
      `invalid field access on immediate ${display_ImmTy(this, PLAIN)} at offset ${offset.bytes()}, original layout ${debug_TyAndLayout_Ty(this.layout, PRETTY)}`,
    );
  }
  // Ensure the new layout matches the new value.
  Immediate.assert_matches_abi(inner_val, layout.backend_repr, "invalid field type in Immediate::offset", cx);

  return ImmTy.from_immediate(inner_val, layout);
};

// impl Projectable for ImmTy
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:445 layout
ImmTy.prototype.layout_ = function (this: ImmTy): TyAndLayout {
  return this.layout;
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:450 meta
ImmTy.prototype.meta = function (this: ImmTy): MemPlaceMeta {
  // debug_assert!(self.layout.is_sized()); // unsized ImmTy can only exist temporarily and should never reach this here
  return MemPlaceMeta.None;
};

// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:455 offset_with_meta
ImmTy.prototype.offset_with_meta = function (this: ImmTy, offset: Size, _mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<ImmTy> {
  assert_matches_none(meta); // we can't store this anywhere anyway
  return interp_ok(this.offset_(offset, layout, ecx));
};

/** PORT: `assert_matches!(meta, MemPlaceMeta::None)` (place.ts uses it too). Not an upstream fn. */
export function assert_matches_none(meta: MemPlaceMeta): void {
  assert_matches(meta, meta.$ === "None", "MemPlaceMeta::None", (v) => debug_MemPlaceMeta(v, PLAIN));
}

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:468 to_op
ImmTy.prototype.to_op = function (this: ImmTy, _ecx: InterpCx): InterpResult<OpTy> {
  return interp_ok(OpTy_from_ImmTy(this));
};

// impl Debug for OpTy
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:492 fmt
export function debug_OpTy(self: OpTy, f: Fmt): string {
  // Printing `layout` results in too much noise; just print a nice version of the type.
  return debug_struct(f, "OpTy", [
    ["op", debug_Operand(self.op, f)],
    ["ty", display_Ty(self.layout.ty)],
  ]);
}

// impl From<ImmTy<'tcx, Prov>> for OpTy
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:503 from
export function OpTy_from_ImmTy(val: ImmTy): OpTy {
  return new OpTy({ $: "Immediate", _0: val.imm }, val.layout);
}

// impl From<MPlaceTy<'tcx, Prov>> for OpTy
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:510 from
export function OpTy_from_MPlaceTy(mplace: MPlaceTy): OpTy {
  return new OpTy({ $: "Indirect", _0: mplace.mplace_() }, mplace.layout);
}

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:517 op
OpTy.prototype.op_ = function (this: OpTy): Operand {
  return this.op;
};

// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:521 is_immediate_uninit
OpTy.prototype.is_immediate_uninit = function (this: OpTy): boolean {
  return this.op.$ === "Immediate" && this.op._0.$ === "Uninit";
};

// impl Projectable for OpTy
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:528 layout
OpTy.prototype.layout_ = function (this: OpTy): TyAndLayout {
  return this.layout;
};

// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:533 meta
OpTy.prototype.meta = function (this: OpTy): MemPlaceMeta {
  const e = this.as_mplace_or_imm();
  switch (e.$) {
    case "Left":
      return e._0.meta();
    case "Right":
      // debug_assert!(self.layout.is_sized(), "unsized immediates are not a thing");
      return MemPlaceMeta.None;
  }
};

// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:543 offset_with_meta
OpTy.prototype.offset_with_meta = function (this: OpTy, offset: Size, mode: OffsetMode, meta: MemPlaceMeta, layout: TyAndLayout, ecx: InterpCx): InterpResult<OpTy> {
  const e = this.as_mplace_or_imm();
  switch (e.$) {
    case "Left": {
      const mplace = e._0;
      const r = mplace.offset_with_meta(offset, mode, meta, layout, ecx);
      if (r.$ === "Err") return r;
      return interp_ok(OpTy_from_MPlaceTy(r._0));
    }
    case "Right": {
      const imm = e._0;
      assert_matches_none(meta); // no place to store metadata here
      // Every part of an uninit is uninit.
      return interp_ok(OpTy_from_ImmTy(imm.offset_(offset, layout, ecx)));
    }
  }
};

// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:564 to_op
OpTy.prototype.to_op = function (this: OpTy, _ecx: InterpCx): InterpResult<OpTy> {
  // PORT: `self.clone()`: `OpTy` values are never mutated in place (eval_context.ts header), so the value is shared.
  return interp_ok(this);
};

/// Try reading an immediate in memory; this is interesting particularly for `ScalarPair`.
/// Returns `None` if the layout does not permit loading this as a value.
///
/// This is an internal function; call `read_immediate` instead.
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:577 read_immediate_from_mplace_raw
InterpCx.prototype.read_immediate_from_mplace_raw = function (this: InterpCx, mplace: MPlaceTy): InterpResult<ImmTy | undefined> {
  if (mplace.layout.is_unsized()) {
    // Don't touch unsized
    return interp_ok(undefined);
  }

  const ar = this.get_place_alloc(mplace);
  if (ar.$ === "Err") return ar;
  const alloc = ar._0;
  if (alloc === undefined) {
    // zero-sized type can be left uninit
    return interp_ok<ImmTy | undefined>(ImmTy.uninit(mplace.layout));
  }

  // It may seem like all types with `Scalar` or `ScalarPair` ABI are fair game at this point.
  // However, `MaybeUninit<u64>` is considered a `Scalar` as far as its layout is concerned --
  // and yet cannot be represented by an interpreter `Scalar`, since we have to handle the
  // case where some of the bytes are initialized and others are not. So, we need an extra
  // check that walks over the type of `mplace` to make sure it is truly correct to treat this
  // like a `Scalar` (or `ScalarPair`).
  const repr = mplace.layout.backend_repr;
  if (repr.$ === "Scalar" && repr._0.$ === "Initialized") {
    const s = repr._0.value;
    const size = Primitive.size(s, this);
    assert_eq_msg(size, mplace.layout.size, debug_size, size_eq, () => "abi::Scalar size does not match layout size");
    const scalar = alloc.read_scalar(alloc_range(Size.ZERO, size), /*read_provenance*/ s.$ === "Pointer");
    if (scalar.$ === "Err") return scalar;
    return interp_ok<ImmTy | undefined>(ImmTy.from_scalar(scalar._0, mplace.layout));
  } else if (repr.$ === "ScalarPair" && repr.a.$ === "Initialized" && repr.b.$ === "Initialized") {
    const a = repr.a.value;
    const b = repr.b.value;
    const b_offset = repr.b_offset;
    // We checked `ptr_align` above, so all fields will have the alignment they need.
    // We would anyway check against `ptr_align.restrict_for_offset(b_offset)`,
    // which `ptr.offset(b_offset)` cannot possibly fail to satisfy.
    const [a_size, b_size] = [Primitive.size(a, this), Primitive.size(b, this)];
    assert(b_offset.bytes() > 0, "assertion failed: b_offset.bytes() > 0"); // in `operand_field` we use the offset to tell apart the fields
    const a_val = alloc.read_scalar(alloc_range(Size.ZERO, a_size), /*read_provenance*/ a.$ === "Pointer");
    if (a_val.$ === "Err") return a_val;
    const b_val = alloc.read_scalar(alloc_range(b_offset, b_size), /*read_provenance*/ b.$ === "Pointer");
    if (b_val.$ === "Err") return b_val;
    return interp_ok<ImmTy | undefined>(ImmTy.from_immediate({ $: "ScalarPair", _0: a_val._0, _1: b_val._0 }, mplace.layout));
  } else {
    // Neither a scalar nor scalar pair.
    return interp_ok<ImmTy | undefined>(undefined);
  }
};

/// Try returning an immediate for the operand. If the layout does not permit loading this as an
/// immediate, return where in memory we can find the data.
/// Note that for a given layout, this operation will either always return Left or Right!
/// Whether it returns Left depends on whether the layout can be represented
/// in an `Immediate`, not on which data is stored there currently.
///
/// This is an internal function that should not usually be used; call `read_immediate` instead.
/// ConstProp needs it, though.
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:642 read_immediate_raw
InterpCx.prototype.read_immediate_raw = function (this: InterpCx, src: Projectable): InterpResult<Either<MPlaceTy, ImmTy>> {
  const op = src.to_op(this);
  if (op.$ === "Err") return op;
  const e = op._0.as_mplace_or_imm();
  switch (e.$) {
    case "Left": {
      const mplace = e._0;
      const r = this.read_immediate_from_mplace_raw(mplace);
      if (r.$ === "Err") return r;
      const val = r._0;
      if (val !== undefined) {
        return interp_ok<Either<MPlaceTy, ImmTy>>({ $: "Right", _0: val });
      } else {
        return interp_ok<Either<MPlaceTy, ImmTy>>({ $: "Left", _0: mplace });
      }
    }
    case "Right":
      return interp_ok<Either<MPlaceTy, ImmTy>>({ $: "Right", _0: e._0 });
  }
};

/// Read an immediate from a place, asserting that that is possible with the given layout.
///
/// If this succeeds, the `ImmTy` is never `Uninit`.
// #[inline(always)]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:662 read_immediate
InterpCx.prototype.read_immediate = function (this: InterpCx, op: Projectable): InterpResult<ImmTy> {
  const repr = op.layout_().backend_repr;
  if (!((repr.$ === "Scalar" && repr._0.$ === "Initialized") || (repr.$ === "ScalarPair" && repr.a.$ === "Initialized" && repr.b.$ === "Initialized"))) {
    span_bug(this.cur_span(), `primitive read not possible for type: ${display_Ty(op.layout_().ty)}`);
  }
  const r = this.read_immediate_raw(op);
  if (r.$ === "Err") return r;
  const imm = unwrap(r._0.$ === "Right" ? r._0._0 : undefined);
  if (imm.deref().$ === "Uninit") {
    // throw_ub!(InvalidUninitBytes(None))
    return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "InvalidUninitBytes", _0: undefined } }));
  }
  return interp_ok(imm);
};

/// Read a scalar from a place
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:685 read_scalar
InterpCx.prototype.read_scalar = function (this: InterpCx, op: Projectable): InterpResult<Scalar> {
  const r = this.read_immediate(op);
  if (r.$ === "Err") return r;
  return interp_ok(Immediate.to_scalar(r._0.deref()));
};

// Pointer-sized reads are fairly common and need target layout access, so we wrap them in
// convenience functions.

/// Read a pointer from a place.
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:696 read_pointer
InterpCx.prototype.read_pointer = function (this: InterpCx, op: Projectable): InterpResult<Pointer<CtfeProvenance | undefined>> {
  const r = this.read_scalar(op);
  if (r.$ === "Err") return r;
  return interp_ok(Scalar.to_pointer(r._0, this));
};

/// Read a pointer-sized unsigned integer from a place.
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:703 read_target_usize
InterpCx.prototype.read_target_usize = function (this: InterpCx, op: Projectable): InterpResult<bigint> {
  const r = this.read_scalar(op);
  if (r.$ === "Err") return r;
  return Scalar.to_target_usize(r._0, this);
};

/// Read a pointer-sized signed integer from a place.
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:710 read_target_isize
InterpCx.prototype.read_target_isize = function (this: InterpCx, op: Projectable): InterpResult<bigint> {
  const r = this.read_scalar(op);
  if (r.$ === "Err") return r;
  return Scalar.to_target_isize(r._0, this);
};

/// Turn the wide MPlace into a string (must already be dereferenced!)
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:718 read_str
InterpCx.prototype.read_str = function (this: InterpCx, mplace: MPlaceTy): InterpResult<string> {
  const len = mplace.len(this);
  if (len.$ === "Err") return len;
  const bytes = this.read_bytes_ptr_strip_provenance(mplace.ptr(), Size.from_bytes(len._0));
  if (bytes.$ === "Err") return bytes;
  const s = from_utf8(bytes._0);
  if (s.$ === "Err") {
    // err_ub!(InvalidStr(err))
    return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "InvalidStr", _0: s._0 } }));
  }
  return interp_ok(s._0);
};

/// Read from a local of a current frame.
/// Will not access memory, instead an indirect `Operand` is returned.
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:727 local_to_op
InterpCx.prototype.local_to_op = function (this: InterpCx, local: Local, layout: TyAndLayout | undefined): InterpResult<OpTy> {
  const frame = this.frame();
  const lr = this.layout_of_local(frame, local, layout);
  if (lr.$ === "Err") return lr;
  const layout_ = lr._0;
  const or = frame.locals[local]!.access();
  if (or.$ === "Err") return or;
  const op = or._0;
  if (op.$ === "Immediate") {
    assert(!layout_.is_unsized(), "assertion failed: !layout.is_unsized()");
    if (!this.validation_in_progress()) {
      const r = this.machine.after_local_read(this, local);
      if (r.$ === "Err") return r;
    }
  }
  return interp_ok(new OpTy(op, layout_));
};

/// Tools like Priroda and [Aquascope](https://github.com/cognitive-engineering-lab/aquascope/)
/// need to access any local without triggering any access hook, since these are not actual
/// AM-level accesses. Do not call this from inside the interpreter!
///
/// Remember to use `ghost_run` when accessing memory for such purposes, to suppress
/// the access hooks for that as well.
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:750 ghost_local_in_frame_to_op
InterpCx.prototype.ghost_local_in_frame_to_op = function (this: InterpCx, frame: Frame, local: Local): InterpResult<OpTy> {
  const lr = this.layout_of_local(frame, local, undefined);
  if (lr.$ === "Err") return lr;
  const layout = lr._0;
  const or = frame.locals[local]!.access();
  if (or.$ === "Err") return or;
  return interp_ok(new OpTy(or._0, layout));
};

/// Every place can be read from, so we can turn them into an operand.
/// This will definitely return `Indirect` if the place is a `Ptr`, i.e., this
/// will never actually read from memory.
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:763 place_to_op
InterpCx.prototype.place_to_op = function (this: InterpCx, place: PlaceTy): InterpResult<OpTy> {
  const e = place.as_mplace_or_local();
  switch (e.$) {
    case "Left":
      return interp_ok(OpTy_from_MPlaceTy(e._0));
    case "Right": {
      const [local, offset, _locals_addr] = e._0;
      // debug_assert!(place.layout.is_sized()); // only sized locals can ever be `Place::Local`.
      // debug_assert_eq!(locals_addr, self.frame().locals_addr());
      const br = this.local_to_op(local, undefined);
      if (br.$ === "Err") return br;
      const base = br._0;
      if (offset !== undefined) {
        return base.offset(offset, place.layout, this);
      } else {
        // In the common case this hasn't been projected.
        // debug_assert_eq!(place.layout, base.layout);
        return interp_ok(base);
      }
    }
  }
};

/// Evaluate a place with the goal of reading from it. This lets us sometimes
/// avoid allocations.
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:787 eval_place_to_op
InterpCx.prototype.eval_place_to_op = function (this: InterpCx, mir_place: mir_Place, layout: TyAndLayout | undefined): InterpResult<OpTy> {
  // let _trace = enter_trace_span!(M, step::eval_place_to_op, ?mir_place, tracing_separate_thread = Empty);

  // Do not use the layout passed in as argument if the base we are looking at
  // here is not the entire place.
  const layout_ = mir_place.projection.length === 0 ? layout : undefined;

  const r = this.local_to_op(mir_place.local, layout_);
  if (r.$ === "Err") return r;
  let op = r._0;
  // Using `try_fold` turned out to be bad for performance, hence the loop.
  for (const elem of mir_place.projection) {
    const p = this.project(op, elem);
    if (p.$ === "Err") return p;
    op = p._0;
  }

  // trace!("eval_place_to_op: got {:?}", op);
  // Sanity-check the type we ended up with.
  // PORT: the `if cfg!(debug_assertions) { .. mir_assign_valid_types .. }` check is skipped (rustc ships without
  // debug assertions).
  return interp_ok(op);
};

/// Evaluate the operand, returning a place where you can then find the data.
/// If you already know the layout, you can save two table lookups
/// by passing it in here.
// #[inline]
// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:837 eval_operand
InterpCx.prototype.eval_operand = function (this: InterpCx, mir_op: mir_Operand, layout: TyAndLayout | undefined): InterpResult<OpTy> {
  // let _trace = enter_trace_span!(M, step::eval_operand, ?mir_op, tracing_separate_thread = Empty);

  let op: OpTy;
  switch (mir_op.$) {
    // FIXME: do some more logic on `move` to invalidate the old location
    case "Copy":
    case "Move": {
      const r = this.eval_place_to_op(mir_op._0, layout);
      if (r.$ === "Err") return r;
      op = r._0;
      break;
    }

    case "RuntimeChecks": {
      const r = this.machine.runtime_checks(this, mir_op._0);
      if (r.$ === "Err") return r;
      const val = r._0;
      op = OpTy_from_ImmTy(ImmTy.from_bool(val, this.tcx_()));
      break;
    }

    case "Constant": {
      const constant = mir_op._0;
      const cr = this.instantiate_from_current_frame_and_normalize_erasing_regions(constant.const_, fold_Const);
      if (cr.$ === "Err") return Err(InterpErrorInfo_from_ErrorHandled(cr._0));
      const c = cr._0;

      // This can still fail:
      // * During ConstProp, with `TooGeneric` or since the `required_consts` were not all
      //   checked yet.
      // * During CTFE, since promoteds in `const`/`static` initializer bodies can fail.
      const r = this.eval_mir_constant(c, constant.span, layout);
      if (r.$ === "Err") return r;
      op = r._0;
      break;
    }
  }
  // trace!("{:?}: {:?}", mir_op, op);
  return interp_ok(op);
};

// rustc: compiler/rustc_const_eval/src/interpret/operand.rs:871 const_val_to_op
InterpCx.prototype.const_val_to_op = function (this: InterpCx, val_val: ConstValue, ty: Ty, layout: TyAndLayout | undefined): InterpResult<OpTy> {
  // Other cases need layout.
  const adjust_scalar = (scalar: Scalar): InterpResult<Scalar> => {
    switch (scalar.$) {
      case "Ptr": {
        const r = this.global_root_pointer(scalar._0);
        if (r.$ === "Err") return r;
        return interp_ok<Scalar>({ $: "Ptr", _0: r._0, _1: scalar._1 });
      }
      case "Int":
        return interp_ok<Scalar>({ $: "Int", _0: scalar._0 });
    }
  };
  const layout_r = from_known_layout(this.tcx, this.typing_env_(), layout, () => {
    const r = this.layout_of(ty);
    return r.$ === "Err" ? Err(InterpErrorInfo_from_InterpErrorKind(r._0)) : r;
  });
  if (layout_r.$ === "Err") return layout_r;
  const layout_ = layout_r._0;
  let imm: Immediate;
  switch (val_val.$) {
    case "Indirect": {
      const { alloc_id, offset } = val_val;
      // This is const data, no mutation allowed.
      const ptr_r = this.global_root_pointer(Pointer.new(CtfeProvenance.as_immutable(CtfeProvenance_from_AllocId(alloc_id)), offset));
      if (ptr_r.$ === "Err") return ptr_r;
      return interp_ok(OpTy_from_MPlaceTy(this.ptr_to_mplace(Pointer_Option_from_Pointer(ptr_r._0), layout_)));
    }
    case "Scalar": {
      const r = adjust_scalar(val_val._0);
      if (r.$ === "Err") return r;
      imm = Immediate_from_Scalar(r._0);
      break;
    }
    case "ZeroSized":
      imm = Immediate.Uninit;
      break;
    case "Slice": {
      const { alloc_id, meta } = val_val;
      // This is const data, no mutation allowed.
      const ptr = Pointer.new(CtfeProvenance.as_immutable(CtfeProvenance_from_AllocId(alloc_id)), Size.ZERO);
      const r = this.global_root_pointer(ptr);
      if (r.$ === "Err") return r;
      imm = Immediate.new_slice(Pointer_Option_from_Pointer(r._0), BigInt(meta), this);
      break;
    }
  }
  return interp_ok(new OpTy({ $: "Immediate", _0: imm }, layout_));
};
