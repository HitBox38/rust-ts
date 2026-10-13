// Port of compiler/rustc_middle/src/middle/stability.rs
//! A pass that annotates every item and method with its stability level,
//! propagating default levels lexically from parent to children ast nodes.
//
// The types (`UnstableKind`, `DeprecationEntry`, `DeprecationSuggestion` with its derive(Subdiagnostic),
// `Deprecated`, `EvalResult`, `AllowUnstable`) are generated into stability.gen.ts (tools/codegen/types.ts,
// set `rustc_middle_stability`). This file adds `DeprecationEntry`'s methods, the free fns, `Deprecated`'s
// manual `impl Diagnostic` and the `impl TyCtxt` block (attached to `TyCtxt.prototype`, PORTING.md §5).
// PORT: `TyCtxt` methods that need HIR (`hir_get_parent_item`, `hir_node`, `def_descr`,
// `emit_node_span_lint`; M3) stop at `unported(..)` where upstream first needs them.
import type { NodeId } from "../../rustc_ast/node_id.ts";
import { display_RustcVersion } from "../../rustc_ast/attr/version.ts";
import { type ConstStability, type DefaultBodyStability, type DeprecatedSince, type Deprecation, debug_DeprecatedSince, type Stability } from "../../rustc_attr_ir/lib.ts";
import { UnstableReason } from "../../rustc_attr_ir/stability.ts";
import { bool_into_diag_arg, Symbol_into_diag_arg } from "../../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, IntoDiagArg, type Level, type LintBuffer, msg } from "../../rustc_errors/lib.ts";
import "../../rustc_errors/decorate_diag.ts";
import type { GateIssue } from "../../rustc_feature/lib.ts";
import type { HirId, OwnerId } from "../../rustc_hir_id/lib.ts";
import { DEPRECATED, DEPRECATED_IN_FUTURE } from "../../rustc_lint_defs/builtin.gen.ts";
import { DeprecatedSinceKind, type Lint } from "../../rustc_lint_defs/lib.ts";
import { feature_err_issue } from "../../rustc_session/diagnostics.ts";
import type { Session } from "../../rustc_session/session.ts";
import { CrateNum, debug_DefId, type DefId, type LocalDefId } from "../../rustc_span/def_id.ts";
import { Span } from "../../rustc_span/lib.ts";
import { display_Symbol, type Symbol, sym } from "../../rustc_span/symbol.ts";
import { PLAIN } from "../../std/fmt.ts";
import { unported, unreachable } from "../../std/panic.ts";
import { TyCtxt } from "../ty/context.ts";
import * as gen from "./stability.gen.ts";
import { type Deprecated, DeprecationSuggestion_subdiagnostic, EvalResult, type UnstableKind } from "./stability.gen.ts";

export * from "./stability.gen.ts";

export type DeprecationEntry = gen.DeprecationEntry;
export const DeprecationEntry = gen.DeprecationEntry as typeof gen.DeprecationEntry & {
  local: (attr: Deprecation, def_id: LocalDefId) => DeprecationEntry;
  external: (attr: Deprecation) => DeprecationEntry;
};

declare module "./stability.gen.ts" {
  interface DeprecationEntry {
    same_origin(other: DeprecationEntry): boolean;
  }
}

// rustc: compiler/rustc_middle/src/middle/stability.rs:44 local
DeprecationEntry.local = function (attr: Deprecation, def_id: LocalDefId): DeprecationEntry {
  return new gen.DeprecationEntry(attr, def_id);
};

// rustc: compiler/rustc_middle/src/middle/stability.rs:48 external
DeprecationEntry.external = function (attr: Deprecation): DeprecationEntry {
  return new gen.DeprecationEntry(attr, undefined);
};

// rustc: compiler/rustc_middle/src/middle/stability.rs:52 same_origin
DeprecationEntry.prototype.same_origin = function (this: DeprecationEntry, other: DeprecationEntry): boolean {
  const o1 = this.origin;
  const o2 = other.origin;
  if (o1 !== undefined && o2 !== undefined) {
    return o1 === o2;
  }
  return false;
};

