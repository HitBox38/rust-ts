// rust-ts port of src/tools/clippy/clippy_config/src/lib.rs.
//
// #![feature(io_error_more, rustc_private)]
// #![warn(rust_2018_idioms, trivial_casts, trivial_numeric_casts, unused_lifetimes, unused_qualifications)]
// #![expect(clippy::must_use_candidate)]
//
// extern crate rustc_attr_ir; rustc_attr_parsing; rustc_data_structures; rustc_errors; rustc_hir; rustc_middle;
// rustc_session; rustc_span;

// #[macro_use]
// mod de;
// mod conf;
// mod metadata;
// pub mod types;
export * as types from "./types.ts";

export { Conf, sanitize_explanation } from "./conf.ts";
// PORT: `pub use metadata::ConfMetadata` carries its `impl Display`; in TS that impl is the function
// `display_ConfMetadata`, so it is re-exported beside the type.
export { ConfMetadata, display_ConfMetadata } from "./metadata.ts";

// PORT: conf.gen.ts is the expansion of conf.rs's `define_Conf!`; it is imported after conf.ts so that, once
// codegen-clippy-conf writes them, its assignments of `Conf.default`, `Conf.get_metadata` and `Conf.deserialize` run
// before anything uses `Conf`.
import "./conf.ts";
import "./conf.gen.ts";
