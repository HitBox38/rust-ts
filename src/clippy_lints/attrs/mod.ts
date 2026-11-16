// Port of src/tools/clippy/clippy_lints/src/attrs/mod.rs (crate `clippy_lints`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): the pass types src/clippy_lints/lib.gen.ts names,
// each `check_*` of their `EarlyLintPass` / `LateLintPass` impls and each constructor declared as a stub: a `// stub: <path>:<line>
// <name> (lane <group>)` marker over an `unported(..)` body, so no sub-pass silently does nothing (a stub never counts as ported).
// The fill lane replaces each stub in place with the port and its `// rustc:` marker, and ports the rest of the file.
import type { Conf } from "../../clippy_config/lib.ts";
import type { EarlyLintPass, LateLintPass } from "../../rustc_lint/passes.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import { unported } from "../../std/panic.ts";
import { Attributes_impl_lint_pass, EarlyAttributes_impl_lint_pass, PostExpansionEarlyAttributes_impl_lint_pass } from "./mod.lints.gen.ts";
export * from "./mod.lints.gen.ts";

// ---- EarlyAttributes (pre-expansion sub-pass; impl_lint_pass! in attrs/mod.rs) ----
export interface EarlyAttributes extends EarlyLintPass {}
/** `struct EarlyAttributes { .. }` (attrs/mod.rs:544); its `impl_lint_pass!` expansion is `EarlyAttributes_impl_lint_pass`. Fields: ported by the fill lane. */
export class EarlyAttributes implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:549 new (lane dispatch)
  static new(conf: Conf): EarlyAttributes {
    return unported("clippy_lints::attrs::EarlyAttributes::new");
  }

  name(): string {
    return EarlyAttributes_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return EarlyAttributes_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return EarlyAttributes_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for EarlyAttributes (attrs/mod.rs:554)
// stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:555 check_attribute (lane dispatch)
EarlyAttributes.prototype.check_attribute = function (cx, attr) {
  unported("clippy_lints::attrs::EarlyAttributes::check_attribute");
};

// ---- PostExpansionEarlyAttributes (early sub-pass; impl_lint_pass! in attrs/mod.rs) ----
export interface PostExpansionEarlyAttributes extends EarlyLintPass {}
/** `struct PostExpansionEarlyAttributes { .. }` (attrs/mod.rs:564); its `impl_lint_pass!` expansion is `PostExpansionEarlyAttributes_impl_lint_pass`. Fields: ported by the fill lane. */
export class PostExpansionEarlyAttributes implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:569 new (lane dispatch)
  static new(conf: Conf): PostExpansionEarlyAttributes {
    return unported("clippy_lints::attrs::PostExpansionEarlyAttributes::new");
  }

  name(): string {
    return PostExpansionEarlyAttributes_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return PostExpansionEarlyAttributes_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return PostExpansionEarlyAttributes_impl_lint_pass.lint_vec();
  }
}

// impl EarlyLintPass for PostExpansionEarlyAttributes (attrs/mod.rs:574)
// stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:575 check_crate (lane dispatch)
PostExpansionEarlyAttributes.prototype.check_crate = function (cx, _krate) {
  unported("clippy_lints::attrs::PostExpansionEarlyAttributes::check_crate");
};
// stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:579 check_attribute (lane dispatch)
PostExpansionEarlyAttributes.prototype.check_attribute = function (cx, attr) {
  unported("clippy_lints::attrs::PostExpansionEarlyAttributes::check_attribute");
};
// stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:625 check_item (lane dispatch)
PostExpansionEarlyAttributes.prototype.check_item = function (cx, item) {
  unported("clippy_lints::attrs::PostExpansionEarlyAttributes::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:634 check_attributes (lane dispatch)
PostExpansionEarlyAttributes.prototype.check_attributes = function (cx, attrs) {
  unported("clippy_lints::attrs::PostExpansionEarlyAttributes::check_attributes");
};
// stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:640 check_attributes_post (lane dispatch)
PostExpansionEarlyAttributes.prototype.check_attributes_post = function (_cx, attrs) {
  unported("clippy_lints::attrs::PostExpansionEarlyAttributes::check_attributes_post");
};

// ---- Attributes (late sub-pass; impl_lint_pass! in attrs/mod.rs) ----
export interface Attributes extends LateLintPass {}
/** `struct Attributes { .. }` (attrs/mod.rs:502); its `impl_lint_pass!` expansion is `Attributes_impl_lint_pass`. Fields: ported by the fill lane. */
export class Attributes implements LintPass {
  // stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:507 new (lane dispatch)
  static new(conf: Conf): Attributes {
    return unported("clippy_lints::attrs::Attributes::new");
  }

  name(): string {
    return Attributes_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return Attributes_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return Attributes_impl_lint_pass.lint_vec();
  }
}

// impl LateLintPass for Attributes (attrs/mod.rs:512)
// stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:513 check_item (lane dispatch)
Attributes.prototype.check_item = function (cx, item) {
  unported("clippy_lints::attrs::Attributes::check_item");
};
// stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:521 check_impl_item (lane dispatch)
Attributes.prototype.check_impl_item = function (cx, item) {
  unported("clippy_lints::attrs::Attributes::check_impl_item");
};
// stub: src/tools/clippy/clippy_lints/src/attrs/mod.rs:533 check_trait_item (lane dispatch)
Attributes.prototype.check_trait_item = function (cx, item) {
  unported("clippy_lints::attrs::Attributes::check_trait_item");
};
