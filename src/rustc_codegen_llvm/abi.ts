// Port of compiler/rustc_codegen_llvm/src/abi.rs (skeleton: lane cg-contract; bodies: lane cg-abi-consts, plan-m7 §8 wave 41).
//
// `impl ArgAbiBuilderMethods for Builder` and `impl AbiBuilderMethods for Builder` are attached with PORTING §5's extension
// pattern (lib.ts imports this file after the class's own module).
// Load order: rustc_target through its crate root first (as src/rust_ts/codegen_backend.ts does): entered from callconv/mod.ts,
// spec/json.ts reads spec/mod.ts's bindings before they exist.
//
// PORT (cg-contract): the crate-internal extension traits on foreign classes (`trait ArgAttributesExt` for `ArgAttributes`,
// `trait LlvmType` for `Reg` / `CastTarget`, `trait ArgAbiExt` for `ArgAbi`, `trait FnAbiLlvmExt` for `FnAbi`) are `declare
// module` augmentations of those classes plus prototype assignments (the miri decision C2 form): `fn_abi.llvm_type(cx)` reads as
// upstream. Each trait is a TS interface whose members carry the declarations' markers; the class's augmentation extends it
// (type_of.ts's `LayoutLlvmExt`).
//
// PORT (cg-abi-consts):
// - `cx.llcx` (an `SCx` field reached through the derefs) is the accessor `llcx()` (type_.rs:152); `bx.cx` (the field) is
//   `bx.cx_` (builder.ts header). A `&CodegenCx` parameter given a `&Builder` (`llvm_type(bx)`) is passed `bx.cx_`, and a
//   `&SimpleCx` parameter given a `&CodegenCx` (`llfn_attrs_from_instance(cx, ..)`) is passed `cx.scx` (deref coercion,
//   cg-contract).
// - `SmallVec` / `Vec` are arrays; `&{ func_attrs }` is the array.
// - `llvm_version >= (23, 0, 0)` on tuples is `version_ge` (lexicographic, the derived `PartialOrd`).
// - `ArgAttribute` bitflags: `regular -= NonNull` (bitflags `Sub`) is `ArgAttribute.difference`.
import "../rustc_target/lib.ts";
import { type Align, type Integer, Integer as IntegerC, Primitive, Reg, type Scalar, Scalar as ScalarC, Size, WrappingRange, debug_Reg, debug_Size } from "../rustc_abi/lib.ts";
import { RegKind, RegKind_eq, debug_RegKind } from "../rustc_abi/callconv/reg.ts";
import type { CanonAbi } from "../rustc_abi/canon_abi.ts";
import { MemFlags } from "../rustc_codegen_ssa/lib.ts";
import { OperandRef, OperandValue } from "../rustc_codegen_ssa/mir/operand.ts";
import { type PlaceRef, PlaceValue } from "../rustc_codegen_ssa/mir/place.ts";
import type { AbiBuilderMethods } from "../rustc_codegen_ssa/traits/abi.ts";
import type { ArgAbiBuilderMethods } from "../rustc_codegen_ssa/traits/type_.ts";
import { TyCtxt_codegen_instance_attrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import { Ty } from "../rustc_middle/ty/mod.ts";
import type { Session } from "../rustc_session/session.ts";
import { bug } from "../rustc_span/macros.ts";
import { ArgAbi, ArgAttribute, ArgAttributes, CastTarget, FnAbi } from "../rustc_target/callconv/mod.ts";
import { Arch, SanitizerSet } from "../rustc_target/spec/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, panic, unported, unwrap } from "../std/panic.ts";
import * as attributes from "./attributes.ts";
import { Builder } from "./builder.ts";
import type { CodegenCx } from "./context.ts";
import * as llvm from "./llvm/mod.ts";
import { type Attribute, AttributeKind, AttributeKind_impl, AttributePlace, type CallConv, type Type, type Value } from "./llvm/mod.ts";
import * as llvm_util from "./llvm_util.ts";
import { store_cast } from "../rustc_codegen_ssa/mir/mod.ts";

/** `(u32, u32, u32) >= (u32, u32, u32)` (derived `PartialOrd`, lexicographic). */
function version_ge(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return true;
}

// ---- trait ArgAttributesExt (abi.rs:29) ----
export interface ArgAttributesExt {
  // rustc: compiler/rustc_codegen_llvm/src/abi.rs:30 apply_attrs_to_llfn
  apply_attrs_to_llfn(idx: AttributePlace, cx: CodegenCx, llfn: Value): void;
  // rustc: compiler/rustc_codegen_llvm/src/abi.rs:31 apply_attrs_to_callsite
  apply_attrs_to_callsite(idx: AttributePlace, cx: CodegenCx, callsite: Value): void;
}
declare module "../rustc_target/callconv/mod.ts" {
  interface ArgAttributes extends ArgAttributesExt {}
}

const ABI_AFFECTING_ATTRIBUTES: readonly (readonly [ArgAttribute, AttributeKind])[] = [[ArgAttribute.InReg, AttributeKind.InReg]];

const OPTIMIZATION_ATTRIBUTES: readonly (readonly [ArgAttribute, AttributeKind])[] = [
  [ArgAttribute.NoAlias, AttributeKind.NoAlias],
  [ArgAttribute.NonNull, AttributeKind.NonNull],
  [ArgAttribute.ReadOnly, AttributeKind.ReadOnly],
  [ArgAttribute.NoUndef, AttributeKind.NoUndef],
  [ArgAttribute.Writable, AttributeKind.Writable],
  // Our internal NoFree attribute still allows deallocation of zero-size allocations. However,
  // these don't render any bytes non-dereferenceable, so it's still fine to apply LLVM NoFree
  // for them.
  [ArgAttribute.NoFree, AttributeKind.NoFree],
];

const CAPTURES_ATTRIBUTES: readonly (readonly [ArgAttribute, AttributeKind])[] = [
  [ArgAttribute.CapturesNone, AttributeKind.CapturesNone],
  [ArgAttribute.CapturesAddress, AttributeKind.CapturesAddress],
  [ArgAttribute.CapturesReadOnly, AttributeKind.CapturesReadOnly],
];

// rustc: compiler/rustc_codegen_llvm/src/abi.rs:60 get_attrs
function get_attrs(this_: ArgAttributes, cx: CodegenCx): Attribute[] {
  let regular = this_.regular;

  const attrs: Attribute[] = [];

  // ABI-affecting attributes must always be applied
  for (const [attr, llattr] of ABI_AFFECTING_ATTRIBUTES) {
    if (ArgAttribute.contains(regular, attr)) {
      attrs.push(AttributeKind_impl.create_attr(llattr, cx.llcx()));
    }
  }
  const align = this_.pointee_align;
  if (align !== undefined) {
    attrs.push(llvm.CreateAlignmentAttr(cx.llcx(), BigInt(align.bytes())));
  }
  switch (this_.arg_ext) {
    case "None":
      break;
    case "Zext":
      attrs.push(AttributeKind_impl.create_attr(AttributeKind.ZExt, cx.llcx()));
      break;
    case "Sext":
      attrs.push(AttributeKind_impl.create_attr(AttributeKind.SExt, cx.llcx()));
      break;
  }

  // Only apply remaining attributes when optimizing
  if (cx.sess().opts.optimize !== "No") {
    const deref = this_.pointee_size.bytes_u64();
    // Prior to <https://github.com/llvm/llvm-project/pull/204795> dereferenceable in LLVM
    // implied nofree, so only emit dereferenceable on older versions of LLVM if nofree
    // is also set.
    const llvm_version = llvm_util.get_version();
    if (deref !== 0n && (version_ge(llvm_version, [23, 0, 0]) || ArgAttribute.contains(regular, ArgAttribute.NoFree))) {
      if (ArgAttribute.contains(regular, ArgAttribute.NonNull)) {
        attrs.push(llvm.CreateDereferenceableAttr(cx.llcx(), deref));
      } else {
        attrs.push(llvm.CreateDereferenceableOrNullAttr(cx.llcx(), deref));
      }
      regular = ArgAttribute.difference(regular, ArgAttribute.NonNull);
    }
    for (const [attr, llattr] of OPTIMIZATION_ATTRIBUTES) {
      if (ArgAttribute.contains(regular, attr)) {
        attrs.push(AttributeKind_impl.create_attr(llattr, cx.llcx()));
      }
    }
    for (const [attr, llattr] of CAPTURES_ATTRIBUTES) {
      if (ArgAttribute.contains(regular, attr)) {
        attrs.push(AttributeKind_impl.create_attr(llattr, cx.llcx()));
        break;
      }
    }
  } else if (SanitizerSet.contains(cx.tcx.sess.sanitizers(), SanitizerSet.MEMORY)) {
    // If we're not optimising, *but* memory sanitizer is on, emit noundef, since it affects
    // memory sanitizer's behavior.

    if (ArgAttribute.contains(regular, ArgAttribute.NoUndef)) {
      attrs.push(AttributeKind_impl.create_attr(AttributeKind.NoUndef, cx.llcx()));
    }
  }

  return attrs;
}

// ---- impl ArgAttributesExt for ArgAttributes (abi.rs:118) ----
// rustc: compiler/rustc_codegen_llvm/src/abi.rs:119 apply_attrs_to_llfn
ArgAttributes.prototype.apply_attrs_to_llfn = function (this: ArgAttributes, idx: AttributePlace, cx: CodegenCx, llfn: Value): void {
  const attrs = get_attrs(this, cx);
  attributes.apply_to_llfn(llfn, idx, attrs);
};

// rustc: compiler/rustc_codegen_llvm/src/abi.rs:124 apply_attrs_to_callsite
ArgAttributes.prototype.apply_attrs_to_callsite = function (this: ArgAttributes, idx: AttributePlace, cx: CodegenCx, callsite: Value): void {
  const attrs = get_attrs(this, cx);
  attributes.apply_to_callsite(callsite, idx, attrs);
};

// ---- pub(crate) trait LlvmType (abi.rs:135) ----
export interface LlvmType {
  // rustc: compiler/rustc_codegen_llvm/src/abi.rs:136 llvm_type
  llvm_type(cx: CodegenCx): Type;
}
declare module "../rustc_abi/callconv/reg.ts" {
  interface Reg extends LlvmType {}
}
declare module "../rustc_target/callconv/mod.ts" {
  interface CastTarget extends LlvmType {}
}

// ---- impl LlvmType for Reg (abi.rs:139) ----
// rustc: compiler/rustc_codegen_llvm/src/abi.rs:140 llvm_type
Reg.prototype.llvm_type = function (this: Reg, cx: CodegenCx): Type {
  switch (this.kind.$) {
    case "Integer":
      return cx.type_ix(this.size.bits());
    case "Float":
      switch (this.size.bits()) {
        case 16:
          return cx.type_f16();
        case 32:
          return cx.type_f32();
        case 64:
          return cx.type_f64();
        case 128:
          return cx.type_f128();
        default:
          return bug(`unsupported float: ${debug_Reg(this, PLAIN)}`);
      }
    case "PpcF128":
      return cx.type_ppcf128();
    case "Vector": {
      const hint_vector_elem = this.kind.hint_vector_elem;
      // NOTE: it is valid to ignore the element type hint (and always pick i8).
      // But providing a more accurate type means fewer casts in LLVM IR,
      // which helps with optimization.
      let ty: Type;
      switch (hint_vector_elem.$) {
        case "Int": {
          const integer: Integer = hint_vector_elem._0;
          switch (integer) {
            case "I8":
              ty = cx.type_ix(8);
              break;
            case "I16":
              ty = cx.type_ix(16);
              break;
            case "I32":
              ty = cx.type_ix(32);
              break;
            case "I64":
              ty = cx.type_ix(64);
              break;
            case "I128":
              ty = cx.type_ix(128);
              break;
          }
          break;
        }
        case "Float": {
          const float = hint_vector_elem._0;
          switch (float) {
            case "F16":
              ty = cx.type_f16();
              break;
            case "F16B":
              ty = cx.type_f16b();
              break;
            case "F32":
              ty = cx.type_f32();
              break;
            case "F64":
              ty = cx.type_f64();
              break;
            case "F128":
              ty = cx.type_f128();
              break;
            case "PpcF128":
              return bug("ppcf128 is not a valid vector element type");
          }
          break;
        }
        case "Pointer":
          ty = cx.type_ptr();
          break;
      }

      assert(this.size.bytes() % Primitive.size(hint_vector_elem, cx).bytes() === 0, "assertion failed: self.size.bytes().is_multiple_of(hint_vector_elem.size(cx).bytes())");
      // `u64` division of two sizes that divide exactly (asserted above).
      const len = this.size.bytes() / Primitive.size(hint_vector_elem, cx).bytes();
      return cx.type_vector(ty, len);
    }
  }
};

// ---- impl LlvmType for CastTarget (abi.rs:182) ----
// rustc: compiler/rustc_codegen_llvm/src/abi.rs:183 llvm_type
CastTarget.prototype.llvm_type = function (this: CastTarget, cx: CodegenCx): Type {
  const rest_ll_unit = this.rest.unit.llvm_type(cx);
  let rest_count: bigint;
  if (this.rest.total.bytes() === Size.ZERO.bytes()) {
    rest_count = 0n;
  } else {
    if (this.rest.unit.size.bytes() === Size.ZERO.bytes()) {
      // assert_ne!(self.rest.unit.size, Size::ZERO, "total size {:?} cannot be divided into units of zero size", self.rest.total);
      panic(
        `assertion \`left != right\` failed: total size ${debug_Size(this.rest.total, PLAIN)} cannot be divided into units of zero size\n  left: ${debug_Size(this.rest.unit.size, PLAIN)}\n right: ${debug_Size(Size.ZERO, PLAIN)}`,
      );
    }
    if (!(this.rest.total.bytes_u64() % this.rest.unit.size.bytes_u64() === 0n)) {
      if (!RegKind_eq(this.rest.unit.kind, RegKind.Integer)) {
        // assert_eq!(self.rest.unit.kind, RegKind::Integer, "only int regs can be split");
        panic(`assertion \`left == right\` failed: only int regs can be split\n  left: ${debug_RegKind(this.rest.unit.kind, PLAIN)}\n right: ${debug_RegKind(RegKind.Integer, PLAIN)}`);
      }
    }
    // `u64::div_ceil`
    const total = this.rest.total.bytes_u64();
    const unit = this.rest.unit.size.bytes_u64();
    rest_count = (total + unit - 1n) / unit;
  }

  // Simplify to an array if there is no prefix.
  if (this.prefix.length === 0) {
    // Pass `[1 x unit]` as just `unit`.
    //
    // On little-endian targets this produces a compatible layout, but using a simpler type.
    // But on big-endian targets (e.g. aarch64_be or powerpc64) the value may be passed in
    // different halves of the register-sized slot, so unit and [1 x unit] are incompatible.
    //
    // Setting `is_consecutive` forces use of an array.
    if (rest_count === 1n && !this.rest.is_consecutive) {
      return rest_ll_unit;
    }

    return cx.type_array(rest_ll_unit, rest_count);
  }

  // Generate a struct type with the prefix and the "rest" arguments.
  const prefix_args = this.prefix.map((reg) => reg.llvm_type(cx));
  const rest_args: Type[] = [];
  for (let i = 0n; i < rest_count; i++) rest_args.push(rest_ll_unit);
  const args: Type[] = [...prefix_args, ...rest_args];
  return cx.type_struct(args, false);
};

// ---- trait ArgAbiExt<'ll, 'tcx> (abi.rs:224) ----
export interface ArgAbiExt {
  // rustc: compiler/rustc_codegen_llvm/src/abi.rs:225 store
  store(bx: Builder, val: Value, dst: PlaceRef<Value>): void;
  // rustc: compiler/rustc_codegen_llvm/src/abi.rs:231 store_fn_arg
  store_fn_arg(bx: Builder, idx: MutRef<number>, dst: PlaceRef<Value>): void;
}
declare module "../rustc_target/callconv/mod.ts" {
  interface ArgAbi<Ty> extends ArgAbiExt {}
}

// ---- impl<'ll, 'tcx> ArgAbiExt<'ll, 'tcx> for ArgAbi<'tcx, Ty<'tcx>> (abi.rs:239) ----
/// Stores a direct/indirect value described by this ArgAbi into a
/// place for the original Rust type of this argument/return.
/// Can be used for both storing formal arguments into Rust variables
/// or results of call/invoke instructions into their destinations.
// rustc: compiler/rustc_codegen_llvm/src/abi.rs:244 store
ArgAbi.prototype.store = function (this: ArgAbi<Ty>, bx: Builder, val: Value, dst: PlaceRef<Value>): void {
  const mode = this.mode;
  switch (mode.$) {
    case "Ignore":
      break;
    // Sized indirect arguments
    case "Indirect": {
      const attrs = mode.attrs;
      const align = attrs.pointee_align ?? this.layout.align.abi;
      OperandValue.store({ $: "Ref", _0: PlaceValue.new_sized(val, align) }, bx, dst);
      break;
    }
    // Unsized indirect arguments cannot be stored
    case "IndirectUnsized":
      return bug("unsized `ArgAbi` cannot be stored");
    case "Cast": {
      const cast = mode.cast;
      // The ABI mandates that the value is passed as a different struct representation.
      // Spill and reload it from the stack to convert from the ABI representation to
      // the Rust representation.
      const scratch_size = cast.size(bx);
      const scratch_align = cast.align(bx);
      // Note that the ABI type may be either larger or smaller than the Rust type,
      // due to the presence or absence of trailing padding. For example:
      // - On some ABIs, the Rust layout { f64, f32, <f32 padding> } may omit padding
      //   when passed by value, making it smaller.
      // - On some ABIs, the Rust layout { u16, u16, u16 } may be padded up to 8 bytes
      //   when passed by value, making it larger.
      const a = cast.unaligned_size(bx).bytes_u64();
      const b = this.layout.size.bytes_u64();
      const copy_bytes = a < b ? a : b;
      // Allocate some scratch space...
      const llscratch = bx.alloca(scratch_size, scratch_align);
      bx.lifetime_start(llscratch, scratch_size);
      // ...store the value...
      store_cast(bx, cast, val, llscratch, scratch_align);
      // ... and then memcpy it to the intended destination.
      bx.memcpy(dst.val.llval, this.layout.align.abi, llscratch, scratch_align, bx.const_usize(copy_bytes), MemFlags.empty(), undefined);
      bx.lifetime_end(llscratch, scratch_size);
      break;
    }
    case "Pair":
    case "Direct":
      OperandValue.store(OperandRef.from_immediate_or_packed_pair(bx, val, this.layout).val, bx, dst);
      break;
  }
};

// rustc: compiler/rustc_codegen_llvm/src/abi.rs:298 store_fn_arg
ArgAbi.prototype.store_fn_arg = function (this: ArgAbi<Ty>, bx: Builder, idx: MutRef<number>, dst: PlaceRef<Value>): void {
  const next = (): Value => {
    const val = llvm.get_param(bx.llfn(), idx.value >>> 0);
    idx.value += 1;
    return val;
  };
  switch (this.mode.$) {
    case "Ignore":
      break;
    case "Pair": {
      // `OperandValue::Pair(next(), next())`: the fields are evaluated left to right.
      const a = next();
      const b = next();
      OperandValue.store({ $: "Pair", _0: a, _1: b }, bx, dst);
      break;
    }
    case "IndirectUnsized":
      return bug("unsized `ArgAbi` cannot be stored");
    case "Direct":
    case "Indirect":
    case "Cast": {
      const next_arg = next();
      this.store(bx, next_arg, dst);
      break;
    }
  }
};

// ---- impl<'ll, 'tcx> ArgAbiBuilderMethods<'tcx> for Builder<'_, 'll, 'tcx> (abi.rs:327) ----
declare module "./builder.ts" {
  interface Builder {
    store_fn_arg(arg_abi: ArgAbi<Ty>, idx: MutRef<number>, dst: PlaceRef<Value>): void;
    store_arg(arg_abi: ArgAbi<Ty>, val: Value, dst: PlaceRef<Value>): void;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/abi.rs:328 store_fn_arg
Builder.prototype.store_fn_arg = function (this: Builder, arg_abi: ArgAbi<Ty>, idx: MutRef<number>, dst: PlaceRef<Value>): void {
  arg_abi.store_fn_arg(this, idx, dst);
};

// rustc: compiler/rustc_codegen_llvm/src/abi.rs:336 store_arg
Builder.prototype.store_arg = function (this: Builder, arg_abi: ArgAbi<Ty>, val: Value, dst: PlaceRef<Value>): void {
  arg_abi.store(this, val, dst);
};

// ---- pub(crate) trait FnAbiLlvmExt<'ll, 'tcx> (abi.rs:346) ----
export interface FnAbiLlvmExt {
  // rustc: compiler/rustc_codegen_llvm/src/abi.rs:347 llvm_type
  llvm_type(cx: CodegenCx): Type;
  // rustc: compiler/rustc_codegen_llvm/src/abi.rs:348 ptr_to_llvm_type
  ptr_to_llvm_type(cx: CodegenCx): Type;
  // rustc: compiler/rustc_codegen_llvm/src/abi.rs:349 llvm_cconv
  llvm_cconv(cx: CodegenCx): CallConv;

  /// Apply attributes to a function declaration/definition.
  // rustc: compiler/rustc_codegen_llvm/src/abi.rs:352 apply_attrs_llfn
  apply_attrs_llfn(cx: CodegenCx, llfn: Value, instance: Instance | undefined): void;

  /// Apply attributes to a function call.
  // rustc: compiler/rustc_codegen_llvm/src/abi.rs:360 apply_attrs_callsite
  apply_attrs_callsite(bx: Builder, callsite: Value): void;
}
declare module "../rustc_target/callconv/mod.ts" {
  interface FnAbi<Ty> extends FnAbiLlvmExt {}
}

// ---- impl<'ll, 'tcx> FnAbiLlvmExt<'ll, 'tcx> for FnAbi<'tcx, Ty<'tcx>> (abi.rs:363) ----
// rustc: compiler/rustc_codegen_llvm/src/abi.rs:364 llvm_type
FnAbi.prototype.llvm_type = function (this: FnAbi<Ty>, cx: CodegenCx): Type {
  // Ignore "extra" args from the call site for C variadic functions.
  // Only the "fixed" args are part of the LLVM function signature.
  const args = this.c_variadic ? this.args.slice(0, this.fixed_count) : this.args;

  // This capacity calculation is approximate.
  const llargument_tys: Type[] = [];

  let llreturn_ty: Type;
  const ret_mode = this.ret.mode;
  switch (ret_mode.$) {
    case "Ignore":
      llreturn_ty = cx.type_void();
      break;
    case "Direct":
    case "Pair":
      llreturn_ty = this.ret.layout.immediate_llvm_type(cx);
      break;
    case "Cast":
      llreturn_ty = ret_mode.cast.llvm_type(cx);
      break;
    case "Indirect": {
      const address_space = ret_mode.address_space;
      const ty = address_space !== undefined ? cx.type_ptr_ext(address_space) : cx.type_ptr();
      llargument_tys.push(ty);
      llreturn_ty = cx.type_void();
      break;
    }
    case "IndirectUnsized":
      return bug("unsized returns are not supported");
  }

  for (const arg of args) {
    // Note that the exact number of arguments pushed here is carefully synchronized with
    // code all over the place, both in the codegen_llvm and codegen_ssa crates. That's how
    // other code then knows which LLVM argument(s) correspond to the n-th Rust argument.
    let llarg_ty: Type;
    const mode = arg.mode;
    switch (mode.$) {
      case "Ignore":
        continue;
      case "Direct":
        // ABI-compatible Rust types have the same `layout.abi` (up to validity ranges),
        // and for Scalar ABIs the LLVM type is fully determined by `layout.abi`,
        // guaranteeing that we generate ABI-compatible LLVM IR.
        llarg_ty = arg.layout.immediate_llvm_type(cx);
        break;
      case "Pair":
        // ABI-compatible Rust types have the same `layout.abi` (up to validity ranges),
        // so for ScalarPair we can easily be sure that we are generating ABI-compatible
        // LLVM IR.
        llargument_tys.push(arg.layout.scalar_pair_element_llvm_type(cx, 0, true));
        llargument_tys.push(arg.layout.scalar_pair_element_llvm_type(cx, 1, true));
        continue;
      case "IndirectUnsized": {
        // Construct the type of a (wide) pointer to `ty`, and pass its two fields.
        // Any two ABI-compatible unsized types have the same metadata type and
        // moreover the same metadata value leads to the same dynamic size and
        // alignment, so this respects ABI compatibility.
        const ptr_ty = Ty.new_mut_ptr(cx.tcx, arg.layout.ty);
        const ptr_layout = cx.layout_of(ptr_ty);
        llargument_tys.push(ptr_layout.scalar_pair_element_llvm_type(cx, 0, true));
        llargument_tys.push(ptr_layout.scalar_pair_element_llvm_type(cx, 1, true));
        continue;
      }
      case "Indirect": {
        const address_space = mode.address_space;
        llarg_ty = address_space !== undefined ? cx.type_ptr_ext(address_space) : cx.type_ptr();
        break;
      }
      case "Cast": {
        // Add padding.
        const pad = Reg.i32().llvm_type(cx);
        for (let k = 0; k < mode.pad_i32_count; k++) llargument_tys.push(pad);

        // Compute the LLVM type we use for this function from the cast type.
        // We assume here that ABI-compatible Rust types have the same cast type.
        llarg_ty = mode.cast.llvm_type(cx);
        break;
      }
    }
    llargument_tys.push(llarg_ty);
  }

  if (this.c_variadic) {
    return cx.type_variadic_func(llargument_tys, llreturn_ty);
  } else {
    return cx.type_func(llargument_tys, llreturn_ty);
  }
};

// rustc: compiler/rustc_codegen_llvm/src/abi.rs:451 ptr_to_llvm_type
FnAbi.prototype.ptr_to_llvm_type = function (this: FnAbi<Ty>, cx: CodegenCx): Type {
  return cx.type_ptr_ext(cx.data_layout().instruction_address_space);
};

// rustc: compiler/rustc_codegen_llvm/src/abi.rs:455 llvm_cconv
FnAbi.prototype.llvm_cconv = function (this: FnAbi<Ty>, cx: CodegenCx): CallConv {
  return to_llvm_calling_convention(cx.tcx.sess, this.conv);
};

// rustc: compiler/rustc_codegen_llvm/src/abi.rs:459 apply_attrs_llfn
FnAbi.prototype.apply_attrs_llfn = function (this: FnAbi<Ty>, cx: CodegenCx, llfn: Value, instance: Instance | undefined): void {
  const func_attrs: Attribute[] = [];
  if (this.ret.layout.is_uninhabited()) {
    func_attrs.push(AttributeKind_impl.create_attr(AttributeKind.NoReturn, cx.llcx()));
  }
  if (!this.can_unwind) {
    func_attrs.push(AttributeKind_impl.create_attr(AttributeKind.NoUnwind, cx.llcx()));
  }
  const conv = this.conv;
  if (conv.$ === "Interrupt" && conv._0 === "RiscvMachine") {
    func_attrs.push(llvm.CreateAttrStringValue(cx.llcx(), "interrupt", "machine"));
  } else if (conv.$ === "Interrupt" && conv._0 === "RiscvSupervisor") {
    func_attrs.push(llvm.CreateAttrStringValue(cx.llcx(), "interrupt", "supervisor"));
  } else if (conv.$ === "Arm" && conv._0 === "CCmseNonSecureEntry") {
    func_attrs.push(llvm.CreateAttrString(cx.llcx(), "cmse_nonsecure_entry"));
  }
  attributes.apply_to_llfn(llfn, AttributePlace.Function, func_attrs);

  let i = 0;
  const apply = (attrs: ArgAttributes): number => {
    attrs.apply_attrs_to_llfn({ $: "Argument", _0: i }, cx, llfn);
    i += 1;
    return i - 1;
  };

  const apply_range_attr = (idx: AttributePlace, scalar: Scalar): void => {
    if (
      cx.sess().opts.optimize !== "No" &&
      ScalarC.primitive(scalar).$ === "Int" &&
      // If the value is a boolean, the range is 0..2 and that ultimately
      // become 0..0 when the type becomes i1, which would be rejected
      // by the LLVM verifier.
      !ScalarC.is_bool(scalar) &&
      // LLVM also rejects full range.
      !ScalarC.is_always_valid(scalar, cx)
    ) {
      attributes.apply_to_llfn(llfn, idx, [llvm.CreateRangeAttr(cx.llcx(), ScalarC.size(scalar, cx), ScalarC.valid_range(scalar, cx))]);
    }
  };

  const ret_mode = this.ret.mode;
  switch (ret_mode.$) {
    case "Direct": {
      const attrs = ret_mode._0;
      attrs.apply_attrs_to_llfn(AttributePlace.ReturnValue, cx, llfn);
      const repr = this.ret.layout.backend_repr;
      if (repr.$ === "Scalar") {
        apply_range_attr(AttributePlace.ReturnValue, repr._0);
      }
      break;
    }
    case "Indirect": {
      const attrs = ret_mode.attrs;
      assert(ret_mode.mode === "Pointer", "assertion failed: *mode == IndirectMode::Pointer");
      const i = apply(attrs);
      const sret = llvm.CreateStructRetAttr(cx.llcx(), cx.type_array(cx.type_i8(), this.ret.layout.size.bytes_u64()));
      attributes.apply_to_llfn(llfn, { $: "Argument", _0: i }, [sret]);
      if (cx.sess().opts.optimize !== "No") {
        attributes.apply_to_llfn(llfn, { $: "Argument", _0: i }, [
          AttributeKind_impl.create_attr(AttributeKind.Writable, cx.llcx()),
          AttributeKind_impl.create_attr(AttributeKind.DeadOnUnwind, cx.llcx()),
        ]);
      }
      break;
    }
    case "IndirectUnsized":
      return bug("unsized returns are not supported");
    case "Cast":
      ret_mode.cast.attrs.apply_attrs_to_llfn(AttributePlace.ReturnValue, cx, llfn);
      break;
    default:
      break;
  }
  for (const arg of this.args) {
    const mode = arg.mode;
    if (mode.$ === "Ignore") {
      // nothing
    } else if (mode.$ === "Indirect" && mode.mode === "OnStack") {
      const i = apply(mode.attrs);
      const byval = llvm.CreateByValAttr(cx.llcx(), cx.type_array(cx.type_i8(), arg.layout.size.bytes_u64()));
      attributes.apply_to_llfn(llfn, { $: "Argument", _0: i }, [byval]);
    } else if (mode.$ === "Indirect" && mode.mode === "AmdgpuKernelArg") {
      const i = apply(mode.attrs);
      const byref = llvm.CreateByRefAttr(cx.llcx(), cx.type_array(cx.type_i8(), arg.layout.size.bytes_u64()));
      attributes.apply_to_llfn(llfn, { $: "Argument", _0: i }, [byref]);
    } else if (mode.$ === "Direct") {
      const i = apply(mode._0);
      const repr = arg.layout.backend_repr;
      if (repr.$ === "Scalar") {
        apply_range_attr({ $: "Argument", _0: i }, repr._0);
      }
    } else if (mode.$ === "Indirect" && mode.mode === "Pointer") {
      const i = apply(mode.attrs);
      if (cx.sess().opts.optimize !== "No") {
        attributes.apply_to_llfn(llfn, { $: "Argument", _0: i }, [AttributeKind_impl.create_attr(AttributeKind.DeadOnReturn, cx.llcx())]);
      }
    } else if (mode.$ === "IndirectUnsized") {
      apply(mode.attrs);
      apply(mode.meta_attrs);
    } else if (mode.$ === "Pair") {
      const i = apply(mode._0);
      const ii = apply(mode._1);
      const repr = arg.layout.backend_repr;
      if (repr.$ === "ScalarPair") {
        const scalar_a = repr.a;
        const scalar_b_ = repr.b;
        apply_range_attr({ $: "Argument", _0: i }, scalar_a);
        const primitive_b = ScalarC.primitive(scalar_b_);
        let scalar_b: Scalar = scalar_b_;
        // `if let Primitive::Int(int, false) = primitive_b && let ty::Ref(_, pointee_ty, _) = *arg.layout.ty.kind()
        //  && let ty::Slice(element_ty) = *pointee_ty.kind() && let elem_size = cx.layout_of(element_ty).size
        //  && elem_size != Size::ZERO`
        if (primitive_b.$ === "Int" && primitive_b._1 === false) {
          const int = primitive_b._0;
          const ty_kind = arg.layout.ty.kind();
          if (ty_kind.$ === "Ref") {
            const pointee_kind = ty_kind._1.kind();
            if (pointee_kind.$ === "Slice") {
              const elem_size = cx.layout_of(pointee_kind._0).size;
              if (elem_size.bytes() !== Size.ZERO.bytes()) {
                // Ideally the layout calculations would have set the range,
                // but that's complicated due to cycles, so in the mean time
                // we calculate and apply it here.
                // debug_assert!(scalar_b.is_always_valid(cx));
                // `int.signed_max() as u64`
                const isize_max = BigInt.asUintN(64, IntegerC.signed_max(int));
                scalar_b = {
                  $: "Initialized",
                  value: primitive_b,
                  valid_range: new WrappingRange(0n, isize_max / elem_size.bytes_u64()),
                };
              }
            }
          }
        }
        apply_range_attr({ $: "Argument", _0: ii }, scalar_b);
      }
    } else if (mode.$ === "Cast") {
      for (let k = 0; k < mode.pad_i32_count; k++) {
        apply(ArgAttributes.new());
      }
      apply(mode.cast.attrs);
    }
  }

  // If the declaration has an associated instance, compute extra attributes based on that.
  if (instance !== undefined) {
    attributes.llfn_attrs_from_instance(cx.scx, cx.tcx, llfn, TyCtxt_codegen_instance_attrs(cx.tcx, instance.def), instance, cx.sanitizer_ignorelist);
  }
};

// rustc: compiler/rustc_codegen_llvm/src/abi.rs:640 apply_attrs_callsite
FnAbi.prototype.apply_attrs_callsite = function (this: FnAbi<Ty>, bx: Builder, callsite: Value): void {
  const func_attrs: Attribute[] = [];
  if (this.ret.layout.is_uninhabited()) {
    func_attrs.push(AttributeKind_impl.create_attr(AttributeKind.NoReturn, bx.cx_.llcx()));
  }
  if (!this.can_unwind) {
    func_attrs.push(AttributeKind_impl.create_attr(AttributeKind.NoUnwind, bx.cx_.llcx()));
  }
  attributes.apply_to_callsite(callsite, AttributePlace.Function, func_attrs);

  let i = 0;
  const apply = (cx: CodegenCx, attrs: ArgAttributes): number => {
    attrs.apply_attrs_to_callsite({ $: "Argument", _0: i }, cx, callsite);
    i += 1;
    return i - 1;
  };
  const ret_mode = this.ret.mode;
  switch (ret_mode.$) {
    case "Direct":
      ret_mode._0.apply_attrs_to_callsite(AttributePlace.ReturnValue, bx.cx_, callsite);
      break;
    case "Indirect": {
      assert(ret_mode.mode === "Pointer", "assertion failed: *mode == IndirectMode::Pointer");
      const i = apply(bx.cx_, ret_mode.attrs);
      const sret = llvm.CreateStructRetAttr(bx.cx_.llcx(), bx.cx_.type_array(bx.cx_.type_i8(), this.ret.layout.size.bytes_u64()));
      attributes.apply_to_callsite(callsite, { $: "Argument", _0: i }, [sret]);
      break;
    }
    case "IndirectUnsized":
      return bug("unsized returns are not supported");
    case "Cast":
      ret_mode.cast.attrs.apply_attrs_to_callsite(AttributePlace.ReturnValue, bx.cx_, callsite);
      break;
    default:
      break;
  }
  for (const arg of this.args) {
    const mode = arg.mode;
    if (mode.$ === "Ignore") {
      // nothing
    } else if (mode.$ === "Indirect" && mode.mode === "OnStack") {
      const i = apply(bx.cx_, mode.attrs);
      const byval = llvm.CreateByValAttr(bx.cx_.llcx(), bx.cx_.type_array(bx.cx_.type_i8(), arg.layout.size.bytes_u64()));
      attributes.apply_to_callsite(callsite, { $: "Argument", _0: i }, [byval]);
    } else if (mode.$ === "Indirect" && mode.mode === "AmdgpuKernelArg") {
      const i = apply(bx.cx_, mode.attrs);
      const byref = llvm.CreateByRefAttr(bx.cx_.llcx(), bx.cx_.type_array(bx.cx_.type_i8(), arg.layout.size.bytes_u64()));
      attributes.apply_to_callsite(callsite, { $: "Argument", _0: i }, [byref]);
    } else if (mode.$ === "Direct") {
      apply(bx.cx_, mode._0);
    } else if (mode.$ === "Indirect" && mode.mode === "Pointer") {
      apply(bx.cx_, mode.attrs);
    } else if (mode.$ === "IndirectUnsized") {
      apply(bx.cx_, mode.attrs);
      apply(bx.cx_, mode.meta_attrs);
    } else if (mode.$ === "Pair") {
      apply(bx.cx_, mode._0);
      apply(bx.cx_, mode._1);
    } else if (mode.$ === "Cast") {
      for (let k = 0; k < mode.pad_i32_count; k++) {
        apply(bx.cx_, ArgAttributes.new());
      }
      apply(bx.cx_, mode.cast.attrs);
    }
  }

  const cconv = this.llvm_cconv(bx.cx_);
  if (cconv !== llvm.CallConv.CCallConv) {
    llvm.SetInstructionCallConv(callsite, cconv);
  }

  if (this.conv.$ === "Arm" && this.conv._0 === "CCmseNonSecureCall") {
    // This will probably get ignored on all targets but those supporting the TrustZone-M
    // extension (thumbv8m targets).
    const cmse_nonsecure_call = llvm.CreateAttrString(bx.cx_.llcx(), "cmse_nonsecure_call");
    attributes.apply_to_callsite(callsite, AttributePlace.Function, [cmse_nonsecure_call]);
  }

  // Some intrinsics require that an elementtype attribute (with the pointee type of a
  // pointer argument) is added to the callsite.
  const element_type_index = llvm.LLVMRustGetElementTypeArgIndex(callsite);
  if (element_type_index >= 0) {
    // `self.args[element_type_index as usize]`: a slice index (panics out of bounds).
    const arg = this.args[element_type_index];
    if (arg === undefined) panic(`index out of bounds: the len is ${this.args.length} but the index is ${element_type_index}`);
    const arg_ty = arg.layout.ty;
    const pointee_ty = unwrap(arg_ty.builtin_deref(true), "Must be pointer argument");
    const element_type_attr = llvm.LLVMRustCreateElementTypeAttr(bx.llcx(), bx.layout_of(pointee_ty).llvm_type(bx.cx_));
    attributes.apply_to_callsite(callsite, { $: "Argument", _0: element_type_index >>> 0 }, [element_type_attr]);
  }
};

// ---- impl AbiBuilderMethods for Builder<'_, '_, '_> (abi.rs:765) ----
declare module "./builder.ts" {
  interface Builder {
    get_param(index: number): Value;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/abi.rs:766 get_param
Builder.prototype.get_param = function (this: Builder, index: number): Value {
  return llvm.get_param(this.llfn(), index >>> 0);
};

/// Determines the appropriate [`llvm::CallConv`] to use for a given function
/// ABI, for the current target.
// rustc: compiler/rustc_codegen_llvm/src/abi.rs:773 to_llvm_calling_convention
export function to_llvm_calling_convention(sess: Session, abi: CanonAbi): CallConv {
  switch (abi.$) {
    case "C":
    case "Rust":
      return llvm.CallConv.CCallConv;
    case "RustCold":
      return llvm.CallConv.PreserveMost;
    case "RustPreserveNone":
      switch (sess.target.arch.$) {
        case "X86_64":
        case "AArch64":
          return llvm.CallConv.PreserveNone;
        default:
          return llvm.CallConv.CCallConv;
      }
    case "RustTail":
      switch (sess.target.arch.$) {
        case "X86":
        case "X86_64":
        case "AArch64":
          return llvm.CallConv.Tail;
        default:
          return sess.dcx().fatal('extern "tail" is only supported on x86, x86_64 and aarch64');
      }
    // Functions with this calling convention can only be called from assembly, but it is
    // possible to declare an `extern "custom"` block, so the backend still needs a calling
    // convention for declaring foreign functions.
    case "Custom":
      return llvm.CallConv.CCallConv;
    case "Swift":
      return llvm.CallConv.SwiftCallConv;
    case "GpuKernel": {
      const arch = sess.target.arch;
      switch (arch.$) {
        case "AmdGpu":
          return llvm.CallConv.AmdgpuKernel;
        case "Nvptx64":
          return llvm.CallConv.PtxKernel;
        default:
          return panic(`Architecture ${Arch.display(arch)} does not support GpuKernel calling convention`);
      }
    }
    case "Interrupt": {
      const interrupt_kind = abi._0;
      switch (interrupt_kind) {
        case "Avr":
          return llvm.CallConv.AvrInterrupt;
        case "AvrNonBlocking":
          return llvm.CallConv.AvrNonBlockingInterrupt;
        case "Msp430":
          return llvm.CallConv.Msp430Intr;
        case "RiscvMachine":
        case "RiscvSupervisor":
          return llvm.CallConv.CCallConv;
        case "X86":
          return llvm.CallConv.X86_Intr;
      }
    }
    case "Arm": {
      const arm_call = abi._0;
      switch (arm_call) {
        case "Aapcs":
          return llvm.CallConv.ArmAapcsCallConv;
        case "CCmseNonSecureCall":
        case "CCmseNonSecureEntry":
          return llvm.CallConv.CCallConv;
      }
    }
    case "X86": {
      const x86_call = abi._0;
      switch (x86_call) {
        case "Fastcall":
          return llvm.CallConv.X86FastcallCallConv;
        case "Stdcall":
          return llvm.CallConv.X86StdcallCallConv;
        case "SysV64":
          return llvm.CallConv.X86_64_SysV;
        case "Thiscall":
          return llvm.CallConv.X86_ThisCall;
        case "Vectorcall":
          return llvm.CallConv.X86_VectorCall;
        case "Win64":
          return llvm.CallConv.X86_64_Win64;
      }
    }
  }
}
