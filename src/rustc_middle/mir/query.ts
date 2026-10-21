// Port of compiler/rustc_middle/src/mir/query.rs (lane mir-contract, plan-m4 D3): every type of the file (coroutine
// layouts, `ConstQualifs`, `ConstraintCategory`, ...) is generated with its derived impls into query.gen.ts (set
// rustc_middle_mir); the file's one fn (the manual `Debug` of `CoroutineLayout`) is a stub for lane mir-body-a.
//! Values computed by queries that use MIR.
import "./mod.ts";
import type { Debug } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import type { CoroutineLayout } from "./query.gen.ts";
export * from "./query.gen.ts";

// impl Debug for CoroutineLayout<'_>
// stub: compiler/rustc_middle/src/mir/query.rs:59 fmt (lane mir-body-a)
export const debug_CoroutineLayout: Debug<CoroutineLayout> = (self, fmt) => {
  return unported("rustc_middle::mir::query::<CoroutineLayout as Debug>::fmt");
};
