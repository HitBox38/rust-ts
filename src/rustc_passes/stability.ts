// Port of compiler/rustc_passes/src/stability.rs (lane passes-b)
//! A pass that annotates every item and method with its stability level,
//! propagating default levels lexically from parent to children ast nodes.
//
// PORT: the file's types are hand-written here (no derives besides `AnnotationKind`'s `PartialEq`, which is `===` on
// the string union). The visitors (`MissingStabilityAnnotations`, `Checker`, `CheckTraitImplStable`) are classes
// extending rustc_hir intravisit's `Visitor`; `Checker`'s second `impl` block (`check_path`, `check_path_segments`)
// sits in the class body after the `Visitor` impl, in upstream order. `find_attr!` is `find_attr(..)`
// (rustc_attr_ir/lib.ts); `find_attr!(tcx, id, ..)` goes through the `HasAttrs_*` tables of rustc_middle/ty/mod.ts.
// The values of the `lookup_*stability` / `associated_item` / `adt_def` / `generics_of` / `hir_crate_items` /
// `lib_features` queries are typed `unknown` in queries.gen.ts; they are cast to their Rust types at each use.
// `#[instrument]` (tracing) is a comment.
import { RustcVersion_cmp, display_RustcVersion } from "../rustc_ast/attr/version.ts";
import { extern_abi_stability } from "../rustc_ast_lowering/stability.ts";
import { type AttributeKind, find_attr } from "../rustc_attr_ir/lib.ts";
import { ConstStability, Stability, StabilityLevel, UnstableReason, VERSION_PLACEHOLDER, type DefaultBodyStability, type UnstableRemovedFeature } from "../rustc_attr_ir/lib.ts";
import { index_map_swap_remove } from "../rustc_errors/decorate_diag.ts";
import { UNSTABLE_LANG_FEATURES } from "../rustc_feature/lib.ts";
import type { DefKind, Res } from "../rustc_hir/def.ts";
import { DefKind as DefKindC, Res as ResC } from "../rustc_hir/def.ts";
import type { HirTyCtxt } from "../rustc_hir/intravisit.ts";
import { Visitor, walk_field_def, walk_foreign_item, walk_generic_param, walk_impl_item, walk_item, walk_path, walk_poly_trait_ref, walk_trait_item, walk_trait_ref, walk_ty, walk_variant } from "../rustc_hir/intravisit.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { Node, Path, VariantData } from "../rustc_hir/hir.ts";
import { CRATE_HIR_ID, type HirId } from "../rustc_hir_id/lib.ts";
import {
  DUPLICATE_FEATURES,
  INEFFECTIVE_UNSTABLE_REEXPORTS,
  INEFFECTIVE_UNSTABLE_TRAIT_IMPL,
  STABLE_FEATURES,
  UNSTABLE_IMPORTS,
} from "../rustc_lint_defs/builtin.gen.ts";
import { TyCtxt_as_HirTyCtxt } from "../rustc_middle/hir/map.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import { OnlyBodies } from "../rustc_middle/hir/nested_filter.ts";
import { lib_features as lib_features_ } from "../rustc_middle/middle/mod.ts";
import type { EffectiveVisibilities } from "../rustc_middle/middle/privacy.ts";
import { Reexport } from "../rustc_middle/middle/resolve.ts";
import { DeprecationEntry, type EvalResult } from "../rustc_middle/middle/stability.ts";
import type { LocalCrate } from "../rustc_middle/query/keys.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { AssocItem } from "../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import { HasAttrs_DefId, HasAttrs_LocalDefId, Visibility } from "../rustc_middle/ty/mod.ts";
import { CRATE_DEF_ID, CrateNum, type DefId, DefId_eq, LOCAL_CRATE, LocalDefId, LocalModId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { unwrap } from "../std/panic.ts";
import { debug_PathSegment } from "../rustc_hir/hir.gen.ts";
import * as diagnostics from "./diagnostics.ts";

type LibFeatures = lib_features_.LibFeatures;
const LibFeatures = lib_features_.LibFeatures;

// rustc-type: compiler/rustc_passes/src/stability.rs:36 AnnotationKind
/** `#[derive(PartialEq)]` */
type AnnotationKind =
  /// Annotation is required if not inherited from unstable parents.
  | "Required"
  /// Annotation is useless, reject it.
  | "Prohibited"
  /// Deprecation annotation is useless, reject it. (Stability attribute is still required.)
  | "DeprecationProhibited"
  /// Annotation itself is useless, but it can be propagated to children.
  | "Container";
const AnnotationKind = { Required: "Required", Prohibited: "Prohibited", DeprecationProhibited: "DeprecationProhibited", Container: "Container" } as const;

// rustc: compiler/rustc_passes/src/stability.rs:48 inherit_deprecation
function inherit_deprecation(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "LifetimeParam":
    case "TyParam":
    case "ConstParam":
      return false;
    default:
      return true;
  }
}

// rustc: compiler/rustc_passes/src/stability.rs:55 inherit_const_stability
function inherit_const_stability(tcx: TyCtxt, def_id: LocalDefId): boolean {
  const def_kind = tcx.def_kind(def_id);
  switch (def_kind.$) {
    case "AssocFn":
    case "AssocTy":
    case "AssocConst": {
      switch (tcx.def_kind(tcx.local_parent(def_id)).$) {
        case "Trait":
        case "Impl":
          return true;
        default:
          return false;
      }
    }
    case "Closure":
      return true;
    default:
      return false;
  }
}

// rustc: compiler/rustc_passes/src/stability.rs:69 annotation_kind
function annotation_kind(tcx: TyCtxt, def_id: LocalDefId): AnnotationKind {
  const def_kind = tcx.def_kind(def_id);
  switch (def_kind.$) {
    // Inherent impls and foreign modules serve only as containers for other items,
    // they don't have their own stability. They still can be annotated as unstable
    // and propagate this unstability to children, but this annotation is completely
    // optional. They inherit stability from their parents when unannotated.
    case "Impl":
      if (!def_kind.of_trait) {
        return AnnotationKind.Container;
      }
      return AnnotationKind.DeprecationProhibited;
    case "ForeignMod":
      return AnnotationKind.Container;

    // Allow stability attributes on default generic arguments.
    case "TyParam":
    case "ConstParam": {
      const kind = Node.expect_generic_param(tcx.hir_node_by_def_id(def_id)).kind;
      if ((kind.$ === "Type" && kind.default !== undefined) || (kind.$ === "Const" && kind.default !== undefined)) {
        return AnnotationKind.Container;
      }
      return AnnotationKind.Prohibited;
    }

    // Impl items in trait impls cannot have stability.
    case "AssocTy":
    case "AssocFn":
    case "AssocConst": {
      const parent_kind = tcx.def_kind(tcx.local_parent(def_id));
      if (parent_kind.$ === "Impl" && parent_kind.of_trait === true) {
        return AnnotationKind.Prohibited;
      }
      return AnnotationKind.Required;
    }

    default:
      return AnnotationKind.Required;
  }
}

