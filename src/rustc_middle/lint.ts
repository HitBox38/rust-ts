// Port of compiler/rustc_middle/src/lint.rs: lint level sources and specs, the `warnings`/`--cap-lints`
// adjustment (`reveal_actual_level_spec`) and `emit_lint_base`, where a lint diagnostic gets its error level,
// its future-incompatibility notes and the "`#[warn(x)]` on by default" explanation.
//
// PORT: `LevelSpec<Id>` is `Copy`; here it is an immutable class (no setter is used), so sharing one object
// between the level maps and the callers is a copy. `reveal_actual_level_spec` writes its `level` field on a
// local copy upstream; the port builds a new `LevelSpec` instead (`with_level`).
// PORT: `impl Into<LevelSpec>` parameters (`emit_lint_base`) take the converted `LevelSpec<LintExpectationId>`;
// callers convert with `LevelSpec.from_UnstableLevelSpec` / `LevelSpec.from_StableLevelSpec`.
import type { Diag, Diagnostic, MultiSpan } from "../rustc_errors/lib.ts";
import { Diag as DiagClass, type Level as ErrLevel, Level as ErrLevelC } from "../rustc_errors/lib.ts";
import {
  builtin,
  FutureIncompatibilityReason,
  Level,
  Level_discriminant,
  Lint,
  LintExpectationId,
  LintId,
  type HirId,
  type ItemLocalId,
  type StableLintExpectationId,
  type UnstableLintExpectationId,
} from "../rustc_lint_defs/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import { display_Edition } from "../rustc_span/edition.ts";
import { DUMMY_SP, Span, debug_Span } from "../rustc_span/lib.ts";
import { type Symbol, Symbol as SymbolC, debug_Symbol, kw } from "../rustc_span/symbol.ts";
import { type Debug, debug_option, debug_struct, debug_tuple } from "../std/fmt.ts";
import { panic, unported, unreachable } from "../std/panic.ts";
import { TyCtxt } from "./ty/context.ts";

/// How a lint level was set.
// #[derive(Clone, Copy, PartialEq, Eq, Encodable, Decodable, StableHash, Debug)]
export type LintLevelSource =
  /// Lint is at the default level as declared in rustc.
  | { readonly $: "Default" }
  /// Lint level was set by an attribute.
  | {
      readonly $: "Node";
      readonly name: Symbol;
      readonly span: Span;
      /// RFC 2383 reason
      readonly reason: Symbol | undefined;
    }
  /// Lint level was set by a command-line flag.
  /// The provided `Level` is the level specified on the command line.
  /// (The actual level may be lower due to `--cap-lints`.)
  | { readonly $: "CommandLine"; readonly _0: Symbol; readonly _1: Level };

export const LintLevelSource = {
  Default: Object.freeze({ $: "Default" as const }),

  // rustc: compiler/rustc_middle/src/lint.rs:39 name
  name(self: LintLevelSource): Symbol {
    switch (self.$) {
      case "Default":
        return kw.Default;
      case "Node":
        return self.name;
      case "CommandLine":
        return self._0;
    }
  },

  // rustc: compiler/rustc_middle/src/lint.rs:47 span
  span(self: LintLevelSource): Span {
    switch (self.$) {
      case "Default":
        return DUMMY_SP;
      case "Node":
        return self.span;
      case "CommandLine":
        return DUMMY_SP;
    }
  },
};

/** `#[derive(PartialEq)]` */
export function LintLevelSource_eq(a: LintLevelSource, b: LintLevelSource): boolean {
  switch (a.$) {
    case "Default":
      return b.$ === "Default";
    case "Node":
      return b.$ === "Node" && a.name === b.name && a.span === b.span && a.reason === b.reason;
    case "CommandLine":
      return b.$ === "CommandLine" && a._0 === b._0 && a._1 === b._1;
  }
}

