//! Conversions from backend-independent data types to/from LLVM FFI types.
//
// Port of compiler/rustc_codegen_llvm/src/llvm/conversions.rs (lane cg-contract).
//
// PORT (cg-contract): the traits `FromGeneric<T>` / `ToGeneric<T>` have one method each and are only ever called on a
// concrete type (`llvm::IntPredicate::from_generic(op)`), so each impl is a const `<Trait>_for_<Type>` (the
// `ModuleBufferMethods_for_Infallible` form): `llvm::Visibility::from_generic(v)` is `FromGeneric_for_Visibility.
// from_generic(v)`, `llvm::LLVMGetTypeKind(ty).to_rust().to_generic()` is `ToGeneric_for_TypeKind.to_generic(..)`.
// `llvm::debuginfo::DebugEmissionKind` is ffi.ts's `DebugEmissionKind` (its `mod debuginfo` items are flat there).
import type {
  AtomicRmwBinOp as generic_AtomicRmwBinOp,
  IntPredicate as generic_IntPredicate,
  RealPredicate as generic_RealPredicate,
  TypeKind as generic_TypeKind,
} from "../../rustc_codegen_ssa/common.ts";
import type { AtomicOrdering as generic_AtomicOrdering } from "../../rustc_middle/ty/consts/int.ts";
import type { DebugInfo } from "../../rustc_session/config.ts";
import type { SymbolVisibility } from "../../rustc_target/spec/mod.ts";
import type * as llvm from "../../rust_ts/llvm/ffi.ts";

/// Helper trait for converting backend-independent types to LLVM-specific
/// types, for FFI purposes.
///
/// FIXME(#147327): These trait/method names were chosen to avoid churn in
/// existing code, but are not great and could probably be made clearer.
// rustc-trait: compiler/rustc_codegen_llvm/src/llvm/conversions.rs:15 FromGeneric
export interface FromGeneric<T, Self> {
  // rustc: compiler/rustc_codegen_llvm/src/llvm/conversions.rs:16 from_generic
  from_generic(other: T): Self;
}

/// Helper trait for converting LLVM-specific types to backend-independent
/// types, for FFI purposes.
///
/// FIXME(#147327): These trait/method names were chosen to avoid churn in
/// existing code, but are not great and could probably be made clearer.
// rustc-trait: compiler/rustc_codegen_llvm/src/llvm/conversions.rs:24 ToGeneric
export interface ToGeneric<T, Self> {
  // rustc: compiler/rustc_codegen_llvm/src/llvm/conversions.rs:25 to_generic
  to_generic(self: Self): T;
}

/** `impl FromGeneric<SymbolVisibility> for llvm::Visibility` */
export const FromGeneric_for_Visibility: FromGeneric<SymbolVisibility, llvm.Visibility> = {
  // rustc: compiler/rustc_codegen_llvm/src/llvm/conversions.rs:29 from_generic
  from_generic(visibility: SymbolVisibility): llvm.Visibility {
    switch (visibility) {
      case "Hidden":
        return "Hidden";
      case "Protected":
        return "Protected";
      case "Interposable":
        return "Default";
    }
  },
};

/** `impl FromGeneric<IntPredicate> for llvm::IntPredicate` */
export const FromGeneric_for_IntPredicate: FromGeneric<generic_IntPredicate, llvm.IntPredicate> = {
  // rustc: compiler/rustc_codegen_llvm/src/llvm/conversions.rs:39 from_generic
  from_generic(int_pred: generic_IntPredicate): llvm.IntPredicate {
    switch (int_pred) {
      case "IntEQ":
        return "IntEQ";
      case "IntNE":
        return "IntNE";
      case "IntUGT":
        return "IntUGT";
      case "IntUGE":
        return "IntUGE";
      case "IntULT":
        return "IntULT";
      case "IntULE":
        return "IntULE";
      case "IntSGT":
        return "IntSGT";
      case "IntSGE":
        return "IntSGE";
      case "IntSLT":
        return "IntSLT";
      case "IntSLE":
        return "IntSLE";
    }
  },
};

/** `impl FromGeneric<RealPredicate> for llvm::RealPredicate` */
export const FromGeneric_for_RealPredicate: FromGeneric<generic_RealPredicate, llvm.RealPredicate> = {
  // rustc: compiler/rustc_codegen_llvm/src/llvm/conversions.rs:56 from_generic
  from_generic(real_pred: generic_RealPredicate): llvm.RealPredicate {
    switch (real_pred) {
      case "RealPredicateFalse":
        return "RealPredicateFalse";
      case "RealOEQ":
        return "RealOEQ";
      case "RealOGT":
        return "RealOGT";
      case "RealOGE":
        return "RealOGE";
      case "RealOLT":
        return "RealOLT";
      case "RealOLE":
        return "RealOLE";
      case "RealONE":
        return "RealONE";
      case "RealORD":
        return "RealORD";
      case "RealUNO":
        return "RealUNO";
      case "RealUEQ":
        return "RealUEQ";
      case "RealUGT":
        return "RealUGT";
      case "RealUGE":
        return "RealUGE";
      case "RealULT":
        return "RealULT";
      case "RealULE":
        return "RealULE";
      case "RealUNE":
        return "RealUNE";
      case "RealPredicateTrue":
        return "RealPredicateTrue";
    }
  },
};