// rustc: compiler/rustc_passes/src/stability.rs:102 lookup_deprecation_entry
function lookup_deprecation_entry(tcx: TyCtxt, def_id: LocalDefId): DeprecationEntry | undefined {
  const depr = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "Deprecated" ? k.deprecation : undefined));

  if (depr === undefined) {
    if (inherit_deprecation(tcx.def_kind(def_id))) {
      const parent_id = tcx.opt_local_parent(def_id);
      if (parent_id === undefined) return undefined;
      const parent_depr = tcx.lookup_deprecation_entry(parent_id);
      if (parent_depr === undefined) return undefined;
      return parent_depr;
    }

    return undefined;
  }

  // `Deprecation` is just two pointers, no need to intern it
  return DeprecationEntry.local(depr, def_id);
}

// rustc: compiler/rustc_passes/src/stability.rs:121 inherit_stability
function inherit_stability(def_kind: DefKind): boolean {
  switch (def_kind.$) {
    case "Field":
    case "Variant":
    case "Ctor":
      return true;
    default:
      return false;
  }
}

/// If the `-Z force-unstable-if-unmarked` flag is passed then we provide
/// a parent stability annotation which indicates that this is private
/// with the `rustc_private` feature. This is intended for use when
/// compiling library and `rustc_*` crates themselves so we can leverage crates.io
/// while maintaining the invariant that all sysroot crates are unstable
/// by default and are unable to be used.
// PORT: a `const` (copied at each use); the shared value is never mutated.
const FORCE_UNSTABLE: Stability = new Stability(
  {
    $: "Unstable",
    reason: UnstableReason.Default,
    issue: 27812,
    implied_by: undefined,
    old_name: undefined,
  },
  sym.rustc_private,
);

// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_passes/src/stability.rs:145 lookup_stability
function lookup_stability(tcx: TyCtxt, def_id: LocalDefId): Stability | undefined {
  // Propagate unstability. This can happen even for non-staged-api crates in case
  // -Zforce-unstable-if-unmarked is set.
  if (!tcx.features().staged_api()) {
    if (!tcx.sess.opts.unstable_opts.force_unstable_if_unmarked) {
      return undefined;
    }

    const parent = tcx.opt_local_parent(def_id);
    if (parent === undefined) return FORCE_UNSTABLE;

    if (inherit_deprecation(tcx.def_kind(def_id))) {
      const parent_ = tcx.lookup_stability(parent) as Stability | undefined;
      if (parent_ === undefined) return undefined;
      if (parent_.is_unstable()) {
        return parent_;
      }
    }

    return undefined;
  }

  // # Regular stability
  const stab = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "Stability" ? k.stability : undefined));

  if (stab !== undefined) {
    return stab;
  }

  if (inherit_deprecation(tcx.def_kind(def_id))) {
    const parent = tcx.opt_local_parent(def_id);
    if (parent === undefined) {
      return tcx.sess.opts.unstable_opts.force_unstable_if_unmarked ? FORCE_UNSTABLE : undefined;
    }
    const parent_ = tcx.lookup_stability(parent) as Stability | undefined;
    if (parent_ === undefined) return undefined;
    if (parent_.is_unstable() || inherit_stability(tcx.def_kind(def_id))) {
      return parent_;
    }
  }

  return undefined;
}

// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_passes/src/stability.rs:191 lookup_default_body_stability
function lookup_default_body_stability(tcx: TyCtxt, def_id: LocalDefId): DefaultBodyStability | undefined {
  if (!tcx.features().staged_api()) {
    return undefined;
  }

  // FIXME: check that this item can have body stability
  return find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcBodyStability" ? k.stability : undefined));
}

// #[instrument(level = "debug", skip(tcx))]
// rustc: compiler/rustc_passes/src/stability.rs:204 lookup_const_stability
function lookup_const_stability(tcx: TyCtxt, def_id: LocalDefId): ConstStability | undefined {
  if (!tcx.features().staged_api()) {
    // Propagate unstability. This can happen even for non-staged-api crates in case
    // -Zforce-unstable-if-unmarked is set.
    if (inherit_deprecation(tcx.def_kind(def_id))) {
      const parent = tcx.opt_local_parent(def_id);
      if (parent === undefined) return undefined;
      const parent_stab = tcx.lookup_stability(parent) as Stability | undefined;
      if (parent_stab === undefined) return undefined;
      let fn_sig: hir.FnSig | undefined;
      if (
        parent_stab.is_unstable() &&
        (fn_sig = Node.fn_sig(tcx.hir_node_by_def_id(def_id))) !== undefined &&
        fn_sig.header.constness.$ === "Const"
      ) {
        const const_stable_indirect = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcConstStableIndirect" ? null : undefined)) !== undefined;
        return ConstStability.unmarked(const_stable_indirect, parent_stab);
      }
    }

    return undefined;
  }

  const const_stable_indirect = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcConstStableIndirect" ? null : undefined)) !== undefined;
  const const_stab_ = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcConstStability" ? k.stability : undefined));

  // After checking the immediate attributes, get rid of the span and compute implied
  // const stability: inherit feature gate from regular stability.
  let const_stab = const_stab_ === undefined ? undefined : ConstStability.from_partial(const_stab_, const_stable_indirect);

  // If this is a const fn but not annotated with stability markers, see if we can inherit
  // regular stability.
  let fn_sig: hir.FnSig | undefined;
  let inherit_regular_stab: Stability | undefined;
  if (
    (fn_sig = Node.fn_sig(tcx.hir_node_by_def_id(def_id))) !== undefined &&
    fn_sig.header.constness.$ === "Const" &&
    const_stab === undefined &&
    // We only ever inherit unstable features.
    (inherit_regular_stab = tcx.lookup_stability(def_id) as Stability | undefined) !== undefined &&
    inherit_regular_stab.is_unstable()
  ) {
    const_stab = new ConstStability(
      inherit_regular_stab.level,
      inherit_regular_stab.feature,
      false,
      // We subject these implicitly-const functions to recursive const stability.
      true,
    );
  }

  if (const_stab !== undefined) {
    return const_stab;
  }

  // `impl const Trait for Type` items forward their const stability to their immediate children.
  // FIXME(const_trait_impl): how is this supposed to interact with `#[rustc_const_stable_indirect]`?
  // Currently, once that is set, we do not inherit anything from the parent any more.
  if (inherit_const_stability(tcx, def_id)) {
    const parent = tcx.opt_local_parent(def_id);
    if (parent === undefined) return undefined;
    const parent_ = tcx.lookup_const_stability(parent) as ConstStability | undefined;
    if (parent_ === undefined) return undefined;
    if (parent_.is_const_unstable()) {
      return parent_;
    }
  }

  return undefined;
}

