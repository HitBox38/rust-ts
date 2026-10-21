//! Basic types for managing and implementing lints.
//!
//! See <https://rustc-dev-guide.rust-lang.org/diagnostics.html> for an
//! overview of how lints are implemented.
//
// Port of compiler/rustc_lint/src/context.rs.
//
// PORT: `LintContext` (a trait with an associated `LintExpectationId` type) is an interface; its provided methods
// live in `LintContext_provided` (PORTING §8) and `EarlyContext` / `LateContext` forward to them. The
// `Self::LintExpectationId: Into<LintExpectationId>` bound is the interface member `into_lint_expectation_id`.
// PORT: the `LateContext` methods need the HIR and `rustc_middle::ty` (M3): their bodies stop at the first
// missing piece with `unported(..)`.
import type { TargetDataLayout } from "../rustc_abi/lib.ts";
import type { Features } from "../rustc_feature/unstable.ts";
import { type Diagnostic, type IntoMultiSpan, LintBuffer, into_MultiSpan } from "../rustc_errors/lib.ts";
import {
  FutureIncompatibilityReason,
  Lint,
  LintExpectationId,
  LintId,
  type RegisteredTools,
  type StableLintExpectationId,
  type UnstableLintExpectationId,
  builtin,
  debug_LintId,
} from "../rustc_lint_defs/lib.ts";
import type { LevelSpec, StableLevelSpec, UnstableLevelSpec } from "../rustc_middle/lint.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { CrateNum, DefId } from "../rustc_span/def_id.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { DynLintStore, LintGroup as SessionLintGroup, Session } from "../rustc_session/session.ts";
import { find_best_match_for_names } from "../rustc_span/edit_distance.ts";
import { Edition } from "../rustc_span/edition.ts";
import { Ident, Symbol, debug_Symbol, sym } from "../rustc_span/symbol.ts";
import type { Span } from "../rustc_span/lib.ts";
import { is_uppercase } from "../std/char.ts";
import { type Debug, debug_option, debug_str, debug_tuple, debug_vec } from "../std/fmt.ts";
import { panic, unported, unreachable } from "../std/panic.ts";
import { str_to_lowercase } from "../std/unicode/str_case.ts";
import { LintLevelsBuilder, type TopDown } from "./levels.ts";
import type { EarlyLintPassObject, LateLintPassObject } from "./passes.ts";

export type EarlyLintPassFactory = () => EarlyLintPassObject;
type LateLintPassFactory = (tcx: TyCtxt) => LateLintPassObject;

/// Information about the registered lints.
//
// About the pass factories: these should only be called once, but since we
// want to avoid locks or interior mutability, we don't enforce this. Lints
// should, in theory, be compatible with being constructed more than once,
// though not necessarily in a sane manner. This is safe though.
export class LintStore implements DynLintStore {
  constructor(
    /// Registered lints.
    private lints: Lint[],

    /// This lint pass kind is softly deprecated. It misses expanded code and has caused a few
    /// errors in the past. Currently, it is only used in Clippy. New implementations
    /// should avoid using this interface, as it might be removed in the future.
    ///
    /// * See [rust#69838](https://github.com/rust-lang/rust/pull/69838)
    /// * See [rust-clippy#5518](https://github.com/rust-lang/rust-clippy/pull/5518)
    public pre_expansion_lint_passes: EarlyLintPassFactory[],

    /// These lint passes run on AST nodes.
    public early_lint_passes: EarlyLintPassFactory[],

    /// These lint passes run on HIR nodes. Each one processes an entire crate. They don't benefit
    /// from incremental compilation. `late_lint_mod_passes` should be used in preference where
    /// possible; only use `late_lint_passes` for lints that implement `check_crate` and/or
    /// `check_crate_post` and accumulate cross-module state.
    ///
    /// The exception is Clippy, which uses `late_lint_passes` for all late lint passes. It needs
    /// `check_crate`/`check_crate_post` for some of its lints and uses late lint passes throughout
    /// for consistency. This is ok because Clippy isn't wired for incremental compilation.
    public late_lint_passes: LateLintPassFactory[],

    /// These lint passes run on HIR nodes, and are constructed per-module (i.e. multiple times).
    /// They benefit from incremental compilation.
    public late_lint_mod_passes: LateLintPassFactory[],

    /// Lints indexed by name.
    // PORT: `UnordMap<String, TargetLint>`; nothing observable depends on its order (`keys().any(..)` only).
    private by_name: Map<string, TargetLint>,

    /// Map of registered lint groups to what lints they expand to.
    private lint_groups: Map<string, LintGroup>,
  ) {}

  /** `impl DynLintStore for LintStore` */
  // rustc: compiler/rustc_lint/src/context.rs:89 lint_groups_iter
  lint_groups_iter(): Iterable<SessionLintGroup> {
    return [...this.get_lint_groups()].map(([name, lints, is_externally_loaded]) => ({ name, lints, is_externally_loaded }));
  }

