// hir.rs fns part 3 (lines 3329-5311), merged into hir.ts by the lane owner.
//
// PORT: (part 3 notes, see hir.ts's header for the placement conventions)
// - HIR nodes are arena-allocated and never edited in place (there is no HIR MutVisitor), so Rust
//   copies of `Copy` HIR objects (`*ut`, `sig.header`, tuples of `&'hir` refs) are identity here.
// - `FnDeclFlags` methods taking `mut self` by value work on a copy (`clone_FnDeclFlags(this)`).
// - Methods whose name clashes with a field of the same struct get a trailing `_`:
//   `FnDeclFlags::splatted()` -> `splatted_()`, `FnHeader::safety()` -> `safety_()`.
// - `expect_methods_self_kind!` / `expect_methods_self!` expansions are written out by hand in
//   upstream order, each marked `// rustc-macro:` at its macro-input line.
import type { ExternAbi } from "../rustc_abi/extern_abi.ts";
import type { IsAuto, MacroDef, Mutability } from "../rustc_ast/lib.ts";
import { FloatTy, IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import { CRATE_HIR_ID, debug_HirId, type HirId, HirId_make_owner, type OwnerId } from "../rustc_hir_id/lib.ts";
import { type DefId, DefId_eq, type LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { type Ident, type Symbol, sym } from "../rustc_span/symbol.ts";
import * as asm from "../rustc_target/asm/mod.ts";
import { is_ascii_digit } from "../std/char.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic, unreachable } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { utf8 } from "../std/str.ts";
import { type CtorKind, debug_Res, type MacroKinds, type PerNS, type Res } from "./def.ts";
import * as gen from "./hir_standin.ts";
import type {
  AnonConst,
  Arm,
  AssocItemConstraint,
  Block,
  BodyId,
  Closure,
  ConstBlock,
  ConstItemRhs,
  DelegationInfo,
  EnumDef,
  Expr,
  ExprField,
  FieldDef,
  FnSig,
  ForeignItem,
  ForeignItemId,
  GenericBounds,
  GenericParam,
  Generics,
  Impl,
  ImplItem,
  ImplRestriction,
  InferArg,
  InlineAsm,
  Item,
  ItemId,
  LetStmt,
  Lifetime,
  Mod,
  OpaqueTy,
  Param,
  Pat,
  PatField,
  PathSegment,
  QPath,
  SplattedArgIndexError,
  Stmt,
  TestBinderBody,
  TraitItem,
  TraitItemId,
  TraitRef,
  Ty,
  UseTree,
  Variant,
  VariantData as VariantDataT,
} from "./hir_standin.ts";
import { FnKind } from "./intravisit.ts";
import { ParamName } from "./hir_part1.ts";
import { expect_failed } from "./hir_part2.ts";

declare module "./hir_standin.ts" {
  interface InlineAsm {
    contains_label(): boolean;
  }
  interface FnDeclFlags {
    set_implicit_self(implicit_self: ImplicitSelfKind): FnDeclFlags;
    set_c_variadic(c_variadic: boolean): FnDeclFlags;
    set_lifetime_elision_allowed(allowed: boolean): FnDeclFlags;
    set_splatted(splatted: number | undefined, args_len: number): Result<FnDeclFlags, SplattedArgIndexError>;
    set_no_splatted_args(): FnDeclFlags;
    implicit_self(): ImplicitSelfKind;
    c_variadic(): boolean;
    lifetime_elision_allowed(): boolean;
    splatted_(): number | undefined;
  }
  interface FnDecl {
    opt_delegation_sig_id(): DefId | undefined;
    opt_delegation_info(): DelegationInfo | undefined;
    implicit_self(): ImplicitSelfKind;
    c_variadic(): boolean;
    lifetime_elision_allowed(): boolean;
    splatted(): number | undefined;
  }
  interface UseTree {
    resolutions(): Generator<PerNS<Res | undefined>, void, undefined>;
  }
  interface TraitRef {
    trait_def_id(): DefId | undefined;
  }
  interface FieldDef {
    is_positional(): boolean;
  }
  interface ItemId {
    hir_id(): HirId;
  }
  interface Item {
    hir_id(): HirId;
    item_id(): ItemId;
    is_adt(): boolean;
    is_struct_or_union(): boolean;
    expect_extern_crate(): [Symbol | undefined, Ident];
    expect_use(): UseTree;
    expect_static(): [Mutability, Ident, Ty, BodyId];
    expect_const(): [Ident, Generics, Ty, ConstItemRhs];
    expect_fn(): [Ident, FnSig, Generics, BodyId];
    expect_macro(): [Ident, MacroDef, MacroKinds];
    expect_mod(): [Ident, Mod];
    expect_foreign_mod(): [ExternAbi, readonly ForeignItemId[]];
    expect_global_asm(): InlineAsm;
    expect_ty_alias(): [Ident, Generics, Ty];
    expect_enum(): [Ident, Generics, EnumDef];
    expect_struct(): [Ident, Generics, VariantDataT];
    expect_union(): [Ident, Generics, VariantDataT];
    expect_trait(): [
      ImplRestriction,
      Constness,
      IsAuto,
      Safety,
      Ident,
      Generics,
      GenericBounds,
      readonly TraitItemId[],
    ];
    expect_trait_alias(): [Constness, Ident, Generics, GenericBounds];
    expect_impl(): Impl;
    expect_test_binder_constraints(): [Generics, TestBinderBody];
  }
  interface FnHeader {
    is_async(): boolean;
    is_unsafe(): boolean;
    is_safe(): boolean;
    safety_(): Safety;
  }
  interface ForeignItemId {
    hir_id(): HirId;
  }
  interface ForeignItem {
    hir_id(): HirId;
    foreign_item_id(): ForeignItemId;
  }
}

export type PrimTy = gen.PrimTy;
export const PrimTy = {
  ...gen.PrimTy,

  /// All of the primitive types
  ALL: [
    // any changes here should also be reflected in `PrimTy::from_name`
    Object.freeze({ $: "Int" as const, _0: IntTy.I8 }),
    Object.freeze({ $: "Int" as const, _0: IntTy.I16 }),
    Object.freeze({ $: "Int" as const, _0: IntTy.I32 }),
    Object.freeze({ $: "Int" as const, _0: IntTy.I64 }),
    Object.freeze({ $: "Int" as const, _0: IntTy.I128 }),
    Object.freeze({ $: "Int" as const, _0: IntTy.Isize }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.U8 }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.U16 }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.U32 }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.U64 }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.U128 }),
    Object.freeze({ $: "Uint" as const, _0: UintTy.Usize }),
    Object.freeze({ $: "Float" as const, _0: FloatTy.F16 }),
    Object.freeze({ $: "Float" as const, _0: FloatTy.F32 }),
    Object.freeze({ $: "Float" as const, _0: FloatTy.F64 }),
    Object.freeze({ $: "Float" as const, _0: FloatTy.F128 }),
    gen.PrimTy.Bool,
    gen.PrimTy.Char,
    gen.PrimTy.Str,
  ] as readonly PrimTy[],

  /// Like [`PrimTy::name`], but returns a &str instead of a symbol.
  ///
  /// Used by clippy.
  // rustc: compiler/rustc_hir/src/hir.rs:3357 name_str
  name_str(self: PrimTy): string {
    switch (self.$) {
      case "Int":
        return IntTy.name_str(self._0);
      case "Uint":
        return UintTy.name_str(self._0);
      case "Float":
        return FloatTy.name_str(self._0);
      case "Str":
        return "str";
      case "Bool":
        return "bool";
      case "Char":
        return "char";
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:3368 name
  name(self: PrimTy): Symbol {
    switch (self.$) {
      case "Int":
        return IntTy.name(self._0);
      case "Uint":
        return UintTy.name(self._0);
      case "Float":
        return FloatTy.name(self._0);
      case "Str":
        return sym.str;
      case "Bool":
        return sym.bool;
      case "Char":
        return sym.char;
    }
  },

  /// Returns the matching `PrimTy` for a `Symbol` such as "str" or "i32".
  /// Returns `None` if no matching type is found.
  // rustc: compiler/rustc_hir/src/hir.rs:3381 from_name
  from_name(name: Symbol): PrimTy | undefined {
    let ty: PrimTy;
    switch (name) {
      // any changes here should also be reflected in `PrimTy::ALL`
      case sym.i8:
        ty = { $: "Int", _0: IntTy.I8 };
        break;
      case sym.i16:
        ty = { $: "Int", _0: IntTy.I16 };
        break;
      case sym.i32:
        ty = { $: "Int", _0: IntTy.I32 };
        break;
      case sym.i64:
        ty = { $: "Int", _0: IntTy.I64 };
        break;
      case sym.i128:
        ty = { $: "Int", _0: IntTy.I128 };
        break;
      case sym.isize:
        ty = { $: "Int", _0: IntTy.Isize };
        break;
      case sym.u8:
        ty = { $: "Uint", _0: UintTy.U8 };
        break;
      case sym.u16:
        ty = { $: "Uint", _0: UintTy.U16 };
        break;
      case sym.u32:
        ty = { $: "Uint", _0: UintTy.U32 };
        break;
      case sym.u64:
        ty = { $: "Uint", _0: UintTy.U64 };
        break;
      case sym.u128:
        ty = { $: "Uint", _0: UintTy.U128 };
        break;
      case sym.usize:
        ty = { $: "Uint", _0: UintTy.Usize };
        break;
      case sym.f16:
        ty = { $: "Float", _0: FloatTy.F16 };
        break;
      case sym.f32:
        ty = { $: "Float", _0: FloatTy.F32 };
        break;
      case sym.f64:
        ty = { $: "Float", _0: FloatTy.F64 };
        break;
      case sym.f128:
        ty = { $: "Float", _0: FloatTy.F128 };
        break;
      case sym.bool:
        ty = gen.PrimTy.Bool;
        break;
      case sym.char:
        ty = gen.PrimTy.Char;
        break;
      case sym.str:
        ty = gen.PrimTy.Str;
        break;
      default:
        return undefined;
    }
    return ty;
  },
};

export type PreciseCapturingArg = gen.PreciseCapturingArg;
export const PreciseCapturingArg = {
  // rustc: compiler/rustc_hir/src/hir.rs:3447 hir_id
  hir_id(self: PreciseCapturingArg): HirId {
    switch (self.$) {
      case "Lifetime":
        return self._0.hir_id;
      case "Param":
        return self._0.hir_id;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:3454 name
  name(self: PreciseCapturingArg): Symbol {
    switch (self.$) {
      case "Lifetime":
        return self._0.ident.name;
      case "Param":
        return self._0.ident.name;
    }
  },
};

export type InlineAsmRegOrRegClass = gen.InlineAsmRegOrRegClass;
export const InlineAsmRegOrRegClass = {
  // For `rustc_mir_build` and `clippy_utils`
  // rustc: compiler/rustc_hir/src/hir.rs:3626 as_target
  as_target(self: InlineAsmRegOrRegClass): asm.InlineAsmRegOrRegClass {
    // PORT: rustc_target's `InlineAsmRegOrRegClass` has no variant constructors; its payloads are
    // interned and its derived `PartialEq` is `asm.InlineAsmRegOrRegClass.eq`, so a fresh object
    // literal is the Rust value.
    switch (self.$) {
      case "Reg":
        return { $: "Reg", _0: self.reg };
      case "RegClass":
        return { $: "RegClass", _0: self._0 };
    }
  },

  // For `rustc_ast_lowering`
  // rustc: compiler/rustc_hir/src/hir.rs:3634 reg_class
  reg_class(self: InlineAsmRegOrRegClass): asm.InlineAsmRegClass {
    return asm.InlineAsmRegOrRegClass.reg_class(InlineAsmRegOrRegClass.as_target(self));
  },

  // For `rustc_ast_lowering`
  // rustc: compiler/rustc_hir/src/hir.rs:3639 source_name
  source_name(self: InlineAsmRegOrRegClass): Symbol | undefined {
    switch (self.$) {
      case "Reg":
        return self.source_name;
      case "RegClass":
        return undefined;
    }
  },
};

// For `rustc_hir_pretty`
// rustc: compiler/rustc_hir/src/hir.rs:3649 fmt
export function display_InlineAsmRegOrRegClass(v: InlineAsmRegOrRegClass): string {
  return asm.InlineAsmRegOrRegClass.display(InlineAsmRegOrRegClass.as_target(v));
}

export type InlineAsmOperand = gen.InlineAsmOperand;
export const InlineAsmOperand = {
  // rustc: compiler/rustc_hir/src/hir.rs:3692 reg
  reg(self: InlineAsmOperand): InlineAsmRegOrRegClass | undefined {
    switch (self.$) {
      case "In":
      case "Out":
      case "InOut":
      case "SplitInOut":
        return self.reg;
      case "Const":
      case "SymFn":
      case "SymStatic":
      case "Label":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:3705 is_clobber
  is_clobber(self: InlineAsmOperand): boolean {
    return self.$ === "Out" && self.reg.$ === "Reg" && self.expr === undefined;
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:3724 contains_label
gen.InlineAsm.prototype.contains_label = function (this: InlineAsm): boolean {
  return this.operands.some((x) => x[0].$ === "Label");
};

export type FnDeclFlags = gen.FnDeclFlags;
// PORT: associated consts and statics of the generated class, attached below in upstream order.
export const FnDeclFlags = gen.FnDeclFlags as typeof gen.FnDeclFlags & {
  IMPLICIT_SELF_MASK: number;
  C_VARIADIC_FLAG: number;
  LIFETIME_ELISION_ALLOWED_FLAG: number;
  NO_SPLATTED_ARG_INDEX: number;
  default: () => FnDeclFlags;
};

/// Mask for the implicit self kind.
FnDeclFlags.IMPLICIT_SELF_MASK = 0b111;

/// Bitflag for a trailing C-style variadic argument.
FnDeclFlags.C_VARIADIC_FLAG = 1 << 3;

/// Bitflag for lifetime elision.
FnDeclFlags.LIFETIME_ELISION_ALLOWED_FLAG = 1 << 4;

/// Marker index for "no splatted argument".
/// Must have the same value as `FnSigKind::NO_SPLATTED_ARG_INDEX` and `rustc_ast::FnDecl::NO_SPLATTED_ARG_INDEX`.
FnDeclFlags.NO_SPLATTED_ARG_INDEX = 0xff; // u8::MAX

/// Create a new FnDeclKind with no implicit self, no lifetime elision, no C-style variadic
/// argument, and no splatting.
/// To modify these flags, use the `set_*` methods, for readability.
// FIXME: use Default instead when that trait is const stable.
// rustc: compiler/rustc_hir/src/hir.rs:3805 default
FnDeclFlags.default = function (): FnDeclFlags {
  return new gen.FnDeclFlags(0, 0)
    .set_implicit_self(ImplicitSelfKind.None)
    .set_lifetime_elision_allowed(false)
    .set_c_variadic(false)
    .set_no_splatted_args();
};

/// Set the implicit self kind.
// rustc: compiler/rustc_hir/src/hir.rs:3815 set_implicit_self
gen.FnDeclFlags.prototype.set_implicit_self = function (this: FnDeclFlags, implicit_self: ImplicitSelfKind): FnDeclFlags {
  const self = gen.clone_FnDeclFlags(this);
  self.flags &= ~FnDeclFlags.IMPLICIT_SELF_MASK & 0xff;

  switch (implicit_self) {
    case "None":
      self.flags |= 0;
      break;
    case "Imm":
      self.flags |= 1;
      break;
    case "Mut":
      self.flags |= 2;
      break;
    case "RefImm":
      self.flags |= 3;
      break;
    case "RefMut":
      self.flags |= 4;
      break;
  }

  return self;
};

/// Set the C-style variadic argument flag.
// rustc: compiler/rustc_hir/src/hir.rs:3831 set_c_variadic
gen.FnDeclFlags.prototype.set_c_variadic = function (this: FnDeclFlags, c_variadic: boolean): FnDeclFlags {
  const self = gen.clone_FnDeclFlags(this);
  if (c_variadic) {
    self.flags |= FnDeclFlags.C_VARIADIC_FLAG;
  } else {
    self.flags &= ~FnDeclFlags.C_VARIADIC_FLAG & 0xff;
  }

  return self;
};

/// Set the lifetime elision allowed flag.
// rustc: compiler/rustc_hir/src/hir.rs:3843 set_lifetime_elision_allowed
gen.FnDeclFlags.prototype.set_lifetime_elision_allowed = function (this: FnDeclFlags, allowed: boolean): FnDeclFlags {
  const self = gen.clone_FnDeclFlags(this);
  if (allowed) {
    self.flags |= FnDeclFlags.LIFETIME_ELISION_ALLOWED_FLAG;
  } else {
    self.flags &= ~FnDeclFlags.LIFETIME_ELISION_ALLOWED_FLAG & 0xff;
  }

  return self;
};

/// Set the splatted argument index.
/// The number of function arguments is used for error checking.
// rustc: compiler/rustc_hir/src/hir.rs:3856 set_splatted
gen.FnDeclFlags.prototype.set_splatted = function (
  this: FnDeclFlags,
  splatted: number | undefined,
  args_len: number,
): Result<FnDeclFlags, SplattedArgIndexError> {
  const self = gen.clone_FnDeclFlags(this);
  if (splatted !== undefined) {
    const splatted_arg_index = splatted;
    if (splatted_arg_index === FnDeclFlags.NO_SPLATTED_ARG_INDEX) {
      // This index value is used as a marker for "no splatting", so it is unsupported.
      // Higher values are also not supported, for performance reasons.
      return Err({ $: "InvalidIndex", splatted_arg_index });
    } else if (splatted_arg_index >= args_len) {
      return Err({
        $: "OutOfBounds",
        splatted_arg_index,
        args_len: args_len & 0xffff, // `args_len as u16`
      });
    }

    self.splatted = splatted_arg_index;
  } else {
    self.splatted = FnDeclFlags.NO_SPLATTED_ARG_INDEX;
  }

  return Ok(self);
};

/// Set "no splatted arguments" for the function declaration.
// rustc: compiler/rustc_hir/src/hir.rs:3883 set_no_splatted_args
gen.FnDeclFlags.prototype.set_no_splatted_args = function (this: FnDeclFlags): FnDeclFlags {
  const self = gen.clone_FnDeclFlags(this);
  self.splatted = FnDeclFlags.NO_SPLATTED_ARG_INDEX;

  return self;
};

/// Get the implicit self kind.
// rustc: compiler/rustc_hir/src/hir.rs:3890 implicit_self
gen.FnDeclFlags.prototype.implicit_self = function (this: FnDeclFlags): ImplicitSelfKind {
  switch (this.flags & FnDeclFlags.IMPLICIT_SELF_MASK) {
    case 0:
      return ImplicitSelfKind.None;
    case 1:
      return ImplicitSelfKind.Imm;
    case 2:
      return ImplicitSelfKind.Mut;
    case 3:
      return ImplicitSelfKind.RefImm;
    case 4:
      return ImplicitSelfKind.RefMut;
    default:
      return unreachable();
  }
};

/// Do the function arguments end with a C-style variadic argument?
// rustc: compiler/rustc_hir/src/hir.rs:3902 c_variadic
gen.FnDeclFlags.prototype.c_variadic = function (this: FnDeclFlags): boolean {
  return (this.flags & FnDeclFlags.C_VARIADIC_FLAG) !== 0;
};

/// Is lifetime elision allowed?
// rustc: compiler/rustc_hir/src/hir.rs:3907 lifetime_elision_allowed
gen.FnDeclFlags.prototype.lifetime_elision_allowed = function (this: FnDeclFlags): boolean {
  return (this.flags & FnDeclFlags.LIFETIME_ELISION_ALLOWED_FLAG) !== 0;
};

/// Get the splatted argument index, if any.
// PORT: `splatted_` (clashes with the `splatted` field).
// rustc: compiler/rustc_hir/src/hir.rs:3912 splatted
gen.FnDeclFlags.prototype.splatted_ = function (this: FnDeclFlags): number | undefined {
  if (this.splatted === FnDeclFlags.NO_SPLATTED_ARG_INDEX) {
    return undefined;
  } else {
    return this.splatted;
  }
};

export type FnDecl = gen.FnDecl;
// PORT: statics of the generated class, attached below in upstream order.
export const FnDecl = gen.FnDecl as typeof gen.FnDecl & {
  dummy: (span: Span) => FnDecl;
};

// rustc: compiler/rustc_hir/src/hir.rs:3930 opt_delegation_sig_id
gen.FnDecl.prototype.opt_delegation_sig_id = function (this: FnDecl): DefId | undefined {
  const output = this.output;
  if (output.$ === "Return") {
    const ty = output._0;
    const kind = ty.kind;
    if (kind.$ === "InferDelegation" && kind._0.$ === "Sig") {
      const sig_id = kind._0._0;
      return sig_id;
    }
  }
  return undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:3939 opt_delegation_info
gen.FnDecl.prototype.opt_delegation_info = function (this: FnDecl): DelegationInfo | undefined {
  const output = this.output;
  if (output.$ === "Return") {
    const ty = output._0;
    const ty_kind = ty.kind;
    if (ty_kind.$ === "InferDelegation" && ty_kind._0.$ === "Sig") {
      const kind = ty_kind._0._1;
      if (kind.$ === "Output") {
        const generics = kind._0;
        return generics;
      }
    }
  }

  return undefined;
};

// rustc: compiler/rustc_hir/src/hir.rs:3950 implicit_self
gen.FnDecl.prototype.implicit_self = function (this: FnDecl): ImplicitSelfKind {
  return this.fn_decl_kind.implicit_self();
};

// rustc: compiler/rustc_hir/src/hir.rs:3954 c_variadic
gen.FnDecl.prototype.c_variadic = function (this: FnDecl): boolean {
  return this.fn_decl_kind.c_variadic();
};

// rustc: compiler/rustc_hir/src/hir.rs:3958 lifetime_elision_allowed
gen.FnDecl.prototype.lifetime_elision_allowed = function (this: FnDecl): boolean {
  return this.fn_decl_kind.lifetime_elision_allowed();
};

// rustc: compiler/rustc_hir/src/hir.rs:3962 splatted
gen.FnDecl.prototype.splatted = function (this: FnDecl): number | undefined {
  return this.fn_decl_kind.splatted_();
};

// rustc: compiler/rustc_hir/src/hir.rs:3966 dummy
FnDecl.dummy = function (span: Span): FnDecl {
  return new gen.FnDecl([], { $: "DefaultReturn", _0: span }, FnDeclFlags.default().set_lifetime_elision_allowed(true));
};

export type ImplicitSelfKind = gen.ImplicitSelfKind;
export const ImplicitSelfKind = {
  ...gen.ImplicitSelfKind,

  /// Does this represent an implicit self?
  // rustc: compiler/rustc_hir/src/hir.rs:3993 has_implicit_self
  has_implicit_self(self: ImplicitSelfKind): boolean {
    return !(self === "None");
  },
};

export type IsAsync = gen.IsAsync;
export const IsAsync = {
  ...gen.IsAsync,

  // rustc: compiler/rustc_hir/src/hir.rs:4005 is_async
  is_async(self: IsAsync): boolean {
    return self.$ === "Async";
  },
};

export type Defaultness = gen.Defaultness;
export const Defaultness = {
  ...gen.Defaultness,

  // rustc: compiler/rustc_hir/src/hir.rs:4021 has_value
  has_value(self: Defaultness): boolean {
    switch (self.$) {
      case "Default":
        return self.has_value;
      case "Final":
        return true;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4028 is_final
  is_final(self: Defaultness): boolean {
    // PORT: derived `PartialEq` against the fieldless `Final`: a tag check.
    return self.$ === "Final";
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4032 is_default
  is_default(self: Defaultness): boolean {
    return self.$ === "Default";
  },
};

export type FnRetTy = gen.FnRetTy;
export const FnRetTy = {
  // rustc: compiler/rustc_hir/src/hir.rs:4051 span
  span(self: FnRetTy): Span {
    switch (self.$) {
      case "DefaultReturn":
        return self._0;
      case "Return":
        return self._0.span;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4058 is_suggestable_infer_ty
  is_suggestable_infer_ty(self: FnRetTy): Ty | undefined {
    if (self.$ === "Return") {
      const ty = self._0;
      if (ty.is_suggestable_infer_ty()) {
        return ty;
      }
    }
    return undefined;
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4122 resolutions
gen.UseTree.prototype.resolutions = function* (this: UseTree): Generator<PerNS<Res | undefined>, void, undefined> {
  // PORT: the boxed `iter!` coroutine is a generator (same laziness).
  switch (this.kind.$) {
    case "Glob":
      yield this.prefix.res;
      break;
    case "Single":
      yield this.prefix.res;
      break;
    case "Nested": {
      const items = this.kind.items;
      for (const [item, _, __] of items) {
        for (const res of item.resolutions()) {
          yield res;
        }
      }
      break;
    }
  }
};

/// Gets the `DefId` of the referenced trait. It _must_ actually be a trait or trait alias.
// rustc: compiler/rustc_hir/src/hir.rs:4172 trait_def_id
gen.TraitRef.prototype.trait_def_id = function (this: TraitRef): DefId | undefined {
  const res = this.path.res;
  if (res.$ === "Def" && (res._0.$ === "Trait" || res._0.$ === "TraitAlias")) {
    const did = res._1;
    return did;
  } else if (res.$ === "Err") {
    return undefined;
  } else {
    return panic(`${debug_Res(res, PLAIN, debug_HirId)} did not resolve to a trait or trait alias`);
  }
};

// Still necessary in couple of places
// rustc: compiler/rustc_hir/src/hir.rs:4213 is_positional
gen.FieldDef.prototype.is_positional = function (this: FieldDef): boolean {
  return is_ascii_digit(utf8(this.ident.as_str())[0]!);
};

export type VariantData = gen.VariantData;
export const VariantData = {
  /// Return the fields of this variant.
  // rustc: compiler/rustc_hir/src/hir.rs:4237 fields
  fields(self: VariantData): readonly FieldDef[] {
    switch (self.$) {
      case "Struct":
        return self.fields;
      case "Tuple":
        return self._0;
      default:
        return [];
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4244 ctor
  ctor(self: VariantData): [CtorKind, HirId, LocalDefId] | undefined {
    switch (self.$) {
      case "Tuple":
        return ["Fn", self._1, self._2];
      case "Unit":
        return ["Const", self._0, self._1];
      case "Struct":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4253 ctor_kind
  ctor_kind(self: VariantData): CtorKind | undefined {
    const ctor = VariantData.ctor(self);
    return ctor === undefined ? undefined : ctor[0];
  },

  /// Return the `HirId` of this variant's constructor, if it has one.
  // rustc: compiler/rustc_hir/src/hir.rs:4259 ctor_hir_id
  ctor_hir_id(self: VariantData): HirId | undefined {
    const ctor = VariantData.ctor(self);
    return ctor === undefined ? undefined : ctor[1];
  },

  /// Return the `LocalDefId` of this variant's constructor, if it has one.
  // rustc: compiler/rustc_hir/src/hir.rs:4265 ctor_def_id
  ctor_def_id(self: VariantData): LocalDefId | undefined {
    const ctor = VariantData.ctor(self);
    return ctor === undefined ? undefined : ctor[2];
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4280 hir_id
gen.ItemId.prototype.hir_id = function (this: ItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:4307 hir_id
gen.Item.prototype.hir_id = function (this: Item): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:4313 item_id
gen.Item.prototype.item_id = function (this: Item): ItemId {
  return new gen.ItemId(this.owner_id);
};

/// Check if this is an [`ItemKind::Enum`], [`ItemKind::Struct`] or
/// [`ItemKind::Union`].
// rustc: compiler/rustc_hir/src/hir.rs:4319 is_adt
gen.Item.prototype.is_adt = function (this: Item): boolean {
  return this.kind.$ === "Enum" || this.kind.$ === "Struct" || this.kind.$ === "Union";
};

/// Check if this is an [`ItemKind::Struct`] or [`ItemKind::Union`].
// rustc: compiler/rustc_hir/src/hir.rs:4324 is_struct_or_union
gen.Item.prototype.is_struct_or_union = function (this: Item): boolean {
  return this.kind.$ === "Struct" || this.kind.$ === "Union";
};

// expect_methods_self_kind! { .. } (hir.rs:4328)
// rustc-macro: compiler/rustc_hir/src/hir.rs:4329 expect_extern_crate (expect_methods_self_kind!)
gen.Item.prototype.expect_extern_crate = function (this: Item): [Symbol | undefined, Ident] {
  const k = this.kind;
  if (k.$ !== "ExternCrate") return expect_failed("expect_extern_crate", this, gen.debug_Item);
  return [k._0, k._1];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4332 expect_use (expect_methods_self_kind!)
gen.Item.prototype.expect_use = function (this: Item): UseTree {
  const k = this.kind;
  if (k.$ !== "Use") return expect_failed("expect_use", this, gen.debug_Item);
  return k._0;
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4334 expect_static (expect_methods_self_kind!)
gen.Item.prototype.expect_static = function (this: Item): [Mutability, Ident, Ty, BodyId] {
  const k = this.kind;
  if (k.$ !== "Static") return expect_failed("expect_static", this, gen.debug_Item);
  return [k._0, k._1, k._2, k._3];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4337 expect_const (expect_methods_self_kind!)
gen.Item.prototype.expect_const = function (this: Item): [Ident, Generics, Ty, ConstItemRhs] {
  const k = this.kind;
  if (k.$ !== "Const") return expect_failed("expect_const", this, gen.debug_Item);
  return [k._0, k._1, k._2, k._3];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4340 expect_fn (expect_methods_self_kind!)
gen.Item.prototype.expect_fn = function (this: Item): [Ident, FnSig, Generics, BodyId] {
  const k = this.kind;
  if (k.$ !== "Fn") return expect_failed("expect_fn", this, gen.debug_Item);
  return [k.ident, k.sig, k.generics, k.body];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4343 expect_macro (expect_methods_self_kind!)
gen.Item.prototype.expect_macro = function (this: Item): [Ident, MacroDef, MacroKinds] {
  const k = this.kind;
  if (k.$ !== "Macro") return expect_failed("expect_macro", this, gen.debug_Item);
  return [k._0, k._1, k._2];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4346 expect_mod (expect_methods_self_kind!)
gen.Item.prototype.expect_mod = function (this: Item): [Ident, Mod] {
  const k = this.kind;
  if (k.$ !== "Mod") return expect_failed("expect_mod", this, gen.debug_Item);
  return [k._0, k._1];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4348 expect_foreign_mod (expect_methods_self_kind!)
gen.Item.prototype.expect_foreign_mod = function (this: Item): [ExternAbi, readonly ForeignItemId[]] {
  const k = this.kind;
  if (k.$ !== "ForeignMod") return expect_failed("expect_foreign_mod", this, gen.debug_Item);
  return [k.abi, k.items];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4351 expect_global_asm (expect_methods_self_kind!)
gen.Item.prototype.expect_global_asm = function (this: Item): InlineAsm {
  const k = this.kind;
  if (k.$ !== "GlobalAsm") return expect_failed("expect_global_asm", this, gen.debug_Item);
  return k.asm;
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4353 expect_ty_alias (expect_methods_self_kind!)
gen.Item.prototype.expect_ty_alias = function (this: Item): [Ident, Generics, Ty] {
  const k = this.kind;
  if (k.$ !== "TyAlias") return expect_failed("expect_ty_alias", this, gen.debug_Item);
  return [k._0, k._1, k._2];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4356 expect_enum (expect_methods_self_kind!)
gen.Item.prototype.expect_enum = function (this: Item): [Ident, Generics, EnumDef] {
  const k = this.kind;
  if (k.$ !== "Enum") return expect_failed("expect_enum", this, gen.debug_Item);
  return [k._0, k._1, k._2];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4359 expect_struct (expect_methods_self_kind!)
gen.Item.prototype.expect_struct = function (this: Item): [Ident, Generics, VariantData] {
  const k = this.kind;
  if (k.$ !== "Struct") return expect_failed("expect_struct", this, gen.debug_Item);
  return [k._0, k._1, k._2];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4362 expect_union (expect_methods_self_kind!)
gen.Item.prototype.expect_union = function (this: Item): [Ident, Generics, VariantData] {
  const k = this.kind;
  if (k.$ !== "Union") return expect_failed("expect_union", this, gen.debug_Item);
  return [k._0, k._1, k._2];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4365 expect_trait (expect_methods_self_kind!)
gen.Item.prototype.expect_trait = function (
  this: Item,
): [ImplRestriction, Constness, IsAuto, Safety, Ident, Generics, GenericBounds, readonly TraitItemId[]] {
  const k = this.kind;
  if (k.$ !== "Trait") return expect_failed("expect_trait", this, gen.debug_Item);
  return [k.impl_restriction, k.constness, k.is_auto, k.safety, k.ident, k.generics, k.bounds, k.items];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4379 expect_trait_alias (expect_methods_self_kind!)
gen.Item.prototype.expect_trait_alias = function (this: Item): [Constness, Ident, Generics, GenericBounds] {
  const k = this.kind;
  if (k.$ !== "TraitAlias") return expect_failed("expect_trait_alias", this, gen.debug_Item);
  return [k._0, k._1, k._2, k._3];
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4382 expect_impl (expect_methods_self_kind!)
gen.Item.prototype.expect_impl = function (this: Item): Impl {
  const k = this.kind;
  if (k.$ !== "Impl") return expect_failed("expect_impl", this, gen.debug_Item);
  return k._0;
};

// rustc-macro: compiler/rustc_hir/src/hir.rs:4384 expect_test_binder_constraints (expect_methods_self_kind!)
gen.Item.prototype.expect_test_binder_constraints = function (this: Item): [Generics, TestBinderBody] {
  const k = this.kind;
  if (k.$ !== "TestBinderConstraints") return expect_failed("expect_test_binder_constraints", this, gen.debug_Item);
  return [k.generics, k.body];
};

export type Safety = gen.Safety;
export const Safety = {
  ...gen.Safety,

  // rustc: compiler/rustc_hir/src/hir.rs:4402 prefix_str
  prefix_str(self: Safety): string {
    switch (self) {
      case "Unsafe":
        return "unsafe ";
      case "Safe":
        return "";
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4410 is_unsafe
  is_unsafe(self: Safety): boolean {
    return !Safety.is_safe(self);
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4415 is_safe
  is_safe(self: Safety): boolean {
    switch (self) {
      case "Unsafe":
        return false;
      case "Safe":
        return true;
    }
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4424 fmt
export function display_Safety(v: Safety): string {
  switch (v) {
    case "Unsafe":
      return "unsafe";
    case "Safe":
      return "safe";
  }
}

export type Constness = gen.Constness;
export const Constness = {
  ...gen.Constness,

  /// This impl exists as an optimization so that metadata deserialization can
  /// store the value directly and not have to encode it wrapped in another `Option`.
  // rustc: compiler/rustc_hir/src/hir.rs:4441 default
  default(): Constness {
    return { $: "Const", always: false };
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4447 fmt
export function display_Constness(v: Constness): string {
  if (v.$ === "Const" && v.always === true) {
    return "comptime";
  } else if (v.$ === "Const" && v.always === false) {
    return "const";
  } else {
    // Self::NotConst
    return "non-const";
  }
}

export type HeaderSafety = gen.HeaderSafety;
export const HeaderSafety = {
  ...gen.HeaderSafety,

  // rustc: compiler/rustc_hir/src/hir.rs:4494 from
  from_Safety(v: Safety): HeaderSafety {
    return { $: "Normal", _0: v };
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4508 is_async
gen.FnHeader.prototype.is_async = function (this: gen.FnHeader): boolean {
  return this.asyncness.$ === "Async";
};

// rustc: compiler/rustc_hir/src/hir.rs:4512 is_unsafe
gen.FnHeader.prototype.is_unsafe = function (this: gen.FnHeader): boolean {
  return Safety.is_unsafe(this.safety_());
};

// rustc: compiler/rustc_hir/src/hir.rs:4516 is_safe
gen.FnHeader.prototype.is_safe = function (this: gen.FnHeader): boolean {
  return Safety.is_safe(this.safety_());
};

// PORT: `safety_` (clashes with the `safety` field).
// rustc: compiler/rustc_hir/src/hir.rs:4520 safety
gen.FnHeader.prototype.safety_ = function (this: gen.FnHeader): Safety {
  const safety = this.safety;
  switch (safety.$) {
    case "SafeTargetFeatures":
      return Safety.Unsafe;
    case "Normal":
      return safety._0;
  }
};

export type ItemKind = gen.ItemKind;
export const ItemKind = {
  // rustc: compiler/rustc_hir/src/hir.rs:4678 ident
  ident(self: ItemKind): Ident | undefined {
    switch (self.$) {
      case "ExternCrate":
        return self._1;
      case "Use":
        if (self._0.kind.$ === "Single") {
          return self._0.kind._0;
        }
        // ItemKind::Use(UseTree { kind: UseKind::Glob | UseKind::Nested { .. }, .. })
        return undefined;
      case "Static":
        return self._1;
      case "Const":
        return self._0;
      case "Fn":
        return self.ident;
      case "Macro":
        return self._0;
      case "Mod":
        return self._0;
      case "TyAlias":
        return self._0;
      case "Enum":
        return self._0;
      case "Struct":
        return self._0;
      case "Union":
        return self._0;
      case "Trait":
        return self.ident;
      case "TraitAlias":
        return self._1;

      case "ForeignMod":
      case "GlobalAsm":
      case "Impl":
      case "TestBinderConstraints":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4702 generics
  generics(self: ItemKind): Generics | undefined {
    switch (self.$) {
      case "Fn":
        return self.generics;
      case "TyAlias":
        return self._1;
      case "Const":
        return self._1;
      case "Enum":
        return self._1;
      case "Struct":
        return self._1;
      case "Union":
        return self._1;
      case "Trait":
        return self.generics;
      case "TraitAlias":
        return self._2;
      case "Impl":
        return self._0.generics;
      case "TestBinderConstraints":
        return self.generics;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4718 recovered
  recovered(self: ItemKind): boolean {
    if (self.$ === "Struct" && self._2.$ === "Struct" && self._2.recovered.$ === "Yes") {
      return true;
    } else if (self.$ === "Union" && self._2.$ === "Struct" && self._2.recovered.$ === "Yes") {
      return true;
    } else if (self.$ === "Enum") {
      const def = self._2;
      return def.variants.some((v: Variant) => {
        const data = v.data;
        if (data.$ === "Struct" && data.recovered.$ === "Yes") {
          return true;
        } else {
          return false;
        }
      });
    } else {
      return false;
    }
  },
};

// rustc: compiler/rustc_hir/src/hir.rs:4749 hir_id
gen.ForeignItemId.prototype.hir_id = function (this: ForeignItemId): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:4766 hir_id
gen.ForeignItem.prototype.hir_id = function (this: ForeignItem): HirId {
  // Items are always HIR owners.
  return HirId_make_owner(this.owner_id.def_id);
};

// rustc: compiler/rustc_hir/src/hir.rs:4771 foreign_item_id
gen.ForeignItem.prototype.foreign_item_id = function (this: ForeignItem): ForeignItemId {
  return new gen.ForeignItemId(this.owner_id);
};

export type OwnerNode = gen.OwnerNode;
export const OwnerNode = {
  ...gen.OwnerNode,

  // rustc: compiler/rustc_hir/src/hir.rs:4824 span
  span(self: OwnerNode): Span {
    switch (self.$) {
      case "Item":
      case "ForeignItem":
      case "ImplItem":
      case "TraitItem":
        return self._0.span;
      case "Crate":
        return self._0.spans.inner_span;
      case "Synthetic":
        return unreachable();
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4835 fn_sig
  fn_sig(self: OwnerNode): FnSig | undefined {
    if (self.$ === "TraitItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else if (self.$ === "ImplItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else if (self.$ === "Item" && self._0.kind.$ === "Fn") {
      return self._0.kind.sig;
    } else if (self.$ === "ForeignItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4847 fn_decl
  fn_decl(self: OwnerNode): gen.FnDecl | undefined {
    let fn_sig: FnSig;
    if (self.$ === "TraitItem" && self._0.kind.$ === "Fn") {
      fn_sig = self._0.kind._0;
    } else if (self.$ === "ImplItem" && self._0.kind.$ === "Fn") {
      fn_sig = self._0.kind._0;
    } else if (self.$ === "Item" && self._0.kind.$ === "Fn") {
      fn_sig = self._0.kind.sig;
    } else if (self.$ === "ForeignItem" && self._0.kind.$ === "Fn") {
      fn_sig = self._0.kind._0;
    } else {
      return undefined;
    }
    return fn_sig.decl;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4859 body_id
  body_id(self: OwnerNode): BodyId | undefined {
    if (self.$ === "Item") {
      const kind = self._0.kind;
      if (kind.$ === "Static") return kind._3;
      if (kind.$ === "Const" && kind._3.$ === "Body") return kind._3._0;
      if (kind.$ === "Fn") return kind.body;
    } else if (self.$ === "TraitItem") {
      const kind = self._0.kind;
      if (kind.$ === "Fn" && kind._1.$ === "Provided") return kind._1._0;
      if (kind.$ === "Const" && kind._1 !== undefined && kind._1.$ === "Body") return kind._1._0;
    } else if (self.$ === "ImplItem") {
      const kind = self._0.kind;
      if (kind.$ === "Fn") return kind._1;
      if (kind.$ === "Const" && kind._1.$ === "Body") return kind._1._0;
    }
    return undefined;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4882 generics
  generics(self: OwnerNode): Generics | undefined {
    return Node.generics(Node.from_OwnerNode(self));
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4886 def_id
  def_id(self: OwnerNode): OwnerId {
    switch (self.$) {
      case "Item":
      case "TraitItem":
      case "ImplItem":
      case "ForeignItem":
        return self._0.owner_id;
      case "Crate":
        return CRATE_HIR_ID.owner;
      case "Synthetic":
        return unreachable();
    }
  },

  /// Check if node is an impl block.
  // rustc: compiler/rustc_hir/src/hir.rs:4898 is_impl_block
  is_impl_block(self: OwnerNode): boolean {
    return self.$ === "Item" && self._0.kind.$ === "Impl";
  },

  // expect_methods_self! { .. } (hir.rs:4902)
  // rustc-macro: compiler/rustc_hir/src/hir.rs:4903 expect_item (expect_methods_self!)
  expect_item(self: OwnerNode): Item {
    if (self.$ !== "Item") return expect_failed("expect_item", self, gen.debug_OwnerNode);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:4904 expect_foreign_item (expect_methods_self!)
  expect_foreign_item(self: OwnerNode): ForeignItem {
    if (self.$ !== "ForeignItem") return expect_failed("expect_foreign_item", self, gen.debug_OwnerNode);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:4905 expect_impl_item (expect_methods_self!)
  expect_impl_item(self: OwnerNode): ImplItem {
    if (self.$ !== "ImplItem") return expect_failed("expect_impl_item", self, gen.debug_OwnerNode);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:4906 expect_trait_item (expect_methods_self!)
  expect_trait_item(self: OwnerNode): TraitItem {
    if (self.$ !== "TraitItem") return expect_failed("expect_trait_item", self, gen.debug_OwnerNode);
    return self._0;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4911 from
  from_Item(val: Item): OwnerNode {
    return { $: "Item", _0: val };
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4917 from
  from_ForeignItem(val: ForeignItem): OwnerNode {
    return { $: "ForeignItem", _0: val };
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4923 from
  from_ImplItem(val: ImplItem): OwnerNode {
    return { $: "ImplItem", _0: val };
  },

  // rustc: compiler/rustc_hir/src/hir.rs:4929 from
  from_TraitItem(val: TraitItem): OwnerNode {
    return { $: "TraitItem", _0: val };
  },
};

export type Node = gen.Node;
export const Node = {
  ...gen.Node,

  // rustc: compiler/rustc_hir/src/hir.rs:4935 from
  from_OwnerNode(val: OwnerNode): Node {
    switch (val.$) {
      case "Item":
        return { $: "Item", _0: val._0 };
      case "ForeignItem":
        return { $: "ForeignItem", _0: val._0 };
      case "ImplItem":
        return { $: "ImplItem", _0: val._0 };
      case "TraitItem":
        return { $: "TraitItem", _0: val._0 };
      case "Crate":
        return { $: "Crate", _0: val._0 };
      case "Synthetic":
        return gen.Node.Synthetic;
    }
  },

  /// Get the identifier of this `Node`, if applicable.
  ///
  /// # Edge cases
  ///
  /// Calling `.ident()` on a [`Node::Ctor`] will return `None`
  /// because `Ctor`s do not have identifiers themselves.
  /// Instead, call `.ident()` on the parent struct/variant, like so:
  ///
  /// ```ignore (illustrative)
  /// ctor
  ///     .ctor_hir_id()
  ///     .map(|ctor_id| tcx.parent_hir_node(ctor_id))
  ///     .and_then(|parent| parent.ident())
  /// ```
  // rustc: compiler/rustc_hir/src/hir.rs:5011 ident
  ident(self: Node): Ident | undefined {
    switch (self.$) {
      case "Item":
        return ItemKind.ident(self._0.kind);
      case "TraitItem":
      case "ImplItem":
      case "ForeignItem":
        return self._0.ident;
      case "NestedUseTree":
        if (self._0.kind.$ === "Single") {
          return self._0.kind._0;
        }
        // Node::NestedUseTree(_) => None
        return undefined;
      case "Field":
      case "Variant":
      case "PathSegment":
        return self._0.ident;
      case "Lifetime":
        return self._0.ident;
      case "GenericParam":
        return ParamName.ident(self._0.name);
      case "AssocItemConstraint":
        return self._0.ident;
      case "PatField":
        return self._0.ident;
      case "ExprField":
        return self._0.ident;
      case "ConstArgExprField":
        return self._0.field;
      case "PreciseCapturingNonLifetimeArg":
        return self._0.ident;
      case "Param":
      case "AnonConst":
      case "ConstBlock":
      case "ConstArg":
      case "Expr":
      case "Stmt":
      case "Block":
      case "Ctor":
      case "Pat":
      case "TyPat":
      case "PatExpr":
      case "Arm":
      case "LetStmt":
      case "Crate":
      case "Ty":
      case "TraitRef":
      case "OpaqueTy":
      case "Infer":
      case "WherePredicate":
      case "TestBinderForall":
      case "TestBinderExists":
      case "TestBinderBoundTypeConstraint":
      case "Synthetic":
      case "Err":
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5056 fn_decl
  fn_decl(self: Node): gen.FnDecl | undefined {
    if (self.$ === "TraitItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0.decl;
    } else if (self.$ === "ImplItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0.decl;
    } else if (self.$ === "Item" && self._0.kind.$ === "Fn") {
      return self._0.kind.sig.decl;
    } else if (self.$ === "ForeignItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0.decl;
    } else if (self.$ === "Expr" && self._0.kind.$ === "Closure") {
      return self._0.kind._0.fn_decl;
    } else {
      return undefined;
    }
  },

  /// Get a `hir::Impl` if the node is an impl block for the given `trait_def_id`.
  // rustc: compiler/rustc_hir/src/hir.rs:5072 impl_block_of_trait
  impl_block_of_trait(self: Node, trait_def_id: DefId): Impl | undefined {
    if (self.$ === "Item" && self._0.kind.$ === "Impl") {
      const impl_block = self._0.kind._0;
      const of_trait = impl_block.of_trait;
      if (of_trait !== undefined) {
        const trait_id = of_trait.trait_ref.trait_def_id();
        if (trait_id !== undefined && DefId_eq(trait_id, trait_def_id)) {
          return impl_block;
        }
      }
    }
    return undefined;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5084 fn_sig
  fn_sig(self: Node): FnSig | undefined {
    if (self.$ === "TraitItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else if (self.$ === "ImplItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else if (self.$ === "Item" && self._0.kind.$ === "Fn") {
      return self._0.kind.sig;
    } else if (self.$ === "ForeignItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._0;
    } else {
      return undefined;
    }
  },

  /// Get the type for constants, assoc types, type aliases and statics.
  // rustc: compiler/rustc_hir/src/hir.rs:5097 ty
  ty(self: Node): Ty | undefined {
    switch (self.$) {
      case "Item": {
        const kind = self._0.kind;
        switch (kind.$) {
          case "TyAlias":
            return kind._2;
          case "Static":
            return kind._2;
          case "Const":
            return kind._2;
          case "Impl":
            return kind._0.self_ty;
          default:
            return undefined;
        }
      }
      case "TraitItem": {
        const kind = self._0.kind;
        switch (kind.$) {
          case "Const":
            return kind._0;
          case "Type":
            return kind._1;
          default:
            return undefined;
        }
      }
      case "ImplItem": {
        const kind = self._0.kind;
        switch (kind.$) {
          case "Const":
            return kind._0;
          case "Type":
            return kind._0;
          default:
            return undefined;
        }
      }
      case "ForeignItem": {
        const kind = self._0.kind;
        switch (kind.$) {
          case "Static":
            return kind._0;
          default:
            return undefined;
        }
      }
      case "GenericParam": {
        const kind = self._0.kind;
        switch (kind.$) {
          case "Lifetime":
            return undefined;
          case "Type":
            return kind.default;
          case "Const":
            return kind.ty;
        }
      }
      case "Field":
        return self._0.ty;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5130 alias_ty
  alias_ty(self: Node): Ty | undefined {
    if (self.$ === "Item" && self._0.kind.$ === "TyAlias") {
      return self._0.kind._2;
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5138 associated_body
  associated_body(self: Node): [LocalDefId, BodyId] | undefined {
    if (self.$ === "Item") {
      const owner_id = self._0.owner_id;
      const kind = self._0.kind;
      if (kind.$ === "Const" && kind._3.$ === "Body") return [owner_id.def_id, kind._3._0];
      if (kind.$ === "Static") return [owner_id.def_id, kind._3];
      if (kind.$ === "Fn") return [owner_id.def_id, kind.body];
    } else if (self.$ === "TraitItem") {
      const owner_id = self._0.owner_id;
      const kind = self._0.kind;
      if (kind.$ === "Const" && kind._1 !== undefined && kind._1.$ === "Body") return [owner_id.def_id, kind._1._0];
      if (kind.$ === "Fn" && kind._1.$ === "Provided") return [owner_id.def_id, kind._1._0];
    } else if (self.$ === "ImplItem") {
      const owner_id = self._0.owner_id;
      const kind = self._0.kind;
      if (kind.$ === "Const" && kind._1.$ === "Body") return [owner_id.def_id, kind._1._0];
      if (kind.$ === "Fn") return [owner_id.def_id, kind._1];
    }

    if (self.$ === "Item" && self._0.kind.$ === "GlobalAsm") {
      return [self._0.owner_id.def_id, self._0.kind.fake_body];
    }

    if (self.$ === "Expr" && self._0.kind.$ === "Closure") {
      const closure: Closure = self._0.kind._0;
      return [closure.def_id, closure.body];
    }

    if (self.$ === "AnonConst") {
      const constant: AnonConst = self._0;
      return [constant.def_id, constant.body];
    }
    if (self.$ === "ConstBlock") {
      const constant: ConstBlock = self._0;
      return [constant.def_id, constant.body];
    }

    return undefined;
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5176 body_id
  body_id(self: Node): BodyId | undefined {
    const associated_body = Node.associated_body(self);
    if (associated_body === undefined) return undefined;
    return associated_body[1];
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5180 generics
  generics(self: Node): Generics | undefined {
    if (self.$ === "ForeignItem" && self._0.kind.$ === "Fn") {
      return self._0.kind._2;
    } else if (self.$ === "TraitItem" || self.$ === "ImplItem") {
      return self._0.generics;
    } else if (self.$ === "Item") {
      return ItemKind.generics(self._0.kind);
    } else {
      return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5192 as_owner
  as_owner(self: Node): OwnerNode | undefined {
    switch (self.$) {
      case "Item":
        return { $: "Item", _0: self._0 };
      case "ForeignItem":
        return { $: "ForeignItem", _0: self._0 };
      case "TraitItem":
        return { $: "TraitItem", _0: self._0 };
      case "ImplItem":
        return { $: "ImplItem", _0: self._0 };
      case "Crate":
        return { $: "Crate", _0: self._0 };
      case "Synthetic":
        return gen.OwnerNode.Synthetic;
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_hir/src/hir.rs:5204 fn_kind
  fn_kind(self: Node): FnKind | undefined {
    switch (self.$) {
      case "Item": {
        const i = self._0;
        const kind = i.kind;
        if (kind.$ === "Fn") {
          const { ident, sig, generics } = kind;
          return { $: "ItemFn", _0: ident, _1: generics, _2: sig.header };
        }
        return undefined;
      }
      case "TraitItem": {
        const ti = self._0;
        const kind = ti.kind;
        if (kind.$ === "Fn") {
          const sig = kind._0;
          return { $: "Method", _0: ti.ident, _1: sig };
        }
        return undefined;
      }
      case "ImplItem": {
        const ii = self._0;
        const kind = ii.kind;
        if (kind.$ === "Fn") {
          const sig = kind._0;
          return { $: "Method", _0: ii.ident, _1: sig };
        }
        return undefined;
      }
      case "Expr": {
        const e = self._0;
        if (e.kind.$ === "Closure") {
          return FnKind.Closure;
        }
        return undefined;
      }
      default:
        return undefined;
    }
  },

  /// For expressions, patterns, and types return the path if it's a path expr/pat/ty.
  // rustc: compiler/rustc_hir/src/hir.rs:5229 path
  path(self: Node): QPath | undefined {
    if (self.$ === "Ty" && self._0.kind.$ === "Path") {
      return self._0.kind._0;
    } else if (self.$ === "Expr" && self._0.kind.$ === "Path") {
      return self._0.kind._0;
    } else if (self.$ === "PatExpr" && self._0.kind.$ === "Path") {
      return self._0.kind._0;
    } else {
      return undefined;
    }
  },

  // expect_methods_self! { .. } (hir.rs:5238)
  // rustc-macro: compiler/rustc_hir/src/hir.rs:5239 expect_param (expect_methods_self!)
  expect_param(self: Node): Param {
    if (self.$ !== "Param") return expect_failed("expect_param", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5240 expect_item (expect_methods_self!)
  expect_item(self: Node): Item {
    if (self.$ !== "Item") return expect_failed("expect_item", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5241 expect_foreign_item (expect_methods_self!)
  expect_foreign_item(self: Node): ForeignItem {
    if (self.$ !== "ForeignItem") return expect_failed("expect_foreign_item", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5242 expect_trait_item (expect_methods_self!)
  expect_trait_item(self: Node): TraitItem {
    if (self.$ !== "TraitItem") return expect_failed("expect_trait_item", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5243 expect_impl_item (expect_methods_self!)
  expect_impl_item(self: Node): ImplItem {
    if (self.$ !== "ImplItem") return expect_failed("expect_impl_item", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5244 expect_variant (expect_methods_self!)
  expect_variant(self: Node): Variant {
    if (self.$ !== "Variant") return expect_failed("expect_variant", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5245 expect_field (expect_methods_self!)
  expect_field(self: Node): FieldDef {
    if (self.$ !== "Field") return expect_failed("expect_field", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5246 expect_anon_const (expect_methods_self!)
  expect_anon_const(self: Node): AnonConst {
    if (self.$ !== "AnonConst") return expect_failed("expect_anon_const", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5247 expect_inline_const (expect_methods_self!)
  expect_inline_const(self: Node): ConstBlock {
    if (self.$ !== "ConstBlock") return expect_failed("expect_inline_const", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5248 expect_expr (expect_methods_self!)
  expect_expr(self: Node): Expr {
    if (self.$ !== "Expr") return expect_failed("expect_expr", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5249 expect_expr_field (expect_methods_self!)
  expect_expr_field(self: Node): ExprField {
    if (self.$ !== "ExprField") return expect_failed("expect_expr_field", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5250 expect_stmt (expect_methods_self!)
  expect_stmt(self: Node): Stmt {
    if (self.$ !== "Stmt") return expect_failed("expect_stmt", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5251 expect_path_segment (expect_methods_self!)
  expect_path_segment(self: Node): PathSegment {
    if (self.$ !== "PathSegment") return expect_failed("expect_path_segment", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5252 expect_ty (expect_methods_self!)
  expect_ty(self: Node): Ty {
    if (self.$ !== "Ty") return expect_failed("expect_ty", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5253 expect_assoc_item_constraint (expect_methods_self!)
  expect_assoc_item_constraint(self: Node): AssocItemConstraint {
    if (self.$ !== "AssocItemConstraint") return expect_failed("expect_assoc_item_constraint", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5254 expect_trait_ref (expect_methods_self!)
  expect_trait_ref(self: Node): TraitRef {
    if (self.$ !== "TraitRef") return expect_failed("expect_trait_ref", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5255 expect_opaque_ty (expect_methods_self!)
  expect_opaque_ty(self: Node): OpaqueTy {
    if (self.$ !== "OpaqueTy") return expect_failed("expect_opaque_ty", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5256 expect_pat (expect_methods_self!)
  expect_pat(self: Node): Pat {
    if (self.$ !== "Pat") return expect_failed("expect_pat", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5257 expect_pat_field (expect_methods_self!)
  expect_pat_field(self: Node): PatField {
    if (self.$ !== "PatField") return expect_failed("expect_pat_field", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5258 expect_arm (expect_methods_self!)
  expect_arm(self: Node): Arm {
    if (self.$ !== "Arm") return expect_failed("expect_arm", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5259 expect_block (expect_methods_self!)
  expect_block(self: Node): Block {
    if (self.$ !== "Block") return expect_failed("expect_block", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5260 expect_let_stmt (expect_methods_self!)
  expect_let_stmt(self: Node): LetStmt {
    if (self.$ !== "LetStmt") return expect_failed("expect_let_stmt", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5261 expect_ctor (expect_methods_self!)
  expect_ctor(self: Node): VariantData {
    if (self.$ !== "Ctor") return expect_failed("expect_ctor", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5262 expect_lifetime (expect_methods_self!)
  expect_lifetime(self: Node): Lifetime {
    if (self.$ !== "Lifetime") return expect_failed("expect_lifetime", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5263 expect_generic_param (expect_methods_self!)
  expect_generic_param(self: Node): GenericParam {
    if (self.$ !== "GenericParam") return expect_failed("expect_generic_param", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5264 expect_crate (expect_methods_self!)
  expect_crate(self: Node): Mod {
    if (self.$ !== "Crate") return expect_failed("expect_crate", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5265 expect_infer (expect_methods_self!)
  expect_infer(self: Node): InferArg {
    if (self.$ !== "Infer") return expect_failed("expect_infer", self, gen.debug_Node);
    return self._0;
  },

  // rustc-macro: compiler/rustc_hir/src/hir.rs:5266 expect_closure (expect_methods_self!)
  expect_closure(self: Node): Closure {
    if (!(self.$ === "Expr" && self._0.kind.$ === "Closure")) {
      return expect_failed("expect_closure", self, gen.debug_Node);
    }
    return self._0.kind._0;
  },
};

// mod size_asserts: `static_assert_size!`s (64-bit layout checks), nothing to port.
// #[cfg(test)] mod tests: hir/tests.rs.