// rustc: compiler/rustc_passes/src/stability.rs:268 stability_implications
function stability_implications(tcx: TyCtxt, _LocalCrate: LocalCrate): Map<Symbol, Symbol> {
  const implications = new Map<Symbol, Symbol>();

  const register_implication = (def_id: LocalDefId): void => {
    const stability = tcx.lookup_stability(def_id) as Stability | undefined;
    if (stability !== undefined && stability.level.$ === "Unstable" && stability.level.implied_by !== undefined) {
      const implied_by = stability.level.implied_by;
      implications.set(implied_by, stability.feature);
    }

    const const_stability = tcx.lookup_const_stability(def_id) as ConstStability | undefined;
    if (const_stability !== undefined && const_stability.level.$ === "Unstable" && const_stability.level.implied_by !== undefined) {
      const implied_by = const_stability.level.implied_by;
      implications.set(implied_by, const_stability.feature);
    }
  };

  if (tcx.features().staged_api()) {
    register_implication(CRATE_DEF_ID);
    for (const def_id of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
      register_implication(def_id);
      const def_kind = tcx.def_kind(def_id);
      if (DefKindC.is_adt(def_kind)) {
        const adt = tcx.adt_def(def_id) as AdtDef;
        for (const variant of adt.variants()) {
          if (!DefId_eq(variant.def_id, LocalDefId.to_def_id(def_id))) {
            register_implication(variant.def_id.expect_local());
          }
          for (const field of variant.fields) {
            register_implication(field.did.expect_local());
          }
          const ctor_def_id = variant.ctor_def_id();
          if (ctor_def_id !== undefined) {
            register_implication(ctor_def_id.expect_local());
          }
        }
      }
      if (DefKindC.has_generics(def_kind)) {
        for (const param of (tcx.generics_of(def_id) as Generics).own_params) {
          register_implication(param.def_id.expect_local());
        }
      }
    }
  }

  return implications;
}