  // rustc: compiler/rustc_lint/src/context.rs:152 new
  static new(): LintStore {
    return new LintStore([], [], [], [], [], new Map(), new Map());
  }

  // rustc: compiler/rustc_lint/src/context.rs:164 get_lints
  get_lints(): readonly Lint[] {
    return this.lints;
  }

  // rustc: compiler/rustc_lint/src/context.rs:168 get_lint_groups
  *get_lint_groups(): Iterable<[string, LintId[], boolean]> {
    for (const [k, { lint_ids, is_externally_loaded, depr }] of this.lint_groups) {
      // Don't display deprecated lint groups.
      if (depr !== undefined) continue;
      yield [k, lint_ids.slice(), is_externally_loaded];
    }
  }

  /// Returns all lint group names, including deprecated/aliased groups
  // rustc: compiler/rustc_lint/src/context.rs:181 get_all_group_names
  get_all_group_names(): Iterable<string> {
    return this.lint_groups.keys();
  }

  /// See the comment on `LintStore::pre_expansion_lint_passes`.
  // rustc: compiler/rustc_lint/src/context.rs:186 register_pre_expansion_lint_pass
  register_pre_expansion_lint_pass(pass: EarlyLintPassFactory): void {
    this.pre_expansion_lint_passes.push(pass);
  }

  /// See the comment on `LintStore::early_lint_passes`.
  // rustc: compiler/rustc_lint/src/context.rs:191 register_early_lint_pass
  register_early_lint_pass(pass: EarlyLintPassFactory): void {
    this.early_lint_passes.push(pass);
  }

  /// See the comment on `LintStore::late_lint_passes`.
  // rustc: compiler/rustc_lint/src/context.rs:196 register_late_lint_pass
  register_late_lint_pass(pass: LateLintPassFactory): void {
    this.late_lint_passes.push(pass);
  }

  /// See the comment on `LintStore::late_lint_mod_passes`.
  // rustc: compiler/rustc_lint/src/context.rs:201 register_late_lint_mod_pass
  register_late_lint_mod_pass(pass: LateLintPassFactory): void {
    this.late_lint_mod_passes.push(pass);
  }

  /// Helper method for register_early/late_pass
  // rustc: compiler/rustc_lint/src/context.rs:206 register_lints
  register_lints(lints: readonly Lint[]): void {
    for (const lint of lints) {
      this.lints.push(lint);

      const id = LintId.of(lint);
      const name_lower = Lint.name_lower(lint);
      const had = this.by_name.has(name_lower);
      this.by_name.set(name_lower, { $: "Id", _0: id });
      if (had) {
        panic(`duplicate specification of lint ${Lint.name_lower(lint)}`);
      }

      if (lint.future_incompatible !== undefined) {
        const { reason } = lint.future_incompatible;
        const edition = FutureIncompatibilityReason.edition(reason);
        if (edition !== undefined) {
          this.lint_groups_entry_or_insert(Edition.lint_name(edition), {
            lint_ids: [],
            is_externally_loaded: lint.is_externally_loaded,
            depr: undefined,
          }).lint_ids.push(id);
        } else {
          // Lints belonging to the `future_incompatible` lint group are lints where a
          // future version of rustc will cause existing code to stop compiling.
          // Lints tied to an edition don't count because they are opt-in.
          this.lint_groups_entry_or_insert("future_incompatible", {
            lint_ids: [],
            is_externally_loaded: lint.is_externally_loaded,
            depr: undefined,
          }).lint_ids.push(id);
        }
      }
    }
  }

  /** PORT: `self.lint_groups.entry(name).or_insert(group)`. */
  private lint_groups_entry_or_insert(name: string, group: LintGroup): LintGroup {
    let g = this.lint_groups.get(name);
    if (g === undefined) {
      g = group;
      this.lint_groups.set(name, g);
    }
    return g;
  }

  // rustc: compiler/rustc_lint/src/context.rs:244 insert_group
  private insert_group(name: string, group: LintGroup): void {
    const previous = this.lint_groups.get(name);
    this.lint_groups.set(name, group);
    if (previous !== undefined) {
      panic(`group ${JSON.stringify(name)} already exists`);
    }
  }

  // rustc: compiler/rustc_lint/src/context.rs:251 register_group_alias
  register_group_alias(group_name: string, alias: string): void {
    const g = this.lint_groups.get(group_name);
    if (g === undefined) {
      panic(`group alias ${JSON.stringify(alias)} points to unregistered group ${JSON.stringify(group_name)}`);
    }
    const { lint_ids } = g;

    this.insert_group(alias, {
      lint_ids: lint_ids.slice(),
      is_externally_loaded: false,
      depr: { name: group_name, silent: true },
    });
  }

