// Port of compiler/rustc_codegen_ssa/src/target_features.rs.
//
// PORT: `UnordMap<String, Stability>` / `UnordSet` / `FxHashMap` / `FxHashSet` / `FxIndexSet` are JS `Map` / `Set`
// (PORTING §5); `into_sorted_stable_ord` / `to_sorted_stable_ord` of strings sort with `str_cmp` (`Ord for str`).
// `SmallVec<[&str; N]>` is `string[]`. The `all_rust_target_features` query value is `Map<string, unknown>` in
// queries.gen.ts (`Stability` there is not typed), so readers cast it to `Map<string, Stability>`.
import type { InstructionSetAttr } from "../rustc_attr_ir/data_structures.gen.ts";
import { DefKind } from "../rustc_hir/def.ts";
import { AARCH64_SOFTFLOAT_NEON, X86_SOFTFLOAT_SSE } from "../rustc_lint_defs/builtin.gen.ts";
import { type TargetFeature, type TargetFeatureKind } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { str_cmp } from "../rustc_session/options.ts";
import type { EarlySession } from "../rustc_session/session.ts";
import { type CrateNum, debug_CrateNum, type DefId, LOCAL_CRATE, type LocalDefId } from "../rustc_span/def_id.ts";
import { PLAIN } from "../std/fmt.ts";
import { DiagSymbolList_from } from "../rustc_errors/diagnostic_impls.ts";
import { edit_distance } from "../rustc_span/edit_distance.ts";
import type { Span } from "../rustc_span/lib.ts";
import { sym, Symbol } from "../rustc_span/symbol.ts";
import { SanitizerSet } from "../rustc_structures/sanitizer_set.ts";
import type { Target } from "../rustc_target/spec/mod.ts";
import { all_rust_features, feature_to_arch_names, RUSTC_SPECIFIC_FEATURES, Stability } from "../rustc_target/target_features.ts";
import { assert_eq, panic } from "../std/panic.ts";
import {
  Aarch64SoftfloatNeon_diagnostic,
  type CrossArchFeatureNote,
  FeatureNotValid_diagnostic,
  type FeatureNotValidHint,
  InternalOnlyCTargetFeature_diagnostic,
  InternalOnlyTargetFeatureAttr_diagnostic,
  PossibleFeature,
  TargetFeatureDisableOrEnable_diagnostic,
  TargetFeatureSafeTrait_diagnostic,
  UnknownCTargetFeature_diagnostic,
  UnknownCTargetFeaturePrefix_diagnostic,
  UnstableCTargetFeature_diagnostic,
  X86SoftfloatSse_diagnostic,
} from "./diagnostics.ts";

