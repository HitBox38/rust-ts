//! Some lints that are built in to the compiler.
//!
//! These are the built-in lints that are emitted direct in the main
//! compiler code, rather than using their own custom pass. Those
//! lints are all available in `rustc_lint::builtin`.
//!
//! When removing a lint, make sure to also add a call to `register_removed` in
//! compiler/rustc_lint/src/lib.rs.
// Port of compiler/rustc_lint_defs/src/builtin.rs. Everything in it is a `declare_lint!` static, the
// `declare_lint_pass!(UnusedDocComment => ..)` pass or `hardwired::lint_vec`, all generated into
// builtin.gen.ts by tools/codegen/lints.ts (PORTING §5).
export * from "./builtin.gen.ts";