/** `#[derive(Debug)]` */
export const debug_LintLevelSource: Debug<LintLevelSource> = (v, f) => {
  switch (v.$) {
    case "Default":
      return "Default";
    case "Node":
      return debug_struct(f, "Node", [
        ["name", debug_Symbol(v.name, f)],
        ["span", debug_Span(v.span, f)],
        ["reason", debug_option(v.reason, f, debug_Symbol)],
      ]);
    case "CommandLine":
      return debug_tuple(f, "CommandLine", [debug_Symbol(v._0, f), v._1]);
  }
};

/// Convenience helper for things that are frequently used together.
// #[derive(Copy, Clone, Debug, StableHash, Encodable, Decodable)]
// PORT: the private fields `level` / `lint_id` share their names with the getters, which get a trailing
// underscore (`level_()`, `lint_id_()`), as for `MultiSpan` (PORTING §8 precedent).
export class LevelSpec<Id = LintExpectationId> {
  constructor(
    // This field *must* be private. It must be set in tandem with `lint_id`, only in
    // `LevelSpec::new`, because only certain `level`/`lint_id` combinations are valid. See
    // `LevelSpec::new` for those combinations.
    //
    // If you are thinking right now that `level` and `lint_id` should be combined into a single
    // type that excludes the invalid combinations, that's a reasonable thought, but in practice
    // it's painful because `level` needs to be used by itself, without `lint_id`, in many places.
    // Making the fields private prevents invalid combinations while retaining the flexibility of
    // two separate fields.
    readonly level: Level,

    // This field *must* be private. See the comment on `level`.
    readonly lint_id: Id | undefined,

    readonly src: LintLevelSource,
  ) {}

  // Panics if an invalid `level`/`lint_id` combination is given.
  // rustc: compiler/rustc_middle/src/lint.rs:81 new
  static new<Id>(level: Level, lint_id: Id | undefined, src: LintLevelSource): LevelSpec<Id> {
    if ((level === "Allow" || level === "Warn" || level === "Deny" || level === "Forbid") && lint_id === undefined) {
      // ok
    } else if (level === "Expect" && lint_id !== undefined) {
      // ok
    } else if (level === "ForceWarn") {
      // ok
    } else {
      panic("invalid level/lint_id combination");
    }
    return new LevelSpec(level, lint_id, src);
  }

  // rustc: compiler/rustc_middle/src/lint.rs:91 level
  level_(): Level {
    return this.level;
  }

  // rustc: compiler/rustc_middle/src/lint.rs:95 is_allow
  is_allow(): boolean {
    return this.level === "Allow";
  }

  // rustc: compiler/rustc_middle/src/lint.rs:99 is_expect
  is_expect(): boolean {
    return this.level === "Expect";
  }

  // rustc: compiler/rustc_middle/src/lint.rs:103 lint_id
  lint_id_(): Id | undefined {
    return this.lint_id;
  }

  /** PORT: `level_spec.level = x` on a `Copy` local (lint.rs:186/191): a new spec with the other fields kept. */
  with_level(level: Level): LevelSpec<Id> {
    return new LevelSpec(level, this.lint_id, this.src);
  }

  /** `impl From<UnstableLevelSpec> for LevelSpec` */
  // rustc: compiler/rustc_middle/src/lint.rs:109 from
  static from_UnstableLevelSpec(level: UnstableLevelSpec): LevelSpec {
    const { level: level_, lint_id, src } = level;
    const lint_id_ = lint_id === undefined ? undefined : LintExpectationId.Unstable(lint_id);
    return new LevelSpec(level_, lint_id_, src);
  }

  /** `impl From<StableLevelSpec> for LevelSpec` */
  // rustc: compiler/rustc_middle/src/lint.rs:117 from
  static from_StableLevelSpec(level: StableLevelSpec): LevelSpec {
    const { level: level_, lint_id, src } = level;
    const lint_id_ = lint_id === undefined ? undefined : LintExpectationId.Stable(lint_id);
    return new LevelSpec(level_, lint_id_, src);
  }
}

export type UnstableLevelSpec = LevelSpec<UnstableLintExpectationId>;
export type StableLevelSpec = LevelSpec<StableLintExpectationId>;

