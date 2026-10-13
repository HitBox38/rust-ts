// Port of compiler/rustc_resolve/src/diagnostics/mod.rs
//
// The `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` / `#[derive(LintDiagnostic)]` structs of
// this file and their impls are generated into mod.gen.ts (tools/codegen/types.ts, set
// `rustc_resolve`). Stub (contract-first, lane res-lib): the two manual impls below have their
// final signatures and `unported` bodies, without markers; the lane that ports diagnostics/mod.rs
// replaces them in place, adding the `// rustc: ` markers (docs/handoff/res-lib.md).
// Init order: top-level code here may touch only this file's `.gen.ts` and other crates.
import type { Diag, DiagCtxtHandle, Diagnostic, Level, Subdiagnostic } from "../../rustc_errors/lib.ts";
import { unported } from "../../std/panic.ts";
import type { Ambiguity, FoundItemConfigureOut } from "./mod.gen.ts";

export * from "./mod.gen.ts";

// impl Subdiagnostic for FoundItemConfigureOut
/** Stub: `diagnostics/mod.rs:1388` `<FoundItemConfigureOut as Subdiagnostic>::add_to_diag` (unported). */
export function FoundItemConfigureOut_add_to_diag(self: FoundItemConfigureOut, diag: Diag): void {
  unported("rustc_resolve::diagnostics::<FoundItemConfigureOut as Subdiagnostic>::add_to_diag");
}
/** `FoundItemConfigureOut` as a `Subdiagnostic` trait object. */
export function FoundItemConfigureOut_subdiagnostic(self: FoundItemConfigureOut): Subdiagnostic {
  return { add_to_diag: (diag) => FoundItemConfigureOut_add_to_diag(self, diag) };
}

// impl<'a> Diagnostic<'a> for Ambiguity
/** Stub: `diagnostics/mod.rs:1535` `<Ambiguity as Diagnostic>::into_diag` (unported). */
export function Ambiguity_into_diag(self: Ambiguity, dcx: DiagCtxtHandle, level: Level): Diag {
  return unported("rustc_resolve::diagnostics::<Ambiguity as Diagnostic>::into_diag");
}
/** `Ambiguity` as a `Diagnostic` trait object. */
export function Ambiguity_diagnostic(self: Ambiguity): Diagnostic {
  return { into_diag: (dcx, level) => Ambiguity_into_diag(self, dcx, level) };
}