/// Compute the enabled target features from the `#[target_feature]` function attribute.
/// Enabled target features are added to `target_features`.
// rustc: compiler/rustc_codegen_ssa/src/target_features.rs:22 from_target_feature_attr
export function from_target_feature_attr(
  tcx: TyCtxt,
  did: LocalDefId,
  features: readonly (readonly [Symbol, Span])[],
  was_forced: boolean,
  rust_target_features: ReadonlyMap<string, Stability>,
  target_features: TargetFeature[],
): void {
  const rust_features = tcx.features();
  const abi_feature_constraints = tcx.sess.target.abi_required_features();
  for (const [feature, feature_span] of features) {
    const feature_str = Symbol.as_str(feature);
    const stability = rust_target_features.get(feature_str);
    if (stability === undefined) {
      let hint: FeatureNotValidHint;
      const stripped = feature_str.startsWith("+") ? feature_str.slice(1) : undefined;
      if (stripped !== undefined && rust_target_features.has(stripped)) {
        hint = { $: "RemovePlusFromFeatureName", span: feature_span, stripped };
      } else {
        // Show the 5 feature names that are most similar to the input.
        const valid_names: string[] = [...rust_target_features.keys()].sort(str_cmp);
        // PORT: `sort_by_key` is a stable sort, as is `Array.prototype.sort`; the key is computed per comparison as
        // upstream's `sort_by_key` does.
        const key = (name: string): number => edit_distance(name, Symbol.as_str(feature), 5) ?? Number.MAX_SAFE_INTEGER;
        valid_names.sort((a, b) => key(a) - key(b));
        valid_names.length = Math.min(valid_names.length, 5);

        hint = {
          $: "ValidFeatureNames",
          possibilities: DiagSymbolList_from(valid_names),
          and_more: Math.max(rust_target_features.size - 5, 0),
        };
      }
      let cross_arch: CrossArchFeatureNote | undefined;
      {
        const arches = feature_to_arch_names(feature_str);
        if (arches.length === 0) {
          cross_arch = undefined;
        } else if (arches.length === 1) {
          cross_arch = { $: "Single", feature: feature_str, arch: arches[0]! };
        } else {
          cross_arch = { $: "Multiple", feature: feature_str, arches: DiagSymbolList_from(arches) };
        }
      }
      tcx.dcx().emit_err(
        FeatureNotValid_diagnostic({
          feature: feature_str,
          span: feature_span,
          hint,
          cross_arch,
        }),
      );
      continue;
    }

    // Only allow target features whose feature gates have been enabled
    // and which are permitted to be toggled.
    const toggle = Stability.toggle_allowed(stability);
    let nightly_feature: Symbol | undefined;
    if (toggle.$ === "Err") {
      const reason = toggle._0;
      tcx.dcx().emit_err(
        InternalOnlyTargetFeatureAttr_diagnostic({
          span: feature_span,
          feature: feature_str,
          reason,
        }),
      );
    } else if ((nightly_feature = Stability.requires_nightly(stability, /* in_cfg */ false)) !== undefined && !rust_features.enabled(nightly_feature)) {
      const explain = Stability.is_cfg_stable_toggle_unstable(stability)
        ? `the target feature \`${Symbol.as_str(feature)}\` is allowed in cfg but unstable otherwise`
        : `the target feature \`${Symbol.as_str(feature)}\` is currently unstable`;
      feature_err(tcx.sess, nightly_feature, feature_span, explain).emit();
    } else {
      // Add this and the implied features.
      for (const name of tcx.implied_target_features(feature)) {
        // But ensure the ABI does not forbid enabling this.
        // Here we do assume that the backend doesn't add even more implied features
        // we don't know about, at least no features that would have ABI effects!
        // We skip this logic in rustdoc, where we want to allow all target features of
        // all targets, so we can't check their ABI compatibility and anyway we are not
        // generating code so "it's fine".
        if (!tcx.sess.opts.actually_rustdoc) {
          if (abi_feature_constraints.incompatible.includes(Symbol.as_str(name))) {
            // For "neon" specifically, we emit an FCW instead of a hard error.
            // See <https://github.com/rust-lang/rust/issues/134375>.
            // Similar for "sse" on x86.
            // See <https://github.com/rust-lang/rust/issues/117938>.
            if (tcx.sess.target.arch.$ === "AArch64" && Symbol.as_str(name) === "neon") {
              tcx.emit_node_span_lint(AARCH64_SOFTFLOAT_NEON, tcx.local_def_id_to_hir_id(did), feature_span, Aarch64SoftfloatNeon_diagnostic({}));
            } else if ((tcx.sess.target.arch.$ === "X86" || tcx.sess.target.arch.$ === "X86_64") && Symbol.as_str(name) === "sse") {
              tcx.emit_node_span_lint(X86_SOFTFLOAT_SSE, tcx.local_def_id_to_hir_id(did), feature_span, X86SoftfloatSse_diagnostic({}));
            } else {
              tcx.dcx().emit_err(
                InternalOnlyTargetFeatureAttr_diagnostic({
                  span: feature_span,
                  feature: Symbol.as_str(name),
                  reason: "this feature is incompatible with the target ABI",
                }),
              );
            }
          }
        }
        let kind: TargetFeatureKind;
        if (name !== feature) {
          kind = "Implied";
        } else if (was_forced) {
          kind = "Forced";
        } else {
          kind = "Enabled";
        }
        target_features.push({ name, kind });

        const s = rust_target_features.get(Symbol.as_str(name));
        if (!(s !== undefined && Stability.toggle_allowed(s).$ === "Ok")) {
          tcx.dcx().span_delayed_bug(feature_span, `internal-only feature ${Symbol.as_str(name)} should not be toggled by \`#[target_feature]\``);
        }
      }
    }
  }
}

