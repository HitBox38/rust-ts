// Port of src/tools/miri/src/shims/extern_static.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-a` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type ImmTy, type Pointer } from "../lib.ts";
import { type MiriInterpCx, MiriMachine } from "../machine.ts";
import { stub_statics } from "../../rust_ts/miri_stub.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";

declare module "../machine.gen.ts" {
  namespace MiriMachine {
    // shims/extern_static.rs:9
    export let add_extern_static: (ecx: MiriInterpCx, name: string, ptr: Pointer) => void;
    // shims/extern_static.rs:15
    export let alloc_extern_static: (ecx: MiriInterpCx, name: string, val: ImmTy) => InterpResult;
    // shims/extern_static.rs:27
    export let add_weak_symbol: (ecx: MiriInterpCx, name: string, ptr: Pointer) => InterpResult;
    // shims/extern_static.rs:42
    export let weak_fn_symbols: (ecx: MiriInterpCx, names: readonly string[]) => InterpResult;
    // shims/extern_static.rs:52
    export let init_extern_statics: (ecx: MiriInterpCx) => InterpResult;
  }
}

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_statics("miri::shims::extern_static::MiriMachine", "src/tools/miri/src/shims/extern_static.rs", "miri-shims-a", () => MiriMachine, ["add_extern_static", "alloc_extern_static", "add_weak_symbol", "weak_fn_symbols", "init_extern_statics"]);
