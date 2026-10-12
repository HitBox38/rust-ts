// Port of compiler/rustc_session/src/lib.rs.
//
// PORT: `pub mod x;` -> `export * as x from "./x.ts"`. Modules not ported yet (code_stats,
// filesearch, output, search_paths, session) are listed as comments.
// `pub(crate) use rustc_lint_defs as lint;` is crate-private: modules import src/rustc_lint_defs directly.
// `pub use getopts;` (external crate) is not vendored yet.
import type { UnstableFeatures } from "../rustc_feature/lib.ts";
import type { DiagCtxtHandle } from "../rustc_errors/lib.ts";

// pub use session::*;
/**
 * PORT: pending session.rs (out of scope of lane session-parse). The minimal surface of
 * `rustc_session::Session` that the ported modules read (`diagnostics.rs`, `parse.rs`):
 * `sess.dcx()` (= `self.psess.dcx()`), `sess.unstable_features` and
 * `sess.opts.unstable_opts.ui_testing`. The real `Session` class must satisfy it structurally;
 * replace this declaration with `export * from "./session.ts"` once session.rs is ported.
 */
export interface Session {
  dcx(): DiagCtxtHandle;
  unstable_features: UnstableFeatures;
  opts: { unstable_opts: { ui_testing: boolean } };
}

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
// pub mod search_paths;
// mod session;