/// Computes the set of target features used in a function for the purposes of
/// inline assembly.
// rustc: compiler/rustc_codegen_ssa/src/target_features.rs:154 asm_target_features
function asm_target_features(tcx: TyCtxt, did: DefId): Set<Symbol> {
  // PORT: `FxIndexSet` is an insertion-ordered `Set`; `swap_remove` (which moves the last element into the removed
  // slot) is done on an array copy.
  let target_features = new Set(tcx.sess.internal_target_features);
  if (DefKind.has_codegen_attrs(tcx.def_kind(did))) {
    const attrs = tcx.codegen_fn_attrs(did) as { target_features: readonly TargetFeature[]; instruction_set: InstructionSetAttr | undefined };
    for (const feature of attrs.target_features) target_features.add(feature.name);
    switch (attrs.instruction_set) {
      case undefined:
        break;
      case "ArmA32": {
        // FIXME(#120456) - is `swap_remove` correct?
        const v = [...target_features];
        const i = v.indexOf(sym.thumb_mode);
        if (i >= 0) {
          const last = v.pop()!;
          if (i < v.length) v[i] = last;
          target_features = new Set(v);
        }
        break;
      }
      case "ArmT32":
        target_features.add(sym.thumb_mode);
        break;
    }
  }

  return target_features;
}

/// Checks the function annotated with `#[target_feature]` is not a safe
/// trait method implementation, reporting an error if it is.
// rustc: compiler/rustc_codegen_ssa/src/target_features.rs:176 check_target_feature_trait_unsafe
export function check_target_feature_trait_unsafe(tcx: TyCtxt, id: LocalDefId, attr_span: Span): void {
  if (tcx.def_kind(id).$ === "AssocFn") {
    const parent_id = tcx.local_parent(id);
    const parent_kind = tcx.def_kind(parent_id);
    if (parent_kind.$ === "Trait" || (parent_kind.$ === "Impl" && parent_kind.of_trait)) {
      tcx.dcx().emit_err(
        TargetFeatureSafeTrait_diagnostic({
          span: attr_span,
          def: tcx.def_span(id),
        }),
      );
    }
  }
}

/// Parse the value of the target spec `features` field or `-Ctarget-feature`, calling the closure
/// for each entry in the list, also expanding implied features (but only for actual Rust target
/// features). If the list contains a syntactically invalid item (not starting with `+`/`-`) , the
/// error callback is invoked.
// rustc: compiler/rustc_codegen_ssa/src/target_features.rs:192 parse_rust_feature_list
function parse_rust_feature_list(
  target: Target,
  features: string,
  err_callback: (feature: string) => void,
  callback: (base_feature: string, with_implied: Set<string> | undefined, enable: boolean) => void,
): void {
  // A cache for the forward and backwards feature maps.
  let features_map: Map<string, unknown> | undefined = undefined;
  let inverse_implied_features: Map<string, Set<string>> | undefined = undefined;

  for (const feature of features.split(",")) {
    if (feature.startsWith("+")) {
      const base_feature = feature.slice(1);
      // Skip features that are not target features, but rustc features.
      if (RUSTC_SPECIFIC_FEATURES.includes(base_feature)) {
        continue;
      }

      features_map ??= target.rust_target_features_map();
      const fm = features_map as ReturnType<Target["rust_target_features_map"]>;

      if (!fm.has(base_feature)) {
        callback(base_feature, undefined, true);
        continue;
      }

      const implied_features = target.implied_target_features(base_feature, fm);
      callback(base_feature, implied_features, true);
    } else if (feature.startsWith("-")) {
      const base_feature = feature.slice(1);
      // Skip features that are not target features, but rustc features.
      if (RUSTC_SPECIFIC_FEATURES.includes(base_feature)) {
        continue;
      }

      features_map ??= target.rust_target_features_map();

      if (!features_map.has(base_feature)) {
        callback(base_feature, undefined, false);
        continue;
      }

      // If `f1` implies `f2`, then `!f2` implies `!f1` -- this is standard logical
      // contraposition. So we have to find all the reverse implications of `base_feature` and
      // disable them, too.

      inverse_implied_features ??= ((): Map<string, Set<string>> => {
        const set: Map<string, Set<string>> = new Map();
        for (const [f, , is] of target.rust_target_features()) {
          for (const i of is) {
            let e = set.get(i);
            if (e === undefined) set.set(i, (e = new Set()));
            e.add(f);
          }
        }
        return set;
      })();

      // Inverse implied target features have their own inverse implied target features, so we
      // traverse the map until there are no more features to add.
      const implied_features: Set<string> = new Set();
      const new_features = [base_feature];
      let new_feature: string | undefined;
      while ((new_feature = new_features.pop()) !== undefined) {
        if (!implied_features.has(new_feature)) {
          implied_features.add(new_feature);
          const implied = inverse_implied_features.get(new_feature);
          if (implied !== undefined) {
            // #[allow(rustc::potential_query_instability)]
            new_features.push(...implied);
          }
        }
      }

      callback(base_feature, implied_features, false);
    } else if (feature.length !== 0) {
      err_callback(feature);
    }
  }
}

