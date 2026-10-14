// Port of compiler/rustc_privacy/src/diagnostics.rs: every type and its `#[derive(Diagnostic)]` /
// `#[derive(Subdiagnostic)]` impl is generated into diagnostics.gen.ts (tools/codegen/types.ts, set rustc_privacy); the
// file has no hand-written impls.
export * from "./diagnostics.gen.ts";
