// Port of src/tools/miri/src/concurrency/mod.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-threads` (plan-m6 wave 36),
// ported (the file has no fns: module declarations and re-exports).
//
// pub mod blocking_io; pub mod data_race; mod data_race_handler; pub mod init_once; pub mod scheduler; pub mod sync;
// pub mod thread; mod vector_clock; pub mod weak_memory;
// (the modules are loaded by src/miri/lib.ts, decision miri-contract C10)
//
// Import either the real genmc adapter or a dummy module.
// On unsupported platforms, we always include the dummy module, even if the `genmc` feature is enabled.
// #[cfg_attr(not(all(feature = "genmc", target_os = "linux", target_pointer_width = "64", target_endian = "little")),
//     path = "genmc/dummy.rs")]
// mod genmc;
// PORT (decision miri-contract C7): the oracle's Miri is built without `genmc`, so `genmc` is genmc/dummy.ts.

export { AllocDataRaceHandler, GlobalDataRaceHandler } from "./data_race_handler.ts";
export { ExitType, GenmcConfig, GenmcCtx, run_genmc_mode } from "./genmc/dummy.ts";
// pub use self::genmc::GenmcEvalContextExt: the trait's methods are `InterpCx` methods (genmc/dummy.ts).
export { VClock } from "./vector_clock.ts";
