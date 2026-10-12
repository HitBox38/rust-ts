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
// module init: lib.gen.ts is only ever entered through this module). Only the fns the manual Debug
// impls need are ported so far.
import type { Debug } from "../std/fmt.ts";
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
};

// rustc: compiler/rustc_ast_ir/src/lib.rs:214 fmt
export const debug_FloatTy: Debug<FloatTy> = (v, _f) => FloatTy.name_str(v);
