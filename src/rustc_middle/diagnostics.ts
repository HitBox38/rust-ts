// Port of compiler/rustc_middle/src/diagnostics.rs: every type and its `#[derive(Diagnostic)]` impl is generated into
// diagnostics.gen.ts (tools/codegen/types.ts, set rustc_middle_diagnostics); the file has no hand-written impls.
export * from "./diagnostics.gen.ts";
