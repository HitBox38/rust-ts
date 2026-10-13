// Stub of compiler/rustc_lint/src/runtime_symbols.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (runtime_symbols.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { RuntimeSymbols } from "./runtime_symbols.lints.gen.ts";

export * from "./runtime_symbols.lints.gen.ts";

// impl LateLintPass for RuntimeSymbols (runtime_symbols.rs:77)
unported_methods(RuntimeSymbols.prototype, "rustc_lint::runtime_symbols::RuntimeSymbols", ["check_item"]);