// rustc: compiler/rustc_middle/src/middle/stability.rs:60 report_unstable
export function report_unstable(
  sess: Session,
  feature: Symbol,
  reason: Symbol | undefined,
  issue: number | undefined,
  span: Span,
  kind: UnstableKind,
): void {
  let qual: string;
  switch (kind.$) {
    case "Regular":
      qual = "";
      break;
    case "Const":
      qual = " const";
      break;
  }

  let msg_: string;
  if (reason !== undefined) {
    const r = reason;
    msg_ = `use of unstable${qual} library feature \`${display_Symbol(feature)}\`: ${display_Symbol(r)}`;
  } else {
    msg_ = `use of unstable${qual} library feature \`${display_Symbol(feature)}\``;
  }

  const issue_: GateIssue = { $: "Library", _0: issue };
  const err = feature_err_issue(sess, feature, span, issue_, msg_);
  if (kind.$ === "Const") {
    const kw = kind._0;
    err.span_label(kw, "trait is not stable as const yet");
  }
  err.emit();
}

// rustc: compiler/rustc_middle/src/middle/stability.rs:85 deprecation_lint
function deprecation_lint(is_in_effect: boolean): Lint {
  return is_in_effect ? DEPRECATED : DEPRECATED_IN_FUTURE;
}

// impl<'a> rustc_errors::Diagnostic<'a> for Deprecated
// rustc: compiler/rustc_middle/src/middle/stability.rs:114 into_diag
export function Deprecated_into_diag(self: Deprecated, dcx: DiagCtxtHandle, level: Level): Diag {
  const { sub, kind, path, note, since_kind } = self;
  let message;
  switch (since_kind.$) {
    case "InEffect":
      message = msg(
        "use of deprecated {$kind} `{$path}`{$has_note ->\n" +
          "                    [true] : {$note}\n" +
          '                    *[other] {""}\n' +
          "                }",
      );
      break;
    case "InFuture":
      message = msg(
        "use of {$kind} `{$path}` that will be deprecated in a future Rust version{$has_note ->\n" +
          "                    [true] : {$note}\n" +
          '                    *[other] {""}\n' +
          "                }",
      );
      break;
    case "InVersion": {
      message = msg(
        "use of {$kind} `{$path}` that will be deprecated in future version {$version}{$has_note ->\n" +
          "                        [true] : {$note}\n" +
          '                        *[other] {""}\n' +
          "                    }",
      );
      break;
    }
  }
  const diag = Diag.new(dcx, level, message).with_arg("kind", IntoDiagArg.String(kind)).with_arg("path", IntoDiagArg.String(path));
  if (since_kind.$ === "InVersion") {
    const version = since_kind._0;
    diag.arg("version", IntoDiagArg.String(version));
  }
  if (note !== undefined) {
    diag.arg("has_note", IntoDiagArg.of(true, bool_into_diag_arg));
    diag.arg("note", IntoDiagArg.of(note, Symbol_into_diag_arg));
  } else {
    diag.arg("has_note", IntoDiagArg.of(false, bool_into_diag_arg));
  }
  if (sub !== undefined) {
    diag.subdiagnostic(DeprecationSuggestion_subdiagnostic(sub));
  }
  return diag;
}

// rustc: compiler/rustc_middle/src/middle/stability.rs:160 deprecated_since_kind
function deprecated_since_kind(is_in_effect: boolean, since: DeprecatedSince): DeprecatedSinceKind {
  if (is_in_effect) {
    return DeprecatedSinceKind.InEffect;
  } else {
    switch (since.$) {
      case "RustcVersion": {
        const version = since._0;
        return { $: "InVersion", _0: display_RustcVersion(version) };
      }
      case "Future":
        return DeprecatedSinceKind.InFuture;
      case "NonStandard":
      case "Unspecified":
      case "Err":
        return unreachable(`internal error: entered unreachable code: this deprecation is always in effect; ${debug_DeprecatedSince(since, PLAIN)}`);
    }
  }
}