  // rustc: compiler/rustc_lint/src/context.rs:266 register_group
  register_group(is_externally_loaded: boolean, name: string, deprecated_name: string | undefined, to: LintId[]): void {
    if (deprecated_name !== undefined) {
      const deprecated = deprecated_name;
      this.insert_group(deprecated, {
        lint_ids: to.slice(),
        is_externally_loaded,
        depr: { name, silent: false },
      });
    }
    this.insert_group(name, { lint_ids: to, is_externally_loaded, depr: undefined });
  }

  /// This lint should give no warning and have no effect.
  ///
  /// This is used by rustc to avoid warning about old rustdoc lints before rustdoc registers them as tool lints.
  // #[track_caller]
  // rustc: compiler/rustc_lint/src/context.rs:290 register_ignored
  register_ignored(name: string): void {
    const had = this.by_name.has(name);
    this.by_name.set(name, TargetLint.Ignored);
    if (had) {
      panic(`duplicate specification of lint ${name}`);
    }
  }

  /// This lint has been renamed; warn about using the new name and apply the lint.
  // #[track_caller]
  // rustc: compiler/rustc_lint/src/context.rs:298 register_renamed
  register_renamed(old_name: string, new_name: string): void {
    const t = this.by_name.get(new_name);
    if (t === undefined || t.$ !== "Id") {
      panic(`invalid lint renaming of ${old_name} to ${new_name}`);
    }
    const target = t._0;
    this.by_name.set(old_name, { $: "Renamed", _0: new_name, _1: target });
  }

  // rustc: compiler/rustc_lint/src/context.rs:305 register_removed
  register_removed(name: string, reason: string): void {
    this.by_name.set(name, { $: "Removed", _0: reason });
  }

  // rustc: compiler/rustc_lint/src/context.rs:309 find_lints
  find_lints(lint_name: string): readonly LintId[] | undefined {
    const t = this.by_name.get(lint_name);
    if (t !== undefined) {
      switch (t.$) {
        case "Id":
          return [t._0];
        case "Renamed":
          return [t._1];
        case "Removed":
          return undefined;
        case "Ignored":
          return [];
      }
    }
    const g = this.lint_groups.get(lint_name);
    if (g !== undefined) {
      return g.lint_ids;
    }
    return undefined;
  }

  /// True if this symbol represents a lint group name.
  // rustc: compiler/rustc_lint/src/context.rs:323 is_lint_group
  is_lint_group(lint_name: Symbol): boolean {
    // debug!("is_lint_group(lint_name={:?}, lint_groups={:?})", lint_name, self.lint_groups.keys().collect::<Vec<_>>());
    const lint_name_str = Symbol.as_str(lint_name);
    return (
      this.lint_groups.has(lint_name_str) ||
      (() => {
        const warnings_name_str = Lint.name_lower(builtin.WARNINGS);
        return lint_name_str === warnings_name_str;
      })()
    );
  }

  /// Checks the name of a lint for its existence, and whether it was
  /// renamed or removed. Generates a `Diag` containing a
  /// warning for renamed and removed lints. This is over both lint
  /// names from attributes and those passed on the command line. Since
  /// it emits non-fatal warnings and there are *two* lint passes that
  /// inspect attributes, this is only run from the late pass to avoid
  /// printing duplicate warnings.
  // rustc: compiler/rustc_lint/src/context.rs:343 check_lint_name
  check_lint_name(lint_name: string, tool_name: Symbol | undefined, registered_lint_tools: RegisteredTools): CheckLintNameResult {
    if (tool_name !== undefined) {
      // FIXME: rustc and rustdoc are considered tools for lints, but not for attributes.
      if (tool_name !== sym.rustc && tool_name !== sym.rustdoc && !registered_lint_tools.has(Ident.with_dummy_span(tool_name))) {
        return CheckLintNameResult.NoTool;
      }
    }

    const complete_name = tool_name !== undefined ? `${Symbol.as_str(tool_name)}::${lint_name}` : lint_name;
    // If the lint was scoped with `tool::` check if the tool lint exists
    if (tool_name !== undefined) {
      const t = this.by_name.get(complete_name);
      if (t === undefined) {
        const g = this.lint_groups.get(complete_name);
        // If the lint isn't registered, there are two possibilities:
        if (g === undefined) {
          // 1. The tool is currently running, so this lint really doesn't exist.
          // FIXME: should this handle tools that never register a lint, like rustfmt?
          // debug!("lints={:?}", self.by_name);
          const tool_prefix = `${Symbol.as_str(tool_name)}::`;

          let any = false;
          for (const lint of this.by_name.keys()) {
            if (lint.startsWith(tool_prefix)) {
              any = true;
              break;
            }
          }
          if (any) {
            return this.no_lint_suggestion(complete_name, Symbol.as_str(tool_name));
          } else {
            // 2. The tool isn't currently running, so no lints will be registered.
            // To avoid giving a false positive, ignore all unknown lints.
            return CheckLintNameResult.MissingTool;
          }
        } else {
          const { lint_ids, depr } = g;
          if (depr !== undefined && !depr.silent) {
            return { $: "Tool", _0: lint_ids, _1: depr.name };
          } else {
            return { $: "Tool", _0: lint_ids, _1: undefined };
          }
        }
      } else if (t.$ === "Id") {
        return { $: "Tool", _0: [t._0], _1: undefined };
      }
      // If the lint was registered as removed or renamed by the lint tool, we don't need
      // to treat tool_lints and rustc lints different and can use the code below.
    }
    const t = this.by_name.get(complete_name);
    if (t === undefined) {
      const g = this.lint_groups.get(complete_name);
      // If neither the lint, nor the lint group exists check if there is a `clippy::`
      // variant of this lint
      if (g === undefined) {
        return this.check_tool_name_for_backwards_compat(complete_name, "clippy");
      }
      const { lint_ids, depr } = g;
      // Check if the lint group name is deprecated
      if (depr !== undefined && !depr.silent) {
        return { $: "Tool", _0: lint_ids, _1: depr.name };
      } else {
        return { $: "Ok", _0: lint_ids };
      }
    }
    switch (t.$) {
      case "Renamed":
        return { $: "Renamed", _0: t._0 };
      case "Removed":
        return { $: "Removed", _0: t._0 };
      case "Id":
        return { $: "Ok", _0: [t._0] };
      case "Ignored":
        return { $: "Ok", _0: [] };
    }
  }

