// Port of src/tools/miri/src/shims/unix/foreign_items.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-c` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { type EmulateItemResult } from "../mod.ts";
import { stub_methods } from "../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../../rustc_middle/ty/mod.ts";
import { type Symbol } from "../../../rustc_span/symbol.ts";
import { type Os } from "../../../rustc_target/spec/mod.ts";
import { unported } from "../../../std/panic.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends Machine = Machine> {
    // ---- shims/unix/foreign_items.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/foreign_items.rs:55
    sysconf(this: MiriInterpCx, val: OpTy): InterpResult<Scalar>;
    // shims/unix/foreign_items.rs:87
    strerror_r(this: MiriInterpCx, errnum: OpTy, buf: OpTy, buflen: OpTy): InterpResult<Scalar>;
  }
}

// shims/unix/foreign_items.rs:111 (`EvalContextExt::emulate_foreign_item_inner`; PORT: decision C9, a module fn taking `this_`: the trait is called by path)
export function emulate_foreign_item_inner(this_: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  return unported("miri::shims::unix::foreign_items::EvalContextExt::emulate_foreign_item_inner (src/tools/miri/src/shims/unix/foreign_items.rs:111; lane miri-shims-c)");
}
// shims/unix/foreign_items.rs:22 (pub)
export function is_dyn_sym(name: string, target_os: Os): boolean {
  return unported("miri::shims::unix::foreign_items::is_dyn_sym (src/tools/miri/src/shims/unix/foreign_items.rs:22; lane miri-shims-c)");
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unix::foreign_items::EvalContextExt", "src/tools/miri/src/shims/unix/foreign_items.rs", "miri-shims-c", () => InterpCx.prototype, ["sysconf", "strerror_r"]);