// rustc: compiler/rustc_middle/src/middle/stability.rs:178 early_report_macro_deprecation
export function early_report_macro_deprecation(
  lint_buffer: LintBuffer,
  depr: Deprecation,
  suggestion_span: Span,
  node_id: NodeId,
  path: string,
): void {
  if (Span.in_derive_expansion(suggestion_span)) {
    return;
  }

  const is_in_effect = depr.is_in_effect();
  const suggestion = depr.suggestion;
  const note = depr.note !== undefined ? depr.note.name : undefined;
  const since_kind = deprecated_since_kind(is_in_effect, depr.since);
  lint_buffer.dyn_buffer_lint(deprecation_lint(is_in_effect), node_id, suggestion_span, (dcx, level) => {
    const sub =
      suggestion !== undefined
        ? {
            span: suggestion_span,
            kind: "macro",
            suggestion,
          }
        : undefined;

    return Deprecated_into_diag({ sub, kind: "macro", path, note, since_kind }, dcx, level);
  });
}

// rustc: compiler/rustc_middle/src/middle/stability.rs:210 late_report_deprecation
function late_report_deprecation(
  tcx: TyCtxt,
  depr: Deprecation,
  span: Span,
  method_span: Span | undefined,
  hir_id: HirId,
  def_id: DefId,
): void {
  if (Span.in_derive_expansion(span)) {
    return;
  }

  const is_in_effect = depr.is_in_effect();
  const lint = deprecation_lint(is_in_effect);

  // Calculating message for lint involves calling `self.def_path_str`,
  // which will by default invoke the expensive `visible_parent_map` query.
  // Skip all that work if the lint is allowed anyway.
  if (tcx.lint_level_spec_at_node(lint, hir_id).is_allow()) {
    return;
  }

  unported(
    "rustc_middle::middle::stability::late_report_deprecation: with_no_trimmed_paths!(def_path_str) / def_descr / hir_node / emit_node_span_lint (ty::print, HIR; M3)",
  );
}

declare module "../ty/context.ts" {
  interface TyCtxt {
    eval_stability(def_id: DefId, id: HirId | undefined, span: Span, method_span: Span | undefined): EvalResult;
    eval_stability_allow_unstable(
      def_id: DefId,
      id: HirId | undefined,
      span: Span,
      method_span: Span | undefined,
      allow_unstable: gen.AllowUnstable,
    ): EvalResult;
    eval_default_body_stability(def_id: DefId, span: Span): EvalResult;
    check_stability(def_id: DefId, id: HirId | undefined, span: Span, method_span: Span | undefined): boolean;
    check_stability_allow_unstable(
      def_id: DefId,
      id: HirId | undefined,
      span: Span,
      method_span: Span | undefined,
      allow_unstable: gen.AllowUnstable,
    ): boolean;
    check_optional_stability(
      def_id: DefId,
      id: HirId | undefined,
      span: Span,
      method_span: Span | undefined,
      allow_unstable: gen.AllowUnstable,
      unmarked: (span: Span, def_id: DefId) => void,
    ): boolean;
    check_const_stability(def_id: DefId, span: Span, const_kw_span: Span): void;
    lookup_deprecation(id: DefId): Deprecation | undefined;
  }
}

/// Evaluates the stability of an item.
///
/// Returns `EvalResult::Allow` if the item is stable, or unstable but the corresponding
/// `#![feature]` has been provided. Returns `EvalResult::Deny` which describes the offending
/// unstable feature otherwise.
///
/// If `id` is `Some(_)`, this function will also check if the item at `def_id` has been
/// deprecated. If the item is indeed deprecated, we will emit a deprecation lint attached to
/// `id`.
// rustc: compiler/rustc_middle/src/middle/stability.rs:282 eval_stability
TyCtxt.prototype.eval_stability = function (this: TyCtxt, def_id: DefId, id: HirId | undefined, span: Span, method_span: Span | undefined): EvalResult {
  return this.eval_stability_allow_unstable(def_id, id, span, method_span, "No");
};

