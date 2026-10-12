// Port of compiler/rustc_ast_ir/src/lib.rs
//! Common utilities shared by both `rustc_ast` and `rustc_type_ir`.
//!
//! Don't depend on this crate directly; both of those crates should re-export
//! the functionality. Additionally, if you're in scope of `rustc_middle`, then
//! prefer imports via that too, to avoid needing to directly depend on (e.g.)
//! `rustc_type_ir` for a single import.
//
// Types and derived Debug impls are generated into lib.gen.ts (tools/codegen/types.ts). Enum methods
// live on the companion const (PORTING §8): the companions below extend the generated ones (safe at
// module init: lib.gen.ts is only ever entered through this module).
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import type { Debug } from "../std/fmt.ts";
import { unreachable } from "../std/panic.ts";
import * as gen from "./lib.gen.ts";

export * from "./lib.gen.ts";

export * as visit from "./visit.ts";

export type IntTy = gen.IntTy;
export const IntTy = {
  ...gen.IntTy,

  // rustc: compiler/rustc_ast_ir/src/lib.rs:34 name_str
  name_str(self: IntTy): string {
    switch (self) {
      case "Isize":
        return "isize";
      case "I8":
        return "i8";
      case "I16":
        return "i16";
      case "I32":
        return "i32";
      case "I64":
        return "i64";
      case "I128":
        return "i128";
    }
  },

  // rustc: compiler/rustc_ast_ir/src/lib.rs:46 name
  name(self: IntTy): Symbol {
    switch (self) {
      case "Isize":
        return sym.isize;
      case "I8":
        return sym.i8;
      case "I16":
        return sym.i16;
      case "I32":
        return sym.i32;
      case "I64":
        return sym.i64;
      case "I128":
        return sym.i128;
    }
  },

  // rustc: compiler/rustc_ast_ir/src/lib.rs:57 bit_width
  bit_width(self: IntTy): number | undefined {
    switch (self) {
      case "Isize":
        return undefined;
      case "I8":
        return 8;
      case "I16":
        return 16;
      case "I32":
        return 32;
      case "I64":
        return 64;
      case "I128":
        return 128;
    }
  },

  // rustc: compiler/rustc_ast_ir/src/lib.rs:68 normalize
  normalize(self: IntTy, target_width: number): IntTy {
    switch (self) {
      case "Isize":
        switch (target_width) {
          case 16:
            return "I16";
          case 32:
            return "I32";
          case 64:
            return "I64";
          default:
            return unreachable();
        }
      default:
        return self;
    }
  },

  // rustc: compiler/rustc_ast_ir/src/lib.rs:80 to_unsigned
  to_unsigned(self: IntTy): UintTy {
    switch (self) {
      case "Isize":
        return "Usize";
      case "I8":
        return "U8";
      case "I16":
        return "U16";
      case "I32":
        return "U32";
      case "I64":
        return "U64";
      case "I128":
        return "U128";
    }
  },
};

// rustc: compiler/rustc_ast_ir/src/lib.rs:93 fmt
export const debug_IntTy: Debug<IntTy> = (v, _f) => IntTy.name_str(v);

export type UintTy = gen.UintTy;
export const UintTy = {
  ...gen.UintTy,

  // rustc: compiler/rustc_ast_ir/src/lib.rs:110 name_str
  name_str(self: UintTy): string {
    switch (self) {
      case "Usize":
        return "usize";
      case "U8":
        return "u8";
      case "U16":
        return "u16";
      case "U32":
        return "u32";
      case "U64":
        return "u64";
      case "U128":
        return "u128";
    }
  },

  // rustc: compiler/rustc_ast_ir/src/lib.rs:122 name
  name(self: UintTy): Symbol {
    switch (self) {
      case "Usize":
        return sym.usize;
      case "U8":
        return sym.u8;
      case "U16":
        return sym.u16;
      case "U32":
        return sym.u32;
      case "U64":
        return sym.u64;
      case "U128":
        return sym.u128;
    }
  },

  // rustc: compiler/rustc_ast_ir/src/lib.rs:133 bit_width
  bit_width(self: UintTy): number | undefined {
    switch (self) {
      case "Usize":
        return undefined;
      case "U8":
        return 8;
      case "U16":
        return 16;
      case "U32":
        return 32;
      case "U64":
        return 64;
      case "U128":
        return 128;
    }
  },

  // rustc: compiler/rustc_ast_ir/src/lib.rs:144 normalize
  normalize(self: UintTy, target_width: number): UintTy {
    switch (self) {
      case "Usize":
        switch (target_width) {
          case 16:
            return "U16";
          case 32:
            return "U32";
          case 64:
            return "U64";
          default:
            return unreachable();
        }
      default:
        return self;
    }
  },

  // rustc: compiler/rustc_ast_ir/src/lib.rs:156 to_signed
  to_signed(self: UintTy): IntTy {
    switch (self) {
      case "Usize":
        return "Isize";
      case "U8":
        return "I8";
      case "U16":
        return "I16";
      case "U32":
        return "I32";
      case "U64":
        return "I64";
      case "U128":
        return "I128";
    }
  },
};

