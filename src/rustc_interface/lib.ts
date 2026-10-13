// Port of compiler/rustc_interface/src/lib.rs (module wiring). Partial: see each module's header.
// mod callbacks;  (not ported: `setup_callbacks` installs rustc_middle hooks; see interface.ts)
// pub mod diagnostics;  (not ported)
// PORT: `interface` is reserved in strict mode: the module namespace is `interface_`.
export * as interface_ from "./interface.ts";
// mod limits;  (not ported)
export * as passes from "./passes.ts";
// mod queries;  (not ported: `Linker`)
export * as util from "./util.ts";

export { type Config, run_compiler } from "./interface.ts";
export { create_and_enter_global_ctxt, parse } from "./passes.ts";
