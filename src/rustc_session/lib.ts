// Port of compiler/rustc_session/src/lib.rs.
//
// PORT: `pub mod x;` -> `export * as x from "./x.ts"`. Modules not ported yet (code_stats,
// filesearch, output, search_paths, session) are listed as comments.
// `pub(crate) use rustc_lint_defs as lint;` is crate-private: modules import src/rustc_lint_defs directly.

// pub use session::*;
// PORT: LOAD ORDER: options.ts is evaluated before config.ts (see config.ts header), and utils.ts
// (which extends `Session`) after session.ts.
import "./options.ts";
export * from "./session.ts";

// pub mod code_stats;
export * as diagnostics from "./diagnostics.ts";
export * as parse from "./parse.ts";
export * as utils from "./utils.ts";
// #[macro_use] pub mod config;
export * as config from "./config.ts";
// pub mod filesearch;
// mod macros;
// mod options;
// PORT: config.rs's `pub use crate::options::*` is not mirrored in config.ts (load-order cycle, see
// docs/handoff/session-options.md decision 2); options are reached through `./options.ts`.
export * as options from "./options.ts";
import "./options/mitigation_coverage.ts";
// pub mod output;
export * as getopts from "../vendor/getopts/lib.ts";
// pub mod search_paths;
// mod session; (re-exported above)
import "./utils.ts";
