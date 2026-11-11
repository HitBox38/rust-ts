// Tests of llvm/conversions.ts (lane cg-contract). Upstream has none. Every expected pair is read off
// compiler/rustc_codegen_llvm/src/llvm/conversions.rs at the pin (the line of each `match` is cited per table), and each
// table lists every variant of the source enum, which the test checks against the enum's companion const.
import { describe, expect, test } from "bun:test";
import { AtomicRmwBinOp, IntPredicate, RealPredicate, TypeKind as generic_TypeKind } from "../../rustc_codegen_ssa/common.ts";
import { AtomicOrdering } from "../../rustc_middle/ty/consts/int.ts";
import { DebugInfo } from "../../rustc_session/config.ts";
import { SymbolVisibility } from "../../rustc_target/spec/mod.ts";
import * as llvm from "../../rust_ts/llvm/ffi.ts";
import {
  FromGeneric_for_AtomicOrdering,
  FromGeneric_for_AtomicRmwBinOp,
  FromGeneric_for_DebugEmissionKind,
  FromGeneric_for_IntPredicate,
  FromGeneric_for_RealPredicate,
  FromGeneric_for_Visibility,
  ToGeneric_for_TypeKind,
} from "./conversions.ts";

/** The string-union variants of a companion const (its string-valued keys). */
function variants(companion: object): string[] {
  return Object.entries(companion)
    .filter(([k, v]) => typeof v === "string" && k === v)
    .map(([k]) => k);
}

function check<A extends string, B extends string>(f: (a: A) => B, source: object, target: object, table: readonly [A, B][]): void {
  // The table covers every source variant, once.
  expect(table.map(([a]): string => a).sort()).toEqual(variants(source).sort());
  for (const [a, b] of table) {
    expect(f(a)).toBe(b);
    // Each result is a variant of the LLVM-side enum.
    expect(variants(target)).toContain(b);
  }
}

describe("FromGeneric", () => {
  test("SymbolVisibility -> llvm::Visibility (conversions.rs:30)", () => {
    check(FromGeneric_for_Visibility.from_generic, SymbolVisibility, llvm.Visibility, [
      ["Hidden", "Hidden"],
      ["Protected", "Protected"],
      ["Interposable", "Default"],
    ]);
  });

  test("IntPredicate -> llvm::IntPredicate (conversions.rs:40)", () => {
    check(FromGeneric_for_IntPredicate.from_generic, IntPredicate, llvm.IntPredicate, [
      ["IntEQ", "IntEQ"],
      ["IntNE", "IntNE"],
      ["IntUGT", "IntUGT"],
      ["IntUGE", "IntUGE"],
      ["IntULT", "IntULT"],
      ["IntULE", "IntULE"],
      ["IntSGT", "IntSGT"],
      ["IntSGE", "IntSGE"],
      ["IntSLT", "IntSLT"],
      ["IntSLE", "IntSLE"],
    ]);
  });

  test("RealPredicate -> llvm::RealPredicate (conversions.rs:57)", () => {
    check(FromGeneric_for_RealPredicate.from_generic, RealPredicate, llvm.RealPredicate, [
      ["RealPredicateFalse", "RealPredicateFalse"],
      ["RealOEQ", "RealOEQ"],
      ["RealOGT", "RealOGT"],
      ["RealOGE", "RealOGE"],
      ["RealOLT", "RealOLT"],
      ["RealOLE", "RealOLE"],
      ["RealONE", "RealONE"],
      ["RealORD", "RealORD"],
      ["RealUNO", "RealUNO"],
      ["RealUEQ", "RealUEQ"],
      ["RealUGT", "RealUGT"],
      ["RealUGE", "RealUGE"],
      ["RealULT", "RealULT"],
      ["RealULE", "RealULE"],
      ["RealUNE", "RealUNE"],
      ["RealPredicateTrue", "RealPredicateTrue"],
    ]);
  });

  test("AtomicRmwBinOp -> llvm::AtomicRmwBinOp (conversions.rs:80)", () => {
    check(FromGeneric_for_AtomicRmwBinOp.from_generic, AtomicRmwBinOp, llvm.AtomicRmwBinOp, [
      ["AtomicXchg", "AtomicXchg"],
      ["AtomicAdd", "AtomicAdd"],
      ["AtomicSub", "AtomicSub"],
      ["AtomicAnd", "AtomicAnd"],
      ["AtomicNand", "AtomicNand"],
      ["AtomicOr", "AtomicOr"],
      ["AtomicXor", "AtomicXor"],
      ["AtomicMax", "AtomicMax"],
      ["AtomicMin", "AtomicMin"],
      ["AtomicUMax", "AtomicUMax"],
      ["AtomicUMin", "AtomicUMin"],
    ]);
  });

  test("AtomicOrdering -> llvm::AtomicOrdering (conversions.rs:98): Relaxed is Monotonic, AcqRel AcquireRelease", () => {
    check(FromGeneric_for_AtomicOrdering.from_generic, AtomicOrdering, llvm.AtomicOrdering, [
      ["Relaxed", "Monotonic"],
      ["Acquire", "Acquire"],
      ["Release", "Release"],
      ["AcqRel", "AcquireRelease"],
      ["SeqCst", "SequentiallyConsistent"],
    ]);
  });

  test("DebugInfo -> llvm::debuginfo::DebugEmissionKind (conversions.rs:120): Limited and Full are FullDebug", () => {
    check(FromGeneric_for_DebugEmissionKind.from_generic, DebugInfo, llvm.DebugEmissionKind, [
      ["None", "NoDebug"],
      ["LineDirectivesOnly", "DebugDirectivesOnly"],
      ["LineTablesOnly", "LineTablesOnly"],
      ["Limited", "FullDebug"],
      ["Full", "FullDebug"],
    ]);
  });
});

describe("ToGeneric", () => {
  test("llvm::TypeKind -> TypeKind (conversions.rs:131): every LLVM type kind, by name", () => {
    const table = variants(llvm.TypeKind).map((k) => [k, k] as [llvm.TypeKind, generic_TypeKind]);
    expect(table.length).toBe(19);
    check(ToGeneric_for_TypeKind.to_generic, llvm.TypeKind, generic_TypeKind, table);
    // ... and the generic enum has exactly these variants.
    expect(variants(generic_TypeKind).sort()).toEqual(variants(llvm.TypeKind).sort());
  });

  test("through the IR model: LLVMGetTypeKind(..).to_rust().to_generic() (type_.rs:242's chain)", () => {
    const cx = llvm.LLVMContextCreate();
    const cases: [llvm.Type, generic_TypeKind][] = [
      [llvm.LLVMInt8TypeInContext(cx), "Integer"],
      [llvm.LLVMDoubleTypeInContext(cx), "Double"],
      [llvm.LLVMFloatTypeInContext(cx), "Float"],
      [llvm.LLVMHalfTypeInContext(cx), "Half"],
      [llvm.LLVMVoidTypeInContext(cx), "Void"],
      [llvm.LLVMPointerTypeInContext(cx, 0), "Pointer"],
    ];
    for (const [ty, kind] of cases) {
      expect(ToGeneric_for_TypeKind.to_generic(llvm.LLVMGetTypeKind(ty).to_rust())).toBe(kind);
    }
  });
});