/// Utility function for a codegen backend to compute the set of all actually enabled Rust target
/// features (which will be stored in `sess.internal_target_features`).
///
/// `to_backend_features` converts a Rust feature name into a list of backend feature names; this is
/// used for diagnostic purposes only.
///
/// `target_base_has_feature` should check whether the given feature (a Rust feature name!) is
/// enabled in the "base" target machine, i.e., without applying `-Ctarget-feature`. Note that LLVM
/// may consider features to be implied that we do not and vice-versa. We want `cfg` to be entirely
/// consistent with Rust feature implications, and thus only consult LLVM to expand the target CPU
/// to target features.
///
/// We do not have to worry about RUSTC_SPECIFIC_FEATURES here, those are handled elsewhere.
// rustc: compiler/rustc_codegen_ssa/src/target_features.rs:284 internal_target_features
export function internal_target_features(
  sess: EarlySession,
  to_backend_features: (feature: string) => readonly string[],
  target_base_has_feature: (feature: string) => boolean,
): Set<Symbol> {
  const features_map = sess.target.rust_target_features_map();

  // Compute which of the known target features are enabled in the 'base' target machine: for
  // every Rust target feature, ask the backend if it is enabled.
  const features: Set<Symbol> = new Set();
  for (const [base_feature] of sess.target.rust_target_features()) {
    if (!target_base_has_feature(base_feature)) continue;
    // Expand the direct base feature into all transitively-implied features. Note that we
    // cannot simply use the `implied` field of the tuple since that only contains
    // directly-implied features.
    //
    // Iteration order is irrelevant because we're collecting into an `UnordSet`.
    // #[allow(rustc::potential_query_instability)]
    for (const f of sess.target.implied_target_features(base_feature, features_map)) {
      features.add(Symbol.intern(f));
    }
  }

  // State gathered for "tied features" check.
  const enabled_disabled_features: Map<string, boolean> = new Map();

  // Add enabled and remove disabled features.
  parse_rust_feature_list(
    sess.target,
    sess.opts.cg.target_feature,
    /* err_callback */
    (feature) => {
      sess.dcx().emit_warn(UnknownCTargetFeaturePrefix_diagnostic({ feature }));
    },
    (base_feature, new_features, enable) => {
      const entry = features_map.get(base_feature);
      if (entry === undefined) {
        // This is definitely not a valid Rust feature name. We do not add it to
        // `features`. Maybe it is a backend feature name? If so, give a better error
        // message.
        let rust_feature: string | undefined = undefined;
        for (const [rf] of sess.target.rust_target_features()) {
          const backend_features = to_backend_features(rf);
          if (backend_features.includes(base_feature) && !backend_features.includes(rf)) {
            rust_feature = rf;
            break;
          }
        }
        const unknown_feature =
          rust_feature !== undefined
            ? { feature: base_feature, rust_feature: { $: "Some" as const, rust_feature } }
            : { feature: base_feature, rust_feature: PossibleFeature.None };
        sess.dcx().emit_warn(UnknownCTargetFeature_diagnostic(unknown_feature));
      } else {
        const [stability] = entry;
        const nf = new_features!;
        // Add feature to our set -- only if it is actually a recognized feature.
        // Iteration order is irrelevant since this only influences an `FxHashMap`.
        // #[allow(rustc::potential_query_instability)]
        for (const s of nf) enabled_disabled_features.set(s, enable);

        // Iteration order is irrelevant since this only influences an `UnordSet`.
        // #[allow(rustc::potential_query_instability)]
        if (enable) {
          for (const f of nf) features.add(Symbol.intern(f));
        } else {
          // Remove `new_features` from `features`.
          for (const n of nf) {
            features.delete(Symbol.intern(n));
          }
        }

        // Check feature stability.
        if (stability.$ === "InternalOnly") {
          const { reason, hard_error } = stability;
          const diag = {
            feature: base_feature,
            enabled: enable ? "enabled" : "disabled",
            reason,
            future_compat_note: !hard_error,
          };

          if (hard_error) {
            sess.dcx().emit_err(InternalOnlyCTargetFeature_diagnostic(diag));
          } else {
            sess.dcx().emit_warn(InternalOnlyCTargetFeature_diagnostic(diag));
          }
        } else if (Stability.requires_nightly(stability, /* in_cfg */ false) !== undefined && !sess.is_nightly_build()) {
          // An unstable feature. Warn about using it on stable. It makes little sense
          // to hard-error here since we just warn about fully unknown
          // features above.
          const note = Stability.is_cfg_stable_toggle_unstable(stability)
            ? "this feature is allowed in cfg but unstable otherwise"
            : "this feature is not stably supported";
          sess.dcx().emit_warn(UnstableCTargetFeature_diagnostic({ feature: base_feature, note }));
        }
      }
    },
  );

  const f = check_tied_features(sess.target, enabled_disabled_features);
  if (f !== undefined) {
    sess.dcx().emit_err(
      TargetFeatureDisableOrEnable_diagnostic({
        features: f,
        span: undefined,
        missing_features: undefined,
      }),
    );
  }

  return features;
}

