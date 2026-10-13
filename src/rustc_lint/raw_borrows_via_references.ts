// Stub of compiler/rustc_lint/src/raw_borrows_via_references.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (raw_borrows_via_references.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { RawBorrowsViaReferences } from "./raw_borrows_via_references.lints.gen.ts";

export * from "./raw_borrows_via_references.lints.gen.ts";

// impl LateLintPass for RawBorrowsViaReferences (raw_borrows_via_references.rs:53)
unported_methods(RawBorrowsViaReferences.prototype, "rustc_lint::raw_borrows_via_references::RawBorrowsViaReferences", ["check_expr"]);
