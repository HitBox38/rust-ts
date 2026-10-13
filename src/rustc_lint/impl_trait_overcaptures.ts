// Stub of compiler/rustc_lint/src/impl_trait_overcaptures.rs (lane lint-early-a; parser-core pattern). The lint statics and
// `declare_lint_pass!` / `impl_lint_pass!` expansions are generated (impl_trait_overcaptures.lints.gen.ts); the pass
// implementations are filled by lane lint-early-b (early passes) / M3 (late passes).
// PORT: stub: pass types keep their upstream names; every `check_*` method upstream implements is an
// `unported` placeholder (rust_ts/stubs.ts), so no pass silently does nothing. No markers.
import { unported_methods } from "../rust_ts/stubs.ts";
import { ImplTraitOvercaptures } from "./impl_trait_overcaptures.lints.gen.ts";

export * from "./impl_trait_overcaptures.lints.gen.ts";

// impl LateLintPass for ImplTraitOvercaptures (impl_trait_overcaptures.rs:109)
unported_methods(ImplTraitOvercaptures.prototype, "rustc_lint::impl_trait_overcaptures::ImplTraitOvercaptures", ["check_item", "check_impl_item", "check_trait_item"]);