// rustc: compiler/rustc_ast_ir/src/lib.rs:169 fmt
export const debug_UintTy: Debug<UintTy> = (v, _f) => UintTy.name_str(v);

export type FloatTy = gen.FloatTy;
export const FloatTy = {
  ...gen.FloatTy,

  // rustc: compiler/rustc_ast_ir/src/lib.rs:184 name_str
  name_str(self: FloatTy): string {
    switch (self) {
      case "F16":
        return "f16";
      case "F32":
        return "f32";
      case "F64":
        return "f64";
      case "F128":
        return "f128";
    }
  },

  // rustc: compiler/rustc_ast_ir/src/lib.rs:194 name
  name(self: FloatTy): Symbol {
    switch (self) {
      case "F16":
        return sym.f16;
      case "F32":
        return sym.f32;
      case "F64":
        return sym.f64;
      case "F128":
        return sym.f128;
    }
  },

  // rustc: compiler/rustc_ast_ir/src/lib.rs:203 bit_width
  bit_width(self: FloatTy): number {
    switch (self) {
      case "F16":
        return 16;
      case "F32":
        return 32;
      case "F64":
        return 64;
      case "F128":
        return 128;
    }
  },
};

// rustc: compiler/rustc_ast_ir/src/lib.rs:214 fmt
export const debug_FloatTy: Debug<FloatTy> = (v, _f) => FloatTy.name_str(v);

export type Mutability = gen.Mutability;
export const Mutability = {
  // N.B. Order is deliberate, so that Not < Mut
  ...gen.Mutability,

  // rustc: compiler/rustc_ast_ir/src/lib.rs:239 invert
  invert(self: Mutability): Mutability {
    switch (self) {
      case "Mut":
        return "Not";
      case "Not":
        return "Mut";
    }
  },

  /// Returns `""` (empty string) or `"mut "` depending on the mutability.
  // rustc: compiler/rustc_ast_ir/src/lib.rs:247 prefix_str
  prefix_str(self: Mutability): string {
    switch (self) {
      case "Mut":
        return "mut ";
      case "Not":
        return "";
    }
  },

  /// Returns `"&"` or `"&mut "` depending on the mutability.
  // rustc: compiler/rustc_ast_ir/src/lib.rs:255 ref_prefix_str
  ref_prefix_str(self: Mutability): string {
    switch (self) {
      case "Not":
        return "&";
      case "Mut":
        return "&mut ";
    }
  },

  /// Returns `"const"` or `"mut"` depending on the mutability.
  // rustc: compiler/rustc_ast_ir/src/lib.rs:263 ptr_str
  ptr_str(self: Mutability): string {
    switch (self) {
      case "Not":
        return "const";
      case "Mut":
        return "mut";
    }
  },

  /// Returns `""` (empty string) or `"mutably "` depending on the mutability.
  // rustc: compiler/rustc_ast_ir/src/lib.rs:271 mutably_str
  mutably_str(self: Mutability): string {
    switch (self) {
      case "Not":
        return "";
      case "Mut":
        return "mutably ";
    }
  },

  /// Return `true` if self is mutable
  // rustc: compiler/rustc_ast_ir/src/lib.rs:279 is_mut
  is_mut(self: Mutability): boolean {
    return self === "Mut";
  },

  /// Return `true` if self is **not** mutable
  // rustc: compiler/rustc_ast_ir/src/lib.rs:284 is_not
  is_not(self: Mutability): boolean {
    return self === "Not";
  },
};

// PORT: derived `Ord` for `Mutability` (declaration order, `Not < Mut`), via the generated
// `Mutability_discriminant`. `cmp::min(a, b)` is `Mutability_cmp(b, a) < 0 ? b : a`.
export function Mutability_cmp(a: Mutability, b: Mutability): -1 | 0 | 1 {
  const da = gen.Mutability_discriminant[a];
  const db = gen.Mutability_discriminant[b];
  return da < db ? -1 : da > db ? 1 : 0;
}

export type Pinnedness = gen.Pinnedness;
export const Pinnedness = {
  ...gen.Pinnedness,

  /// Return `true` if self is pinned
  // rustc: compiler/rustc_ast_ir/src/lib.rs:298 is_pinned
  is_pinned(self: Pinnedness): boolean {
    return self === "Pinned";
  },

  /// Returns `""` (empty string), "mut", `"pin mut "` or `"pin const "` depending
  /// on the pinnedness and mutability.
  // rustc: compiler/rustc_ast_ir/src/lib.rs:304 prefix_str
  prefix_str(self: Pinnedness, mutbl: Mutability): string {
    if (self === "Pinned" && mutbl === "Mut") {
      return "pin mut ";
    } else if (self === "Pinned" && mutbl === "Not") {
      return "pin const ";
    } else if (self === "Not" && mutbl === "Mut") {
      return "mut ";
    } else {
      // (Pinnedness::Not, Mutability::Not)
      return "";
    }
  },
};
