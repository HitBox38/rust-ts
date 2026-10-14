// Port of compiler/rustc_passes/src/lib_features.rs
//! Detecting lib features (i.e., features that are not lang features).
//!
//! These are declared using stability attributes (e.g., `#[stable (..)]` and `#[unstable (..)]`),
//! but are not declared in one single location (unlike lang features), which means we need to
//! collect them instead.
import { display_RustcVersion } from "../rustc_ast/attr/version.ts";
import type { Attribute, StabilityLevel } from "../rustc_attr_ir/lib.ts";
import { type HirTyCtxt, Visitor } from "../rustc_hir/intravisit.ts";
import { TyCtxt_as_HirTyCtxt } from "../rustc_middle/hir/map.ts";
import { All } from "../rustc_middle/hir/nested_filter.ts";
import { lib_features as lib_features_ } from "../rustc_middle/middle/mod.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { FeaturePreviouslyDeclared_diagnostic, FeatureStableTwice_diagnostic } from "./diagnostics.ts";

type FeatureStability = lib_features_.FeatureStability;
type LibFeatures = lib_features_.LibFeatures;
const LibFeatures = lib_features_.LibFeatures;

// impl<'tcx> LibFeatureCollector<'tcx> (lib_features.rs:22) and its `Visitor` impl (:95) are the methods of the
// class below, in upstream order (PORTING §8).
// rustc-type: compiler/rustc_passes/src/lib_features.rs:17 LibFeatureCollector
class LibFeatureCollector extends Visitor {
  // `type NestedFilter = nested_filter::All;`
  override NestedFilter = All;

  constructor(
    public tcx: TyCtxt,
    public lib_features: LibFeatures,
  ) {
    super();
  }

  // rustc: compiler/rustc_passes/src/lib_features.rs:23 new
  static new(tcx: TyCtxt): LibFeatureCollector {
    return new LibFeatureCollector(tcx, LibFeatures.default());
  }

  // rustc: compiler/rustc_passes/src/lib_features.rs:27 extract
  extract(attr: Attribute): [Symbol, FeatureStability, Span] | undefined {
    let feature: Symbol;
    let level: StabilityLevel;
    let span: Span;
    if (attr.$ === "Parsed" && attr._0.$ === "Stability") {
      const { stability, span: span_ } = attr._0;
      [feature, level, span] = [stability.feature, stability.level, span_];
    } else if (attr.$ === "Parsed" && attr._0.$ === "RustcConstStability") {
      const { stability, span: span_ } = attr._0;
      [feature, level, span] = [stability.feature, stability.level, span_];
    } else if (attr.$ === "Parsed" && attr._0.$ === "RustcBodyStability") {
      const { stability, span: span_ } = attr._0;
      [feature, level, span] = [stability.feature, stability.level, span_];
    } else {
      return undefined;
    }

    let feature_stability: FeatureStability;
    if (level.$ === "Unstable") {
      feature_stability = { $: "Unstable", old_name: level.old_name };
    } else {
      const since = level.since;
      let s: Symbol;
      if (since.$ === "Version") {
        s = Symbol.intern(display_RustcVersion(since._0));
      } else if (since.$ === "Current") {
        s = sym.env_CFG_RELEASE;
      } else {
        return undefined;
      }
      feature_stability = { $: "AcceptedSince", _0: s };
    }

    return [feature, feature_stability, span];
  }

  // rustc: compiler/rustc_passes/src/lib_features.rs:53 collect_feature
  collect_feature(feature: Symbol, stability: FeatureStability, span: Span): void {
    const existing_stability = this.lib_features.stability.get(feature);

    if (existing_stability === undefined) {
      this.lib_features.stability.set(feature, [stability, span]);
    } else if (stability.$ === "AcceptedSince" && existing_stability[0].$ === "AcceptedSince") {
      const since = stability._0;
      const prev_since = existing_stability[0]._0;
      if (prev_since !== since) {
        this.tcx.dcx().emit_err(FeatureStableTwice_diagnostic({ span, feature, since, prev_since }));
      }
    } else if (stability.$ === "AcceptedSince" && existing_stability[0].$ === "Unstable") {
      this.tcx.dcx().emit_err(
        FeaturePreviouslyDeclared_diagnostic({
          span,
          feature,
          declared: "stable",
          prev_declared: "unstable",
        }),
      );
    } else if (stability.$ === "Unstable" && existing_stability[0].$ === "AcceptedSince") {
      this.tcx.dcx().emit_err(
        FeaturePreviouslyDeclared_diagnostic({
          span,
          feature,
          declared: "unstable",
          prev_declared: "stable",
        }),
      );
    } else {
      // duplicate `unstable` feature is ok.
    }
  }

  // impl<'tcx> Visitor<'tcx> for LibFeatureCollector<'tcx>

  // rustc: compiler/rustc_passes/src/lib_features.rs:98 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_passes/src/lib_features.rs:102 visit_attribute
  override visit_attribute(attr: Attribute): undefined {
    const r = this.extract(attr);
    if (r !== undefined) {
      const [feature, stable, span] = r;
      this.collect_feature(feature, stable, span);
    }
  }
}

// rustc: compiler/rustc_passes/src/lib_features.rs:109 lib_features
function lib_features(tcx: TyCtxt, _: unknown): LibFeatures {
  // If `staged_api` is not enabled then we aren't allowed to define lib
  // features; there is no point collecting them.
  if (!tcx.features().staged_api()) {
    return LibFeatures.default();
  }

  const collector = LibFeatureCollector.new(tcx);
  tcx.hir_walk_attributes(collector);
  return collector.lib_features;
}

// rustc: compiler/rustc_passes/src/lib_features.rs:121 provide
export function provide(providers: Providers): void {
  providers.lib_features = lib_features;
}
