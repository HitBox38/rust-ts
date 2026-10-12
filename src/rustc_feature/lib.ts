//! # Feature gates
//!
//! This crate declares the set of past and present unstable features in the compiler.
//! Feature gate checking itself is done in `rustc_ast_passes/src/feature_gate.rs`
//! at the moment.
//!
//! Features are enabled in programs via the crate-level attributes of
//! `#![feature(...)]` with a comma-separated list of features.
//!
//! For the purpose of future feature-tracking, once a feature gate is added,
//! even if it is stabilized or removed, *do not remove it*. Instead, move the
//! symbol to the `accepted` or `removed` modules respectively.

// mod accepted; mod builtin_attrs; mod removed; mod unstable;
// PORT: `unstable.gen.ts` adds the per-feature `Features` methods (PORTING.md §5 "Methods defined
// in another file"); it is imported here, after `unstable.ts`, for its side effects.
import "./unstable.ts";
import "./unstable.gen.ts";

import { type Debug, debug_int, debug_option, debug_str, debug_struct } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { debug_Symbol, display_Symbol, type Symbol } from "../rustc_span/symbol.ts";
import { ACCEPTED_LANG_FEATURES } from "./accepted.ts";
import { REMOVED_LANG_FEATURES } from "./removed.ts";
import { UNSTABLE_LANG_FEATURES } from "./unstable.gen.ts";

/** `#[derive(Debug, Clone)]` */
export interface Feature {
  readonly name: Symbol;
  /// For unstable features: the version the feature was added in.
  /// For accepted features: the version the feature got stabilized in.
  /// For removed features we are inconsistent; sometimes this is the
  /// version it got added, sometimes the version it got removed.
  readonly since: string;
  // PORT: `Option<NonZero<u32>>` -> `number | undefined` (never 0).
  readonly issue: number | undefined;
}

export const debug_Feature: Debug<Feature> = (v, f) =>
  debug_struct(f, "Feature", [
    ["name", debug_Symbol(v.name, f)],
    ["since", debug_str(v.since)],
    ["issue", debug_option(v.issue, f, debug_int)],
  ]);

/** `#[derive(Clone, Copy, Debug, Hash)]` */
export type UnstableFeatures =
  /// Disallow use of unstable features, as on beta/stable channels.
  | "Disallow"
  /// Allow use of unstable features, as on nightly.
  | "Allow"
  /// Errors are bypassed for bootstrapping. This is required any time
  /// during the build that feature-related lints are set to warn or above
  /// because the build turns on warnings-as-errors and uses lots of unstable
  /// features. As a result, this is always required for building Rust itself.
  | "Cheat";

/** `std::env::VarError`. PORT: `NotUnicode(OsString)` cannot occur: JS environment values are strings. */
export type VarError = "NotPresent";

// PORT: `option_env!("CFG_DISABLE_UNSTABLE_FEATURES")` is read when rustc is built. Bootstrap sets it
// only for the beta and stable channels; the oracle is the pinned nightly (`UPSTREAM.json`
// `rust.release` = "1.101.0-nightly", channel "nightly"), so it is unset.
const CFG_DISABLE_UNSTABLE_FEATURES: string | undefined = undefined;

