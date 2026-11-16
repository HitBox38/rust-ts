// Port of src/tools/clippy/clippy_lints/src/utils/attr_collector.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass type src/clippy_lints/lib.gen.ts names (and
// `AttrStorage`, which lib.ts builds),
// each `check_*` of its `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { EarlyLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { unported } from "../../std/panic.ts";
import { AttrCollector_impl_lint_pass } from "./attr_collector.lints.gen.ts";
export * from "./attr_collector.lints.gen.ts";

// #[derive(Clone, Default)]
// PORT: `Arc<OnceLock<Vec<Span>>>` is one shared cell (`value` is `undefined` until set); `Clone` shares it, as the `Arc` does (lib.ts
// passes the same storage to the collector and to the late passes). Ported now, with the struct only, because
// `register_lint_passes` builds it (`AttrStorage::default()`).
export class AttrStorage {
  constructor(public _0: { value: Span[] | undefined }) {}

  /** `#[derive(Default)]` */
  static default(): AttrStorage {
    return new AttrStorage({ value: undefined });
  }
}

// ---- AttrCollector (early sub-pass; impl_lint_pass! in utils/attr_collector.rs) ----
export interface AttrCollector extends EarlyLintPass {}
/** `struct AttrCollector { .. }` (utils/attr_collector.rs:11); its `impl_lint_pass!` expansion is `AttrCollector_impl_lint_pass`. Fields: ported by the fill lane. */
export class AttrCollector implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/utils/attr_collector.rs:17 new (lane always-running)
  static new(storage: AttrStorage): AttrCollector {
    return unported("clippy_lints::utils::attr_collector::AttrCollector::new");
  }

  name(): string {
    return AttrCollector_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return AttrCollector_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return AttrCollector_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for AttrCollector (utils/attr_collector.rs:27)
// stub: src/tools/clippy/clippy_lints/src/utils/attr_collector.rs:28 check_attribute (lane always-running)
AttrCollector.prototype.check_attribute = function (_cx, attr) {
  unported("clippy_lints::utils::attr_collector::AttrCollector::check_attribute");
};
// stub: src/tools/clippy/clippy_lints/src/utils/attr_collector.rs:32 check_crate_post (lane always-running)
AttrCollector.prototype.check_crate_post = function (_0, _1) {
  unported("clippy_lints::utils::attr_collector::AttrCollector::check_crate_post");
};
