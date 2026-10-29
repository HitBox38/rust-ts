// Port of compiler/rustc_target/src/callconv/mod.rs (lane fn-abi).
//
// PORT notes:
// - The data types are hand-written (as rustc_abi's and rustc_target spec's): structs with inherent impls are classes
//   (`ArgAttributes`, `Uniform`, `CastTarget`, `ArgAbi`, `FnAbi`), the enums `$`-tagged unions / string unions. Fields
//   that upstream mutates in place (`&mut self` methods, `ref mut` patterns) are mutable.
// - `Copy` objects (`ArgAttributes`, `Uniform`, `CastTarget` behind the `Box`) are copied with `clone_<T>` where rustc
//   copies them (PORTING §8); `#[derive(Clone)]` of `ArgAbi` / `FnAbi` is `clone_ArgAbi` / `clone_FnAbi` (deep, since
//   `fn_abi_adjust_for_deduced_attrs` edits the clone's attributes in place).
// - `T: Into<CastTarget>` parameters take `IntoCastTarget` (`Reg | Uniform | CastTarget`), converted by
//   `into_CastTarget` (the `From` impls below).
// - `C: HasDataLayout + HasTargetSpec + HasX86AbiOpt` is the intersection of those interfaces; `Ty: TyAbiInterface` is
//   the registered table (rustc_abi layout/ty.ts), reached through `TyAndLayout`'s methods.
// - `impl fmt::Debug for ArgAbi / FnAbi` need `Ty: Display`: `debug_ArgAbi` / `debug_FnAbi` take the `Display` fn (as
//   rustc_abi's `debug_TyAndLayout`).
// - Only the x86_64 lowerings (`x86_64::compute_abi_info`, SysV, and `x86_win64::compute_abi_info`, lane gaps-30c) are
//   ported; the other targets' modules
//   (`mod aarch64; .. mod xtensa;`) are not, and their arms of `adjust_for_foreign_abi` / `adjust_for_rust_abi` stop
//   with `unported(..)`.
import { CanonAbi, debug_CanonAbi } from "../../rustc_abi/canon_abi.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import {
  AddressSpace,
  Align,
  Align_max,
  type BackendRepr,
  FieldsShape,
  type HasDataLayout,
  Integer,
  Primitive,
  Scalar,
  Size,
  debug_AddressSpace,
  debug_Align,
  debug_Size,
} from "../../rustc_abi/lib.ts";
import { Reg, Reg_eq, debug_Reg } from "../../rustc_abi/callconv/reg.ts";
import { BackendRepr as BackendReprC } from "../../rustc_abi/lib.ts";
import { type TyAndLayout, debug_TyAndLayout } from "../../rustc_abi/layout/ty.ts";
import { type Debug, type Fmt, PLAIN, debug_bool, debug_int, debug_option, debug_struct, debug_tuple, debug_vec } from "../../std/fmt.ts";
import { assert, panic, unported, unreachable } from "../../std/panic.ts";
import { to_writer } from "../../vendor/bitflags/parser.ts";
import { flags_companion } from "../../vendor/bitflags/traits.ts";
import { Arch, type HasTargetSpec, type HasX86AbiOpt } from "../spec/mod.ts";
import * as x86_64 from "./x86_64.ts";
import * as x86_win64 from "./x86_win64.ts";

export { AbiMap } from "../spec/abi_map.ts";

// mod aarch64; .. mod xtensa;  PORT: only `mod x86_64;` and `mod x86_win64;` are ported (header).

/// Different modes in which indirect arguments can be passed.
// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, StableHash)]
export type IndirectMode =
  /// Passed as a normal pointer, nothing special.
  | "Pointer"
  /// The value should be passed at a fixed stack offset in accordance to
  /// the ABI rather than passed using a pointer. This corresponds to the `byval` LLVM argument
  /// attribute. The `byval` argument will use a byte array with the same size as the Rust type
  /// (which ensures that padding is preserved and that we do not rely on LLVM's struct layout),
  /// and will use the alignment specified in `attrs.pointee_align` (if `Some`) or the type's
  /// alignment (if `None`). This means that the alignment will not always
  /// match the Rust type's alignment; see documentation of `pass_by_stack_offset` for more info.
  | "OnStack"
  /// `AmdgpuKernelArg` behaves similar to `OnStack` except that the pointer does not necessarily
  /// point to the stack, no extra copy is made, and the passed argument should not be modified.
  /// This corresponds to the `byref` LLVM argument attribute.
  | "AmdgpuKernelArg";
export const IndirectMode = { Pointer: "Pointer", OnStack: "OnStack", AmdgpuKernelArg: "AmdgpuKernelArg" } as const;
// derive(Debug)
export const debug_IndirectMode: Debug<IndirectMode> = (v) => v;

// #[derive(Clone, PartialEq, Eq, Hash, Debug, StableHash)]
export type PassMode =
  /// Ignore the argument.
  ///
  /// The argument is a ZST.
  | { readonly $: "Ignore" }
  /// Pass the argument directly.
  ///
  /// The argument has a layout abi of `Scalar` or `Vector`.
  /// Unfortunately due to past mistakes, in rare cases on wasm, it can also be `Aggregate`.
  /// This is bad since it leaks LLVM implementation details into the ABI.
  /// (Also see <https://github.com/rust-lang/rust/issues/115666>.)
  | { readonly $: "Direct"; readonly _0: ArgAttributes }
  /// Pass a pair's elements directly in two arguments.
  ///
  /// The argument has a layout abi of `ScalarPair`.
  | { readonly $: "Pair"; readonly _0: ArgAttributes; readonly _1: ArgAttributes }
  /// Pass the argument after casting it. See the `CastTarget` docs for details.
  ///
  /// `pad_i32` indicates how many `Reg::i32()` dummy arguments are emitted before the real
  /// argument.
  | { readonly $: "Cast"; readonly pad_i32_count: number; readonly cast: CastTarget }
  /// Pass the argument indirectly via a hidden pointer.
  ///
  /// `address_space` specifies if the pointer is in a special address space or the default one.
  ///
  /// `mode` can be a special way to pass an argument indirectly.
  | { readonly $: "Indirect"; readonly attrs: ArgAttributes; address_space: AddressSpace | undefined; mode: IndirectMode }

  /// Like `Indirect`, but for unsized parameters.
  ///
  /// The `meta_attrs` value, is for the metadata (vtable or length) of an unsized argument.
  /// (This is the only mode that supports unsized arguments.) `on_stack` is always false.
  | { readonly $: "IndirectUnsized"; readonly attrs: ArgAttributes; readonly meta_attrs: ArgAttributes };

