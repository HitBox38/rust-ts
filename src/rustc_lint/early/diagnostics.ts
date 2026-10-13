// Port of compiler/rustc_lint/src/early/diagnostics.rs.
import type { Diag, DiagCtxtHandle, Diagnostic, Level } from "../../rustc_errors/lib.ts";
import type { Session } from "../../rustc_session/session.ts";

// PORT: the callback's `&dyn Any` argument is the `Session` (rustc_errors' `DecorateDiagCompat` convention).
export interface DiagAndSess {
  callback: (dcx: DiagCtxtHandle, level: Level, sess: unknown) => Diag;
  sess: Session;
}

/** `impl<'a> Diagnostic<'a> for DiagAndSess<'_>` */
// rustc: compiler/rustc_lint/src/early/diagnostics.rs:15 into_diag
export function DiagAndSess_into_diag(self: DiagAndSess, dcx: DiagCtxtHandle, level: Level): Diag {
  return self.callback(dcx, level, self.sess);
}

/** `DiagAndSess` as a `Diagnostic` trait object. */
export function DiagAndSess_diagnostic(self: DiagAndSess): Diagnostic {
  return { into_diag: (dcx, level) => DiagAndSess_into_diag(self, dcx, level) };
}