  // rustc: compiler/rustc_lint/src/context.rs:418 no_lint_suggestion
  private no_lint_suggestion(lint_name: string, tool_name: string): CheckLintNameResult {
    const name_lower = str_to_lowercase(lint_name);

    let any_upper = false;
    for (const c of lint_name) {
      if (is_uppercase(c.codePointAt(0)!)) {
        any_upper = true;
        break;
      }
    }
    if (any_upper && this.find_lints(name_lower) !== undefined) {
      // First check if the lint name is (partly) in upper case instead of lower case...
      return { $: "NoLint", _0: [Symbol.intern(name_lower), false] };
    }

    // ...if not, search for lints with a similar name
    // Note: find_best_match_for_name depends on the sort order of its input vector.
    // To ensure deterministic output, sort elements of the lint_groups hash map.
    // Also, never suggest deprecated lint groups.
    // We will soon sort, so the initial order does not matter.
    // #[allow(rustc::potential_query_instability)]
    const groups_: string[] = [];
    for (const [k, { depr }] of this.lint_groups) {
      if (depr === undefined) groups_.push(k);
    }
    groups_.sort(str_cmp);
    const groups = groups_.map((k) => Symbol.intern(k));
    const lints = this.lints.map((l) => Symbol.intern(Lint.name_lower(l)));
    const names: Symbol[] = [...groups, ...lints];
    const lookups = [Symbol.intern(name_lower)];
    {
      // `name_lower.split("::").last()` is always `Some`.
      const parts = name_lower.split("::");
      const stripped = parts[parts.length - 1]!;
      lookups.push(Symbol.intern(stripped));
    }
    const res = find_best_match_for_names(names, lookups, undefined);
    const is_rustc = res === undefined ? false : name_lower.includes("::") && !Symbol.as_str(res).startsWith(tool_name);
    const suggestion: [Symbol, boolean] | undefined = res === undefined ? undefined : [res, is_rustc];
    return { $: "NoLint", _0: suggestion };
  }

  // rustc: compiler/rustc_lint/src/context.rs:454 check_tool_name_for_backwards_compat
  private check_tool_name_for_backwards_compat(lint_name: string, tool_name: string): CheckLintNameResult {
    const complete_name = `${tool_name}::${lint_name}`;
    const t = this.by_name.get(complete_name);
    if (t === undefined) {
      const g = this.lint_groups.get(complete_name);
      // Now we are sure, that this lint exists nowhere
      if (g === undefined) {
        return this.no_lint_suggestion(lint_name, tool_name);
      }
      return { $: "Tool", _0: g.lint_ids, _1: complete_name };
    }
    if (t.$ === "Id") {
      return { $: "Tool", _0: [t._0], _1: complete_name };
    }
    // debug!("got renamed lint {:?}", other);
    return { $: "NoLint", _0: undefined };
  }
}

/** `str::cmp` (byte-wise on UTF-8 = code point order). */
function str_cmp(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const p = x[i]!.codePointAt(0)!;
    const q = y[i]!.codePointAt(0)!;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length - y.length;
}