/// Given a map from target_features to whether they are enabled or disabled, ensure only valid
/// combinations are allowed. Returns `Some` if a violation is found.
// rustc: compiler/rustc_codegen_ssa/src/target_features.rs:420 check_tied_features
export function check_tied_features(target: Target, features: ReadonlyMap<string, boolean>): readonly string[] | undefined {
  if (!(features.size === 0)) {
    for (const tied of target.tied_target_features()) {
      // Tied features must be set to the same value, or not set at all
      const enabled = features.get(tied[0]!);
      if (tied.slice(1).some((f) => enabled !== features.get(f))) {
        return tied;
      }
    }
  }
  return undefined;
}

/// Translates the target spec `features` field into a backend target feature list.
///
/// `extend_backend_features` extends the set of backend features (assumed to be in mutable state
/// accessible by that closure) to enable/disable the given Rust feature name.
// rustc: compiler/rustc_codegen_ssa/src/target_features.rs:441 target_spec_to_backend_features
export function target_spec_to_backend_features(sess: EarlySession, extend_backend_features: (feature: string, enable: boolean) => void): void {
  // This check handles SM versions that defaults (by LLVM) to unsupported (by Rust) PTX ISA versions.
  // sm_70, sm_72 and sm_75 defaults to PTX ISA versions with major version 6, while sm_80 default to 7.0
  const target_cpu = sess.opts.cg.target_cpu;
  if (sess.target.arch.$ === "Nvptx64" && (target_cpu === undefined || target_cpu === "sm_70" || target_cpu === "sm_72" || target_cpu === "sm_75")) {
    extend_backend_features("ptx70", true);
  }

  // Compute implied features
  parse_rust_feature_list(
    sess.target,
    sess.target.features,
    /* err_callback */
    (feature) => {
      panic(`Target spec contains invalid feature ${feature} (missing \`+\`/\`-\` prefix)`);
    },
    (base_feature, new_features, enable) => {
      // FIXME emit an error for unknown features in the target spec like
      // internal_target_features would for -Ctarget-feature.
      const nf = new_features ?? new Set([base_feature]);
      for (const new_feature of [...nf].sort(str_cmp)) {
        extend_backend_features(new_feature, enable);
      }
    },
  );
}

/// Translates the `-Ctarget-feature` flag into a backend target feature list.
///
/// `extend_backend_features` extends the set of backend features (assumed to be in mutable state
/// accessible by that closure) to enable/disable the given Rust feature name.
// rustc: compiler/rustc_codegen_ssa/src/target_features.rs:480 flag_to_backend_features
export function flag_to_backend_features(sess: EarlySession, extend_backend_features: (feature: string, enable: boolean) => void): void {
  parse_rust_feature_list(
    sess.target,
    sess.opts.cg.target_feature,
    /* err_callback */
    (_feature) => {
      // Errors are already emitted in `internal_target_features`; avoid duplicates.
    },
    (base_feature, new_features, enable) => {
      // Forward unknown features to the backend as that's what we have always done.
      const nf = new_features ?? new Set([base_feature]);
      for (const new_feature of [...nf].sort(str_cmp)) {
        extend_backend_features(new_feature, enable);
      }
    },
  );
}

