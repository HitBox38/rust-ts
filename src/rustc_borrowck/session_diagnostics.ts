// Port of compiler/rustc_borrowck/src/session_diagnostics.rs (lane borrowck-contract: declarations; fill lane bck-diag-f, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
// The `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` / `#[derive(LintDiagnostic)]` types and their impls are
// generated in session_diagnostics.gen.ts (set rustc_borrowck); the manual `impl Diagnostic for TailExprDropOrder<F>` is
// declared here (precedent rustc_mir_transform diagnostics.ts `AssertLint_into_diag` / `AssertLint_diagnostic`).
// PORT: `F: FnOnce(&mut Diag<'_>)` is the arrow type `(diag: Diag) => void` (the `Diag` object is mutated in place).
import type { Diag, DiagCtxtHandle, Diagnostic, Level } from "../rustc_errors/lib.ts";
import { unported } from "../std/panic.ts";
import type { TailExprDropOrder } from "./session_diagnostics.gen.ts";

export * from "./session_diagnostics.gen.ts";

// impl<'a, F: FnOnce(&mut Diag<'_>)> Diagnostic<'a> for TailExprDropOrder<F>
// stub: compiler/rustc_borrowck/src/session_diagnostics.rs:668 into_diag (lane bck-diag-f)
export function TailExprDropOrder_into_diag<F extends (diag: Diag) => void>(self: TailExprDropOrder<F>, dcx: DiagCtxtHandle, level: Level): Diag {
  return unported("rustc_borrowck::session_diagnostics::TailExprDropOrder::into_diag");
}
/** `TailExprDropOrder<F>` as a `Diagnostic` trait object. */
export function TailExprDropOrder_diagnostic<F extends (diag: Diag) => void>(self: TailExprDropOrder<F>): Diagnostic {
  return { into_diag: (dcx, level) => TailExprDropOrder_into_diag(self, dcx, level) };
}