/// The target of the `by_name` map, which accounts for renaming/deprecation.
// #[derive(Debug)]
type TargetLint =
  /// A direct lint target
  | { readonly $: "Id"; readonly _0: LintId }
  /// Temporary renaming, used for easing migration pain; see #16545
  | { readonly $: "Renamed"; readonly _0: string; readonly _1: LintId }
  /// Lint with this name existed previously, but has been removed/deprecated.
  /// The string argument is the reason for removal.
  | { readonly $: "Removed"; readonly _0: string }
  /// A lint name that should give no warnings and have no effect.
  ///
  /// This is used by rustc to avoid warning about old rustdoc lints before rustdoc registers
  /// them as tool lints.
  | { readonly $: "Ignored" };
const TargetLint = {
  Ignored: Object.freeze({ $: "Ignored" as const }),
};

interface LintAlias {
  name: string;
  /// Whether deprecation warnings should be suppressed for this alias.
  silent: boolean;
}

interface LintGroup {
  lint_ids: LintId[];
  is_externally_loaded: boolean;
  depr: LintAlias | undefined;
}

// #[derive(Debug)]
export type CheckLintNameResult =
  | { readonly $: "Ok"; readonly _0: readonly LintId[] }
  /// Lint doesn't exist. Potentially contains a suggestion for a correct lint name.
  | { readonly $: "NoLint"; readonly _0: [Symbol, boolean] | undefined }
  /// The lint refers to a tool that has not been registered.
  | { readonly $: "NoTool" }
  /// The lint has been renamed to a new name.
  | { readonly $: "Renamed"; readonly _0: string }
  /// The lint has been removed due to the given reason.
  | { readonly $: "Removed"; readonly _0: string }

  /// The lint is from a tool. The `LintId` will be returned as if it were a
  /// rustc lint. The `Option<String>` indicates if the lint has been
  /// renamed.
  | { readonly $: "Tool"; readonly _0: readonly LintId[]; readonly _1: string | undefined }

  /// The lint is from a tool. Either the lint does not exist in the tool or
  /// the code was not compiled with the tool and therefore the lint was
  /// never added to the `LintStore`.
  | { readonly $: "MissingTool" };
export const CheckLintNameResult = {
  NoTool: Object.freeze({ $: "NoTool" as const }),
  MissingTool: Object.freeze({ $: "MissingTool" as const }),
};

/** `#[derive(Debug)]` */
export const debug_CheckLintNameResult: Debug<CheckLintNameResult> = (v, f) => {
  const ids = (x: readonly LintId[]): string => debug_vec(x, f, debug_LintId);
  switch (v.$) {
    case "Ok":
      return debug_tuple(f, "Ok", [ids(v._0)]);
    case "NoLint":
      return debug_tuple(f, "NoLint", [debug_option(v._0, f, (x) => debug_tuple(f, "", [debug_Symbol(x[0], f), String(x[1])]))]);
    case "NoTool":
      return "NoTool";
    case "Renamed":
      return debug_tuple(f, "Renamed", [debug_str(v._0)]);
    case "Removed":
      return debug_tuple(f, "Removed", [debug_str(v._0)]);
    case "Tool":
      return debug_tuple(f, "Tool", [ids(v._0), debug_option(v._1, f, debug_str)]);
    case "MissingTool":
      return "MissingTool";
  }
};

/// Context for lint checking outside of type inference.
export class LateContext implements LintContext<StableLintExpectationId> {
  constructor(
    /// Type context we're checking in.
    public tcx: TyCtxt,

    /// Current body, or `None` if outside a body.
    public enclosing_body: unknown | undefined,

    /// Type-checking results for the current body.
    public typeck_results: unknown | undefined,

    /// Parameter environment for the item we are in.
    public param_env: unknown,

    /// Items accessible from the crate being checked.
    public effective_visibilities: unknown,

    public last_node_with_lint_attrs: HirId,

    /// Generic type parameters in scope for the item we are in.
    public generics: unknown | undefined,

    /// We are only looking at one module
    public only_module: boolean,
  ) {}

  /// Gets the overall compiler `Session` object.
  // rustc: compiler/rustc_lint/src/context.rs:580 sess
  sess(): Session {
    return this.tcx.sess;
  }

  // rustc: compiler/rustc_lint/src/context.rs:584 opt_span_lint
  opt_span_lint(lint: Lint, span: IntoMultiSpan | undefined, decorate: Diagnostic): void {
    const hir_id = this.last_node_with_lint_attrs;

    if (span !== undefined) {
      const s = span;
      this.tcx.emit_node_span_lint(lint, hir_id, s, decorate);
    } else {
      this.tcx.emit_node_lint(lint, hir_id, decorate);
    }
  }

  // rustc: compiler/rustc_lint/src/context.rs:598 get_lint_level_spec
  get_lint_level_spec(lint: Lint): StableLevelSpec {
    return this.tcx.lint_level_spec_at_node(lint, this.last_node_with_lint_attrs);
  }