/// Computes the backend target features to be added to account for retpoline flags.
/// Used by both LLVM and GCC since their target features are, conveniently, the same.
// rustc: compiler/rustc_codegen_ssa/src/target_features.rs:504 retpoline_features_by_flags
export function retpoline_features_by_flags(sess: EarlySession, features: string[]): void {
  // -Zretpoline without -Zretpoline-external-thunk enables
  // retpoline-indirect-branches and retpoline-indirect-calls target features
  const unstable_opts = sess.opts.unstable_opts;
  if (unstable_opts.retpoline && !unstable_opts.retpoline_external_thunk) {
    features.push("+retpoline-indirect-branches");
    features.push("+retpoline-indirect-calls");
  }
  // -Zretpoline-external-thunk (maybe, with -Zretpoline too) enables
  // retpoline-external-thunk, retpoline-indirect-branches and
  // retpoline-indirect-calls target features
  if (unstable_opts.retpoline_external_thunk) {
    features.push("+retpoline-external-thunk");
    features.push("+retpoline-indirect-branches");
    features.push("+retpoline-indirect-calls");
  }
}

/// Computes the backend target features to be added to account for sanitizer flags.
// rustc: compiler/rustc_codegen_ssa/src/target_features.rs:523 sanitizer_features_by_flags
export function sanitizer_features_by_flags(sess: EarlySession, features: string[]): void {
  // It's intentional that this is done only for non-kernel version of hwaddress. This matches
  // clang behavior.
  // PORT: `SanitizerSet::contains` as session.ts spells it.
  if ((sess.sanitizers() & SanitizerSet.HWADDRESS) === SanitizerSet.HWADDRESS) {
    features.push("+tagged-globals");
  }
}

// rustc: compiler/rustc_codegen_ssa/src/target_features.rs:531 provide
export function provide(providers: Providers): void {
  providers.all_rust_target_features = (tcx: TyCtxt, cnum: CrateNum): Map<string, Stability> => {
    assert_eq(cnum, LOCAL_CRATE, (c) => debug_CrateNum(c, PLAIN));
    if (tcx.sess.opts.actually_rustdoc) {
      // HACK: rustdoc would like to pretend that we have all the target features, so we
      // have to merge all the lists into one. To ensure an unstable target never prevents
      // a stable one from working, we merge the stability info of all instances of the
      // same target feature name, with the "most stable" taking precedence. And then we
      // hope that this doesn't cause issues anywhere else in the compiler...
      const result: Map<string, Stability> = new Map();
      for (const [name, stability] of all_rust_features()) {
        const occupied = result.get(name);
        if (occupied === undefined) {
          result.set(name, stability);
        } else {
          // Merge the two stabilities, "more stable" taking precedence.
          const a = occupied;
          const b = stability;
          if (
            a.$ === "Stable" ||
            (a.$ === "Unstable" && (b.$ === "Unstable" || b.$ === "InternalOnly")) ||
            (a.$ === "InternalOnly" && b.$ === "InternalOnly")
          ) {
            // The stability in the entry is at least as good as the new
            // one, just keep it.
          } else {
            // Overwrite stability.
            result.set(name, stability);
          }
        }
      }
      return result;
    } else {
      return new Map(tcx.sess.target.rust_target_features().map(([feat, stab]) => [feat, stab]));
    }
  };
  providers.implied_target_features = (tcx: TyCtxt, feature: Symbol): Symbol[] => {
    if (tcx.sess.opts.actually_rustdoc) {
      // We can't handle implication when we are mixing all targets.
      return [feature];
    }
    const features_map = tcx.sess.target.rust_target_features_map();
    const feature_ = Symbol.as_str(feature);
    return [...tcx.sess.target.implied_target_features(feature_, features_map)].sort(str_cmp).map((s) => Symbol.intern(s));
  };
  providers.asm_target_features = asm_target_features;
}

