// Oracle probe for lane mbe-a (src/rustc_expand/mbe/mbe_oracle.test.ts; not part of the build).
//
// rustc_expand's mbe internals are crate-private, so the probe compiles the *pinned upstream sources*
// of mbe.rs, mbe/{quoted,macro_parser,macro_check,metavar_expr}.rs and diagnostics.rs verbatim
// against the pinned nightly's rustc-dev crates. Only `mbe/macro_rules.rs` is replaced by
// `macro_rules.rs` of this directory: the verbatim `Tracker` trait, `WhichMatcher`, `NoopTracker` and
// `parser_from_cx`, plus the probe driver (it must live inside `mod mbe` to see the private modules).
// `mbe/diagnostics.rs` and `mbe/transcribe.rs` are empty files.
//
// Build and run (from this directory; `$RUST_TS_DATA` from .env.local):
//
//   D=$RUST_TS_DATA/tmp/mbe-a/probe; U=$RUST_TS_DATA/rust/compiler/rustc_expand/src
//   rm -rf $D && mkdir -p $D/mbe && cp $U/diagnostics.rs $U/mbe.rs $D/ \
//     && cp $U/mbe/quoted.rs $U/mbe/macro_parser.rs $U/mbe/macro_check.rs $U/mbe/metavar_expr.rs $D/mbe/ \
//     && touch $D/mbe/diagnostics.rs $D/mbe/transcribe.rs \
//     && cp main.rs $D/main.rs && cp macro_rules.rs $D/mbe/macro_rules.rs
//   rustc +nightly-2026-10-11 --edition 2024 -O $D/main.rs -o $D/probe
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib $D/probe cases.txt > out.json
//
// (`LD_LIBRARY_PATH` / `PATH` instead of `DYLD_LIBRARY_PATH` on Linux / Windows.)
// The case format and the ops are described in macro_rules.rs.
#![feature(rustc_private)]
#![feature(associated_type_defaults)]
#![feature(default_field_values)]
#![feature(deref_patterns)]
#![feature(macro_metavar_expr)]
#![feature(try_blocks)]
#![feature(yeet_expr)]
#![allow(dead_code, unused_imports, unused_variables, internal_features)]

extern crate rustc_ast;
extern crate rustc_ast_pretty;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_errors;
extern crate rustc_feature;
extern crate rustc_interface;
extern crate rustc_lexer;
extern crate rustc_lint_defs;
extern crate rustc_macros;
extern crate rustc_parse;
extern crate rustc_serialize;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_structures;
extern crate smallvec;

mod diagnostics;
mod mbe;

fn main() {
    mbe::macro_rules::probe_main();
}