  into_lint_expectation_id(id: StableLintExpectationId): LintExpectationId {
    return LintExpectationId.Stable(id);
  }

  emit_span_lint(lint: Lint, span: IntoMultiSpan, decorator: Diagnostic): void {
    LintContext_provided.emit_span_lint(this, lint, span, decorator);
  }

  fulfill_expectation(expectation: StableLintExpectationId): void {
    LintContext_provided.fulfill_expectation(this, expectation);
  }

  /// The typing mode of the currently visited node. Use this when
  /// building a new `InferCtxt`.
  // rustc: compiler/rustc_lint/src/context.rs:628 typing_mode
  typing_mode(): unknown {
    return unported("rustc_lint::context::LateContext::typing_mode (rustc_middle::ty::TypingMode, M3)");
  }

  // rustc: compiler/rustc_lint/src/context.rs:639 typing_env
  typing_env(): unknown {
    return unported("rustc_lint::context::LateContext::typing_env (rustc_middle::ty::TypingEnv, M3)");
  }

  // rustc: compiler/rustc_lint/src/context.rs:643 type_is_copy_modulo_regions
  type_is_copy_modulo_regions(_ty: unknown): boolean {
    return unported("rustc_middle::ty::TyCtxt::type_is_copy_modulo_regions (M3)");
  }

  // rustc: compiler/rustc_lint/src/context.rs:647 type_is_use_cloned_modulo_regions
  type_is_use_cloned_modulo_regions(_ty: unknown): boolean {
    return unported("rustc_middle::ty::TyCtxt::type_is_use_cloned_modulo_regions (M3)");
  }

  /// Gets the type-checking results for the current body.
  /// As this will ICE if called outside bodies, only call when working with
  /// `Expr` or `Pat` nodes (they are guaranteed to be found only in bodies).
  // #[inline]
  // #[track_caller]
  // rustc: compiler/rustc_lint/src/context.rs:656 typeck_results
  typeck_results_(): unknown {
    if (this.typeck_results === undefined) panic("`LateContext::typeck_results` called outside of body");
    return this.typeck_results;
  }

  /// Returns the final resolution of a `QPath`, or `Res::Err` if unavailable.
  /// Unlike `.typeck_results().qpath_res(qpath, id)`, this can be used even outside
  /// bodies (e.g. for paths in `hir::Ty`), without any risk of ICE-ing.
  // rustc: compiler/rustc_lint/src/context.rs:663 qpath_res
  qpath_res(_qpath: unknown, _id: HirId): unknown {
    return unported("rustc_lint::context::LateContext::qpath_res (hir::QPath, M3)");
  }

  /// Gets the absolute path of `def_id` as a vector of `Symbol`.
  ///
  /// Note that this is kinda expensive because it has to
  /// travel the tree and pretty-print. Use sparingly.
  ///
  /// If you're trying to match for an item given by its path, use a
  /// diagnostic item. If you're only interested in given sections, use more
  /// specific functions, such as [`TyCtxt::crate_name`]
  ///
  /// FIXME: It would be great if this could be optimized.
  // rustc: compiler/rustc_lint/src/context.rs:698 get_def_path
  get_def_path(def_id: DefId): Symbol[] {
    const p = new LintPathPrinter(this.tcx, []);
    p.print_def_path(def_id, []);
    return p.path;
  }

  /// Returns the associated type `name` for `self_ty` as an implementation of `trait_id`.
  /// Do not invoke without first verifying that the type implements the trait.
  // rustc: compiler/rustc_lint/src/context.rs:814 get_associated_type
  get_associated_type(_self_ty: unknown, _trait_id: DefId, _name: Symbol): unknown {
    return unported("rustc_lint::context::LateContext::get_associated_type (tcx.associated_items, M3)");
  }

  /// Returns the effective precedence of an expression for the purpose of
  /// rendering diagnostic. This is not the same as the precedence that would
  /// be used for pretty-printing HIR by rustc_hir_pretty.
  // rustc: compiler/rustc_lint/src/context.rs:833 precedence
  precedence(_expr: unknown): unknown {
    return unported("rustc_lint::context::LateContext::precedence (hir::Expr::precedence, M3)");
  }

  /// If the given expression is a local binding, find the initializer expression.
  /// If that initializer expression is another local binding, find its initializer again.
  ///
  /// This process repeats as long as possible (but usually no more than once).
  /// Type-check adjustments are not taken in account in this function.
  // rustc: compiler/rustc_lint/src/context.rs:858 expr_or_init
  expr_or_init(_expr: unknown): unknown {
    return unported("rustc_lint::context::LateContext::expr_or_init (hir::Expr::peel_blocks, M3)");
  }