/// Return type for the `shallow_lint_levels_on` query.
///
/// This map represents lints levels given by the attributes for *a single HirId*.
// #[derive(Default, Debug, StableHash)]
// PORT: `SortedMap<ItemLocalId, ..>` → `Map` (only `get` / `get_mut_or_insert_default` / iteration of values are
// used; nothing iterates it in key order).
export class ShallowLintLevelMap {
  constructor(
    // All the specs for this HirId. This is accessed frequently, e.g. for every lint emitted.
    public specs: Map<ItemLocalId, Map<LintId, StableLevelSpec>>,

    // Additional information about the `expect` specs for this HirId. This is consulted only once
    // per compilation session, in `check_expectations`/`lint_expectations`.
    public expectations: [StableLintExpectationId, LintExpectation][],
  ) {}

  static default(): ShallowLintLevelMap {
    return new ShallowLintLevelMap(new Map(), []);
  }

  /// Perform a deep probe in the HIR tree looking for the actual level spec for the lint.
  /// This lint level spec is not usable for diagnostics, it needs to be corrected by
  /// `reveal_actual_level` beforehand.
  // #[instrument(level = "trace", skip(self, tcx), ret)]
  // rustc: compiler/rustc_middle/src/lint.rs:201 probe_for_lint_level_spec
  private probe_for_lint_level_spec(tcx: TyCtxt, id: LintId, start: HirId): StableLevelSpec | undefined {
    let level_spec: StableLevelSpec | undefined;
    const map = this.specs.get(start.local_id);
    if (map !== undefined && (level_spec = map.get(id)) !== undefined) {
      return level_spec;
    }

    let owner = start.owner;
    let specs = this.specs;

    for (const parent of hir_parent_id_iter(tcx, start)) {
      if (parent.owner.def_id !== owner.def_id) {
        owner = parent.owner;
        specs = (tcx.shallow_lint_levels_on(owner) as ShallowLintLevelMap).specs;
      }
      const map = specs.get(parent.local_id);
      if (map !== undefined && (level_spec = map.get(id)) !== undefined) {
        return level_spec;
      }
    }

    return undefined;
  }

  /// Fetch and return the user-visible lint level spec for the given lint at the given HirId.
  // #[instrument(level = "trace", skip(self, tcx), ret)]
  // rustc: compiler/rustc_middle/src/lint.rs:233 lint_level_spec_at_node
  lint_level_spec_at_node(tcx: TyCtxt, lint: LintId, cur: HirId): StableLevelSpec {
    return reveal_actual_level_spec(tcx.sess, lint, (lint) => this.probe_for_lint_level_spec(tcx, lint, cur));
  }
}

/** `tcx.hir_parent_id_iter(start)` (rustc_middle hir/map.rs). PORT: HIR is M3. */
function hir_parent_id_iter(_tcx: TyCtxt, _start: HirId): Iterable<HirId> {
  return unported("rustc_middle::hir::map::TyCtxt::hir_parent_id_iter (HIR, M3)");
}