// rustc-type: compiler/rustc_passes/src/stability.rs:317 MissingStabilityAnnotations
class MissingStabilityAnnotations extends Visitor {
  // impl<'tcx> Visitor<'tcx> for MissingStabilityAnnotations<'tcx>
  // type NestedFilter = nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public tcx: TyCtxt,
    public effective_visibilities: EffectiveVisibilities,
  ) {
    super();
  }

  // ---- impl<'tcx> MissingStabilityAnnotations<'tcx> ----

  /// Verify that deprecation and stability attributes make sense with one another.
  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_passes/src/stability.rs:323 check_compatible_stability
  check_compatible_stability(def_id: LocalDefId): void {
    if (!this.tcx.features().staged_api()) {
      return;
    }

    const depr = this.tcx.lookup_deprecation_entry(def_id);
    const stab = this.tcx.lookup_stability(def_id) as Stability | undefined;
    const const_stab = this.tcx.lookup_const_stability(def_id) as ConstStability | undefined;

    // macro_rules! find_attr_span
    const find_attr_span = (name: "Deprecated" | "Stability" | "RustcConstStability"): Span | undefined => {
      const attrs = this.tcx.hir_attrs(this.tcx.local_def_id_to_hir_id(def_id));
      return find_attr(attrs, (k: AttributeKind) => (k.$ === name ? (k as Extract<AttributeKind, { $: typeof name }>).span : undefined));
    };

    let span: Span | undefined;
    if (stab === undefined && depr !== undefined && depr.attr.is_since_rustc_version() && (span = find_attr_span("Deprecated")) !== undefined) {
      this.tcx.dcx().emit_err(diagnostics.DeprecatedAttribute_diagnostic({ span }));
    }

    if (stab !== undefined) {
      // Error if prohibited, or can't inherit anything from a container.
      const kind = annotation_kind(this.tcx, def_id);
      if (kind === AnnotationKind.Prohibited || (kind === AnnotationKind.Container && StabilityLevel.is_stable(stab.level) && depr !== undefined)) {
        const span = find_attr_span("Stability");
        if (span !== undefined) {
          const item_sp = this.tcx.def_span(def_id);
          this.tcx.dcx().emit_err(diagnostics.UselessStability_diagnostic({ span, item_sp }));
        }
      }

      // Check if deprecated_since < stable_since. If it is,
      // this is *almost surely* an accident.
      let span: Span | undefined;
      if (
        depr !== undefined &&
        depr.attr.since.$ === "RustcVersion" &&
        stab.level.$ === "Stable" &&
        (span = find_attr_span("Stability")) !== undefined
      ) {
        const dep_since = depr.attr.since._0;
        const stab_since = stab.level.since;
        const item_sp = this.tcx.def_span(def_id);
        switch (stab_since.$) {
          case "Current": {
            this.tcx.dcx().emit_err(diagnostics.CannotStabilizeDeprecated_diagnostic({ span, item_sp }));
            break;
          }
          case "Version": {
            const stab_since_ = stab_since._0;
            if (RustcVersion_cmp(dep_since, stab_since_) < 0) {
              this.tcx.dcx().emit_err(diagnostics.CannotStabilizeDeprecated_diagnostic({ span, item_sp }));
            }
            break;
          }
          case "Err": {
            // An error already reported. Assume the unparseable stabilization
            // version is older than the deprecation version.
            break;
          }
        }
      }
    }

    // If the current node is a function with const stability attributes (directly given or
    // implied), check if the function/method is const or the parent impl block is const.
    const fn_sig = Node.fn_sig(this.tcx.hir_node_by_def_id(def_id));
    if (fn_sig !== undefined && !(fn_sig.header.constness.$ === "Const") && const_stab !== undefined && find_attr_span("RustcConstStability") !== undefined) {
      this.tcx.dcx().emit_err(diagnostics.MissingConstErr_diagnostic({ fn_sig_span: fn_sig.span }));
    }

    // If this is marked const *stable*, it must also be regular-stable.
    let path_span: Span | undefined;
    if (
      const_stab !== undefined &&
      fn_sig !== undefined &&
      const_stab.is_const_stable() &&
      !(stab !== undefined && stab.is_stable()) &&
      (path_span = find_attr_span("RustcConstStability")) !== undefined
    ) {
      this.tcx.dcx().emit_err(
        diagnostics.ConstStableNotStable_diagnostic({
          fn_sig_span: fn_sig.span,
          path_span,
        }),
      );
    }

    let span2: Span | undefined;
    if (const_stab !== undefined && const_stab.is_const_stable() && const_stab.const_stable_indirect && (span2 = find_attr_span("RustcConstStability")) !== undefined) {
      this.tcx.dcx().emit_err(diagnostics.RustcConstStableIndirectPairing_diagnostic({ span: span2 }));
    }
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_passes/src/stability.rs:421 check_missing_stability
  check_missing_stability(def_id: LocalDefId): void {
    const stab = this.tcx.lookup_stability(def_id) as Stability | undefined;
    this.tcx.ensure_ok().lookup_const_stability(def_id);
    if (!this.tcx.sess.is_test_crate() && stab === undefined && this.effective_visibilities.is_reachable(def_id)) {
      const descr = this.tcx.def_descr(LocalDefId.to_def_id(def_id));
      const span = this.tcx.def_span(def_id);
      this.tcx.dcx().emit_err(diagnostics.MissingStabilityAttr_diagnostic({ span, descr }));
    }
  }

  // rustc: compiler/rustc_passes/src/stability.rs:434 check_missing_const_stability
  check_missing_const_stability(def_id: LocalDefId): void {
    const is_const =
      this.tcx.is_const_fn(LocalDefId.to_def_id(def_id)) ||
      (this.tcx.def_kind(LocalDefId.to_def_id(def_id)).$ === "Trait" && this.tcx.is_const_trait(LocalDefId.to_def_id(def_id)));

    // Reachable const fn/trait must have a stability attribute.
    if (is_const && this.effective_visibilities.is_reachable(def_id) && this.tcx.lookup_const_stability(def_id) === undefined) {
      const span = this.tcx.def_span(def_id);
      const descr = this.tcx.def_descr(LocalDefId.to_def_id(def_id));
      this.tcx.dcx().emit_err(diagnostics.MissingConstStabAttr_diagnostic({ span, descr }));
    }
  }

  // ---- impl<'tcx> Visitor<'tcx> for MissingStabilityAnnotations<'tcx> ----

  // rustc: compiler/rustc_passes/src/stability.rs:454 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_passes/src/stability.rs:458 visit_item
  override visit_item(i: hir.Item): undefined {
    this.check_compatible_stability(i.owner_id.def_id);

    // Inherent impls and foreign modules serve only as containers for other items,
    // they don't have their own stability. They still can be annotated as unstable
    // and propagate this instability to children, but this annotation is completely
    // optional. They inherit stability from their parents when unannotated.
    if (!((i.kind.$ === "Impl" && i.kind._0.of_trait === undefined) || i.kind.$ === "ForeignMod")) {
      this.check_missing_stability(i.owner_id.def_id);
    }

    // Ensure stable `const fn` have a const stability attribute.
    this.check_missing_const_stability(i.owner_id.def_id);

    return walk_item(this, i);
  }

  // rustc: compiler/rustc_passes/src/stability.rs:479 visit_trait_item
  override visit_trait_item(ti: hir.TraitItem): undefined {
    this.check_compatible_stability(ti.owner_id.def_id);
    this.check_missing_stability(ti.owner_id.def_id);
    walk_trait_item(this, ti);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/stability.rs:485 visit_impl_item
  override visit_impl_item(ii: hir.ImplItem): undefined {
    this.check_compatible_stability(ii.owner_id.def_id);
    if (ii.impl_kind.$ === "Inherent") {
      this.check_missing_stability(ii.owner_id.def_id);
      this.check_missing_const_stability(ii.owner_id.def_id);
    }
    walk_impl_item(this, ii);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/stability.rs:494 visit_variant
  override visit_variant(var_: hir.Variant): undefined {
    this.check_compatible_stability(var_.def_id);
    this.check_missing_stability(var_.def_id);
    const ctor_def_id = VariantData.ctor_def_id(var_.data);
    if (ctor_def_id !== undefined) {
      this.check_missing_stability(ctor_def_id);
    }
    walk_variant(this, var_);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/stability.rs:503 visit_field_def
  override visit_field_def(s: hir.FieldDef): undefined {
    this.check_compatible_stability(s.def_id);
    this.check_missing_stability(s.def_id);
    walk_field_def(this, s);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/stability.rs:509 visit_foreign_item
  override visit_foreign_item(i: hir.ForeignItem): undefined {
    this.check_compatible_stability(i.owner_id.def_id);
    this.check_missing_stability(i.owner_id.def_id);
    walk_foreign_item(this, i);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/stability.rs:515 visit_generic_param
  override visit_generic_param(p: hir.GenericParam): undefined {
    this.check_compatible_stability(p.def_id);
    // Note that we don't need to `check_missing_stability` for default generic parameters,
    // as we assume that any default generic parameters without attributes are automatically
    // stable (assuming they have not inherited instability from their parent).
    walk_generic_param(this, p);
    return undefined;
  }
}

/// Cross-references the feature names of unstable APIs with enabled
/// features and possibly prints errors.
// rustc: compiler/rustc_passes/src/stability.rs:526 check_mod_unstable_api_usage
function check_mod_unstable_api_usage(tcx: TyCtxt, mod_id: LocalModId): null {
  const checker = new Checker(tcx, mod_id, new Map());
  tcx.hir_visit_item_likes_in_module(mod_id, checker);
  checker.emit_ineffective_unstable_reexports();

  const is_staged_api = tcx.sess.opts.unstable_opts.force_unstable_if_unmarked || tcx.features().staged_api();
  if (is_staged_api) {
    const effective_visibilities = tcx.effective_visibilities(null);
    const missing = new MissingStabilityAnnotations(tcx, effective_visibilities);
    if (LocalModId.is_top_level_module(mod_id)) {
      missing.check_missing_stability(CRATE_DEF_ID);
    }
    tcx.hir_visit_item_likes_in_module(mod_id, missing);
  }

  if (LocalModId.is_top_level_module(mod_id)) {
    check_unused_or_stable_features(tcx);
  }
  return null;
}

// rustc: compiler/rustc_passes/src/stability.rs:547 provide
export function provide(providers: Providers): void {
  providers.check_mod_unstable_api_usage = check_mod_unstable_api_usage;
  providers.stability_implications = stability_implications;
  providers.lookup_stability = lookup_stability;
  providers.lookup_const_stability = lookup_const_stability;
  providers.lookup_default_body_stability = lookup_default_body_stability;
  providers.lookup_deprecation_entry = lookup_deprecation_entry;
}

// rustc-type: compiler/rustc_passes/src/stability.rs:559 UnstableReexport
interface UnstableReexport {
  hir_id: HirId;
  span: Span;
  has_target: boolean;
  all_targets_stable: boolean;
}

// rustc-type: compiler/rustc_passes/src/stability.rs:566 Checker
class Checker extends Visitor {
  // impl<'tcx> Visitor<'tcx> for Checker<'tcx>
  // type NestedFilter = nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public tcx: TyCtxt,
    public mod_id: LocalModId,
    // PORT: `FxIndexMap<Span, UnstableReexport>` -> an insertion-ordered `Map` (`Span` is an interned handle).
    public unstable_reexports: Map<Span, UnstableReexport>,
  ) {
    super();
  }

  // ---- impl<'tcx> Checker<'tcx> ----

  // rustc: compiler/rustc_passes/src/stability.rs:573 unstable_reexport_span
  unstable_reexport_span(hir_id: HirId): Span | undefined {
    const attrs = this.tcx.hir_attrs(hir_id);
    const found = find_attr(attrs, (k): [Stability, Span] | undefined => (k.$ === "Stability" ? [k.stability, k.span] : undefined));
    if (found === undefined) return undefined;
    const [stability, span] = found;

    return StabilityLevel.is_unstable(stability.level) ? span : undefined;
  }

  // rustc: compiler/rustc_passes/src/stability.rs:581 classify_reexport_targets
  classify_reexport_targets<Id>(targets: Iterable<Res<Id>>): [boolean, boolean] {
    let has_target = false;
    let all_targets_stable = true;

    for (const res of targets) {
      switch (res.$) {
        case "Def": {
          const def_id = res._1;
          has_target = true;

          const stability = this.tcx.lookup_stability(def_id) as Stability | undefined;
          if (stability !== undefined && StabilityLevel.is_unstable(stability.level)) {
            all_targets_stable = false;
          } else if (stability !== undefined) {
            // Some(_) => {}
          } else {
            // Items from crates without staged API metadata are
            // effectively stable. Unmarked items in staged API
            // crates are diagnosed by the existing stability checks.
            if ((this.tcx.lookup_stability(CrateNum.as_def_id(def_id.krate)) as Stability | undefined) !== undefined) {
              all_targets_stable = false;
            }
          }
          break;
        }

        // Primitives are stable and have no DefId.
        case "PrimTy": {
          has_target = true;
          break;
        }

        // Do not lint if the target cannot be classified.
        default: {
          all_targets_stable = false;
          break;
        }
      }
    }

    return [has_target, all_targets_stable];
  }

  // rustc: compiler/rustc_passes/src/stability.rs:625 record_unstable_reexport
  record_unstable_reexport(hir_id: HirId, attr_span: Span, span: Span, has_target: boolean, all_targets_stable: boolean): void {
    let entry = this.unstable_reexports.get(attr_span);
    if (entry === undefined) {
      entry = {
        hir_id,
        span,
        has_target: false,
        all_targets_stable: true,
      };
      this.unstable_reexports.set(attr_span, entry);
    }

    entry.has_target ||= has_target;
    entry.all_targets_stable &&= all_targets_stable;
  }

  // rustc: compiler/rustc_passes/src/stability.rs:644 check_single_unstable_reexport
  check_single_unstable_reexport(hir_id: HirId, path: hir.UsePath): void {
    const attr_span = this.unstable_reexport_span(hir_id);
    if (attr_span === undefined) {
      return;
    }

    const [has_target, all_targets_stable] = this.classify_reexport_targets(path.res.present_items());

    this.record_unstable_reexport(hir_id, attr_span, path.span, has_target, all_targets_stable);
  }

  // rustc: compiler/rustc_passes/src/stability.rs:655 check_glob_unstable_reexport
  check_glob_unstable_reexport(hir_id: HirId, glob_def_id_: LocalDefId, path: hir.UsePath): void {
    const attr_span = this.unstable_reexport_span(hir_id);
    if (attr_span === undefined) {
      return;
    }

    const glob_def_id = LocalDefId.to_def_id(glob_def_id_);

    const targets = this.tcx
      .module_children_local(LocalModId.to_local_def_id(this.mod_id))
      .filter((child) =>
        child.reexport_chain.some((reexport) => {
          const id = Reexport.id(reexport);
          return id !== undefined && DefId_eq(id, glob_def_id);
        }),
      )
      .map((child) => child.res);

    const [has_target, all_targets_stable] = this.classify_reexport_targets(targets);

    this.record_unstable_reexport(hir_id, attr_span, path.span, has_target, all_targets_stable);
  }

  // rustc: compiler/rustc_passes/src/stability.rs:681 containing_module_is_unstable
  containing_module_is_unstable(): boolean {
    const stability = this.tcx.lookup_stability(LocalModId.to_local_def_id(this.mod_id)) as Stability | undefined;
    return stability !== undefined && StabilityLevel.is_unstable(stability.level);
  }

  // rustc: compiler/rustc_passes/src/stability.rs:687 emit_ineffective_unstable_reexports
  emit_ineffective_unstable_reexports(): void {
    // an unstable module already makes its re-exports unstable
    // keep the explicit annotation without linting it as ineffective
    if (this.unstable_reexports.size === 0 || this.containing_module_is_unstable()) {
      return;
    }

    for (const reexport of this.unstable_reexports.values()) {
      if (reexport.has_target && reexport.all_targets_stable) {
        this.tcx.emit_node_span_lint(INEFFECTIVE_UNSTABLE_REEXPORTS, reexport.hir_id, reexport.span, diagnostics.IneffectiveUnstableReexport_diagnostic({}));
      }
    }
  }

  // ---- impl<'tcx> Visitor<'tcx> for Checker<'tcx> ----

  /// Because stability levels are scoped lexically, we want to walk
  /// nested items in the context of the outer item, so enable
  /// deep-walking.
  // rustc: compiler/rustc_passes/src/stability.rs:713 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_passes/src/stability.rs:717 visit_item
  override visit_item(item: hir.Item): undefined {
    const kind = item.kind;
    if (kind.$ === "ExternCrate") {
      const ident = kind._1;
      // compiler-generated `extern crate` items have a dummy span.
      // `std` is still checked for the `restricted-std` feature.
      if (Span.is_dummy(item.span) && ident.name !== sym.std) {
        return undefined;
      }

      const cnum = this.tcx.extern_mod_stmt_cnum(item.owner_id.def_id);
      if (cnum === undefined) {
        return undefined;
      }
      const def_id = CrateNum.as_def_id(cnum);
      this.tcx.check_stability(def_id, item.hir_id(), item.span, undefined);
    }

    // For implementations of traits, check the stability of each item
    // individually as it's possible to have a stable trait with unstable
    // items.
    else if (kind.$ === "Impl" && kind._0.of_trait !== undefined) {
      const { of_trait, self_ty, items, constness } = kind._0;
      const features = this.tcx.features();
      if (features.staged_api()) {
        const attrs = this.tcx.hir_attrs(item.hir_id());
        const stab = find_attr(attrs, (k): [Stability, Span] | undefined => (k.$ === "Stability" ? [k.stability, k.span] : undefined));

        // FIXME(jdonszelmann): make it impossible to miss the or_else in the typesystem
        const const_stab = find_attr(attrs, (k) => (k.$ === "RustcConstStability" ? k.stability : undefined));

        const unstable_feature_stab: readonly [Symbol, Span][] = find_attr(attrs, (k) => (k.$ === "UnstableFeatureBound" ? k._0 : undefined)) ?? [];

        // If this impl block has an #[unstable] attribute, give an
        // error if all involved types and traits are stable, because
        // it will have no effect.
        // See: https://github.com/rust-lang/rust/issues/55436
        //
        // The exception is when there are both  #[unstable_feature_bound(..)] and
        //  #![unstable(feature = "..", issue = "..")] that have the same symbol because
        // that can effectively mark an impl as unstable.
        //
        // For example:
        // ```
        // #[unstable_feature_bound(feat_foo)]
        // #[unstable(feature = "feat_foo", issue = "none")]
        // impl Foo for Bar {}
        // ```
        if (stab !== undefined && stab[0].level.$ === "Unstable") {
          const feature = stab[0].feature;
          const span = stab[1];
          const c = new CheckTraitImplStable(this.tcx, true);
          c.visit_ty_unambig(self_ty);
          c.visit_trait_ref(of_trait.trait_ref);

          // Skip the lint if the impl is marked as unstable using
          // #[unstable_feature_bound(..)]
          let unstable_feature_bound_in_effect = false;
          for (const [unstable_bound_feat_name, _] of unstable_feature_stab) {
            if (unstable_bound_feat_name === feature) {
              unstable_feature_bound_in_effect = true;
            }
          }

          // do not lint when the trait isn't resolved, since resolution error should
          // be fixed first
          if (of_trait.trait_ref.path.res.$ !== "Err" && c.fully_stable && !unstable_feature_bound_in_effect) {
            this.tcx.emit_node_span_lint(INEFFECTIVE_UNSTABLE_TRAIT_IMPL, item.hir_id(), span, diagnostics.IneffectiveUnstableImpl_diagnostic({}));
          }
        }

        if (features.const_trait_impl() && constness.$ === "Const") {
          let stable_or_implied_stable: boolean;
          if (const_stab === undefined) {
            stable_or_implied_stable = true;
          } else if (const_stab.is_const_stable()) {
            // `#![feature(const_trait_impl)]` is unstable, so any impl declared stable
            // needs to have an error emitted.
            // Note: Remove this error once `const_trait_impl` is stabilized
            this.tcx.dcx().emit_err(
              diagnostics.TraitImplConstStable_diagnostic({
                span: item.span,
              }),
            );
            stable_or_implied_stable = true;
          } else {
            stable_or_implied_stable = false;
          }

          const trait_id = of_trait.trait_ref.trait_def_id();
          let const_stab_: ConstStability | undefined;
          if (trait_id !== undefined && (const_stab_ = this.tcx.lookup_const_stability(trait_id) as ConstStability | undefined) !== undefined) {
            // the const stability of a trait impl must match the const stability on the trait.
            if (const_stab_.is_const_stable() !== stable_or_implied_stable) {
              const trait_span = unwrap(this.tcx.def_ident_span(trait_id));

              const impl_stability: diagnostics.ImplConstStability = stable_or_implied_stable
                ? { $: "Stable", span: item.span }
                : { $: "Unstable", span: item.span };
              const trait_stability: diagnostics.TraitConstStability = const_stab_.is_const_stable()
                ? { $: "Stable", span: trait_span }
                : { $: "Unstable", span: trait_span };

              this.tcx.dcx().emit_err(
                diagnostics.TraitImplConstStabilityMismatch_diagnostic({
                  span: item.span,
                  impl_stability,
                  trait_stability,
                }),
              );
            }
          }
        }
      }

      let def_id: DefId | undefined;
      if (constness.$ === "Const" && (def_id = of_trait.trait_ref.trait_def_id()) !== undefined) {
        // FIXME(const_trait_impl): Improve the span here.
        this.tcx.check_const_stability(def_id, of_trait.trait_ref.path.span, of_trait.trait_ref.path.span);
      }

      for (const impl_item_ref of items) {
        const impl_item = this.tcx.associated_item(impl_item_ref.owner_id) as AssocItem;

        if (impl_item.container.$ === "TraitImpl" && impl_item.container._0.$ === "Ok") {
          const def_id = impl_item.container._0._0;
          // Pass `None` to skip deprecation warnings.
          this.tcx.check_stability(def_id, undefined, this.tcx.def_span(impl_item_ref.owner_id), undefined);
        }
      }
    } else {
      // _ => (/* pass */),
    }
    return walk_item(this, item);
  }

  // rustc: compiler/rustc_passes/src/stability.rs:882 visit_poly_trait_ref
  override visit_poly_trait_ref(t: hir.PolyTraitRef): undefined {
    const constness = t.modifiers.constness;
    switch (constness.$) {
      case "Always":
      case "Maybe": {
        const span = constness._0;
        const def_id = t.trait_ref.trait_def_id();
        if (def_id !== undefined) {
          this.tcx.check_const_stability(def_id, t.trait_ref.path.span, span);
        }
        break;
      }
      case "Never":
        break;
    }
    walk_poly_trait_ref(this, t);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/stability.rs:894 visit_use
  override visit_use(tree: hir.UseTree, hir_id: HirId, def_id: LocalDefId): undefined {
    const v: (readonly hir.PathSegment[])[] = [];

    // #[instrument(skip(visitor))]
    // rustc: compiler/rustc_passes/src/stability.rs:898 recurse
    function recurse(visitor: Checker, tree: hir.UseTree, hir_id: HirId, def_id: LocalDefId, stack: (readonly hir.PathSegment[])[]): void {
      const { segments, res, span } = tree.prefix;

      switch (tree.kind.$) {
        case "Single":
        case "Glob": {
          if (visitor.tcx.features().staged_api() && Visibility.is_public(visitor.tcx.local_visibility(def_id))) {
            if (tree.kind.$ === "Single") {
              visitor.check_single_unstable_reexport(hir_id, tree.prefix);
            } else {
              visitor.check_glob_unstable_reexport(hir_id, def_id, tree.prefix);
            }
          }
          // A use item can import something from two namespaces at the same time.
          // For deprecation/stability we don't want to warn twice.
          // This specifically happens with constructors for unit/tuple structs.
          const res_ = res.value_ns ?? res.type_ns;
          if (res_ !== undefined) {
            visitor.check_path(new Path(span, res_, segments), hir_id, stack);
          }

          // Though, visit the macro namespace if it exists,
          // regardless of the checks above relating to constructors.
          const res_m = res.macro_ns;
          if (res_m !== undefined) {
            visitor.check_path(new Path(span, res_m, segments), hir_id, stack);
          }
          break;
        }
        case "Nested": {
          const items = tree.kind.items;
          stack.push(tree.prefix.segments);
          if (items.length === 0) {
            // need to handle `use foo::bar::{};`
            const last = segments.at(-1);
            visitor.check_path(new Path(span, last === undefined ? ResC.Err : last.res, segments), hir_id, stack);
          } else {
            for (const [tree, id, def_id] of items) {
              recurse(visitor, tree, id, def_id, stack);
            }
          }
          stack.pop();
          break;
        }
      }
    }
    recurse(this, tree, hir_id, def_id, v);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/stability.rs:956 visit_path
  override visit_path(path: hir.Path, id: HirId): undefined {
    this.check_path(path, id, []);

    walk_path(this, path);
    return undefined;
  }

  // ---- impl<'tcx> Checker<'tcx> ----

  // rustc: compiler/rustc_passes/src/stability.rs:964 check_path
  check_path(path: hir.Path, id: HirId, prefix: readonly (readonly hir.PathSegment[])[]): void {
    const def_id = ResC.opt_def_id(path.res);
    if (def_id !== undefined) {
      const last = path.segments.at(-1);
      const method_span = last === undefined ? undefined : last.ident.span;
      const item_is_allowed = this.tcx.check_stability_allow_unstable(def_id, id, path.span, method_span, is_unstable_reexport(this.tcx, id) ? "Yes" : "No");

      if (item_is_allowed) {
        // The item itself is allowed; check whether the path there is also allowed.
        const stab = this.tcx.lookup_stability(def_id) as Stability | undefined;
        let is_allowed_through_unstable_modules: [Symbol, Symbol] | undefined;
        if (stab === undefined) {
          is_allowed_through_unstable_modules = undefined;
        } else {
          switch (stab.level.$) {
            case "Stable":
              is_allowed_through_unstable_modules = stab.level.allowed_through_unstable_modules;
              break;
            default:
              is_allowed_through_unstable_modules = undefined;
              break;
          }
        }
        const segments: hir.PathSegment[] = [...prefix.flatMap((i) => i), ...path.segments.slice(0, Math.max(0, path.segments.length - 1))];
        const intrinsics_module = segments.at(-1);
        for (const segment of segments) {
          this.check_path_segments(path.span, segment, intrinsics_module, id, method_span, is_allowed_through_unstable_modules);
        }
      }
    }
  }

  /// Check parent modules stability as well if the item the path refers to is itself
  /// stable. We only emit errors for unstable path segments if the item is stable
  /// or allowed because stability is often inherited, so the most common case is that
  /// both the segments and the item are unstable behind the same feature flag.
  ///
  /// We check here rather than in `visit_path_segment` to prevent visiting the last
  /// path segment twice
  ///
  /// We include special cases via `#[rustc_allowed_through_unstable_modules]` for items
  /// that were accidentally stabilized through unstable paths before this check was
  /// added, such as `core::intrinsics::transmute`
  // rustc: compiler/rustc_passes/src/stability.rs:1022 check_path_segments
  check_path_segments(
    span: Span,
    path_segment: hir.PathSegment,
    intrinsics_module: hir.PathSegment | undefined,
    id: HirId,
    method_span: Span | undefined,
    is_allowed_through_unstable_modules: [Symbol, Symbol] | undefined,
  ): void {
    // The item itself is allowed; check whether the path there is also allowed.

    const def_id = ResC.opt_def_id(path_segment.res);
    if (def_id !== undefined) {
      if (is_allowed_through_unstable_modules === undefined) {
        // Emit a hard stability error if this path is not stable.

        // use `None` for id to prevent deprecation check
        this.tcx.check_stability_allow_unstable(def_id, undefined, path_segment.ident.span, undefined, is_unstable_reexport(this.tcx, id) ? "Yes" : "No");
      } else {
        const [message, suggestion] = is_allowed_through_unstable_modules;
        // Call the stability check directly so that we can control which
        // diagnostic is emitted.
        const eval_result: EvalResult = this.tcx.eval_stability_allow_unstable(def_id, undefined, span, undefined, is_unstable_reexport(this.tcx, id) ? "Yes" : "No");
        const is_allowed = eval_result.$ === "Allow";
        if (!is_allowed) {
          // Show a deprecation message.
          const intrinsics_module_ =
            intrinsics_module ??
            span_bug(span, `no module for \`is_allowed_through_unstable_modules\` intrinsic ${debug_PathSegment(path_segment, PLAIN)}`);
          const diag = diagnostics.RustcAtumSuggestion_diagnostic({
            message,
            import_span: span,
            unstable_mod_span: intrinsics_module_.ident.span,
            module: intrinsics_module_.ident,
            suggestion,
          });
          this.tcx.emit_node_span_lint(UNSTABLE_IMPORTS, id, method_span ?? span, diag);
        }
      }
    }
  }
}

/// Check whether a path is a `use` item that has been marked as unstable.
///
/// See issue #94972 for details on why this is a special case
// rustc: compiler/rustc_passes/src/stability.rs:1097 is_unstable_reexport
function is_unstable_reexport(tcx: TyCtxt, id: HirId): boolean {
  // Get the LocalDefId so we can lookup the item to check the kind.
  const def_id = id.owner.def_id;

  const stab = tcx.lookup_stability(def_id) as Stability | undefined;
  if (stab === undefined) {
    return false;
  }

  if (StabilityLevel.is_stable(stab.level)) {
    // The re-export is not marked as unstable, don't override
    return false;
  }

  // If this is a path that isn't a use, we don't need to do anything special
  const node = tcx.hir_node(id);
  if (!((node.$ === "Item" && node._0.kind.$ === "Use") || node.$ === "NestedUseTree")) {
    return false;
  }

  return true;
}

// rustc-type: compiler/rustc_passes/src/stability.rs:1121 CheckTraitImplStable
class CheckTraitImplStable extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public fully_stable: boolean,
  ) {
    super();
  }

  // ---- impl<'tcx> Visitor<'tcx> for CheckTraitImplStable<'tcx> ----

  // rustc: compiler/rustc_passes/src/stability.rs:1127 visit_path
  override visit_path(path: hir.Path, _id: HirId): undefined {
    const def_id = ResC.opt_def_id(path.res);
    let stab: Stability | undefined;
    if (def_id !== undefined && (stab = this.tcx.lookup_stability(def_id) as Stability | undefined) !== undefined) {
      this.fully_stable &&= StabilityLevel.is_stable(stab.level);
    }
    walk_path(this, path);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/stability.rs:1136 visit_trait_ref
  override visit_trait_ref(t: hir.TraitRef): undefined {
    if (t.path.res.$ === "Def" && t.path.res._0.$ === "Trait") {
      const trait_did = t.path.res._1;
      const stab = this.tcx.lookup_stability(trait_did) as Stability | undefined;
      if (stab !== undefined) {
        this.fully_stable &&= StabilityLevel.is_stable(stab.level);
      }
    }
    walk_trait_ref(this, t);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/stability.rs:1145 visit_ty
  override visit_ty(t: hir.Ty<hir.AmbigArg>): undefined {
    if (t.kind.$ === "FnPtr") {
      const function_ = t.kind._0;
      if (extern_abi_stability(function_.abi).$ === "Err") {
        this.fully_stable = false;
      }
    }
    walk_ty(this, t);
    return undefined;
  }
}

/// Given the list of enabled features that were not language features (i.e., that
/// were expected to be library features), and the list of features used from
/// libraries, identify activated features that don't exist and error about them.
// This is `pub` for rustdoc. rustc should call it through `check_mod_unstable_api_usage`.
// rustc: compiler/rustc_passes/src/stability.rs:1159 check_unused_or_stable_features
export function check_unused_or_stable_features(tcx: TyCtxt): void {
  const _prof_timer = tcx.sess.timer("unused_lib_feature_checking");

  const enabled_lang_features = tcx.features().enabled_lang_features();
  const lang_features = new Set<Symbol>();
  for (const { gate_name, attr_sp, stable_since } of enabled_lang_features) {
    if (stable_since !== undefined) {
      const version = stable_since;
      // Mark the feature as enabled, to ensure that it is not marked as unused.
      const _ = tcx.features().enabled(gate_name);

      // Warn if the user has enabled an already-stable lang feature.
      unnecessary_stable_feature_lint(tcx, attr_sp, gate_name, version);
    }
    // `UnordSet::insert` returns whether the value was newly inserted.
    const inserted = !lang_features.has(gate_name);
    lang_features.add(gate_name);
    if (!inserted) {
      // Warn if the user enables a lang feature multiple times.
      duplicate_feature_lint(tcx, attr_sp, gate_name);
    }
  }

  const enabled_lib_features = tcx.features().enabled_lib_features();
  // PORT: `FxIndexMap<Symbol, Span>` -> an insertion-ordered `Map`; `swap_remove` is `index_map_swap_remove`.
  const remaining_lib_features = new Map<Symbol, Span>();
  for (const { gate_name, attr_sp } of enabled_lib_features) {
    if (remaining_lib_features.has(gate_name)) {
      // Warn if the user enables a lib feature multiple times.
      duplicate_feature_lint(tcx, attr_sp, gate_name);
    }
    remaining_lib_features.set(gate_name, attr_sp);
  }
  // `stdbuild` has special handling for `libc`, so we need to
  // recognise the feature when building std.
  // Likewise, libtest is handled specially, so `test` isn't
  // available as we'd like it to be.
  // FIXME: only remove `libc` when `stdbuild` is enabled.
  // FIXME: remove special casing for `test`.
  // FIXME(#120456) - is `swap_remove` correct?
  index_map_swap_remove(remaining_lib_features, sym.libc);
  index_map_swap_remove(remaining_lib_features, sym.test);

  /// For each feature in `defined_features`..
  ///
  /// - If it is in `remaining_lib_features` (those features with `#![feature(..)]` attributes in
  ///   the current crate), check if it is stable (or partially stable) and thus an unnecessary
  ///   attribute.
  /// - If it is in `remaining_implications` (a feature that is referenced by an `implied_by`
  ///   from the current crate), then remove it from the remaining implications.
  ///
  /// Once this function has been invoked for every feature (local crate and all extern crates),
  /// then..
  ///
  /// - If features remain in `remaining_lib_features`, then the user has enabled a feature that
  ///   does not exist.
  /// - If features remain in `remaining_implications`, the `implied_by` refers to a feature that
  ///   does not exist.
  ///
  /// By structuring the code in this way: checking the features defined from each crate one at a
  /// time, less loading from metadata is performed and thus compiler performance is improved.
  // rustc: compiler/rustc_passes/src/stability.rs:1215 check_features
  function check_features(
    tcx: TyCtxt,
    remaining_lib_features: Map<Symbol, Span>,
    remaining_implications: Map<Symbol, Symbol>,
    defined_features: LibFeatures,
    all_implications: Map<Symbol, Symbol>,
  ): void {
    for (const [feature, stability] of LibFeatures.to_sorted_vec(defined_features)) {
      let span: Span | undefined;
      if (stability.$ === "AcceptedSince" && (span = remaining_lib_features.get(feature)) !== undefined) {
        const since = stability._0;
        // Mark the feature as enabled, to ensure that it is not marked as unused.
        const _ = tcx.features().enabled(feature);

        // Warn if the user has enabled an already-stable lib feature.
        const implies = all_implications.get(feature);
        if (implies !== undefined) {
          unnecessary_partially_stable_feature_lint(tcx, span, feature, implies, since);
        } else {
          unnecessary_stable_feature_lint(tcx, span, feature, since);
        }
      }
      // FIXME(#120456) - is `swap_remove` correct?
      index_map_swap_remove(remaining_lib_features, feature);

      // `feature` is the feature doing the implying, but `implied_by` is the feature with
      // the attribute that establishes this relationship. `implied_by` is guaranteed to be a
      // feature defined in the local crate because `remaining_implications` is only the
      // implications from this crate.
      remaining_implications.delete(feature);

      let span2: Span | undefined;
      if (stability.$ === "Unstable" && stability.old_name !== undefined && (span2 = index_map_swap_remove(remaining_lib_features, stability.old_name)) !== undefined) {
        const alias = stability.old_name;
        tcx.dcx().emit_err(diagnostics.RenamedFeature_diagnostic({ span: span2, feature, alias }));
      }

      if (remaining_lib_features.size === 0 && remaining_implications.size === 0) {
        break;
      }
    }
  }

  // All local crate implications need to have the feature that implies it confirmed to exist.
  const remaining_implications = new Map(tcx.stability_implications(LOCAL_CRATE));

  // We always collect the lib features enabled in the current crate, even if there are
  // no unknown features, because the collection also does feature attribute validation.
  const local_defined_features = tcx.lib_features(LOCAL_CRATE) as LibFeatures;
  if (remaining_lib_features.size !== 0 || remaining_implications.size !== 0) {
    const crates = tcx.crates(null);

    // Loading the implications of all crates is unavoidable to be able to emit the partial
    // stabilization diagnostic, but it can be avoided when there are no
    // `remaining_lib_features`.
    const all_implications = new Map(remaining_implications);
    for (const cnum of crates) {
      for (const [k, v] of tcx.stability_implications(cnum)) {
        all_implications.set(k, v);
      }
    }

    check_features(tcx, remaining_lib_features, remaining_implications, local_defined_features, all_implications);

    for (const cnum of crates) {
      if (remaining_lib_features.size === 0 && remaining_implications.size === 0) {
        break;
      }
      check_features(tcx, remaining_lib_features, remaining_implications, tcx.lib_features(cnum) as LibFeatures, all_implications);
    }

    if (remaining_lib_features.size !== 0) {
      const lang_features = UNSTABLE_LANG_FEATURES.map((feature) => feature.name);
      const lib_features = crates.flatMap((cnum) => [...(tcx.lib_features(cnum) as LibFeatures).stability.keys()].sort((a, b) => Symbol.stable_cmp(a, b)));

      const valid_feature_names = [...lang_features, ...lib_features];

      // Collect all of the marked as "removed" features
      const unstable_removed_features: UnstableRemovedFeature[] = crates.flatMap(
        (cnum) => find_attr(HasAttrs_DefId.get_attrs(CrateNum.as_def_id(cnum), tcx), (k) => (k.$ === "UnstableRemoved" ? k._0 : undefined)) ?? [],
      );

      for (const [feature, span] of remaining_lib_features) {
        const removed = unstable_removed_features.find((removed) => removed.feature === feature);
        if (removed !== undefined) {
          tcx.dcx().emit_err(
            diagnostics.FeatureRemoved_diagnostic({
              span,
              feature,
              reason: removed.reason,
              link: removed.link,
              since: display_RustcVersion(removed.since),
            }),
          );
        } else {
          const similar = Symbol.find_similar(feature, valid_feature_names);
          const suggestion: diagnostics.MisspelledFeature | undefined = similar === undefined ? undefined : { span, actual_name: similar[0] };
          tcx.dcx().emit_err(diagnostics.UnknownFeature_diagnostic({ span, feature, suggestion }));
        }
      }
    }
  }

  for (const [implied_by, feature] of [...remaining_implications].sort(([a], [b]) => Symbol.stable_cmp(a, b))) {
    const local_defined_features = tcx.lib_features(LOCAL_CRATE) as LibFeatures;
    const span = unwrap(local_defined_features.stability.get(feature), "feature that implied another does not exist")[1];
    tcx.dcx().emit_err(diagnostics.ImpliedFeatureNotExist_diagnostic({ span, feature, implied_by }));
  }
}

// rustc: compiler/rustc_passes/src/stability.rs:1350 unnecessary_partially_stable_feature_lint
function unnecessary_partially_stable_feature_lint(tcx: TyCtxt, span: Span, feature: Symbol, implies: Symbol, since: Symbol): void {
  tcx.emit_node_span_lint(
    STABLE_FEATURES,
    CRATE_HIR_ID,
    span,
    diagnostics.UnnecessaryPartialStableFeature_diagnostic({
      span,
      line: tcx.sess.source_map().span_extend_to_line(span),
      feature,
      since,
      implies,
    }),
  );
}

// rustc: compiler/rustc_passes/src/stability.rs:1371 unnecessary_stable_feature_lint
function unnecessary_stable_feature_lint(tcx: TyCtxt, span: Span, feature: Symbol, since_: Symbol): void {
  let since = since_;
  if (Symbol.as_str(since) === VERSION_PLACEHOLDER) {
    since = sym.env_CFG_RELEASE;
  }
  tcx.emit_node_span_lint(STABLE_FEATURES, CRATE_HIR_ID, span, diagnostics.UnnecessaryStableFeature_diagnostic({ feature, since }));
}

// rustc: compiler/rustc_passes/src/stability.rs:1388 duplicate_feature_lint
function duplicate_feature_lint(tcx: TyCtxt, span: Span, feature: Symbol): void {
  tcx.emit_node_span_lint(DUPLICATE_FEATURES, CRATE_HIR_ID, span, diagnostics.DuplicateFeature_diagnostic({ feature }));
}
