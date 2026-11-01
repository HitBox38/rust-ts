// Port of src/tools/miri/src/shims/unix/linux_like/sync.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-e` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into sync.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MPlaceTy } from "../../../lib.ts";
import { type MiriInterpCx } from "../../../machine.ts";
import { type Varargs } from "../../sig.ts";
import { type InterpResult } from "../../../../rustc_middle/mir/interpret/mod.ts";
import { unported } from "../../../../std/panic.ts";
export * from "./sync.gen.ts";

// shims/unix/linux_like/sync.rs:13 (pub)
export function futex(ecx: MiriInterpCx, varargs: Varargs, dest: MPlaceTy): InterpResult {
  return unported("miri::shims::unix::linux_like::sync::futex (src/tools/miri/src/shims/unix/linux_like/sync.rs:13; lane miri-shims-e)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl SyncObj for LinuxFutex (shims/unix/linux_like/sync.rs:9)