/** `impl FromGeneric<AtomicRmwBinOp> for llvm::AtomicRmwBinOp` */
export const FromGeneric_for_AtomicRmwBinOp: FromGeneric<generic_AtomicRmwBinOp, llvm.AtomicRmwBinOp> = {
  // rustc: compiler/rustc_codegen_llvm/src/llvm/conversions.rs:79 from_generic
  from_generic(op: generic_AtomicRmwBinOp): llvm.AtomicRmwBinOp {
    switch (op) {
      case "AtomicXchg":
        return "AtomicXchg";
      case "AtomicAdd":
        return "AtomicAdd";
      case "AtomicSub":
        return "AtomicSub";
      case "AtomicAnd":
        return "AtomicAnd";
      case "AtomicNand":
        return "AtomicNand";
      case "AtomicOr":
        return "AtomicOr";
      case "AtomicXor":
        return "AtomicXor";
      case "AtomicMax":
        return "AtomicMax";
      case "AtomicMin":
        return "AtomicMin";
      case "AtomicUMax":
        return "AtomicUMax";
      case "AtomicUMin":
        return "AtomicUMin";
    }
  },
};

/** `impl FromGeneric<AtomicOrdering> for llvm::AtomicOrdering` */
export const FromGeneric_for_AtomicOrdering: FromGeneric<generic_AtomicOrdering, llvm.AtomicOrdering> = {
  // rustc: compiler/rustc_codegen_llvm/src/llvm/conversions.rs:97 from_generic
  from_generic(ordering: generic_AtomicOrdering): llvm.AtomicOrdering {
    switch (ordering) {
      case "Relaxed":
        return "Monotonic";
      case "Acquire":
        return "Acquire";
      case "Release":
        return "Release";
      case "AcqRel":
        return "AcquireRelease";
      case "SeqCst":
        return "SequentiallyConsistent";
    }
  },
};

/** `impl FromGeneric<DebugInfo> for llvm::debuginfo::DebugEmissionKind` */
export const FromGeneric_for_DebugEmissionKind: FromGeneric<DebugInfo, llvm.DebugEmissionKind> = {
  // rustc: compiler/rustc_codegen_llvm/src/llvm/conversions.rs:109 from_generic
  from_generic(kind: DebugInfo): llvm.DebugEmissionKind {
    // We should be setting LLVM's emission kind to `LineTablesOnly` if
    // we are compiling with "limited" debuginfo. However, some of the
    // existing tools relied on slightly more debuginfo being generated than
    // would be the case with `LineTablesOnly`, and we did not want to break
    // these tools in a "drive-by fix", without a good idea or plan about
    // what limited debuginfo should exactly look like. So for now we are
    // instead adding a new debuginfo option "line-tables-only" so as to
    // not break anything and to allow users to have 'limited' debug info.
    //
    // See https://github.com/rust-lang/rust/issues/60020 for details.
    switch (kind) {
      case "None":
        return "NoDebug";
      case "LineDirectivesOnly":
        return "DebugDirectivesOnly";
      case "LineTablesOnly":
        return "LineTablesOnly";
      case "Limited":
      case "Full":
        return "FullDebug";
    }
  },
};

/** `impl ToGeneric<TypeKind> for llvm::TypeKind` */
export const ToGeneric_for_TypeKind: ToGeneric<generic_TypeKind, llvm.TypeKind> = {
  // rustc: compiler/rustc_codegen_llvm/src/llvm/conversions.rs:130 to_generic
  to_generic(self: llvm.TypeKind): generic_TypeKind {
    switch (self) {
      case "Void":
        return "Void";
      case "Half":
        return "Half";
      case "Float":
        return "Float";
      case "Double":
        return "Double";
      case "X86_FP80":
        return "X86_FP80";
      case "FP128":
        return "FP128";
      case "PPC_FP128":
        return "PPC_FP128";
      case "Label":
        return "Label";
      case "Integer":
        return "Integer";
      case "Function":
        return "Function";
      case "Struct":
        return "Struct";
      case "Array":
        return "Array";
      case "Pointer":
        return "Pointer";
      case "Vector":
        return "Vector";
      case "Metadata":
        return "Metadata";
      case "Token":
        return "Token";
      case "ScalableVector":
        return "ScalableVector";
      case "BFloat":
        return "BFloat";
      case "X86_AMX":
        return "X86_AMX";
    }
  },
};