/// Verify the effect of special annotations: `warnings` lint level and lint caps.
///
/// The return of this function is suitable for diagnostics.
// rustc: compiler/rustc_middle/src/lint.rs:140 reveal_actual_level_spec
export function reveal_actual_level_spec<Id>(
  sess: Session,
  lint: LintId,
  probe_for_lint_level_spec: (id: LintId) => LevelSpec<Id> | undefined,
): LevelSpec<Id> {
  const level_spec_ = probe_for_lint_level_spec(lint);

  // If `level` is none then we actually assume the default level for this lint.
  let level_spec =
    level_spec_ ?? LevelSpec.new<Id>(Lint.default_level(lint.lint, sess.edition()), undefined, LintLevelSource.Default);

  // If we're about to issue a warning, check at the last minute for any
  // directives against the `warnings` lint group. If, for example, there's an
  // `allow(warnings)` in scope then we want to respect that instead.
  if (level_spec.level === "Warn") {
    const configured_level_spec = probe_for_lint_level_spec(LintId.of(builtin.WARNINGS));
    if (configured_level_spec !== undefined) {
      let respect_warnings_lint_group: boolean;
      switch (configured_level_spec.level) {
        // -Wwarnings is a no-op.
        case "Warn":
          respect_warnings_lint_group = false;
          break;
        // Some warnings cannot be denied from the `warnings` lint group, only individually.
        case "Deny":
        case "Forbid":
          respect_warnings_lint_group = !lint.lint.ignore_deny_warnings;
          break;
        // All warnings respect -Awarnings.
        case "Allow":
          respect_warnings_lint_group = true;
          break;
        // Not sure what the right behavior is here, but, sure, why not.
        // See tests/ui/lint/rfc-2383-lint-reason/expect_warnings.rs.
        case "Expect":
          respect_warnings_lint_group = true;
          break;
        case "ForceWarn": {
          sess.dcx().span_delayed_bug(LintLevelSource.span(configured_level_spec.src), "cannot --force-warn the `warnings` lint group");
          respect_warnings_lint_group = false;
          break;
        }
      }
      if (respect_warnings_lint_group) {
        level_spec = configured_level_spec;
      }
    }
  }

  // Ensure that we never exceed the `--cap-lints` argument unless the source is a --force-warn
  if (!(level_spec.src.$ === "CommandLine" && level_spec.src._1 === "ForceWarn")) {
    level_spec = level_spec.with_level(level_min(level_spec.level, sess.opts.lint_cap ?? "Forbid"));
  }

  // Ensure that we never exceed driver level.
  const driver_level = sess.driver_lint_caps.get(lint);
  if (driver_level !== undefined) {
    level_spec = level_spec.with_level(level_min(level_spec.level, driver_level));
  }

  return level_spec;
}

/** `std::cmp::min` over `Level`'s derived `Ord` (declaration order). */
function level_min(a: Level, b: Level): Level {
  // `min` returns the first argument when they are equal.
  return Level_discriminant[b] < Level_discriminant[a] ? b : a;
}

declare module "./ty/context.ts" {
  interface TyCtxt {
    lint_level_spec_at_node(lint: Lint, id: HirId): StableLevelSpec;
  }
}

/// Fetch and return the user-visible lint level spec for the given lint at the given HirId.
// rustc: compiler/rustc_middle/src/lint.rs:247 lint_level_spec_at_node
TyCtxt.prototype.lint_level_spec_at_node = function (this: TyCtxt, lint: Lint, id: HirId): StableLevelSpec {
  return (this.shallow_lint_levels_on(id.owner) as ShallowLintLevelMap).lint_level_spec_at_node(this, LintId.of(lint), id);
};

/// This struct represents a lint expectation and holds all required information
/// to emit the `unfulfilled_lint_expectations` lint if it is unfulfilled after
/// the `LateLintPass` has completed.
// #[derive(Clone, Debug, Encodable, Decodable, StableHash)]
export class LintExpectation {
  constructor(
    /// The reason for this expectation that can optionally be added as part of
    /// the attribute. It will be displayed as part of the lint message.
    public reason: Symbol | undefined,
    /// The [`Span`] of the attribute that this expectation originated from.
    public emission_span: Span,
    /// Lint messages for the `unfulfilled_lint_expectations` lint will be
    /// adjusted to include an additional note. Therefore, we have to track if
    /// the expectation is for the lint.
    public is_unfulfilled_lint_expectations: boolean,
    /// This will hold the name of the tool that this lint belongs to. For
    /// the lint `clippy::some_lint` the tool would be `clippy`, the same
    /// goes for `rustdoc`. This will be `None` for rustc lints
    public lint_tool: Symbol | undefined,
  ) {}

  // rustc: compiler/rustc_middle/src/lint.rs:273 new
  static new(
    reason: Symbol | undefined,
    emission_span: Span,
    is_unfulfilled_lint_expectations: boolean,
    lint_tool: Symbol | undefined,
  ): LintExpectation {
    return new LintExpectation(reason, emission_span, is_unfulfilled_lint_expectations, lint_tool);
  }
}