/// Evaluates the stability of an item.
///
/// Returns `EvalResult::Allow` if the item is stable, or unstable but the corresponding
/// `#![feature]` has been provided. Returns `EvalResult::Deny` which describes the offending
/// unstable feature otherwise.
///
/// If `id` is `Some(_)`, this function will also check if the item at `def_id` has been
/// deprecated. If the item is indeed deprecated, we will emit a deprecation lint attached to
/// `id`.
///
/// Pass `AllowUnstable::Yes` to `allow_unstable` to force an unstable item to be allowed. Deprecation warnings will be emitted normally.
// rustc: compiler/rustc_middle/src/middle/stability.rs:303 eval_stability_allow_unstable
TyCtxt.prototype.eval_stability_allow_unstable = function (
  this: TyCtxt,
  def_id: DefId,
  id: HirId | undefined,
  span: Span,
  method_span: Span | undefined,
  allow_unstable: gen.AllowUnstable,
): EvalResult {
  // Deprecated attributes apply in-crate and cross-crate.
  if (id !== undefined) {
    const depr_entry = this.lookup_deprecation_entry(def_id);
    if (depr_entry !== undefined) {
      const parent_def_id: OwnerId = unported("rustc_middle::hir::map::TyCtxt::hir_get_parent_item (HIR, M3)");
      const parent_depr = this.lookup_deprecation_entry(parent_def_id.to_def_id());
      const skip = parent_depr !== undefined && parent_depr.same_origin(depr_entry);

      // #[deprecated] doesn't emit a notice if we're not on the
      // topmost deprecation. For example, if a struct is deprecated,
      // the use of a field won't be linted.
      //
      // With #![staged_api], we want to emit down the whole
      // hierarchy.
      const depr_attr = depr_entry.attr;
      if (!skip || depr_attr.is_since_rustc_version()) {
        late_report_deprecation(this, depr_attr, span, method_span, id, def_id);
      }
    }
  }

  // PORT: the `lookup_stability` query value is typed `unknown` in queries.gen.ts; it is `Option<Stability>`.
  const is_staged_api = (this.lookup_stability(CrateNum.as_def_id(def_id.krate)) as Stability | undefined) !== undefined;
  if (!is_staged_api) {
    return EvalResult.Allow;
  }

  // Only the cross-crate scenario matters when checking unstable APIs
  const cross_crate = !def_id.is_local();
  if (!cross_crate) {
    return EvalResult.Allow;
  }

  const stability = this.lookup_stability(def_id) as Stability | undefined;
  // debug!("stability: inspecting def_id={:?} span={:?} of stability={:?}", def_id, span, stability);

  if (stability !== undefined && stability.level.$ === "Unstable") {
    const { reason, issue, implied_by } = stability.level;
    const feature = stability.feature;
    if (Span.allows_unstable(span, feature)) {
      // debug!("stability: skipping span={:?} since it is internal", span);
      return EvalResult.Allow;
    }
    if (this.features().enabled(feature)) {
      return EvalResult.Allow;
    }

    // If this item was previously part of a now-stabilized feature which is still
    // enabled (i.e. the user hasn't removed the attribute for the stabilized feature
    // yet) then allow use of this item.
    if (implied_by !== undefined && this.features().enabled(implied_by)) {
      return EvalResult.Allow;
    }

    // When we're compiling the compiler itself we may pull in
    // crates from crates.io, but those crates may depend on other
    // crates also pulled in from crates.io. We want to ideally be
    // able to compile everything without requiring upstream
    // modifications, so in the case that this looks like a
    // `rustc_private` crate (e.g., a compiler crate) and we also have
    // the `-Z force-unstable-if-unmarked` flag present (we're
    // compiling a compiler crate), then let this missing feature
    // annotation slide.
    if (feature === sym.rustc_private && issue === 27812 && this.sess.opts.unstable_opts.force_unstable_if_unmarked) {
      return EvalResult.Allow;
    }

    if (allow_unstable === "Yes") {
      return EvalResult.Allow;
    }

    return { $: "Deny", feature, reason: UnstableReason.to_opt_reason(reason), issue };
  } else if (stability !== undefined) {
    // Stable APIs are always ok to call and deprecated APIs are
    // handled by the lint emitting logic above.
    return EvalResult.Allow;
  } else {
    return EvalResult.Unmarked;
  }
};

