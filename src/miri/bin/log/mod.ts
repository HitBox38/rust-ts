// Port of src/tools/miri/src/bin/log/mod.rs (crate `miri`, plan-m6 D2, D10).
// Fill lane: `miri-driver` (plan-m6 wave 36); ported by lane miri-log (D10), which owns it this wave.
// `mod tracing_chrome;` is excluded (D2: Miri is built without its `tracing` feature).
export * as setup from "./setup.ts";