/** `#[derive(Debug)]` */
export const debug_LintExpectation: Debug<LintExpectation> = (v, f) =>
  debug_struct(f, "LintExpectation", [
    ["reason", debug_option(v.reason, f, debug_Symbol)],
    ["emission_span", debug_Span(v.emission_span, f)],
    ["is_unfulfilled_lint_expectations", String(v.is_unfulfilled_lint_expectations)],
    ["lint_tool", debug_option(v.lint_tool, f, debug_Symbol)],
  ]);

// rustc: compiler/rustc_middle/src/lint.rs:283 explain_lint_level_source
function explain_lint_level_source(sess: Session, lint: Lint, level: Level, src: LintLevelSource, err: Diag): void {
  // Find the name of the lint group that contains the given lint.
  // Assumes the lint only belongs to one group.
  const lint_group_name = (lint: Lint): string | undefined => {
    const lint_groups_iter = sess.lint_groups_iter();
    const lint_id = LintId.of(lint);
    for (const lint_group of lint_groups_iter) {
      if (lint_group.is_externally_loaded) continue;
      if (lint_group.lints.find((lint_group_lint) => lint_group_lint === lint_id) !== undefined) {
        return lint_group.name;
      }
    }
    return undefined;
  };
  const name = Lint.name_lower(lint);
  if (level === "Allow") {
    // Do not point at `#[allow(compat_lint)]` as the reason for a compatibility lint
    // triggering. (#121009)
    return;
  }
  switch (src.$) {
    case "Default": {
      const level_str = Level.as_str(level);
      const group_name = lint_group_name(lint);
      if (group_name !== undefined) {
        err.note_once(`\`#[${level_str}(${name})]\` (part of \`#[${level_str}(${group_name})]\`) on by default`);
      } else {
        err.note_once(`\`#[${level_str}(${name})]\` on by default`);
      }
      break;
    }
    case "CommandLine": {
      const lint_flag_val = src._0;
      const orig_level = src._1;
      const flag = Level.to_cmd_flag(orig_level);
      const hyphen_case_lint_name = name.replaceAll("_", "-");
      if (SymbolC.as_str(lint_flag_val) === name) {
        err.note_once(`requested on the command line with \`${flag} ${hyphen_case_lint_name}\``);
      } else {
        const hyphen_case_flag_val = SymbolC.as_str(lint_flag_val).replaceAll("_", "-");
        err.note_once(`\`${flag} ${hyphen_case_lint_name}\` implied by \`${flag} ${hyphen_case_flag_val}\``);
        if (orig_level === "Warn" || orig_level === "Deny") {
          let help: string;
          if (name === "dead_code") {
            help = `to override \`${flag} ${hyphen_case_flag_val}\` add \`#[expect(${name})]\` or \`#[allow(${name})]\``;
          } else {
            help = `to override \`${flag} ${hyphen_case_flag_val}\` add \`#[allow(${name})]\``;
          }
          err.help_once(help);
        }
      }
      break;
    }
    case "Node": {
      const lint_attr_name = src.name;
      const span = src.span;
      const reason = src.reason;
      if (reason !== undefined) {
        err.note(SymbolC.as_str(reason));
      }
      err.span_note_once(span, "the lint level is defined here");
      if (SymbolC.as_str(lint_attr_name) !== name) {
        const level_str = Level.as_str(level);
        err.note_once(`\`#[${level_str}(${name})]\` implied by \`#[${level_str}(${SymbolC.as_str(lint_attr_name)})]\``);
      }
      break;
    }
  }

  const found = sess.opts.lint_opts.find(([opt, _level]) => opt === "warnings");
  const warnings_group = found === undefined ? undefined : found[1];
  if (
    warnings_group !== undefined &&
    Level_discriminant[warnings_group] >= Level_discriminant.Deny &&
    Level_discriminant[level] < Level_discriminant[warnings_group]
  ) {
    err.note_once(`the \`${name}\` lint ignores \`-D warnings\``);
  }
}

