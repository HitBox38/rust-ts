// Port of src/tools/miri/src/shims/unix/linux_like/syscall.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-e` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy, type OpTy } from "../../../lib.ts";
import { type MiriInterpCx } from "../../../machine.ts";
import { type InterpResult } from "../../../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../../../rustc_middle/ty/decls.ts";
import { type Ty } from "../../../../rustc_middle/ty/mod.ts";
import { type Symbol } from "../../../../rustc_span/symbol.ts";
import { unported } from "../../../../std/panic.ts";

// shims/unix/linux_like/syscall.rs:11 (pub)
export function syscall(ecx: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: MPlaceTy): InterpResult {
  return unported("miri::shims::unix::linux_like::syscall::syscall (src/tools/miri/src/shims/unix/linux_like/syscall.rs:11; lane miri-shims-e)");
}
