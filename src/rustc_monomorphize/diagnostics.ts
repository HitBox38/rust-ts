// Port of compiler/rustc_monomorphize/src/diagnostics.rs: every type and its `#[derive(Diagnostic)]` impl is generated
// into diagnostics.gen.ts (tools/codegen/types.ts, set rustc_monomorphize); the file has no hand-written impls.
//
// PORT(contract): the set `rustc_monomorphize` is not in tools/codegen/types.sets.json yet (lanes do not edit tools/);
// diagnostics.gen.ts is that generator's unedited output, run on a scratch copy holding the entry written out in
// docs/handoff/mono-collector.md. Root adds the entry in a tools batch; regenerating then gives the same file.
export * from "./diagnostics.gen.ts";