  /// If the given expression is a local binding, find the initializer expression.
  /// If that initializer expression is another local or **outside** (`const`/`static`)
  /// binding, find its initializer again.
  ///
  /// This process repeats as long as possible (but usually no more than once).
  /// Type-check adjustments are not taken in account in this function.
  // rustc: compiler/rustc_lint/src/context.rs:904 expr_or_init_with_outside_body
  expr_or_init_with_outside_body(_expr: unknown): unknown {
    return unported("rustc_lint::context::LateContext::expr_or_init_with_outside_body (hir::Expr::peel_blocks, M3)");
  }

  /** `impl HasDataLayout for LateContext` */
  // #[inline]
  // rustc: compiler/rustc_lint/src/context.rs:941 data_layout
  data_layout(): TargetDataLayout {
    return this.tcx.gcx.data_layout;
  }

  /** `impl HasTyCtxt for LateContext` */
  // #[inline]
  // rustc: compiler/rustc_lint/src/context.rs:948 tcx
  tcx_(): TyCtxt {
    return this.tcx;
  }

  /** `impl HasTypingEnv for LateContext` */
  // #[inline]
  // rustc: compiler/rustc_lint/src/context.rs:955 typing_env
  typing_env_(): unknown {
    return this.typing_env();
  }

  /** `impl LayoutOfHelpers for LateContext` */
  // #[inline]
  // rustc: compiler/rustc_lint/src/context.rs:964 handle_layout_err
  handle_layout_err(err: unknown, _: Span, __: unknown): unknown {
    return err;
  }
}

/** `struct LintPathPrinter` local to `LateContext::get_def_path` (`impl Printer`). */
// PORT: the `Printer` trait (rustc_middle::ty::print) is not ported (M3); `print_def_path` is unported.
class LintPathPrinter {
  constructor(
    public tcx: TyCtxt,
    public path: Symbol[],
  ) {}

  /** `Printer::print_def_path` (provided; rustc_middle ty/print/mod.rs). */
  print_def_path(_def_id: DefId, _args: readonly unknown[]): void {
    unported("rustc_middle::ty::print::Printer::print_def_path (M3)");
  }

  // rustc: compiler/rustc_lint/src/context.rs:705 tcx
  tcx_(): TyCtxt {
    return this.tcx;
  }

  // rustc: compiler/rustc_lint/src/context.rs:709 print_region
  print_region(_region: unknown): void {
    unreachable(); // because `print_path_with_generic_args` ignores the `GenericArgs`
  }

  // rustc: compiler/rustc_lint/src/context.rs:713 print_type
  print_type(_ty: unknown): void {
    unreachable(); // because `print_path_with_generic_args` ignores the `GenericArgs`
  }

  // rustc: compiler/rustc_lint/src/context.rs:717 print_dyn_existential
  print_dyn_existential(_predicates: unknown): void {
    unreachable(); // because `print_path_with_generic_args` ignores the `GenericArgs`
  }

  // rustc: compiler/rustc_lint/src/context.rs:724 print_const
  print_const(_ct: unknown): void {
    unreachable(); // because `print_path_with_generic_args` ignores the `GenericArgs`
  }

  // rustc: compiler/rustc_lint/src/context.rs:728 print_crate_name
  print_crate_name(cnum: unknown): void {
    this.path = [this.tcx.crate_name(cnum as CrateNum)];
  }

  // rustc: compiler/rustc_lint/src/context.rs:733 print_path_with_qualified
  print_path_with_qualified(_self_ty: unknown, _trait_ref: unknown): void {
    unported("rustc_lint::context::LintPathPrinter::print_path_with_qualified (ty::Adt, M3)");
  }

  // rustc: compiler/rustc_lint/src/context.rs:754 print_path_with_impl
  print_path_with_impl(print_prefix: (p: LintPathPrinter) => void, _self_ty: unknown, _trait_ref: unknown): void {
    print_prefix(this);
    unported("rustc_lint::context::LintPathPrinter::print_path_with_impl (trait_ref/self_ty printing, M3)");
  }

  // rustc: compiler/rustc_lint/src/context.rs:779 print_path_with_simple
  print_path_with_simple(print_prefix: (p: LintPathPrinter) => void, _disambiguated_data: unknown): void {
    print_prefix(this);
    unported("rustc_lint::context::LintPathPrinter::print_path_with_simple (DefPathData, M3)");
  }

  // rustc: compiler/rustc_lint/src/context.rs:798 print_path_with_generic_args
  print_path_with_generic_args(print_prefix: (p: LintPathPrinter) => void, _args: readonly unknown[]): void {
    print_prefix(this);
  }
}

/// Context for lint checking of the AST, after expansion, before lowering to HIR.
export class EarlyContext implements LintContext<UnstableLintExpectationId> {
  constructor(
    public builder: LintLevelsBuilder<TopDown, UnstableLintExpectationId>,
    public buffered: LintBuffer,
  ) {}