/// The innermost function for emitting lints implementing the [`trait@Diagnostic`] trait.
///
/// If you are looking to implement a lint, look for higher level functions,
/// for example:
///
/// - [`TyCtxt::emit_node_span_lint`]
/// - `LintContext::opt_span_lint`
// #[track_caller]
// rustc: compiler/rustc_middle/src/lint.rs:385 emit_lint_base
export function emit_lint_base(sess: Session, lint: Lint, level_spec: LevelSpec, span: MultiSpan | undefined, decorate: Diagnostic): void {
  // Avoid codegen bloat from monomorphization by immediately doing dyn dispatch of `decorate` to
  // the "real" work.
  // #[track_caller]
  // rustc: compiler/rustc_middle/src/lint.rs:395 emit_lint_base_impl
  function emit_lint_base_impl(
    sess: Session,
    lint: Lint,
    level_spec: LevelSpec,
    span: MultiSpan | undefined,
    decorate: (dcx: ReturnType<Session["dcx"]>, level: ErrLevel) => Diag,
  ): void {
    const { level, lint_id, src } = level_spec;

    // Check for future incompatibility lints and issue a stronger warning.
    const future_incompatible = lint.future_incompatible;

    const has_future_breakage =
      future_incompatible === undefined
        ? // Default allow lints trigger too often for testing.
          sess.opts.unstable_opts.future_incompat_test && lint.default_level !== "Allow"
        : future_incompatible.report_in_deps;

    // Convert lint level to error level.
    let err_level: ErrLevel;
    switch (level) {
      case "Allow":
        if (has_future_breakage) {
          err_level = { $: "Warning", _0: { $: "Allowed" } };
        } else {
          return;
        }
        break;
      case "Expect":
        // This case is special as we actually allow the lint itself in this context, but
        // we can't return early like in the case for `Level::Allow` because we still
        // need the lint diagnostic to be emitted to `rustc_error::DiagCtxtInner`.
        //
        // We also cannot mark the lint expectation as fulfilled here right away, because
        // it can still be cancelled in the decorate function. So we create a `Diag` and
        // continue as we would for `Level::Warn`.
        if (lint_id === undefined) panic("called `Option::unwrap()` on a `None` value");
        err_level = { $: "Warning", _0: { $: "Expected", lint_id } };
        break;
      case "ForceWarn":
        err_level = { $: "Warning", _0: { $: "Forced", lint_id } };
        break;
      case "Warn":
        err_level = { $: "Warning", _0: undefined };
        break;
      case "Deny":
      case "Forbid":
        err_level = ErrLevelC.Error;
        break;
    }

    let disable_suggestions: boolean;
    if (
      span !== undefined &&
      // If this code originates in a foreign macro, aka something that this crate
      // did not itself author, then it's likely that there's nothing this crate
      // can do about it. We probably want to skip the lint entirely.
      span.primary_spans_().some((s) => Span.in_external_macro(s, sess.source_map()))
    ) {
      disable_suggestions = true;
    } else {
      disable_suggestions = false;
    }

    if (disable_suggestions) {
      // If this is a future incompatible that is not an edition fixing lint
      // it'll become a hard error, so we have to emit *something*. Also,
      // if this lint occurs in the expansion of a macro from an external crate,
      // allow individual lints to opt-out from being reported.
      const incompatible = future_incompatible !== undefined && FutureIncompatibilityReason.edition(future_incompatible.reason) === undefined;

      // In rustc, for the find_attr macro, we want to always emit this.
      // This completely circumvents normal lint checking, which usually doesn't happen for macros from other crates.
      // However, we kind of want that when using find_attr from another rustc crate. So we cheat a little.
      const is_in_find_attr =
        sess.enable_internal_lints() &&
        span !== undefined &&
        span.primary_spans_().some((s) => {
          const i = Span.source_callee(s);
          return i !== undefined && i.kind.$ === "Macro" && SymbolC.as_str(i.kind._1) === "find_attr";
        });

      if (!incompatible && !lint.report_in_external_macro && !is_in_find_attr) {
        // Don't continue further, since we don't want to have
        // `diag_span_note_once` called for a diagnostic that isn't emitted.
        return;
      }
    }
    // Finally, run `decorate`. `decorate` can call `trimmed_path_str` (directly or indirectly),
    // so we need to make sure when we do call `decorate` that the diagnostic is eventually
    // emitted or we'll get a `must_produce_diag` ICE.
    //
    // When is a diagnostic *eventually* emitted? Well, that is determined by 2 factors:
    // 1. If the corresponding `rustc_errors::Level` is beyond warning, i.e. `Error`, then the
    //    diagnostic will be emitted regardless of CLI options.
    // 2. If the corresponding `rustc_errors::Level` is warning, then that can be affected by
    //    `-A warnings` or `--cap-lints=xxx` on the command line. In which case, the diagnostic
    //    will be emitted if `can_emit_warnings` is true.
    const skip = err_level.$ === "Warning" && err_level._0 === undefined && !sess.dcx().can_emit_warnings();

    let err: Diag;
    if (!skip) {
      err = decorate(sess.dcx(), err_level);
    } else {
      err = DiagClass.new(sess.dcx(), err_level, "");
    }

    if (span !== undefined && err.deref().span.primary_span() === undefined) {
      // We can't use `err.span()` because it overwrites the labels, so we need to do it
      // manually.
      for (const primary of span.primary_spans_()) {
        err.deref_mut().span.push_primary_span(primary);
      }
      for (const [label_span, label] of span.span_labels_raw()) {
        err.deref_mut().span.push_span_diag(label_span, label);
      }
    }

    if (disable_suggestions) {
      // Any suggestions made here are likely to be incorrect, so anything we
      // emit shouldn't be automatically fixed by rustfix.
      err.disable_suggestions();
    }

    err.is_lint(Lint.name_lower(lint), has_future_breakage, lint.rust_version);
    // Lint diagnostics that are covered by the expect level will not be emitted outside
    // the compiler. It is therefore not necessary to add any information for the user.
    // This will therefore directly call the decorate function which will in turn emit
    // the diagnostic.
    if (level === "Expect") {
      err.emit();
      return;
    }

    if (future_incompatible !== undefined) {
      let explanation: string;
      const reason = future_incompatible.reason;
      switch (reason.$) {
        case "FutureReleaseError":
          explanation =
            "this was previously accepted by the compiler but is being phased out; " +
            "it will become a hard error in a future release!";
          break;
        case "FutureReleaseSemanticsChange":
          explanation = "this will change its meaning in a future release!";
          break;
        case "EditionError": {
          const edition = reason._0.edition;
          const current_edition = sess.edition();
          explanation = `this is accepted in the current edition (Rust ${display_Edition(current_edition)}) but is a hard error in Rust ${display_Edition(edition)}!`;
          break;
        }
        case "EditionSemanticsChange": {
          const edition = reason._0.edition;
          explanation = `this changes meaning in Rust ${display_Edition(edition)}`;
          break;
        }
        case "EditionAndFutureReleaseError": {
          const edition = reason._0.edition;
          explanation =
            "this was previously accepted by the compiler but is being phased out; " +
            `it will become a hard error in Rust ${display_Edition(edition)} and in a future release in all editions!`;
          break;
        }
        case "EditionAndFutureReleaseSemanticsChange": {
          const edition = reason._0.edition;
          explanation = `this changes meaning in Rust ${display_Edition(edition)} and in a future release in all editions!`;
          break;
        }
        case "Custom":
          explanation = reason._0;
          break;
        case "Unreachable":
          unreachable();
      }

      if (future_incompatible.explain_reason) {
        err.warn(explanation);
      }

      const citation = `for more information, see ${FutureIncompatibilityReason.reference(future_incompatible.reason)}`;
      err.note(citation);
    }

    explain_lint_level_source(sess, lint, level, src, err);
    err.emit();
  }
  emit_lint_base_impl(sess, lint, level_spec, span, (dcx, level) => decorate.into_diag(dcx, level));
}