/// Evaluates the default-impl stability of an item.
///
/// Returns `EvalResult::Allow` if the item's default implementation is stable, or unstable but the corresponding
/// `#![feature]` has been provided. Returns `EvalResult::Deny` which describes the offending
/// unstable feature otherwise.
// rustc: compiler/rustc_middle/src/middle/stability.rs:409 eval_default_body_stability
TyCtxt.prototype.eval_default_body_stability = function (this: TyCtxt, def_id: DefId, span: Span): EvalResult {
  // PORT: query values typed `unknown` in queries.gen.ts: `lookup_stability` is `Option<Stability>`,
  // `lookup_default_body_stability` is `Option<DefaultBodyStability>`.
  const is_staged_api = (this.lookup_stability(CrateNum.as_def_id(def_id.krate)) as Stability | undefined) !== undefined;
  if (!is_staged_api) {
    return EvalResult.Allow;
  }

  // Only the cross-crate scenario matters when checking unstable APIs
  const cross_crate = !def_id.is_local();
  if (!cross_crate) {
    return EvalResult.Allow;
  }

  const stability = this.lookup_default_body_stability(def_id) as DefaultBodyStability | undefined;
  // debug!("body stability: inspecting def_id={def_id:?} span={span:?} of stability={stability:?}");

  if (stability !== undefined && stability.level.$ === "Unstable") {
    const { reason, issue } = stability.level;
    const feature = stability.feature;
    if (Span.allows_unstable(span, feature)) {
      // debug!("body stability: skipping span={:?} since it is internal", span);
      return EvalResult.Allow;
    }
    if (this.features().enabled(feature)) {
      return EvalResult.Allow;
    }

    return { $: "Deny", feature, reason: UnstableReason.to_opt_reason(reason), issue };
  } else if (stability !== undefined) {
    // Stable APIs are always ok to call
    return EvalResult.Allow;
  } else {
    return EvalResult.Unmarked;
  }
};

/// Checks if an item is stable or error out.
///
/// If the item defined by `def_id` is unstable and the corresponding `#![feature]` does not
/// exist, emits an error.
///
/// This function will also check if the item is deprecated.
/// If so, and `id` is not `None`, a deprecated lint attached to `id` will be emitted.
///
/// Returns `true` if item is allowed aka, stable or unstable under an enabled feature.
// rustc: compiler/rustc_middle/src/middle/stability.rs:458 check_stability
TyCtxt.prototype.check_stability = function (this: TyCtxt, def_id: DefId, id: HirId | undefined, span: Span, method_span: Span | undefined): boolean {
  return this.check_stability_allow_unstable(def_id, id, span, method_span, "No");
};

/// Checks if an item is stable or error out.
///
/// If the item defined by `def_id` is unstable and the corresponding `#![feature]` does not
/// exist, emits an error.
///
/// This function will also check if the item is deprecated.
/// If so, and `id` is not `None`, a deprecated lint attached to `id` will be emitted.
///
/// Pass `AllowUnstable::Yes` to `allow_unstable` to force an unstable item to be allowed. Deprecation warnings will be emitted normally.
///
/// Returns `true` if item is allowed aka, stable or unstable under an enabled feature.
// rustc: compiler/rustc_middle/src/middle/stability.rs:479 check_stability_allow_unstable
TyCtxt.prototype.check_stability_allow_unstable = function (
  this: TyCtxt,
  def_id: DefId,
  id: HirId | undefined,
  span: Span,
  method_span: Span | undefined,
  allow_unstable: gen.AllowUnstable,
): boolean {
  return this.check_optional_stability(def_id, id, span, method_span, allow_unstable, (span, def_id) => {
    // The API could be uncallable for other reasons, for example when a private module
    // was referenced.
    this.dcx().span_delayed_bug(span, `encountered unmarked API: ${debug_DefId(def_id, PLAIN)}`);
  });
};