  // rustc: compiler/rustc_lint/src/context.rs:555 new
  static new(
    sess: Session,
    features: Features,
    lint_added_lints: boolean,
    lint_store: LintStore,
    registered_lint_tools: RegisteredTools,
    buffered: LintBuffer,
  ): EarlyContext {
    return new EarlyContext(LintLevelsBuilder.new(sess, features, lint_added_lints, lint_store, registered_lint_tools), buffered);
  }

  /// Gets the overall compiler `Session` object.
  // rustc: compiler/rustc_lint/src/context.rs:607 sess
  sess(): Session {
    return this.builder.sess();
  }

  // rustc: compiler/rustc_lint/src/context.rs:611 opt_span_lint
  opt_span_lint(lint: Lint, span: IntoMultiSpan | undefined, decorator: Diagnostic): void {
    this.builder.opt_span_lint(lint, span === undefined ? undefined : into_MultiSpan(span), decorator);
  }

  // rustc: compiler/rustc_lint/src/context.rs:620 get_lint_level_spec
  get_lint_level_spec(lint: Lint): UnstableLevelSpec {
    return this.builder.lint_level_spec(lint);
  }

  into_lint_expectation_id(id: UnstableLintExpectationId): LintExpectationId {
    return LintExpectationId.Unstable(id);
  }

  emit_span_lint(lint: Lint, span: IntoMultiSpan, decorator: Diagnostic): void {
    LintContext_provided.emit_span_lint(this, lint, span, decorator);
  }

  fulfill_expectation(expectation: UnstableLintExpectationId): void {
    LintContext_provided.fulfill_expectation(this, expectation);
  }
}

export interface LintContext<Id> {
  // type LintExpectationId: Copy + Into<LintExpectationId>;
  /** PORT: the `Into<LintExpectationId>` bound of the associated type. */
  into_lint_expectation_id(id: Id): LintExpectationId;

  // rustc: compiler/rustc_lint/src/context.rs:512 sess
  sess(): Session;

  // FIXME: These methods should not take an Into<MultiSpan> -- instead, callers should need to
  // set the span in their `decorate` function (preferably using set_span).
  /// Emit a lint at the appropriate level, with an optional associated span.
  ///
  /// [`emit_lint_base`]: rustc_middle::lint::emit_lint_base#decorate-signature
  // #[track_caller]
  // rustc: compiler/rustc_lint/src/context.rs:520 opt_span_lint
  opt_span_lint(lint: Lint, span: IntoMultiSpan | undefined, decorate: Diagnostic): void;

  /// Emit a lint at `span` from a lint struct (some type that implements `Diagnostic`,
  /// typically generated by `#[derive(Diagnostic)]`).
  // (provided)
  emit_span_lint(lint: Lint, span: IntoMultiSpan, decorator: Diagnostic): void;

  /// This returns the lint level spec for the given lint at the current location.
  // rustc: compiler/rustc_lint/src/context.rs:540 get_lint_level_spec
  get_lint_level_spec(lint: Lint): LevelSpec<Id>;

  /// This function can be used to manually fulfill an expectation. This can
  /// be used for lints which contain several spans, and should be suppressed,
  /// if either location was marked with an expectation.
  ///
  /// Note that this function should only be called for [`LintExpectationId`]s
  /// retrieved from the current lint pass. Buffered or manually created ids can
  /// cause ICEs.
  // (provided)
  fulfill_expectation(expectation: Id): void;
}

/** The provided methods of `LintContext`. */
export const LintContext_provided = {
  /// Emit a lint at `span` from a lint struct (some type that implements `Diagnostic`,
  /// typically generated by `#[derive(Diagnostic)]`).
  // #[track_caller]
  // rustc: compiler/rustc_lint/src/context.rs:530 emit_span_lint
  emit_span_lint<Id>(self: LintContext<Id>, lint: Lint, span: IntoMultiSpan, decorator: Diagnostic): void {
    self.opt_span_lint(lint, span, decorator);
  },

  // rustc: compiler/rustc_lint/src/context.rs:549 fulfill_expectation
  fulfill_expectation<Id>(self: LintContext<Id>, expectation: Id): void {
    self.sess().dcx().fulfill_expectation(self.into_lint_expectation_id(expectation));
  },
};

/** `#[derive(Debug)]` */
export const debug_TargetLint: Debug<TargetLint> = (v, f) => {
  switch (v.$) {
    case "Id":
      return debug_tuple(f, "Id", [debug_LintId(v._0, f)]);
    case "Renamed":
      return debug_tuple(f, "Renamed", [debug_str(v._0), debug_LintId(v._1, f)]);
    case "Removed":
      return debug_tuple(f, "Removed", [debug_str(v._0)]);
    case "Ignored":
      return "Ignored";
  }
};
