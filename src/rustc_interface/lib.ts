// Port of compiler/rustc_interface/src/lib.rs (module wiring). Partial: see each module's header.
// mod callbacks;  (partial: `DEF_ID_DEBUG` only, see callbacks.ts)
export { setup_callbacks } from "./callbacks.ts";
// pub mod diagnostics;  (not ported)
// PORT: `interface` is reserved in strict mode: the module namespace is `interface_`.
export * as interface_ from "./interface.ts";
// mod limits;  (not ported)
export * as passes from "./passes.ts";
export { Linker } from "./queries.ts";
export * as util from "./util.ts";

export { type Config, run_compiler } from "./interface.ts";
export { create_and_enter_global_ctxt, parse } from "./passes.ts";
