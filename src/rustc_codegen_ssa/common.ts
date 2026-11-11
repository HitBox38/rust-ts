// Port of compiler/rustc_codegen_ssa/src/common.rs (lane ssa-contract).
//
// #![allow(non_camel_case_types)]
import type { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type { DllImport } from "../rustc_crate_store/cstore.gen.ts";
import { DllImportSymbolType } from "../rustc_crate_store/cstore.gen.ts";
import { IntTy } from "../rustc_ast_ir/lib.ts";
import { CtfeProvenance, PointerArithmetic_provided } from "../rustc_middle/mir/interpret/pointer.ts";
import { Scalar } from "../rustc_middle/mir/interpret/value.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { ScalarInt } from "../rustc_middle/ty/consts/int.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { Session } from "../rustc_session/session.ts";
import type { Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import type { Target } from "../rustc_target/spec/mod.ts";
import { type Debug, PLAIN } from "../std/fmt.ts";
import { unported, unreachable } from "../std/panic.ts";
import type { BackendTypes } from "./traits/backend.ts";
import type { BuilderMethods } from "./traits/builder.ts";
import type { FnAbi } from "../rustc_target/callconv/mod.ts";
import type { PointerAuthSchema } from "./traits/misc.ts";

// #[derive(Copy, Clone, Debug)]
export type IntPredicate =
  | "IntEQ"
  | "IntNE"
  | "IntUGT"
  | "IntUGE"
  | "IntULT"
  | "IntULE"
  | "IntSGT"
  | "IntSGE"
  | "IntSLT"
  | "IntSLE";
export const IntPredicate = {
  IntEQ: "IntEQ",
  IntNE: "IntNE",
  IntUGT: "IntUGT",
  IntUGE: "IntUGE",
  IntULT: "IntULT",
  IntULE: "IntULE",
  IntSGT: "IntSGT",
  IntSGE: "IntSGE",
  IntSLT: "IntSLT",
  IntSLE: "IntSLE",
} as const;
export const debug_IntPredicate: Debug<IntPredicate> = (v) => v;

// #[derive(Copy, Clone, Debug)]
export type RealPredicate =
  | "RealPredicateFalse"
  | "RealOEQ"
  | "RealOGT"
  | "RealOGE"
  | "RealOLT"
  | "RealOLE"
  | "RealONE"
  | "RealORD"
  | "RealUNO"
  | "RealUEQ"
  | "RealUGT"
  | "RealUGE"
  | "RealULT"
  | "RealULE"
  | "RealUNE"
  | "RealPredicateTrue";
export const RealPredicate = {
  RealPredicateFalse: "RealPredicateFalse",
  RealOEQ: "RealOEQ",
  RealOGT: "RealOGT",
  RealOGE: "RealOGE",
  RealOLT: "RealOLT",
  RealOLE: "RealOLE",
  RealONE: "RealONE",
  RealORD: "RealORD",
  RealUNO: "RealUNO",
  RealUEQ: "RealUEQ",
  RealUGT: "RealUGT",
  RealUGE: "RealUGE",
  RealULT: "RealULT",
  RealULE: "RealULE",
  RealUNE: "RealUNE",
  RealPredicateTrue: "RealPredicateTrue",
} as const;
export const debug_RealPredicate: Debug<RealPredicate> = (v) => v;

// #[derive(Copy, Clone, PartialEq, Debug)]
export type AtomicRmwBinOp =
  | "AtomicXchg"
  | "AtomicAdd"
  | "AtomicSub"
  | "AtomicAnd"
  | "AtomicNand"
  | "AtomicOr"
  | "AtomicXor"
  | "AtomicMax"
  | "AtomicMin"
  | "AtomicUMax"
  | "AtomicUMin";
export const AtomicRmwBinOp = {
  AtomicXchg: "AtomicXchg",
  AtomicAdd: "AtomicAdd",
  AtomicSub: "AtomicSub",
  AtomicAnd: "AtomicAnd",
  AtomicNand: "AtomicNand",
  AtomicOr: "AtomicOr",
  AtomicXor: "AtomicXor",
  AtomicMax: "AtomicMax",
  AtomicMin: "AtomicMin",
  AtomicUMax: "AtomicUMax",
  AtomicUMin: "AtomicUMin",
} as const;
export const debug_AtomicRmwBinOp: Debug<AtomicRmwBinOp> = (v) => v;

// #[derive(Copy, Clone, Debug)]
export type SynchronizationScope = "SingleThread" | "CrossThread";
export const SynchronizationScope = { SingleThread: "SingleThread", CrossThread: "CrossThread" } as const;
export const debug_SynchronizationScope: Debug<SynchronizationScope> = (v) => v;

// #[derive(Copy, Clone, PartialEq, Debug)]
export type TypeKind =
  | "Void"
  | "Half"
  | "Float"
  | "Double"
  | "X86_FP80"
  | "FP128"
  | "PPC_FP128"
  | "Label"
  | "Integer"
  | "Function"
  | "Struct"
  | "Array"
  | "Pointer"
  | "Vector"
  | "Metadata"
  | "Token"
  | "ScalableVector"
  | "BFloat"
  | "X86_AMX";
export const TypeKind = {
  Void: "Void",
  Half: "Half",
  Float: "Float",
  Double: "Double",
  X86_FP80: "X86_FP80",
  FP128: "FP128",
  PPC_FP128: "PPC_FP128",
  Label: "Label",
  Integer: "Integer",
  Function: "Function",
  Struct: "Struct",
  Array: "Array",
  Pointer: "Pointer",
  Vector: "Vector",
  Metadata: "Metadata",
  Token: "Token",
  ScalableVector: "ScalableVector",
  BFloat: "BFloat",
  X86_AMX: "X86_AMX",
} as const;
export const debug_TypeKind: Debug<TypeKind> = (v) => v;

// FIXME(mw): Anything that is produced via DepGraph::with_task() must implement
//            the StableHash trait. Normally DepGraph::with_task() calls are
//            hidden behind queries, but CGU creation is a special case in two
//            ways: (1) it's not a query and (2) CGU are output nodes, so their
//            Fingerprints are not actually needed. It remains to be clarified
//            how exactly this case will be handled in the red/green system but
//            for now we content ourselves with providing a no-op StableHash
//            implementation for CGUs.
// mod temp_stable_hash_impls {
//     impl<M> StableHash for ModuleCodegen<M> {
// rustc-skip: compiler/rustc_codegen_ssa/src/common.rs:106 stable_hash no-op StableHash impl for ModuleCodegen (incremental, out of scope)
//     }
// }

/** PORT (ssa-contract): `Session::pointer_authentication_functions` (rustc_session session.rs:1271) is not on the TS
 *  `Session`. Its `pointer_auth_config` is always `None` in the port (rustc_session `build_session`: only `Pauthtest`
 *  targets build one, and that path stops), so the answer is `None` exactly when the config is absent. Not a marker:
 *  rustc_session owns the fn (handoff). */
function pointer_authentication_functions(sess: Session): PointerAuthSchema | undefined {
  return sess.pointer_auth_config === undefined
    ? undefined
    : unported("rustc_session::Session::pointer_authentication_functions (PointerAuthConfig)");
}

// rustc: compiler/rustc_codegen_ssa/src/common.rs:112 build_langcall
export function build_langcall<B extends BackendTypes>(
  bx: BuilderMethods<B>,
  span: Span,
  li: LangItem,
): [FnAbi<Ty>, B["Value"], Instance] {
  const tcx = bx.tcx_();
  const def_id = tcx.require_lang_item(li, span);
  const instance = Instance.mono(tcx, def_id);
  return [
    bx.fn_abi_of_instance(instance, RawList.empty()),
    bx.get_fn_addr(instance, pointer_authentication_functions(tcx.sess)),
    instance,
  ];
}

// rustc: compiler/rustc_codegen_ssa/src/common.rs:127 shift_mask_val
export function shift_mask_val<B extends BackendTypes>(
  bx: BuilderMethods<B>,
  llty: B["Type"],
  mask_llty: B["Type"],
  invert: boolean,
): B["Value"] {
  const kind = bx.type_kind(llty);
  switch (kind) {
    case "Integer": {
      // i8/u8 can shift by at most 7, i16/u16 by at most 15, etc.
      const val = bx.int_width(llty) - 1;
      if (invert) {
        // PORT: `!val as i64` of a `u64` is `-1 - val`.
        return bx.const_int(mask_llty, BigInt(-1 - val));
      } else {
        return bx.const_uint(mask_llty, BigInt(val));
      }
    }
    case "Vector": {
      const mask = shift_mask_val(bx, bx.element_type(llty), bx.element_type(mask_llty), invert);
      return bx.vector_splat(bx.vector_length(mask_llty), mask);
    }
    default:
      return bug(`shift_mask_val: expected Integer or Vector, found ${debug_TypeKind(kind, PLAIN)}`);
  }
}

// rustc: compiler/rustc_codegen_ssa/src/common.rs:153 asm_const_to_str
export function asm_const_to_str(tcx: TyCtxt, sp: Span, scalar: ScalarInt, ty_and_layout: TyAndLayout): string {
  const value = scalar.to_bits(ty_and_layout.size);
  const kind = ty_and_layout.ty.kind();
  switch (kind.$) {
    case "Uint":
      return value.toString();
    case "Int":
      switch (IntTy.normalize(kind._0, tcx.sess.target.pointer_width)) {
        case "I8":
          return BigInt.asIntN(8, value).toString();
        case "I16":
          return BigInt.asIntN(16, value).toString();
        case "I32":
          return BigInt.asIntN(32, value).toString();
        case "I64":
          return BigInt.asIntN(64, value).toString();
        case "I128":
          return BigInt.asIntN(128, value).toString();
        case "Isize":
          return unreachable();
      }
    // For pointers without provenance, just print the unsigned value
    case "Ref":
    case "RawPtr":
    case "FnPtr":
      return value.toString();
    default:
      return span_bug(sp, `asm const has bad type ${display_Ty(ty_and_layout.ty)}`);
  }
}

/// "Clean" a const pointer by removing values where the resulting ASM will not be
/// `<symbol> + <offset>`.
///
/// These values are converted to `ScalarInt`.
// rustc: compiler/rustc_codegen_ssa/src/common.rs:180 asm_const_ptr_clean
export function asm_const_ptr_clean(tcx: TyCtxt, scalar: Scalar): Scalar {
  if (scalar.$ !== "Ptr") {
    return scalar;
  }
  const ptr = scalar._0;
  const [prov, offset] = ptr.prov_and_relative_offset();
  const global_alloc = tcx.global_alloc(CtfeProvenance.alloc_id(prov));
  if (global_alloc.$ === "TypeId") {
    // `TypeId` provenances are not a thing in codegen. Just erase and replace with scalar offset.
    return Scalar.from_u64(offset.bytes_u64());
  }
  if (global_alloc.$ === "Memory" && global_alloc._0.inner().len() === 0) {
    const alloc = global_alloc._0;
    // ZST const allocations don't actually get global defined when lowered.
    // Turn them into integer without provenances now.
    const val = BigInt.asUintN(64, BigInt(alloc.inner().align.bytes()) + offset.bytes_u64());
    return Scalar.from_target_usize(PointerArithmetic_provided.truncate_to_target_usize(tcx, val), tcx);
  }
  // Other types of `GlobalAlloc` are fine.
  return scalar;
}

// rustc: compiler/rustc_codegen_ssa/src/common.rs:202 is_using_dlltool
export function is_using_dlltool(target: Target): boolean {
  return target.os.$ === "Windows" && target.env.$ === "Gnu" && target.cfg_abi.$ === "Unspecified";
}

// rustc: compiler/rustc_codegen_ssa/src/common.rs:206 i686_decorated_name
export function i686_decorated_name(
  dll_import: DllImport,
  mingw: boolean,
  disable_name_mangling: boolean,
  force_fully_decorated: boolean,
): string {
  const name = Symbol.as_str(dll_import.name);

  let add_prefix: boolean, add_suffix: boolean;
  // No prefix is a bit weird, in that LLVM/ar_archive_writer won't emit it, so we will
  // ignore `force_fully_decorated` and always partially decorate it.
  if (dll_import.import_name_type?.$ === "NoPrefix") {
    [add_prefix, add_suffix] = [false, true];
  } else if (!force_fully_decorated && dll_import.import_name_type?.$ === "Undecorated") {
    [add_prefix, add_suffix] = [false, false];
  } else {
    [add_prefix, add_suffix] = [true, true];
  }

  // Worst case: +1 for disable name mangling, +1 for prefix, +4 for suffix (@@__).
  let decorated_name = "";

  if (disable_name_mangling) {
    // LLVM uses a binary 1 ('\x01') prefix to a name to indicate that mangling needs to be
    // disabled.
    decorated_name += "\x01";
  }

  let prefix: string | undefined;
  if (add_prefix && dll_import.symbol_type === DllImportSymbolType.Function) {
    switch (dll_import.calling_convention.$) {
      case "C":
      case "Vectorcall":
        prefix = undefined;
        break;
      case "Stdcall":
        prefix = !mingw || dll_import.import_name_type?.$ === "Decorated" ? "_" : undefined;
        break;
      case "Fastcall":
        prefix = "@";
        break;
    }
  } else if (dll_import.symbol_type !== DllImportSymbolType.Function && !mingw) {
    // For static variables, prefix with '_' on MSVC.
    prefix = "_";
  } else {
    prefix = undefined;
  }
  if (prefix !== undefined) {
    decorated_name += prefix;
  }

  decorated_name += name;

  if (add_suffix && dll_import.symbol_type === DllImportSymbolType.Function) {
    const cc = dll_import.calling_convention;
    switch (cc.$) {
      case "C":
        break;
      case "Stdcall":
      case "Fastcall":
        decorated_name += `@${cc._0}`;
        break;
      case "Vectorcall":
        decorated_name += `@@${cc._0}`;
        break;
    }
  }

  return decorated_name;
}
