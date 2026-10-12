//! List of the unstable feature gates.

import { closeSync, openSync, writeSync } from "node:fs";
import { AtomicRef } from "../rustc_data_structures/atomic_ref.ts";
import { debug_Span, type Span } from "../rustc_span/lib.ts";
import { debug_Symbol, display_Symbol, type Symbol, sym } from "../rustc_span/symbol.ts";
import { type Debug, debug_list, debug_option, debug_set, debug_struct, type Fmt } from "../std/fmt.ts";
import { type IoError, io_error_from_node } from "../std/io.ts";
import { unported } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";

// rustc: compiler/rustc_feature/src/unstable.rs:13 default_track_feature
function default_track_feature(_: Symbol): void {}

/// Recording used features in the dependency graph so incremental can
/// replay used features when needed.
export const TRACK_FEATURE: AtomicRef<(feature: Symbol) => void> = AtomicRef.new(default_track_feature);

/** `#[derive(PartialEq)]` */
// PORT: used only by the `declare_features!` expansion (unstable.gen.ts), where
// `status_to_enum!($status) == FeatureStatus::X` is folded by the generator.
export type FeatureStatus = "Default" | "Incomplete" | "Internal";
export const FeatureStatus = { Default: "Default", Incomplete: "Incomplete", Internal: "Internal" } as const;

// macro_rules! status_to_enum { (unstable) => Default, (incomplete) => Incomplete, (internal) => Internal }
// (expanded by tools/codegen/features.ts)

/// A set of features to be used by later passes.
///
/// There are two ways to check if a language feature `foo` is enabled:
/// - Directly with the `foo` method, e.g. `if tcx.features().foo() { ... }`.
/// - With the `enabled` method, e.g. `if tcx.features.enabled(sym::foo) { ... }`.
///
/// The former is preferred. `enabled` should only be used when the feature symbol is not a
/// constant, e.g. a parameter, or when the feature is a library feature.
/** `#[derive(Clone, Default, Debug, StableHash)]` */
// PORT: the three private fields carry a trailing `_`: the inherent methods of the same names
// (`enabled_lang_features()`, ...) are the public API and occupy those properties.
export class Features {
  constructor(
    /// `#![feature]` attrs for language features, for error reporting.
    public enabled_lang_features_: EnabledLangFeature[],
    /// `#![feature]` attrs for non-language (library) features.
    public enabled_lib_features_: EnabledLibFeature[],
    /// `enabled_lang_features` + `enabled_lib_features`.
    public enabled_features_: Set<Symbol>,
  ) {}

  /** `#[derive(Default)]` */
  static default(): Features {
    return new Features([], [], new Set());
  }

  // rustc: compiler/rustc_feature/src/unstable.rs:76 set_enabled_lang_feature
  set_enabled_lang_feature(lang_feat: EnabledLangFeature): void {
    this.enabled_lang_features_.push(lang_feat);
    this.enabled_features_.add(lang_feat.gate_name);
  }

  // rustc: compiler/rustc_feature/src/unstable.rs:81 set_enabled_lib_feature
  set_enabled_lib_feature(lib_feat: EnabledLibFeature): void {
    this.enabled_lib_features_.push(lib_feat);
    this.enabled_features_.add(lib_feat.gate_name);
  }

  /// Returns a list of [`EnabledLangFeature`] with info about:
  ///
  /// - Feature gate name.
  /// - The span of the `#[feature]` attribute.
  /// - For stable language features, version info for when it was stabilized.
  // rustc: compiler/rustc_feature/src/unstable.rs:91 enabled_lang_features
  enabled_lang_features(): readonly EnabledLangFeature[] {
    return this.enabled_lang_features_;
  }

  // rustc: compiler/rustc_feature/src/unstable.rs:95 enabled_lib_features
  enabled_lib_features(): readonly EnabledLibFeature[] {
    return this.enabled_lib_features_;
  }

  // rustc: compiler/rustc_feature/src/unstable.rs:99 enabled_features
  enabled_features(): ReadonlySet<Symbol> {
    return this.enabled_features_;
  }

