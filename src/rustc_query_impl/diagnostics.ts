// Port of compiler/rustc_query_impl/src/diagnostics.rs. Every type and `#[derive(Diagnostic)]` /
// `#[derive(Subdiagnostic)]` impl is generated into diagnostics.gen.ts (tools/codegen/types.ts, set
// `rustc_query_impl`); the file has no hand-written fns.
export * from "./diagnostics.gen.ts";
