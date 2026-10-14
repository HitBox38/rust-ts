// Port of compiler/rustc_hir_analysis/src/diagnostics.rs: the types and their `#[derive(Diagnostic)]` /
// `#[derive(Subdiagnostic)]` impls are generated into diagnostics.gen.ts (tools/codegen/types.ts, set rustc_hir_analysis);
// the manual `impl Diagnostic` blocks are ported here (lane hirtylowerer-contract generated the set; see
// docs/handoff/hirtylowerer-contract.md for the owners of the two manual impls).

export * from "./diagnostics.gen.ts";

// mod precise_captures; mod remove_or_use_generic; pub(crate) mod wrong_number_of_generic_args;
// (diagnostics/{precise_captures, remove_or_use_generic, wrong_number_of_generic_args}.rs: not ported; see the handoff's
// lane table)

// impl<'a> Diagnostic<'a> for MissingGenericParams
// (diagnostics.rs:477 into_diag: not ported; lane hir-ty-lowering-d, `MissingGenericParams_into_diag` + `_diagnostic`)

// impl<'tcx> Diagnostic<'tcx> for UncoveredTyParam<'tcx>
// (diagnostics.rs:2078 into_diag: not ported; coherence/orphan.rs is wave 17, lane coherence)