export const UnstableFeatures = {
  Disallow: "Disallow",
  Allow: "Allow",
  Cheat: "Cheat",

  /// This takes into account `RUSTC_BOOTSTRAP`.
  ///
  /// If `krate` is [`Some`], then setting `RUSTC_BOOTSTRAP=krate` will enable the nightly
  /// features. Otherwise, only `RUSTC_BOOTSTRAP=1` will work.
  // rustc: compiler/rustc_feature/src/lib.rs:55 from_environment
  from_environment(krate: string | undefined): UnstableFeatures {
    // PORT: `std::env::var` -> `process.env`.
    const v = process.env["RUSTC_BOOTSTRAP"];
    return UnstableFeatures.from_environment_value(krate, v === undefined ? Err("NotPresent" as const) : Ok(v));
  },

  /// Avoid unsafe `std::env::set_var()` by allowing tests to inject
  /// `std::env::var("RUSTC_BOOTSTRAP")` with the `env_var_rustc_bootstrap`
  /// arg.
  // rustc: compiler/rustc_feature/src/lib.rs:62 from_environment_value
  from_environment_value(krate: string | undefined, env_var_rustc_bootstrap: Result<string, VarError>): UnstableFeatures {
    // `true` if this is a feature-staged build, i.e., on the beta or stable channel.
    const disable_unstable_features = CFG_DISABLE_UNSTABLE_FEATURES !== undefined && CFG_DISABLE_UNSTABLE_FEATURES !== "0";
    // Returns whether `krate` should be counted as unstable
    const is_unstable_crate = (var_: string): boolean =>
      krate !== undefined && var_.split(",").some((new_krate) => new_krate === krate);

    if (env_var_rustc_bootstrap.$ === "Ok") {
      const val = env_var_rustc_bootstrap._0;
      if (val === "1" || is_unstable_crate(val)) return UnstableFeatures.Cheat;
      // Hypnotize ourselves so that we think we are a stable compiler and thus don't
      // allow any unstable features.
      else if (val === "-1") return UnstableFeatures.Disallow;
    }

    return disable_unstable_features ? UnstableFeatures.Disallow : UnstableFeatures.Allow;
  },

  // rustc: compiler/rustc_feature/src/lib.rs:86 is_nightly_build
  is_nightly_build(self: UnstableFeatures): boolean {
    switch (self) {
      case "Allow":
      case "Cheat":
        return true;
      case "Disallow":
        return false;
    }
  },
} as const;

export const debug_UnstableFeatures: Debug<UnstableFeatures> = (v) => v;

// rustc: compiler/rustc_feature/src/lib.rs:94 find_lang_feature_issue
function find_lang_feature_issue(feature: Symbol): number | undefined {
  // Search in all the feature lists.
  {
    const f = UNSTABLE_LANG_FEATURES.find((f) => f.name === feature);
    if (f !== undefined) return f.issue;
  }
  {
    const f = ACCEPTED_LANG_FEATURES.find((f) => f.name === feature);
    if (f !== undefined) return f.issue;
  }
  {
    const f = REMOVED_LANG_FEATURES.find((f) => f.feature.name === feature);
    if (f !== undefined) return f.feature.issue;
  }
  panic(`feature \`${display_Symbol(feature)}\` is not declared anywhere`);
}

// PORT: a function declaration (hoisted), so the generated tables can call it while this module is
// still being evaluated (they are imported from here).
// rustc: compiler/rustc_feature/src/lib.rs:108 to_nonzero
export function to_nonzero(n: number | undefined): number | undefined {
  // Can be replaced with `n.and_then(NonZero::new)` if that is ever usable
  // in const context. Requires https://github.com/rust-lang/rfcs/pull/2632.
  if (n === undefined) return undefined;
  // `NonZero::new(n)`
  return n !== 0 ? n : undefined;
}

export type GateIssue = { readonly $: "Language" } | { readonly $: "Library"; readonly _0: number | undefined };
export const GateIssue = {
  Language: { $: "Language" } as GateIssue,
} as const;

// rustc: compiler/rustc_feature/src/lib.rs:122 find_feature_issue
export function find_feature_issue(feature: Symbol, issue: GateIssue): number | undefined {
  switch (issue.$) {
    case "Language":
      return find_lang_feature_issue(feature);
    case "Library":
      return issue._0;
  }
}

export { ACCEPTED_LANG_FEATURES } from "./accepted.ts";
export {
  AttributeStability,
  BUILTIN_ATTRIBUTE_SET,
  BUILTIN_ATTRIBUTES,
  type GatedCfg,
  find_gated_cfg,
  is_builtin_attr_name,
} from "./builtin_attrs.ts";
export { REMOVED_LANG_FEATURES } from "./removed.ts";
export {
  DEPENDENT_FEATURES,
  type DependentFeature,
  type EnabledLangFeature,
  type EnabledLibFeature,
  Features,
  INCOMPATIBLE_FEATURES,
  TRACK_FEATURE,
} from "./unstable.ts";
export { UNSTABLE_LANG_FEATURES } from "./unstable.gen.ts";
