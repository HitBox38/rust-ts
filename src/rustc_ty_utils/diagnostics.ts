// Port of compiler/rustc_ty_utils/src/diagnostics.rs: every type and its `#[derive(Diagnostic)]` /
// `#[derive(Subdiagnostic)]` impl is generated into diagnostics.gen.ts (tools/codegen/types.ts, set rustc_ty_utils); the
// file has no hand-written impls.
//! Errors emitted by ty_utils
export * from "./diagnostics.gen.ts";