export const PassMode = {
  Ignore: Object.freeze({ $: "Ignore" }) as PassMode,

  /// Checks if these two `PassMode` are equal enough to be considered "the same for all
  /// function call ABIs". However, the `Layout` can also impact ABI decisions,
  /// so that needs to be compared as well!
  // rustc: compiler/rustc_target/src/callconv/mod.rs:98 eq_abi
  eq_abi(self: PassMode, other: PassMode): boolean {
    if (self.$ === "Ignore" && other.$ === "Ignore") {
      return true;
    } else if (self.$ === "Direct" && other.$ === "Direct") {
      return self._0.eq_abi(other._0);
    } else if (self.$ === "Pair" && other.$ === "Pair") {
      return self._0.eq_abi(other._0) && self._1.eq_abi(other._1);
    } else if (self.$ === "Cast" && other.$ === "Cast") {
      return self.cast.eq_abi(other.cast) && self.pad_i32_count === other.pad_i32_count;
    } else if (self.$ === "Indirect" && other.$ === "Indirect") {
      return self.attrs.eq_abi(other.attrs) && self.address_space === other.address_space && self.mode === other.mode;
    } else if (self.$ === "IndirectUnsized" && other.$ === "IndirectUnsized") {
      return self.attrs.eq_abi(other.attrs) && self.meta_attrs.eq_abi(other.meta_attrs);
    } else {
      return false;
    }
  },
} as const;
// derive(Debug)
export const debug_PassMode: Debug<PassMode> = (v, f) => {
  switch (v.$) {
    case "Ignore":
      return "Ignore";
    case "Direct":
      return debug_tuple(f, "Direct", [debug_ArgAttributes(v._0, f)]);
    case "Pair":
      return debug_tuple(f, "Pair", [debug_ArgAttributes(v._0, f), debug_ArgAttributes(v._1, f)]);
    case "Cast":
      return debug_struct(f, "Cast", [
        ["pad_i32_count", debug_int(v.pad_i32_count, f)],
        ["cast", debug_CastTarget(v.cast, f)],
      ]);
    case "Indirect":
      return debug_struct(f, "Indirect", [
        ["attrs", debug_ArgAttributes(v.attrs, f)],
        ["address_space", debug_option(v.address_space, f, debug_AddressSpace)],
        ["mode", debug_IndirectMode(v.mode, f)],
      ]);
    case "IndirectUnsized":
      return debug_struct(f, "IndirectUnsized", [
        ["attrs", debug_ArgAttributes(v.attrs, f)],
        ["meta_attrs", debug_ArgAttributes(v.meta_attrs, f)],
      ]);
  }
};
/** derive(Clone) (the `ArgAttributes` / `Box<CastTarget>` inside are copied). */
export function clone_PassMode(v: PassMode): PassMode {
  switch (v.$) {
    case "Ignore":
      return v;
    case "Direct":
      return { $: "Direct", _0: clone_ArgAttributes(v._0) };
    case "Pair":
      return { $: "Pair", _0: clone_ArgAttributes(v._0), _1: clone_ArgAttributes(v._1) };
    case "Cast":
      return { $: "Cast", pad_i32_count: v.pad_i32_count, cast: clone_CastTarget(v.cast) };
    case "Indirect":
      return { $: "Indirect", attrs: clone_ArgAttributes(v.attrs), address_space: v.address_space, mode: v.mode };
    case "IndirectUnsized":
      return { $: "IndirectUnsized", attrs: clone_ArgAttributes(v.attrs), meta_attrs: clone_ArgAttributes(v.meta_attrs) };
  }
}

// Hack to disable non_upper_case_globals only for the bitflags! and not for the rest
// of this module
// pub use attr_impl::ArgAttribute;

// mod attr_impl {
// The subset of llvm::Attribute needed for arguments, packed into a bitfield.
// #[derive(Clone, Copy, Default, Hash, PartialEq, Eq, StableHash)]
// pub struct ArgAttribute(u16);
// PORT: `bitflags!` (`impl ArgAttribute: u16`) -> branded number; flags + `Flags` API on the companion (as rustc_abi's
// `ReprFlags`). Equality is `===`; `Default` is `0`.
export type ArgAttribute = number & { readonly __brand: "ArgAttribute" };
export const ArgAttribute = flags_companion<
  ArgAttribute,
  {
    CapturesNone: ArgAttribute;
    CapturesAddress: ArgAttribute;
    CapturesReadOnly: ArgAttribute;
    NoAlias: ArgAttribute;
    NonNull: ArgAttribute;
    ReadOnly: ArgAttribute;
    InReg: ArgAttribute;
    NoUndef: ArgAttribute;
    Writable: ArgAttribute;
    NoFree: ArgAttribute;
  }
>(
  16,
  {
    CapturesNone: 0b111 as ArgAttribute,
    CapturesAddress: 0b110 as ArgAttribute,
    CapturesReadOnly: 0b100 as ArgAttribute,
    NoAlias: (1 << 3) as ArgAttribute,
    NonNull: (1 << 4) as ArgAttribute,
    ReadOnly: (1 << 5) as ArgAttribute,
    InReg: (1 << 6) as ArgAttribute,
    NoUndef: (1 << 7) as ArgAttribute,
    Writable: (1 << 8) as ArgAttribute,
    /// It is UB for this pointer or any pointer derived from it to be used for
    /// deallocation (except for zero-sized deallocation) while the function is
    /// executing. Only valid on arguments (including return values that are passed
    /// indirectly as arguments).
    NoFree: (1 << 9) as ArgAttribute,
  },
  [
    ["CapturesNone", 0b111 as ArgAttribute],
    ["CapturesAddress", 0b110 as ArgAttribute],
    ["CapturesReadOnly", 0b100 as ArgAttribute],
    ["NoAlias", (1 << 3) as ArgAttribute],
    ["NonNull", (1 << 4) as ArgAttribute],
    ["ReadOnly", (1 << 5) as ArgAttribute],
    ["InReg", (1 << 6) as ArgAttribute],
    ["NoUndef", (1 << 7) as ArgAttribute],
    ["Writable", (1 << 8) as ArgAttribute],
    ["NoFree", (1 << 9) as ArgAttribute],
  ],
);
// rustc_data_structures::external_bitflags_debug! { ArgAttribute }
// PORT: the macro expands to `impl Debug for ArgAttribute { fn fmt(..) { bitflags::parser::to_writer(self, f) } }`
// (compiler/rustc_data_structures/src/lib.rs:147).
export const debug_ArgAttribute: Debug<ArgAttribute> = (v) => to_writer(ArgAttribute.FLAGS_DESC, v);
// }

/// Sometimes an ABI requires small integers to be extended to a full or partial register. This enum
/// defines if this extension should be zero-extension or sign-extension when necessary. When it is
/// not necessary to extend the argument, this enum is ignored.
// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, StableHash)]
export type ArgExtension = "None" | "Zext" | "Sext";
export const ArgExtension = { None: "None", Zext: "Zext", Sext: "Sext" } as const;
// derive(Debug)
export const debug_ArgExtension: Debug<ArgExtension> = (v) => v;

