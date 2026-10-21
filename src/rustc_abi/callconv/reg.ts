// Port of compiler/rustc_abi/src/callconv/reg.rs (lane layout-contract: the types with their Debug; lane abi-lib: the
// fns and the `reg_ctor!` constructors).
// Init order: lib.ts re-exports this module (through callconv.ts), so its top-level code must not touch lib.ts's values.
import { type Debug, debug_struct, PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { type Align, debug_Primitive, debug_Size, type HasDataLayout, type Primitive, Primitive_eq, Size } from "../lib.ts";

// #[cfg_attr(feature = "nightly", derive(StableHash))]
// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
export type RegKind =
  | { readonly $: "Integer" }
  | { readonly $: "Float" }
  | { readonly $: "PpcF128" }
  | { readonly $: "Vector"; readonly hint_vector_elem: Primitive };
export const RegKind = {
  Integer: Object.freeze({ $: "Integer" }) as RegKind,
  Float: Object.freeze({ $: "Float" }) as RegKind,
  PpcF128: Object.freeze({ $: "PpcF128" }) as RegKind,

  // rustc: compiler/rustc_abi/src/callconv/reg.rs:26 from_primitive
  from_primitive(primitive: Primitive): RegKind {
    switch (primitive.$) {
      case "Int":
      case "Pointer":
        return RegKind.Integer;
      case "Float":
        if (primitive._0 === "PpcF128") return RegKind.PpcF128;
        // Primitive::Float(Float::F16 | Float::F16B | Float::F32 | Float::F64 | Float::F128)
        return RegKind.Float;
    }
  },
} as const;
/** derive(PartialEq) */
export function RegKind_eq(a: RegKind, b: RegKind): boolean {
  if (a.$ === "Vector") return b.$ === "Vector" && Primitive_eq(a.hint_vector_elem, b.hint_vector_elem);
  return a.$ === b.$;
}
// derive(Debug)
export const debug_RegKind: Debug<RegKind> = (v, f) => {
  switch (v.$) {
    case "Integer":
      return "Integer";
    case "Float":
      return "Float";
    case "PpcF128":
      return "PpcF128";
    case "Vector":
      return debug_struct(f, "Vector", [["hint_vector_elem", debug_Primitive(v.hint_vector_elem, f)]]);
  }
};

/// A combination of a [`RegKind`] and a [`Size`] that represents a builtin type in the backend.
// #[cfg_attr(feature = "nightly", derive(StableHash))]
// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
// PORT (layout-contract): a struct with an inherent impl is a class.
// PORT (abi-lib): the `reg_ctor!` constructors (`Reg::i8()`, .., `Reg::f128()`) are statics, written out (macro
// expansion; not fns of the coverage table).
export class Reg {
  constructor(
    readonly kind: RegKind,
    readonly size: Size,
  ) {}

  // reg_ctor!(i8, Integer, 8);
  static i8(): Reg {
    return new Reg(RegKind.Integer, Size.from_bits(8));
  }
  // reg_ctor!(i16, Integer, 16);
  static i16(): Reg {
    return new Reg(RegKind.Integer, Size.from_bits(16));
  }
  // reg_ctor!(i32, Integer, 32);
  static i32(): Reg {
    return new Reg(RegKind.Integer, Size.from_bits(32));
  }
  // reg_ctor!(i64, Integer, 64);
  static i64(): Reg {
    return new Reg(RegKind.Integer, Size.from_bits(64));
  }
  // reg_ctor!(i128, Integer, 128);
  static i128(): Reg {
    return new Reg(RegKind.Integer, Size.from_bits(128));
  }

  // reg_ctor!(f16, Float, 16);
  static f16(): Reg {
    return new Reg(RegKind.Float, Size.from_bits(16));
  }
  // reg_ctor!(f32, Float, 32);
  static f32(): Reg {
    return new Reg(RegKind.Float, Size.from_bits(32));
  }
  // reg_ctor!(f64, Float, 64);
  static f64(): Reg {
    return new Reg(RegKind.Float, Size.from_bits(64));
  }
  // reg_ctor!(f128, Float, 128);
  static f128(): Reg {
    return new Reg(RegKind.Float, Size.from_bits(128));
  }

  /// A vector of the given size with an unknown (and irrelevant) element type.
  // rustc: compiler/rustc_abi/src/callconv/reg.rs:66 opaque_vector
  static opaque_vector(size: Size): Reg {
    // Default to an i8 vector of the given size.
    return new Reg({ $: "Vector", hint_vector_elem: { $: "Int", _0: "I8", _1: true } }, size);
  }

  // rustc: compiler/rustc_abi/src/callconv/reg.rs:73 align
  align(cx: HasDataLayout): Align {
    const dl = cx.data_layout();
    switch (this.kind.$) {
      case "Integer": {
        const bits = this.size.bits();
        if (bits === 1) return dl.i1_align;
        if (2 <= bits && bits <= 8) return dl.i8_align;
        if (9 <= bits && bits <= 16) return dl.i16_align;
        if (17 <= bits && bits <= 32) return dl.i32_align;
        if (33 <= bits && bits <= 64) return dl.i64_align;
        if (65 <= bits && bits <= 128) return dl.i128_align;
        return panic(`unsupported integer: ${debug_Reg(this, PLAIN)}`);
      }
      case "Float":
        switch (this.size.bits()) {
          case 16:
            return dl.f16_align;
          case 32:
            return dl.f32_align;
          case 64:
            return dl.f64_align;
          case 128:
            return dl.f128_align;
          default:
            return panic(`unsupported float: ${debug_Reg(this, PLAIN)}`);
        }
      case "PpcF128":
        return dl.f128_align;
      case "Vector":
        return dl.rust_vector_align(this.size);
    }
  }
}
/** derive(PartialEq) */
export function Reg_eq(a: Reg, b: Reg): boolean {
  return RegKind_eq(a.kind, b.kind) && a.size.raw === b.size.raw;
}
// derive(Debug)
export const debug_Reg: Debug<Reg> = (v, f) =>
  debug_struct(f, "Reg", [
    ["kind", debug_RegKind(v.kind, f)],
    ["size", debug_Size(v.size, f)],
  ]);
