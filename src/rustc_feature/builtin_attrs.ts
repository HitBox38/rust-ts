//! Built-in attributes and `cfg` flag gating.

import { debug_Symbol, display_Symbol, type Symbol, sym } from "../rustc_span/symbol.ts";
import { type Debug, debug_list, debug_str, debug_struct } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import { BUILTIN_ATTRIBUTES } from "./builtin_attrs.gen.ts";
import type { Features } from "./unstable.ts";

type GateFn = (features: Features) => boolean;

export type GatedCfg = readonly [Symbol, Symbol, GateFn];

// PORT: `Features::cfg_*` fn items -> arrow functions calling the method: the per-feature methods are
// installed on `Features.prototype` by unstable.gen.ts, which may load after this module.
/// `cfg(...)`'s that are feature gated.
const GATED_CFGS: readonly GatedCfg[] = [
  // (name in cfg, feature, function to check if the feature is enabled)
  [sym.overflow_checks, sym.cfg_overflow_checks, (f) => f.cfg_overflow_checks()],
  [sym.ub_checks, sym.cfg_ub_checks, (f) => f.cfg_ub_checks()],
  [sym.contract_checks, sym.cfg_contract_checks, (f) => f.cfg_contract_checks()],
  [sym.target_thread_local, sym.cfg_target_thread_local, (f) => f.cfg_target_thread_local()],
  [sym.target_has_atomic_load_store, sym.cfg_target_has_atomic, (f) => f.cfg_target_has_atomic()],
  [sym.sanitize, sym.cfg_sanitize, (f) => f.cfg_sanitize()],
  [sym.version, sym.cfg_version, (f) => f.cfg_version()],
  [sym.relocation_model, sym.cfg_relocation_model, (f) => f.cfg_relocation_model()],
  [sym.sanitizer_cfi_generalize_pointers, sym.cfg_sanitizer_cfi, (f) => f.cfg_sanitizer_cfi()],
  [sym.sanitizer_cfi_normalize_integers, sym.cfg_sanitizer_cfi, (f) => f.cfg_sanitizer_cfi()],
  // this is consistent with naming of the compiler flag it's for
  [sym.fmt_debug, sym.fmt_debug, (f) => f.fmt_debug()],
  [sym.target_has_reliable_f16, sym.cfg_target_has_reliable_f16_f128, (f) => f.cfg_target_has_reliable_f16_f128()],
  [sym.target_has_reliable_f16_math, sym.cfg_target_has_reliable_f16_f128, (f) => f.cfg_target_has_reliable_f16_f128()],
  [sym.target_has_reliable_f16b, sym.cfg_target_has_reliable_f16b, (f) => f.cfg_target_has_reliable_f16b()],
  [sym.target_has_reliable_f128, sym.cfg_target_has_reliable_f16_f128, (f) => f.cfg_target_has_reliable_f16_f128()],
  [sym.target_has_reliable_f128_math, sym.cfg_target_has_reliable_f16_f128, (f) => f.cfg_target_has_reliable_f16_f128()],
  [sym.target_has_threads, sym.cfg_target_has_threads, (f) => f.cfg_target_has_threads()],
  [sym.target_object_format, sym.cfg_target_object_format, (f) => f.cfg_target_object_format()],
];

/// Find a gated cfg matching `name`.
// rustc: compiler/rustc_feature/src/builtin_attrs.rs:63 find_gated_cfg
export function find_gated_cfg(name: Symbol): GatedCfg | undefined {
  return GATED_CFGS.find(([cfg_sym]) => name === cfg_sym);
}

/** `#[derive(Clone, Debug, Copy)]` */
export type AttributeStability =
  /// An attribute that is unstable behind a specified feature gate.
  | {
      readonly $: "Unstable";
      /// The feature gate, for example `rustc_attrs` for rustc_* attributes.
      readonly gate_name: Symbol;
      /// Notes to be displayed when an attempt is made to use the attribute without its feature
      /// gate.
      readonly notes: readonly string[];
    }
  /// A stable attribute, can be used on all release channels
  | { readonly $: "Stable" };
export const AttributeStability = {
  Stable: { $: "Stable" } as AttributeStability,
} as const;

export const debug_AttributeStability: Debug<AttributeStability> = (v, f) => {
  switch (v.$) {
    case "Unstable":
      return debug_struct(f, "Unstable", [
        ["gate_name", debug_Symbol(v.gate_name, f)],
        ["notes", debug_list(f, v.notes.map((s) => debug_str(s)))],
      ]);
    case "Stable":
      return "Stable";
  }
};

/// Attributes that have a special meaning to rustc or rustdoc.
// PORT: the `BUILTIN_ATTRIBUTES` table is generated from upstream by tools/codegen/features.ts.
export { BUILTIN_ATTRIBUTES };

// rustc: compiler/rustc_feature/src/builtin_attrs.rs:422 is_builtin_attr_name
export function is_builtin_attr_name(name: Symbol): boolean {
  return BUILTIN_ATTRIBUTE_SET().has(name);
}

// PORT: `static BUILTIN_ATTRIBUTE_SET: LazyLock<FxHashSet<Symbol>>` -> an accessor that builds the
// set on first use (`BUILTIN_ATTRIBUTE_SET.contains(..)` -> `BUILTIN_ATTRIBUTE_SET().has(..)`).
let BUILTIN_ATTRIBUTE_SET_: Set<Symbol> | undefined;
export function BUILTIN_ATTRIBUTE_SET(): ReadonlySet<Symbol> {
  if (BUILTIN_ATTRIBUTE_SET_ === undefined) {
    const set = new Set<Symbol>();
    for (const attr of BUILTIN_ATTRIBUTES) {
      // `if !set.insert(*attr)`
      if (set.has(attr)) {
        panic(`duplicate builtin attribute \`${display_Symbol(attr)}\``);
      }
      set.add(attr);
    }
    BUILTIN_ATTRIBUTE_SET_ = set;
  }
  return BUILTIN_ATTRIBUTE_SET_;
}
