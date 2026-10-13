// Port of compiler/rustc_metadata/src/diagnostics.rs.
//
// The `#[derive(Diagnostic)]` types are generated into diagnostics.gen.ts (tools/codegen/types.ts, set
// `rustc_metadata`). PORT: the three hand-written `impl Diagnostic` (`MultipleCandidates` :308,
// `InvalidMetadataFiles` :421, `CannotFindCrate` :453) are only reached by the locator's error reporting
// (`CrateError::report`); the locator lane ports them here.
export * from "./diagnostics.gen.ts";
