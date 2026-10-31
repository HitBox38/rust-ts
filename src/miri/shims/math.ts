// Port of src/tools/miri/src/shims/math.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-b` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type EmulateItemResult } from "./mod.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";
import { unported } from "../../std/panic.ts";

// shims/math.rs:12 (`EvalContextExt::emulate_foreign_item_inner`; PORT: decision C9, a module fn taking `this_`: the trait is called by path)
export function emulate_foreign_item_inner(this_: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult> {
  return unported("miri::shims::math::EvalContextExt::emulate_foreign_item_inner (src/tools/miri/src/shims/math.rs:12; lane miri-shims-b)");
}