  /// Returns an iterator of enabled features in stable order.
  // PORT: `impl Iterator<Item = (Symbol, Span)> + Clone` -> an array.
  // rustc: compiler/rustc_feature/src/unstable.rs:104 enabled_features_iter_stable_order
  enabled_features_iter_stable_order(): [Symbol, Span][] {
    return [
      ...this.enabled_lang_features_.map((feat): [Symbol, Span] => [feat.gate_name, feat.attr_sp]),
      ...this.enabled_lib_features_.map((feat): [Symbol, Span] => [feat.gate_name, feat.attr_sp]),
    ];
  }

  /// Is the given feature enabled (via `#[feature(...)]`)?
  // rustc: compiler/rustc_feature/src/unstable.rs:114 enabled
  enabled(feature: Symbol): boolean {
    if (this.enabled_features_.has(feature)) {
      TRACK_FEATURE.deref()(feature);
      return true;
    } else {
      return false;
    }
  }

  /// The generic_const_args family of features has a set of common behavior that can be enabled
  /// by either `gca_min_const_items` or `gca_adts`. There is no actual `gca` base feature, but
  /// this method acts as one.
  // rustc: compiler/rustc_feature/src/unstable.rs:126 gca
  gca(): boolean {
    return this.gca_min_const_items() || this.gca_adts();
  }

  // macro_rules! declare_features { .. } and its invocation (UNSTABLE_LANG_FEATURES, one method per
  // feature, `incomplete`, `internal`) are expanded by tools/codegen/features.ts into unstable.gen.ts.

  // rustc: compiler/rustc_feature/src/unstable.rs:804 dump_feature_usage_metrics
  dump_feature_usage_metrics(metrics_path: string): Result<undefined, IoError> {
    // #[derive(serde::Serialize)] struct LibFeature { timestamp: u128, symbol: String }
    interface LibFeature {
      timestamp: bigint;
      symbol: string;
    }

    // #[derive(serde::Serialize)] struct LangFeature { timestamp: u128, symbol: String, since: Option<String> }
    interface LangFeature {
      timestamp: bigint;
      symbol: string;
      since: string | undefined;
    }

    // #[derive(serde::Serialize)] struct FeatureUsage { lib_features: Vec<LibFeature>, lang_features: Vec<LangFeature> }
    interface FeatureUsage {
      lib_features: LibFeature[];
      lang_features: LangFeature[];
    }

    let metrics_file: number;
    try {
      metrics_file = openSync(metrics_path, "w");
    } catch (e) {
      return Err(io_error_from_node(e));
    }
    // PORT: `BufWriter::new(metrics_file)`: the JSON text is built in memory and written at once.

    const now = (): bigint => {
      // PORT: `SystemTime::now().duration_since(UNIX_EPOCH).as_nanos()`; JS clocks have
      // millisecond (Date) resolution at the epoch scale.
      return BigInt(Date.now()) * 1_000_000n;
    };

    const lib_features: LibFeature[] = this.enabled_lib_features_.map(({ gate_name }) => ({
      symbol: display_Symbol(gate_name),
      timestamp: now(),
    }));

    const lang_features: LangFeature[] = this.enabled_lang_features_.map(({ gate_name, stable_since }) => ({
      symbol: display_Symbol(gate_name),
      since: stable_since === undefined ? undefined : display_Symbol(stable_since),
      timestamp: now(),
    }));

    const feature_usage: FeatureUsage = { lib_features, lang_features };

    // PORT: `serde_json::to_writer(metrics_file, &feature_usage)?`. serde serializes struct fields in
    // declaration order, compact, `None` as `null` and `u128` as a bare integer. For strings,
    // `JSON.stringify` escapes exactly what serde_json escapes (`"`, `\`, control characters as
    // \b \t \n \f \r or \u00xx with lowercase hex).
    const str = (s: string): string => JSON.stringify(s);
    const json =
      `{"lib_features":[${feature_usage.lib_features.map((f) => `{"timestamp":${f.timestamp},"symbol":${str(f.symbol)}}`).join(",")}],` +
      `"lang_features":[${feature_usage.lang_features
        .map((f) => `{"timestamp":${f.timestamp},"symbol":${str(f.symbol)},"since":${f.since === undefined ? "null" : str(f.since)}}`)
        .join(",")}]}`;
    try {
      writeSync(metrics_file, json);
    } catch (e) {
      return Err(io_error_from_node(e));
    } finally {
      closeSync(metrics_file);
    }

    return Ok(undefined);
  }
}

