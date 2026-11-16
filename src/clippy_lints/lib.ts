// Port of src/tools/clippy/clippy_lints/src/lib.rs (crate `clippy_lints`, plan-m8 D4; lane clippy-contract-a).
// The two `rustc_lint::{early,late}_lint_methods!(crate::combined_{early,late}_lint_pass, [..])` invocations (lib.rs:492, :553) are
// expanded by tools/codegen/clippy.ts into lib.gen.ts (plan-m8 D5): `CombinedEarlyLintPass` and `CombinedLateLintPass`, with clippy's
// per-sub-pass `Option` selection (`is_active(&<T>::lint_vec()).then(|| ..)`) from combined_late_pass.rs.
//
// PORT: the module declarations (`mod utils; mod combined_early_pass; mod combined_late_pass; pub mod declared_lints;
// pub mod deprecated_lints;` and the ~360 `mod <lint>;`) load as imports: every module that holds a sub-pass through lib.gen.ts
// (which imports each one), every module with a lint through declared_lints.ts, and `utils/mod.ts` here. The two `pub mod`s are
// re-exported as namespaces (`clippy_lints::declared_lints::LINTS`). `#[macro_use] extern crate clippy_utils` /
// `declare_clippy_lint` (the macros) have no TS counterpart (generated, D5). The crate is loaded lazily, by src/clippy/driver.ts's
// `register_lints` (plan-m8 D12), so no other entry loads it.
import { type Conf, sanitize_explanation, Conf as Conf_, display_ConfMetadata } from "../clippy_config/lib.ts";
import { FormatArgsStorage } from "../clippy_utils/macros.ts";
import type { LintStore } from "../rustc_lint/context.ts";
import { is_lint_pass_required } from "../rustc_lint/lib.ts";
import type { LintVec } from "../rustc_lint_defs/lib.ts";
import { Lint } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { write_stdout } from "../std/io.ts";
import * as attrs from "./attrs/mod.ts";
import * as declared_lints from "./declared_lints.ts";
import * as deprecated_lints from "./deprecated_lints.ts";
import { CombinedEarlyLintPass, CombinedLateLintPass } from "./lib.gen.ts";
import * as nonstandard_macro_braces from "./nonstandard_macro_braces.ts";
import { AttrStorage } from "./utils/attr_collector.ts";
import "./utils/mod.ts";
import "./combined_early_pass.ts";
import "./combined_late_pass.ts";

export { declared_lints, deprecated_lints };

// rustc: src/tools/clippy/clippy_lints/src/lib.rs:425 explain
export function explain(name: string): number {
  const target = `clippy::${to_ascii_uppercase(name)}`;
  const info = declared_lints.LINTS.find((info) => info.lint.name === target);
  if (info !== undefined) {
    println(sanitize_explanation(info.explanation));
    // Check if the lint has configuration
    let mdconf = Conf_.get_metadata();
    const name_ = to_ascii_lowercase(name);
    mdconf = mdconf.filter((cconf) => cconf.lints.includes(name_)); // `retain`
    if (mdconf.length !== 0) {
      println(`### Configuration for ${Lint.name_lower(info.lint)}:\n`);
      for (const conf of mdconf) {
        println(display_ConfMetadata(conf));
      }
    }
    return 0;
  } else {
    println(`unknown lint: ${name}`);
    return 1;
  }
}

/// Register all lints and lint groups with the rustc lint store
///
/// Used in `./src/driver.rs`.
// rustc: src/tools/clippy/clippy_lints/src/lib.rs:449 register_lint_passes
export function register_lint_passes(store: LintStore, conf: Conf): void {
  for (const [old_name, new_name] of deprecated_lints.RENAMED) {
    store.register_renamed(old_name, new_name);
  }
  for (const [name, reason] of deprecated_lints.DEPRECATED) {
    store.register_removed(name, reason);
  }

  // NOTE: Do not add any more pre-expansion passes. These should be removed eventually.
  // Due to the architecture of the compiler, currently `cfg_attr` attributes on crate
  // level (i.e `#![cfg_attr(...)]`) will still be expanded even when using a pre-expansion pass.
  store.register_pre_expansion_lint_pass(() => attrs.EarlyAttributes.new(conf));
  store.register_pre_expansion_lint_pass(() => {
    return nonstandard_macro_braces.MacroBraces.new(conf);
  });

  const format_args_storage = FormatArgsStorage.default();
  const attr_storage = AttrStorage.default();

  {
    // PORT: `FormatArgsStorage` / `AttrStorage` are `Arc` newtypes, so `.clone()` shares the value: the same object here.
    const format_args = format_args_storage;
    const attrs = attr_storage;
    store.register_early_lint_pass(() => {
      return CombinedEarlyLintPass.new(conf, format_args, attrs);
    });
  }

  store.register_late_lint_pass((tcx: TyCtxt) => {
    const skippable_lints = tcx.skippable_lints(null);
    const is_active = (lints: LintVec): boolean => is_lint_pass_required(skippable_lints, lints);
    return CombinedLateLintPass.new(tcx, conf, format_args_storage, attr_storage, is_active);
  });
}

/** `println!("{}", s)` */
function println(s: string): void {
  write_stdout(`${s}\n`);
}

/** `str::to_ascii_uppercase`: only `a`..=`z` change. */
function to_ascii_uppercase(s: string): string {
  return s.replace(/[a-z]+/g, (m) => m.toUpperCase());
}

/** `str::to_ascii_lowercase`: only `A`..=`Z` change. */
function to_ascii_lowercase(s: string): string {
  return s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
}
