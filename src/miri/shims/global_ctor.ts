// Port of src/tools/miri/src/shims/global_ctor.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-a` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into global_ctor.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type MiriInterpCx } from "../machine.ts";
import { GlobalCtorState } from "./global_ctor.gen.ts";
import { stub_methods } from "../../rust_ts/miri_stub.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
export * from "./global_ctor.gen.ts";

declare module "./global_ctor.gen.ts" {
  interface GlobalCtorState {
    // shims/global_ctor.rs:24
    on_stack_empty(this_: MiriInterpCx): InterpResult<Pending<"Poll<()>">>;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::global_ctor::GlobalCtorState", "src/tools/miri/src/shims/global_ctor.rs", "miri-shims-a", () => GlobalCtorState.prototype, ["on_stack_empty"]);
