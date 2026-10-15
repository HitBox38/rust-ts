// Port of compiler/rustc_mir_build/src/thir/mod.rs (lane thir-cx-print).
//! The MIR is built from some typed high-level IR
//! (THIR). This section defines the THIR along with a trait for
//! accessing it. The intention is to allow MIR construction to be
//! unit-tested and separated from the Rust source and compiler data
//! structures.
//
// PORT: `cx` and `pattern` carry `impl` blocks split over several files (extension modules); the crate root (lib.ts)
// loads them in order. This module re-exports the submodules as namespaces.

// pub(crate) mod constant;
export * as constant from "./constant.ts";
// pub(crate) mod cx;
export * as cx from "./cx/mod.ts";
// pub(crate) mod pattern;
export * as pattern from "./pattern/mod.ts";
// pub mod print;
export * as print from "./print.ts";
// mod util;
export * as util from "./util.ts";
