// Port of compiler/rustc_lint/src/expect.rs: `provide`. The two queries (`lint_expectations`,
// `check_expectations`) need the HIR (M3): stubs with `unported` bodies, no markers.
import type { Providers as QueryProviders } from "../rustc_middle/queries.gen.ts";
import { unported } from "../std/panic.ts";

// rustc: compiler/rustc_lint/src/expect.rs:11 provide
export function provide(providers: QueryProviders): void {
  providers.lint_expectations = lint_expectations;
  providers.check_expectations = check_expectations;
}

/** `fn lint_expectations` (expect.rs:15). PORT: stub (HIR, M3). */
function lint_expectations(_tcx: unknown, _: null): never {
  return unported("rustc_lint::expect::lint_expectations (tcx.hir_crate_items: HIR, M3)");
}

/** `fn check_expectations` (expect.rs:28). PORT: stub (M3). */
function check_expectations(_tcx: unknown, _tool_filter: unknown): never {
  return unported("rustc_lint::expect::check_expectations (M3)");
}