/// A compact representation of LLVM attributes (at least those relevant for this module)
/// that can be manipulated without interacting with LLVM's Attribute machinery.
// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, StableHash)]
export class ArgAttributes {
  constructor(
    public regular: ArgAttribute,
    public arg_ext: ArgExtension,
    /// If the pointer is not null, the minimum dereferenceable size of the pointee, at the time of
    /// function entry (for arguments) or function return (for return values).
    public pointee_size: Size,
    /// The minimum alignment of the pointee, if any.
    public pointee_align: Align | undefined,
  ) {}

  // rustc: compiler/rustc_target/src/callconv/mod.rs:177 new
  static new(): ArgAttributes {
    return new ArgAttributes(/* regular */ 0 as ArgAttribute, /* arg_ext */ ArgExtension.None, /* pointee_size */ Size.ZERO, /* pointee_align */ undefined);
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:186 ext
  ext(ext: ArgExtension): ArgAttributes {
    assert(
      this.arg_ext === ArgExtension.None || this.arg_ext === ext,
      () => `cannot set ${debug_ArgExtension(ext, PLAIN)} when ${debug_ArgExtension(this.arg_ext, PLAIN)} is already set`,
    );
    this.arg_ext = ext;
    return this;
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:197 set
  set(attr: ArgAttribute): ArgAttributes {
    this.regular = ArgAttribute.union(this.regular, attr);
    return this;
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:202 contains
  contains(attr: ArgAttribute): boolean {
    return ArgAttribute.contains(this.regular, attr);
  }

  /// Checks if these two `ArgAttributes` are equal enough to be considered "the same for all
  /// function call ABIs".
  // rustc: compiler/rustc_target/src/callconv/mod.rs:208 eq_abi
  eq_abi(other: ArgAttributes): boolean {
    // There's only one regular attribute that matters for the call ABI: InReg.
    // Everything else is things like noalias, dereferenceable, nonnull, ...
    // (This also applies to pointee_size, pointee_align.)
    if (ArgAttribute.contains(this.regular, ArgAttribute.InReg) !== ArgAttribute.contains(other.regular, ArgAttribute.InReg)) {
      return false;
    }
    // We also compare the sign extension mode -- this could let the callee make assumptions
    // about bits that conceptually were not even passed.
    if (this.arg_ext !== other.arg_ext) {
      return false;
    }
    return true;
  }
}
// derive(Debug)
export const debug_ArgAttributes: Debug<ArgAttributes> = (v, f) =>
  debug_struct(f, "ArgAttributes", [
    ["regular", debug_ArgAttribute(v.regular, f)],
    ["arg_ext", debug_ArgExtension(v.arg_ext, f)],
    ["pointee_size", debug_Size(v.pointee_size, f)],
    ["pointee_align", debug_option(v.pointee_align, f, debug_Align)],
  ]);
/** derive(Clone) of a `Copy` object (PORTING §8). */
export function clone_ArgAttributes(v: ArgAttributes): ArgAttributes {
  return new ArgAttributes(v.regular, v.arg_ext, v.pointee_size, v.pointee_align);
}

// impl From<ArgAttribute> for ArgAttributes
// rustc: compiler/rustc_target/src/callconv/mod.rs:226 from
export function ArgAttributes_from_ArgAttribute(value: ArgAttribute): ArgAttributes {
  return new ArgAttributes(/* regular */ value, /* arg_ext */ ArgExtension.None, /* pointee_size */ Size.ZERO, /* pointee_align */ undefined);
}

/// An argument passed entirely registers with the
/// same kind (e.g., HFA / HVA on PPC64 and AArch64).
// #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, StableHash)]
export class Uniform {
  constructor(
    readonly unit: Reg,

    /// The total size of the argument, which can be:
    /// * equal to `unit.size` (one scalar/vector),
    /// * a multiple of `unit.size` (an array of scalar/vectors),
    /// * if `unit.kind` is `Integer`, the last element can be shorter, i.e., `{ i64, i64, i32 }`
    ///   for 64-bit integers with a total size of 20 bytes. When the argument is actually passed,
    ///   this size will be rounded up to the nearest multiple of `unit.size`.
    readonly total: Size,

    /// Indicate that the argument is consecutive, in the sense that either all values need to be
    /// passed in register, or all on the stack. If they are passed on the stack, there should be
    /// no additional padding between elements.
    readonly is_consecutive: boolean,
  ) {}

  // rustc: compiler/rustc_target/src/callconv/mod.rs:263 align
  align(cx: HasDataLayout): Align {
    return this.unit.align(cx);
  }

  /// Pass using one or more values of the given type, without requiring them to be consecutive.
  /// That is, some values may be passed in register and some on the stack.
  // rustc: compiler/rustc_target/src/callconv/mod.rs:269 new
  static new(unit: Reg, total: Size): Uniform {
    return new Uniform(unit, total, /* is_consecutive */ false);
  }

  /// Pass using one or more consecutive values of the given type. Either all values will be
  /// passed in registers, or all on the stack.
  // rustc: compiler/rustc_target/src/callconv/mod.rs:275 consecutive
  static consecutive(unit: Reg, total: Size): Uniform {
    return new Uniform(unit, total, /* is_consecutive */ true);
  }
}
/** derive(PartialEq) */
export function Uniform_eq(a: Uniform, b: Uniform): boolean {
  return Reg_eq(a.unit, b.unit) && a.total.bytes() === b.total.bytes() && a.is_consecutive === b.is_consecutive;
}
// derive(Debug)
export const debug_Uniform: Debug<Uniform> = (v, f) =>
  debug_struct(f, "Uniform", [
    ["unit", debug_Reg(v.unit, f)],
    ["total", debug_Size(v.total, f)],
    ["is_consecutive", debug_bool(v.is_consecutive, f)],
  ]);

// impl From<Reg> for Uniform
// rustc: compiler/rustc_target/src/callconv/mod.rs:257 from
export function Uniform_from_Reg(unit: Reg): Uniform {
  return new Uniform(unit, /* total */ unit.size, /* is_consecutive */ false);
}

/// Describes the type used for `PassMode::Cast`.
///
/// Passing arguments in this mode works as follows: the registers in the `prefix` (the ones that
/// are `Some`) get laid out one after the other (using `repr(C)` layout rules). Then the
/// `rest.unit` register type gets repeated often enough to cover `rest.size`. This describes the
/// actual type used for the call; the Rust type of the argument is then transmuted to this ABI type
/// (and all data in the padding between the registers is dropped).
// #[derive(Clone, PartialEq, Eq, Hash, Debug, StableHash)]
export class CastTarget {
  constructor(
    // Note that this is fixed to 8 elements for now as ABIs currently don't
    // need anything further beyond that, and when this code was originally
    // refactored to use `ArrayVec` it was already using 8, so that stuck
    // around.
    public prefix: Reg[],
    /// The offset of `rest` from the start of the value. Currently only implemented for a `Reg`
    /// pair created by the `offset_pair` method.
    public rest_offset: Size | undefined,
    public rest: Uniform,
    public attrs: ArgAttributes,
  ) {}

  // rustc: compiler/rustc_target/src/callconv/mod.rs:314 prefixed
  static prefixed(prefix: Reg[], rest: Uniform): CastTarget {
    return new CastTarget(prefix, /* rest_offset */ undefined, rest, /* attrs */ ArgAttributes.new());
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:318 offset_pair
  static offset_pair(a: Reg, offset_from_start: Size, b: Reg): CastTarget {
    const prefix: Reg[] = [];
    prefix.push(a);
    return new CastTarget(prefix, /* rest_offset */ offset_from_start, /* rest */ Uniform_from_Reg(b), /* attrs */ ArgAttributes.new());
  }

  // PORT: `mut self` by value: the receiver is consumed, so it is updated in place and returned.
  // rustc: compiler/rustc_target/src/callconv/mod.rs:329 with_attrs
  with_attrs(attrs: ArgAttributes): CastTarget {
    this.attrs = attrs;
    return this;
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:334 pair
  static pair(a: Reg, b: Reg): CastTarget {
    const prefix: Reg[] = [];
    prefix.push(a);
    return CastTarget.prefixed(prefix, Uniform_from_Reg(b));
  }

  /// When you only access the range containing valid data, you can use this unaligned size;
  /// otherwise, use the safer `size` method.
  // rustc: compiler/rustc_target/src/callconv/mod.rs:342 unaligned_size
  unaligned_size(_cx: HasDataLayout): Size {
    // Prefix arguments are passed in specific designated registers
    let prefix_size: Size;
    if (this.rest_offset !== undefined) {
      const offset_from_start = this.rest_offset;
      prefix_size = offset_from_start;
    } else {
      prefix_size = this.prefix.map((reg) => reg.size).reduce((acc, size) => acc.add(size), Size.ZERO);
    }
    // Remaining arguments are passed in chunks of the unit size
    const rest_size = this.rest.unit.size.mul(Math.ceil(this.rest.total.bytes() / this.rest.unit.size.bytes()));

    return prefix_size.add(rest_size);
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:356 size
  size(cx: HasDataLayout): Size {
    return this.unaligned_size(cx).align_to(this.align(cx));
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:360 align
  align(cx: HasDataLayout): Align {
    return this.prefix
      .map((reg) => reg.align(cx))
      .reduce((acc, align) => Align_max(acc, align), Align_max(cx.data_layout().aggregate_align, this.rest.align(cx)));
  }

  /// Checks if these two `CastTarget` are equal enough to be considered "the same for all
  /// function call ABIs".
  // rustc: compiler/rustc_target/src/callconv/mod.rs:371 eq_abi
  eq_abi(other: CastTarget): boolean {
    const { prefix: prefix_l, rest_offset: rest_offset_l, rest: rest_l, attrs: attrs_l } = this;
    const { prefix: prefix_r, rest_offset: rest_offset_r, rest: rest_r, attrs: attrs_r } = other;
    return (
      prefix_l.length === prefix_r.length &&
      prefix_l.every((r, i) => Reg_eq(r, prefix_r[i]!)) &&
      rest_offset_l?.bytes() === rest_offset_r?.bytes() &&
      Uniform_eq(rest_l, rest_r) &&
      attrs_l.eq_abi(attrs_r)
    );
  }
}
// derive(Debug)
export const debug_CastTarget: Debug<CastTarget> = (v, f) =>
  debug_struct(f, "CastTarget", [
    ["prefix", debug_vec(v.prefix, f, debug_Reg)],
    ["rest_offset", debug_option(v.rest_offset, f, debug_Size)],
    ["rest", debug_Uniform(v.rest, f)],
    ["attrs", debug_ArgAttributes(v.attrs, f)],
  ]);
/** derive(Clone) */
export function clone_CastTarget(v: CastTarget): CastTarget {
  return new CastTarget([...v.prefix], v.rest_offset, v.rest, clone_ArgAttributes(v.attrs));
}

// impl From<Reg> for CastTarget
// rustc: compiler/rustc_target/src/callconv/mod.rs:302 from
export function CastTarget_from_Reg(unit: Reg): CastTarget {
  return CastTarget_from_Uniform(Uniform_from_Reg(unit));
}

// impl From<Uniform> for CastTarget
// rustc: compiler/rustc_target/src/callconv/mod.rs:308 from
export function CastTarget_from_Uniform(uniform: Uniform): CastTarget {
  return CastTarget.prefixed(/* Default::default() */ [], uniform);
}

/** PORT: the `T: Into<CastTarget>` parameters (header). */
export type IntoCastTarget = Reg | Uniform | CastTarget;
/** `target.into()` for an `IntoCastTarget`. */
export function into_CastTarget(target: IntoCastTarget): CastTarget {
  if (target instanceof CastTarget) return target;
  if (target instanceof Uniform) return CastTarget_from_Uniform(target);
  return CastTarget_from_Reg(target);
}

/// Information about how to pass an argument to,
/// or return a value from, a function, under some ABI.
// #[derive(Clone, PartialEq, Eq, Hash, StableHash)]
export class ArgAbi<Ty> {
  constructor(
    public layout: TyAndLayout<Ty>,
    public mode: PassMode,
  ) {}

  /// This defines the "default ABI" for that type, that is then later adjusted in `fn_abi_adjust_for_abi`.
  // rustc: compiler/rustc_target/src/callconv/mod.rs:409 new
  static new<Ty>(layout: TyAndLayout<Ty>, scalar_attrs: (scalar: Scalar, offset: Size) => ArgAttributes): ArgAbi<Ty> {
    let mode: PassMode;
    const backend_repr = layout.backend_repr;
    if (layout.is_zst()) {
      mode = PassMode.Ignore;
    } else {
      switch (backend_repr.$) {
        case "Scalar":
          mode = { $: "Direct", _0: scalar_attrs(backend_repr._0, Size.ZERO) };
          break;
        case "ScalarPair":
          mode = { $: "Pair", _0: scalar_attrs(backend_repr.a, Size.ZERO), _1: scalar_attrs(backend_repr.b, backend_repr.b_offset) };
          break;
        case "SimdVector":
          mode = { $: "Direct", _0: ArgAttributes.new() };
          break;
        case "Memory":
          mode = ArgAbi.indirect_pass_mode(layout);
          break;
        case "SimdScalableVector":
          mode = { $: "Direct", _0: ArgAttributes.new() };
          break;
      }
    }
    return new ArgAbi(layout, mode);
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:426 indirect_pass_mode
  private static indirect_pass_mode<Ty>(layout: TyAndLayout<Ty>): PassMode {
    const attrs = ArgAttributes.new();

    // For non-immediate arguments the callee gets its own copy of
    // the value on the stack, so there are no aliases. The function
    // can capture the address of the argument, but not the provenance.
    attrs
      .set(ArgAttribute.NoAlias)
      .set(ArgAttribute.CapturesAddress)
      .set(ArgAttribute.NonNull)
      .set(ArgAttribute.NoUndef)
      .set(ArgAttribute.NoFree);
    attrs.pointee_size = layout.size;
    attrs.pointee_align = layout.align.abi;

    if (layout.is_unsized()) {
      return { $: "IndirectUnsized", attrs, meta_attrs: ArgAttributes.new() };
    } else {
      return { $: "Indirect", attrs, address_space: undefined, mode: IndirectMode.Pointer };
    }
  }

  /// Pass this argument indirectly, by passing a (thin or wide) pointer to the argument instead.
  /// This is valid for both sized and unsized arguments.
  // #[track_caller]
  // rustc: compiler/rustc_target/src/callconv/mod.rs:451 make_indirect
  make_indirect(): void {
    const mode = this.mode;
    if (mode.$ === "Direct" || mode.$ === "Pair") {
      this.mode = ArgAbi.indirect_pass_mode(this.layout);
    } else if ((mode.$ === "Indirect" && mode.mode === "Pointer") || mode.$ === "IndirectUnsized") {
      // already indirect
    } else {
      panic(`Tried to make ${debug_PassMode(this.mode, PLAIN)} indirect`);
    }
  }

  /// Pass this argument indirectly, by passing a (thin or wide) pointer to the argument instead.
  /// This is valid for both sized and unsized arguments.
  // #[track_caller]
  // rustc: compiler/rustc_target/src/callconv/mod.rs:467 make_indirect_addrspace
  make_indirect_addrspace(addrspace: AddressSpace): void {
    this.make_indirect();
    const mode = this.mode;
    if (mode.$ === "Indirect") {
      mode.address_space = addrspace;
    } else {
      unreachable();
    }
  }

  /// Same as `make_indirect`, but for arguments that are ignored. Only needed for ABIs that pass
  /// ZSTs indirectly.
  // #[track_caller]
  // rustc: compiler/rustc_target/src/callconv/mod.rs:480 make_indirect_from_ignore
  make_indirect_from_ignore(): void {
    const mode = this.mode;
    if (mode.$ === "Ignore") {
      this.mode = ArgAbi.indirect_pass_mode(this.layout);
    } else if ((mode.$ === "Indirect" && mode.mode === "Pointer") || mode.$ === "IndirectUnsized") {
      // already indirect
    } else {
      panic(`Tried to make ${debug_PassMode(this.mode, PLAIN)} indirect (expected \`PassMode::Ignore\`)`);
    }
  }

  /// Pass this argument indirectly, by placing it at a fixed stack offset.
  /// This corresponds to the `byval` LLVM argument attribute.
  /// This is only valid for sized arguments.
  ///
  /// `byval_align` specifies the alignment of the `byval` stack slot, which does not need to
  /// correspond to the type's alignment. This will be `Some` if the target's ABI specifies that
  /// stack slots used for arguments passed by-value have specific alignment requirements which
  /// differ from the alignment used in other situations.
  ///
  /// If `None`, the type's alignment is used.
  ///
  /// If the resulting alignment differs from the type's alignment,
  /// the argument will be copied to an alloca with sufficient alignment,
  /// either in the caller (if the type's alignment is lower than the byval alignment)
  /// or in the callee (if the type's alignment is higher than the byval alignment),
  /// to ensure that Rust code never sees an underaligned pointer.
  // rustc: compiler/rustc_target/src/callconv/mod.rs:509 pass_by_stack_offset
  pass_by_stack_offset(byval_align: Align | undefined): void {
    assert(!this.layout.is_unsized(), "used byval ABI for unsized layout");
    this.make_indirect();
    const mode = this.mode;
    if (mode.$ === "Indirect") {
      const attrs = mode.attrs;
      mode.mode = IndirectMode.OnStack;

      // Some platforms, like 32-bit x86, change the alignment of the type when passing
      // `byval`. Account for that.
      if (byval_align !== undefined) {
        // On all targets with byval align this is currently true, so let's assert it.
        // debug_assert!(byval_align >= Align::from_bytes(4).unwrap());
        attrs.pointee_align = byval_align;
      }
    } else {
      unreachable();
    }
  }

  /// Pass this argument indirectly.
  /// This corresponds to the `byref` LLVM argument attribute.
  ///
  /// `address_space` specifies the address space of the passed pointer.
  // rustc: compiler/rustc_target/src/callconv/mod.rs:532 pass_amdgpu_kernel_arg
  pass_amdgpu_kernel_arg(addrspace: AddressSpace | undefined): void {
    assert(!this.layout.is_unsized(), "used amdgpu kernel arg ABI for unsized layout");
    this.make_indirect();
    const mode = this.mode;
    if (mode.$ === "Indirect") {
      mode.mode = IndirectMode.AmdgpuKernelArg;
      mode.address_space = addrspace;
    } else {
      unreachable();
    }
  }

  // PORT: `bits: u64` is a `number` (bit widths).
  // rustc: compiler/rustc_target/src/callconv/mod.rs:544 extend_integer_width_to
  extend_integer_width_to(bits: number): void {
    // Only integers have signedness
    const backend_repr = this.layout.backend_repr;
    if (backend_repr.$ === "Scalar") {
      const scalar = backend_repr._0;
      const primitive = Scalar.primitive(scalar);
      if (
        primitive.$ === "Int" &&
        // bools are i1 but their primitive is i8. Unlike other types,
        // bools can be extended to their primitive size.
        (Integer.size(primitive._0).bits() < bits || BackendReprC.is_bool(this.layout.backend_repr))
      ) {
        const signed = primitive._1;
        const mode = this.mode;
        if (mode.$ === "Direct") {
          const attrs = mode._0;
          if (signed) {
            attrs.ext(ArgExtension.Sext);
          } else {
            attrs.ext(ArgExtension.Zext);
          }
        }
      }
    }
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:561 cast_to
  cast_to(target: IntoCastTarget): void {
    this.mode = { $: "Cast", cast: into_CastTarget(target), pad_i32_count: 0 };
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:565 cast_to_with_attrs
  cast_to_with_attrs(target: IntoCastTarget, attrs: ArgAttributes): void {
    this.mode = { $: "Cast", cast: into_CastTarget(target).with_attrs(attrs), pad_i32_count: 0 };
  }

  /// Cast to `target`, forwarding `NoUndef` only when the layout provably has no uninit
  /// bytes *and* the cast exactly covers the layout (`target.size(cx) == self.layout.size`).
  /// A wider cast (e.g. `Uniform::new` rounding a 3-byte aggregate up to an `i32`) covers
  /// undef padding bytes that must not be marked `noundef`; a narrower cast does not occur,
  /// since a `PassMode::Cast` target always covers the whole value.
  // rustc: compiler/rustc_target/src/callconv/mod.rs:575 cast_to_maybe_noundef
  cast_to_maybe_noundef(target_: IntoCastTarget, cx: HasDataLayout): void {
    const target = into_CastTarget(target_);
    let attr: ArgAttribute;
    if (layout_is_noundef(this.layout, cx) && target.size(cx).bytes() === this.layout.size.bytes()) {
      attr = ArgAttribute.NoUndef;
    } else {
      attr = /* ArgAttribute::default() */ 0 as ArgAttribute;
    }
    this.cast_to_with_attrs(target, ArgAttributes_from_ArgAttribute(attr));
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:590 cast_to_and_pad_i32
  cast_to_and_pad_i32(target: IntoCastTarget, pad_i32_count: number): void {
    this.mode = { $: "Cast", cast: into_CastTarget(target), pad_i32_count };
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:594 is_indirect
  is_indirect(): boolean {
    return this.mode.$ === "Indirect" || this.mode.$ === "IndirectUnsized";
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:598 is_sized_indirect
  is_sized_indirect(): boolean {
    return this.mode.$ === "Indirect";
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:602 is_unsized_indirect
  is_unsized_indirect(): boolean {
    return this.mode.$ === "IndirectUnsized";
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:606 is_ignore
  is_ignore(): boolean {
    return this.mode.$ === "Ignore";
  }

  /// Checks if these two `ArgAbi` are equal enough to be considered "the same for all
  /// function call ABIs".
  // rustc: compiler/rustc_target/src/callconv/mod.rs:612 eq_abi
  eq_abi(other: ArgAbi<Ty>): boolean {
    // Ideally we'd just compare the `mode`, but that is not enough -- for some modes LLVM will look
    // at the type.
    return (
      this.layout.eq_abi(other.layout.deref()) &&
      PassMode.eq_abi(this.mode, other.mode) &&
      (() => {
        // `fn_arg_sanity_check` accepts `PassMode::Direct` for some aggregates.
        // That elevates any type difference to an ABI difference since we just use the
        // full Rust type as the LLVM argument/return type.
        if (this.mode.$ === "Direct" && this.layout.backend_repr.$ === "Memory") {
          // For aggregates in `Direct` mode to be compatible, the types need to be equal.
          return this.layout.ty === other.layout.ty;
        } else {
          return true;
        }
      })()
    );
  }
}

// Needs to be a custom impl because of the bounds on the `TyAndLayout` debug impl.
// impl<'a, Ty: fmt::Display> fmt::Debug for ArgAbi<'a, Ty>
// rustc: compiler/rustc_target/src/callconv/mod.rs:401 fmt
export function debug_ArgAbi<Ty>(self: ArgAbi<Ty>, f: Fmt, display_Ty: (ty: Ty) => string): string {
  const { layout, mode } = self;
  return debug_struct(f, "ArgAbi", [
    ["layout", debug_TyAndLayout(layout, f, display_Ty)],
    ["mode", debug_PassMode(mode, f)],
  ]);
}
/** derive(Clone) */
export function clone_ArgAbi<Ty>(v: ArgAbi<Ty>): ArgAbi<Ty> {
  return new ArgAbi(v.layout, clone_PassMode(v.mode));
}

// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, StableHash)]
export type RiscvInterruptKind = "Machine" | "Supervisor";
export const RiscvInterruptKind = {
  Machine: "Machine",
  Supervisor: "Supervisor",

  // rustc: compiler/rustc_target/src/callconv/mod.rs:641 as_str
  as_str(self: RiscvInterruptKind): string {
    switch (self) {
      case "Machine":
        return "machine";
      case "Supervisor":
        return "supervisor";
    }
  },
} as const;
// derive(Debug)
export const debug_RiscvInterruptKind: Debug<RiscvInterruptKind> = (v) => v;

/// Metadata describing how the arguments to a native function
/// should be passed in order to respect the native ABI.
///
/// The signature represented by this type may not match the MIR function signature.
/// Certain attributes, like `#[track_caller]` can introduce additional arguments, which are present in [`FnAbi`], but not in `FnSig`.
/// The std::offload module also adds an addition dyn_ptr argument to the GpuKernel ABI.
/// While this difference is rarely relevant, it should still be kept in mind.
///
/// I will do my best to describe this structure, but these
/// comments are reverse-engineered and may be inaccurate. -NDM
// #[derive(Clone, PartialEq, Eq, Hash, StableHash)]
export class FnAbi<Ty> {
  constructor(
    /// The type, layout, and information about how each argument is passed.
    public args: ArgAbi<Ty>[],

    /// The layout, type, and the way a value is returned from this function.
    public ret: ArgAbi<Ty>,

    /// Marks this function as variadic (accepting a variable number of arguments).
    public c_variadic: boolean,

    /// The count of non-variadic arguments.
    ///
    /// Should only be different from args.len() when c_variadic is true.
    /// This can be used to know whether an argument is variadic or not.
    public fixed_count: number,
    /// The calling convention of this function.
    public conv: CanonAbi,
    /// Indicates if an unwind may happen across a call to this function.
    public can_unwind: boolean,
  ) {}

  // rustc: compiler/rustc_target/src/callconv/mod.rs:697 adjust_for_foreign_abi
  adjust_for_foreign_abi(cx: HasDataLayout & HasTargetSpec & HasX86AbiOpt, abi: ExternAbi): void {
    if (ExternAbi.eq(abi, ExternAbi.X86Interrupt)) {
      const arg = this.args[0];
      if (arg !== undefined) {
        arg.pass_by_stack_offset(undefined);
      }
      return;
    }

    const spec = cx.target_spec();
    const arch = spec.arch;
    switch (arch.$) {
      case "X86":
        // let flavor = match abi { .. x86::Flavor .. }; let reg_struct_return = ..; let opts = x86::X86Options { .. };
        // if spec.is_like_msvc { x86_win32::compute_abi_info(cx, self, opts) } else { x86::compute_abi_info(cx, self, opts) }
        return unported("rustc_target::callconv::x86::compute_abi_info / x86_win32::compute_abi_info (lane fn-abi: x86_64 only)");
      case "X86_64":
        switch (abi.$) {
          case "SysV64":
            return x86_64.compute_abi_info(cx, this);
          case "Win64":
          case "Vectorcall":
            return x86_win64.compute_abi_info(cx, this);
          default:
            if (cx.target_spec().is_like_windows) {
              return x86_win64.compute_abi_info(cx, this);
            } else {
              return x86_64.compute_abi_info(cx, this);
            }
        }
      case "AArch64":
      case "Arm64EC":
        // let kind = if is_like_darwin { DarwinPCS } else if is_like_windows { Win64 } else { AAPCS };
        return unported("rustc_target::callconv::aarch64::compute_abi_info (lane fn-abi: x86_64 only)");
      case "AmdGpu":
        return unported("rustc_target::callconv::amdgpu::compute_abi_info (lane fn-abi: x86_64 only)");
      case "Arm":
        return unported("rustc_target::callconv::arm::compute_abi_info (lane fn-abi: x86_64 only)");
      case "Avr":
        return unported("rustc_target::callconv::avr::compute_abi_info (lane fn-abi: x86_64 only)");
      case "LoongArch32":
      case "LoongArch64":
        return unported("rustc_target::callconv::loongarch::compute_abi_info (lane fn-abi: x86_64 only)");
      case "M68k":
        return unported("rustc_target::callconv::m68k::compute_abi_info (lane fn-abi: x86_64 only)");
      case "CSky":
        return unported("rustc_target::callconv::csky::compute_abi_info (lane fn-abi: x86_64 only)");
      case "Mips":
      case "Mips32r6":
        return unported("rustc_target::callconv::mips::compute_abi_info (lane fn-abi: x86_64 only)");
      case "Mips64":
      case "Mips64r6":
        return unported("rustc_target::callconv::mips64::compute_abi_info (lane fn-abi: x86_64 only)");
      case "PowerPC":
        return unported("rustc_target::callconv::powerpc::compute_abi_info (lane fn-abi: x86_64 only)");
      case "PowerPC64":
        return unported("rustc_target::callconv::powerpc64::compute_abi_info (lane fn-abi: x86_64 only)");
      case "S390x":
        return unported("rustc_target::callconv::s390x::compute_abi_info (lane fn-abi: x86_64 only)");
      case "Msp430":
        return unported("rustc_target::callconv::msp430::compute_abi_info (lane fn-abi: x86_64 only)");
      case "Sparc":
        return unported("rustc_target::callconv::sparc::compute_abi_info (lane fn-abi: x86_64 only)");
      case "Sparc64":
        return unported("rustc_target::callconv::sparc64::compute_abi_info (lane fn-abi: x86_64 only)");
      case "Nvptx64":
        if (ExternAbi.eq(abi, ExternAbi.PtxKernel) || ExternAbi.eq(abi, ExternAbi.GpuKernel)) {
          return unported("rustc_target::callconv::nvptx64::compute_ptx_kernel_abi_info (lane fn-abi: x86_64 only)");
        } else {
          return unported("rustc_target::callconv::nvptx64::compute_abi_info (lane fn-abi: x86_64 only)");
        }
      case "Hexagon":
        return unported("rustc_target::callconv::hexagon::compute_abi_info (lane fn-abi: x86_64 only)");
      case "Xtensa":
        return unported("rustc_target::callconv::xtensa::compute_abi_info (lane fn-abi: x86_64 only)");
      case "RiscV32":
      case "RiscV64":
        return unported("rustc_target::callconv::riscv::compute_abi_info (lane fn-abi: x86_64 only)");
      case "Wasm32":
      case "Wasm64":
        return unported("rustc_target::callconv::wasm::compute_abi_info (lane fn-abi: x86_64 only)");
      case "Bpf":
        return unported("rustc_target::callconv::bpf::compute_abi_info (lane fn-abi: x86_64 only)");
      case "SpirV":
      case "Other":
        return panic(`no lowering implemented for ${Arch.display(arch)}`);
    }
  }

  // rustc: compiler/rustc_target/src/callconv/mod.rs:784 adjust_for_rust_abi
  adjust_for_rust_abi(cx: HasDataLayout & HasTargetSpec): void {
    const spec = cx.target_spec();
    switch (spec.arch.$) {
      case "X86":
        return unported("rustc_target::callconv::x86::compute_rust_abi_info (lane fn-abi: x86_64 only)");
      case "RiscV32":
      case "RiscV64":
        return unported("rustc_target::callconv::riscv::compute_rust_abi_info (lane fn-abi: x86_64 only)");
      case "LoongArch32":
      case "LoongArch64":
        return unported("rustc_target::callconv::loongarch::compute_rust_abi_info (lane fn-abi: x86_64 only)");
      case "AArch64":
        return unported("rustc_target::callconv::aarch64::compute_rust_abi_info (lane fn-abi: x86_64 only)");
      case "Bpf":
        return unported("rustc_target::callconv::bpf::compute_rust_abi_info (lane fn-abi: x86_64 only)");
      default:
        break;
    }

    // Decides whether we can pass the given SIMD argument via `PassMode::Direct`.
    // May only return `true` if the target will always pass those arguments the same way,
    // no matter what the user does with `-Ctarget-feature`! In other words, whatever
    // target features are required to pass a SIMD value in registers must be listed in
    // the `abi_required_features` for the current target and ABI.
    const can_pass_simd_directly = (arg: ArgAbi<Ty>): boolean => {
      // On x86, if we have SSE2 (which we have by default for x86_64), we can always pass up
      // to 128-bit-sized vectors.
      if (spec.arch.$ === "X86" && spec.rustc_abi === "X86Sse2") {
        return arg.layout.size.bits() <= 128;
      } else if (spec.arch.$ === "X86_64" && spec.rustc_abi !== "Softfloat") {
        // x86-64 non-softfloat targets all require SSE2 so we can use SSE registers.
        return arg.layout.size.bits() <= 128;
      } else {
        // So far, we haven't implemented this logic for any other target.
        return false;
      }
    };

    const all: [number | undefined, ArgAbi<Ty>][] = [...this.args.map((arg, idx): [number | undefined, ArgAbi<Ty>] => [idx, arg]), [undefined, this.ret]];
    for (const [arg_idx, arg] of all) {
      // If the logic above already picked a specific type to cast the argument to, leave that
      // in place.
      if (arg.mode.$ === "Ignore" || arg.mode.$ === "Cast") {
        continue;
      }

      // Always extend `bool` in the Rust ABI
      const extend_bool = (attrs: ArgAttributes, scalar: Scalar): void => {
        if (Scalar.is_bool(scalar)) {
          attrs.ext(ArgExtension.Zext);
        }
      };

      const mode = arg.mode;
      const repr: BackendRepr = arg.layout.backend_repr;
      if (mode.$ === "Direct" && repr.$ === "Scalar") {
        extend_bool(mode._0, repr._0);
      } else if (mode.$ === "Pair" && repr.$ === "ScalarPair") {
        extend_bool(mode._0, repr.a);
        extend_bool(mode._1, repr.b);
      }

      if (
        arg_idx === undefined &&
        arg.layout.size.bytes() > Primitive.size({ $: "Pointer", _0: AddressSpace.ZERO }, cx).mul(2).bytes() &&
        !(arg.layout.backend_repr.$ === "SimdVector" || arg.layout.backend_repr.$ === "SimdScalableVector")
      ) {
        // Return values larger than 2 registers using a return area
        // pointer. LLVM and Cranelift disagree about how to return
        // values that don't fit in the registers designated for return
        // values. LLVM will force the entire return value to be passed
        // by return area pointer, while Cranelift will look at each IR level
        // return value independently and decide to pass it in a
        // register or not, which would result in the return value
        // being passed partially in registers and partially through a
        // return area pointer. For large IR-level values such as `i128`,
        // cranelift will even split up the value into smaller chunks.
        //
        // While Cranelift may need to be fixed as the LLVM behavior is
        // generally more correct with respect to the surface language,
        // forcing this behavior in rustc itself makes it easier for
        // other backends to conform to the Rust ABI and for the C ABI
        // rustc already handles this behavior anyway.
        //
        // In addition LLVM's decision to pass the return value in
        // registers or using a return area pointer depends on how
        // exactly the return type is lowered to an LLVM IR type. For
        // example `Option<u128>` can be lowered as `{ i128, i128 }`
        // in which case the x86_64 backend would use a return area
        // pointer, or it could be passed as `{ i32, i128 }` in which
        // case the x86_64 backend would pass it in registers by taking
        // advantage of an LLVM ABI extension that allows using 3
        // registers for the x86_64 sysv call conv rather than the
        // officially specified 2 registers.
        //
        // FIXME: Technically we should look at the amount of available
        // return registers rather than guessing that there are 2
        // registers for return values. In practice only a couple of
        // architectures have less than 2 return registers. None of
        // which supported by Cranelift.
        //
        // NOTE: This adjustment is only necessary for the Rust ABI as
        // for other ABI's the calling convention implementations in
        // rustc_target already ensure any return value which doesn't
        // fit in the available amount of return registers is passed in
        // the right way for the current target.
        //
        // The adjustment is not necessary nor desired for types with a vector
        // representation; those are handled below.
        arg.make_indirect();
        continue;
      }

      switch (arg.layout.backend_repr.$) {
        case "Memory": {
          // Compute `Aggregate` ABI.

          const m = arg.mode;
          const is_indirect_not_on_stack = (m.$ === "Indirect" && m.mode === "Pointer") || m.$ === "IndirectUnsized";
          assert(is_indirect_not_on_stack, "assertion failed: is_indirect_not_on_stack");

          const size = arg.layout.size;
          if (arg.layout.is_sized() && size.bytes() <= Primitive.size({ $: "Pointer", _0: AddressSpace.ZERO }, cx).bytes()) {
            // We want to pass small aggregates as immediates, but using
            // an LLVM aggregate type for this leads to bad optimizations,
            // so we pick an appropriately sized integer type instead.
            arg.cast_to_maybe_noundef(new Reg(/* kind */ { $: "Integer" }, size), cx);
          } else if (this.conv.$ === "RustTail" && arg_idx !== undefined) {
            assert(arg.layout.is_sized(), 'extern "tail" arguments must be sized');
            arg.pass_by_stack_offset(undefined);
          }
          break;
        }

        case "SimdVector": {
          // This is a fun case! The gist of what this is doing is
          // that we want callers and callees to always agree on the
          // ABI of how they pass SIMD arguments. If we were to *not*
          // make these arguments indirect then they'd be immediates
          // in LLVM, which means that they'd used whatever the
          // appropriate ABI is for the callee and the caller. That
          // means, for example, if the caller doesn't have AVX
          // enabled but the callee does, then passing an AVX argument
          // across this boundary would cause corrupt data to show up.
          //
          // This problem is fixed by passing most SIMD arguments through memory between
          // callers and callees which should get them all to agree on ABI regardless of
          // target feature sets, except for those that rely on target features that we
          // know to be always available. Some more information about this issue can be
          // found in #44367 and the comment on `can_pass_simd_directly`.
          if (spec.simd_types_indirect && !can_pass_simd_directly(arg)) {
            arg.make_indirect();
          }
          break;
        }

        default:
          break;
      }
    }
  }
}

// Needs to be a custom impl because of the bounds on the `TyAndLayout` debug impl.
// impl<'a, Ty: fmt::Display> fmt::Debug for FnAbi<'a, Ty>
// rustc: compiler/rustc_target/src/callconv/mod.rs:683 fmt
export function debug_FnAbi<Ty>(self: FnAbi<Ty>, f: Fmt, display_Ty: (ty: Ty) => string): string {
  const { args, ret, c_variadic, fixed_count, conv, can_unwind } = self;
  return debug_struct(f, "FnAbi", [
    ["args", debug_vec(args, f, (a, f) => debug_ArgAbi(a, f, display_Ty))],
    ["ret", debug_ArgAbi(ret, f, display_Ty)],
    ["c_variadic", debug_bool(c_variadic, f)],
    ["fixed_count", debug_int(fixed_count, f)],
    ["conv", debug_CanonAbi(conv, f)],
    ["can_unwind", debug_bool(can_unwind, f)],
  ]);
}
/** derive(Clone) (deep: header). */
export function clone_FnAbi<Ty>(v: FnAbi<Ty>): FnAbi<Ty> {
  return new FnAbi(v.args.map(clone_ArgAbi), clone_ArgAbi(v.ret), v.c_variadic, v.fixed_count, v.conv, v.can_unwind);
}

/// Determines whether `layout` contains no uninit bytes (no padding, no unions),
/// using only the computed layout.
///
/// Conservative: returns `false` for anything it cannot prove fully initialized,
/// including multi-variant enums and SIMD vectors.
// FIXME: extend to multi-variant enums (per-variant padding analysis needed).
// rustc: compiler/rustc_target/src/callconv/mod.rs:958 layout_is_noundef
function layout_is_noundef<Ty>(layout: TyAndLayout<Ty>, cx: HasDataLayout): boolean {
  const backend_repr = layout.backend_repr;
  switch (backend_repr.$) {
    case "Scalar":
      return !Scalar.is_uninit_valid(backend_repr._0);
    case "ScalarPair": {
      const s1 = backend_repr.a;
      const s2 = backend_repr.b;
      return (
        !Scalar.is_uninit_valid(s1) &&
        !Scalar.is_uninit_valid(s2) &&
        // Ensure there is no padding.
        Scalar.size(s1, cx).add(Scalar.size(s2, cx)).bytes() === layout.size.bytes()
      );
    }
    case "Memory": {
      const fields = layout.fields;
      switch (fields.$) {
        case "Primitive":
        case "Union":
          return false;
        // Array elements are at stride offsets with no inter-element gaps.
        case "Array":
          return fields.count === 0n || layout_is_noundef(layout.field(cx, 0), cx);
        case "Arbitrary":
          // With `Variants::Multiple`, `layout.fields` only covers shared
          // bytes (niche/discriminant); per-variant data is absent, so
          // full coverage cannot be proven.
          return layout.variants.$ === "Single" && fields_are_noundef(layout, cx);
      }
      break;
    }
    case "SimdVector":
    case "SimdScalableVector":
      return false;
  }
}

/// Returns `true` if the fields of `layout` contiguously cover bytes `0..layout.size`
/// with no padding gaps and each field is recursively `layout_is_noundef`.
// rustc: compiler/rustc_target/src/callconv/mod.rs:990 fields_are_noundef
function fields_are_noundef<Ty>(layout: TyAndLayout<Ty>, cx: HasDataLayout): boolean {
  let cursor = Size.ZERO;
  for (const i of FieldsShape.index_by_increasing_offset(layout.fields)) {
    const field = layout.field(cx, i);
    if (field.size.bytes() === Size.ZERO.bytes()) {
      continue;
    }
    if (FieldsShape.offset(layout.fields, i).bytes() !== cursor.bytes()) {
      return false;
    }
    if (!layout_is_noundef(field, cx)) {
      return false;
    }
    cursor = cursor.add(field.size);
  }
  return cursor.bytes() === layout.size.bytes();
}

// Some types are used a lot. Make sure they don't unintentionally get bigger.
// #[cfg(target_pointer_width = "64")] mod size_asserts { .. }  (static_assert_size!: no TS counterpart)