/** `#[derive(Debug)]` for `Features`. */
export const debug_Features: Debug<Features> = (v, f) =>
  debug_struct(f, "Features", [
    ["enabled_lang_features", debug_list(f, v.enabled_lang_features_.map((x) => debug_EnabledLangFeature(x, f)))],
    ["enabled_lib_features", debug_list(f, v.enabled_lib_features_.map((x) => debug_EnabledLibFeature(x, f)))],
    ["enabled_features", debug_FxHashSet_Symbol(v.enabled_features_, f)],
  ]);

// PORT: `HashSet::iter` yields hashbrown bucket order (FxHasher); with at most one element the
// order cannot matter, larger sets stay unported until hashbrown + FxHasher are ported (as
// src/rust_ts/hash_map.ts does for maps).
function debug_FxHashSet_Symbol(v: ReadonlySet<Symbol>, f: Fmt): string {
  if (v.size > 1) unported("std::collections::HashSet Debug iteration order (hashbrown + FxHasher)");
  return debug_set(
    f,
    [...v].map((s) => debug_Symbol(s, f)),
  );
}

/// Information about an enabled language feature.
/** `#[derive(Debug, Copy, Clone, StableHash)]` */
export interface EnabledLangFeature {
  /// Name of the feature gate guarding the language feature.
  readonly gate_name: Symbol;
  /// Span of the `#[feature(...)]` attribute.
  readonly attr_sp: Span;
  /// If the lang feature is stable, the version number when it was stabilized.
  readonly stable_since: Symbol | undefined;
}

export const debug_EnabledLangFeature: Debug<EnabledLangFeature> = (v, f) =>
  debug_struct(f, "EnabledLangFeature", [
    ["gate_name", debug_Symbol(v.gate_name, f)],
    ["attr_sp", debug_Span(v.attr_sp, f)],
    ["stable_since", debug_option(v.stable_since, f, debug_Symbol)],
  ]);

/// Information about an enabled library feature.
/** `#[derive(Debug, Copy, Clone, StableHash)]` */
export interface EnabledLibFeature {
  readonly gate_name: Symbol;
  readonly attr_sp: Span;
}

export const debug_EnabledLibFeature: Debug<EnabledLibFeature> = (v, f) =>
  debug_struct(f, "EnabledLibFeature", [
    ["gate_name", debug_Symbol(v.gate_name, f)],
    ["attr_sp", debug_Span(v.attr_sp, f)],
  ]);

/// Some features are not allowed to be used together at the same time.
///
/// If the two are present, produce an error.
export const INCOMPATIBLE_FEATURES: readonly (readonly [Symbol, Symbol])[] = [
  // Experimental match ergonomics rulesets are incompatible with each other, to simplify the
  // boolean logic required to tell which typing rules to use.
  [sym.ref_pat_eat_one_layer_2024, sym.ref_pat_eat_one_layer_2024_structural],
];

export type DependentFeature =
  | { readonly $: "And"; readonly _0: readonly DependentFeature[] }
  | { readonly $: "Or"; readonly _0: readonly DependentFeature[] }
  | { readonly $: "Leaf"; readonly _0: Symbol };

/// Some features require one or more other features to be enabled.
export const DEPENDENT_FEATURES: readonly (readonly [Symbol, DependentFeature])[] = [
  // tidy-alphabetical-start
  [
    sym.gca_adts,
    {
      $: "Or",
      _0: [
        { $: "Leaf", _0: sym.min_adt_const_params },
        { $: "Leaf", _0: sym.adt_const_params },
      ],
    },
  ],
  [sym.gca_const_items, { $: "Leaf", _0: sym.gca_min_const_items }],
  [sym.gca_macroless_args, { $: "Leaf", _0: sym.gca_min_const_items }],
  [sym.gca_macroless_items, { $: "Leaf", _0: sym.gca_min_const_items }],
  [sym.unsized_const_params, { $: "Leaf", _0: sym.adt_const_params }],
  // tidy-alphabetical-end
];