/// Like `check_stability`, except that we permit items to have custom behaviour for
/// missing stability attributes (not necessarily just emit a `bug!`). This is necessary
/// for default generic parameters, which only have stability attributes if they were
/// added after the type on which they're defined.
///
/// Returns `true` if item is allowed aka, stable or unstable under an enabled feature.
// rustc: compiler/rustc_middle/src/middle/stability.rs:507 check_optional_stability
TyCtxt.prototype.check_optional_stability = function (
  this: TyCtxt,
  def_id: DefId,
  id: HirId | undefined,
  span: Span,
  method_span: Span | undefined,
  allow_unstable: gen.AllowUnstable,
  unmarked: (span: Span, def_id: DefId) => void,
): boolean {
  const eval_result = this.eval_stability_allow_unstable(def_id, id, span, method_span, allow_unstable);
  const is_allowed = eval_result.$ === "Allow";
  switch (eval_result.$) {
    case "Allow":
      break;
    case "Deny": {
      const { feature, reason, issue } = eval_result;
      report_unstable(this.sess, feature, reason, issue, span, gen.UnstableKind.Regular);
      break;
    }
    case "Unmarked":
      unmarked(span, def_id);
      break;
  }

  return is_allowed;
};

/// This function is analogous to `check_optional_stability` but with the logic in
/// `eval_stability_allow_unstable` inlined, and which operating on const stability
/// instead of regular stability.
///
/// This enforces *syntactical* const stability of const traits. In other words,
/// it enforces the ability to name `[const]`/`const` traits in trait bounds in various
/// syntax positions in HIR (including in the trait of an impl header).
// rustc: compiler/rustc_middle/src/middle/stability.rs:537 check_const_stability
TyCtxt.prototype.check_const_stability = function (this: TyCtxt, def_id: DefId, span: Span, const_kw_span: Span): void {
  // PORT: query values typed `unknown` in queries.gen.ts: `lookup_stability` is `Option<Stability>`,
  // `lookup_const_stability` is `Option<ConstStability>`.
  const is_staged_api = (this.lookup_stability(CrateNum.as_def_id(def_id.krate)) as Stability | undefined) !== undefined;
  if (!is_staged_api) {
    return;
  }

  // Only the cross-crate scenario matters when checking unstable APIs
  const cross_crate = !def_id.is_local();
  if (!cross_crate) {
    return;
  }

  const stability = this.lookup_const_stability(def_id) as ConstStability | undefined;
  // debug!("stability: inspecting def_id={:?} span={:?} of stability={:?}", def_id, span, stability);

  if (stability !== undefined && stability.level.$ === "Unstable") {
    const { reason, issue, implied_by } = stability.level;
    const feature = stability.feature;
    if (Span.allows_unstable(span, feature)) {
      // debug!("body stability: skipping span={:?} since it is internal", span);
      return;
    }
    if (this.features().enabled(feature)) {
      return;
    }

    // If this item was previously part of a now-stabilized feature which is still
    // enabled (i.e. the user hasn't removed the attribute for the stabilized feature
    // yet) then allow use of this item.
    if (implied_by !== undefined && this.features().enabled(implied_by)) {
      return;
    }

    report_unstable(this.sess, feature, UnstableReason.to_opt_reason(reason), issue, span, { $: "Const", _0: const_kw_span });
  } else {
    // Some(_) | None => {}
  }
};

// rustc: compiler/rustc_middle/src/middle/stability.rs:592 lookup_deprecation
TyCtxt.prototype.lookup_deprecation = function (this: TyCtxt, id: DefId): Deprecation | undefined {
  const depr = this.lookup_deprecation_entry(id);
  return depr !== undefined ? depr.attr : undefined;
};
