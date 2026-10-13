// Stub of compiler/rustc_lint/src/non_ascii_idents.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (non_ascii_idents.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { NonAsciiIdents } from "./non_ascii_idents.lints.gen.ts";

export * from "./non_ascii_idents.lints.gen.ts";

// impl EarlyLintPass for NonAsciiIdents (non_ascii_idents.rs:154)
unported_methods(NonAsciiIdents.prototype, "rustc_lint::non_ascii_idents::NonAsciiIdents", ["check_crate"]);
