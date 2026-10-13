// Port of compiler/rustc_lint/src/levels.rs: the lint level stack (`#[allow]`/`#[warn]`/`#[deny]`/`#[forbid]`/
// `#[expect]` attributes and `-A`/`-W`/`-D`/`-F`/`--force-warn`), and the diagnostics for unknown, renamed,
// removed and malformed lint names.
//
// PORT: `LintLevelsBuilder<'s, P>` is one class generic over the provider; the methods of the
// `impl LintLevelsBuilder<'_, TopDown>` / `impl LintLevelsBuilder<'_, LintLevelQueryMap>` blocks are typed on
// `this`. The `LevelSpec<P::LintExpectationId>: Into<LevelSpec>` bound is the provider member `into_level_spec`.
// PORT: `fn add(&mut self, attrs: &[impl AttributeExt], ..)` takes the `AttributeExt` impl table as its last
// argument (rustc_ast attr/mod.ts convention). The HIR side (`shallow_lint_levels_on`, `LintLevelQueryMap`'s
// visitor, `skippable_lints`) needs the HIR (M3): those bodies stop at the first missing piece with `unported`.
import { type ast, attr as ast_attr, MetaItemInner } from "../rustc_ast/lib.ts";
import type { AttributeExt } from "../rustc_ast/attr/mod.ts";
import { path_to_string } from "../rustc_ast_pretty/pprust/mod.ts";
import { String_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, IntoDiagArg, type Level as ErrLevel, type MultiSpan, into_MultiSpan, msg } from "../rustc_errors/lib.ts";
import { GateIssue } from "../rustc_feature/lib.ts";
import type { Features } from "../rustc_feature/unstable.ts";
import {
  builtin,
  Level,
  Lint,
  LintId,
  type RegisteredTools,
  type StableLintExpectationId,
  type UnstableLintExpectationId,
} from "../rustc_lint_defs/lib.ts";
import {
  LevelSpec,
  LintExpectation,
  LintLevelSource,
  ShallowLintLevelMap,
  type StableLevelSpec,
  type UnstableLevelSpec,
  emit_lint_base,
  reveal_actual_level_spec,
} from "../rustc_middle/lint.ts";
import type { Providers as QueryProviders } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { add_feature_diagnostics_for_issue } from "../rustc_session/diagnostics.ts";
import { CRATE_HIR_ID, CRATE_OWNER_ID, type HirId, type OwnerId } from "../rustc_hir_id/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import { type AttrId, DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { MISSING_DOCS } from "./builtin.ts";
import { type CheckLintNameResult, LintStore } from "./context.ts";
import {
  CheckNameUnknownTool_diagnostic,
  DeprecatedLintNameFromCommandLine_diagnostic,
  DeprecatedLintName_diagnostic,
  IgnoredUnlessCrateSpecified_diagnostic,
  MalformedAttribute_diagnostic,
  type MalformedAttributeSub,
  OverruledAttributeLint_diagnostic,
  type OverruledAttributeSub,
  OverruledAttribute_diagnostic,
  RemovedLintFromCommandLine_diagnostic,
  RemovedLint_diagnostic,
  RenamedLintFromCommandLine_diagnostic,
  type RenamedLintSuggestion,
  RenamedLint_diagnostic,
  type RequestedLevel,
  UnknownLintFromCommandLine_diagnostic,
  type UnknownLintSuggestion,
  UnknownLint_diagnostic,
  UnknownToolInScopedLint_diagnostic,
  UnsupportedGroup_diagnostic,
} from "./diagnostics.ts";
import { unerased_lint_store } from "./late.ts";

const { FORBIDDEN_LINT_GROUPS, RENAMED_AND_REMOVED_LINTS, SINGLE_USE_LIFETIMES, UNFULFILLED_LINT_EXPECTATIONS, UNKNOWN_LINTS, UNUSED_ATTRIBUTES } = builtin;

/// Collection of lint levels for the whole crate.
/// This is used by AST-based lints, which do not
/// wait until we have built HIR to be emitted.
// #[derive(Debug)]
class LintLevelSets {
  constructor(
    /// Linked list of specifications.
    public list: LintSet[],
  ) {}

  // rustc: compiler/rustc_lint/src/levels.rs:74 new
  static new(): LintLevelSets {
    return new LintLevelSets([]);
  }

  // rustc: compiler/rustc_lint/src/levels.rs:78 get_lint_level_spec
  get_lint_level_spec(
    lint: Lint,
    idx: LintStackIndex,
    aux: Map<LintId, UnstableLevelSpec> | undefined,
    sess: Session,
  ): UnstableLevelSpec {
    return reveal_actual_level_spec(sess, LintId.of(lint), (id) => this.raw_lint_level_spec(id, idx, aux));
  }

  // rustc: compiler/rustc_lint/src/levels.rs:90 raw_lint_level_spec
  raw_lint_level_spec(id: LintId, idx_: LintStackIndex, aux: Map<LintId, UnstableLevelSpec> | undefined): UnstableLevelSpec | undefined {
    let idx = idx_;
    let level_spec: UnstableLevelSpec | undefined;
    if (aux !== undefined && (level_spec = aux.get(id)) !== undefined) {
      return level_spec;
    }

    for (;;) {
      const { specs, parent } = this.list[idx]!;
      if ((level_spec = specs.get(id)) !== undefined) {
        return level_spec;
      }
      if (idx === COMMAND_LINE) {
        return undefined;
      }
      idx = parent;
    }
  }
}

// rustc_index::newtype_index! { struct LintStackIndex { const COMMAND_LINE = 0; } }
type LintStackIndex = number;
const COMMAND_LINE: LintStackIndex = 0;

/// Specifications found at this position in the stack. This map only represents the lints
/// found for one set of attributes (like `shallow_lint_levels_on` does).
///
/// We store the level specifications as a linked list.
/// Each `LintSet` represents a set of attributes on the same AST node.
/// The `parent` forms a linked list that matches the AST tree.
/// This way, walking the linked list is equivalent to walking the AST bottom-up
/// to find the specifications for a given lint.
// #[derive(Debug)]
interface LintSet {
  specs: Map<LintId, UnstableLevelSpec>;
  parent: LintStackIndex;
}

// rustc: compiler/rustc_lint/src/levels.rs:115 skippable_lints
function skippable_lints(tcx: TyCtxt, _: null): Set<LintId> {
  const store = unerased_lint_store(tcx.sess);
  const root_map = tcx.shallow_lint_levels_on(CRATE_OWNER_ID) as ShallowLintLevelMap;

  const skippable = new Set<LintId>();
  for (const lint of store.get_lints()) {
    // Lints that show up in future-compat reports must always be run.
    const has_future_breakage = lint.future_incompatible !== undefined && lint.future_incompatible.report_in_deps;
    if (!(!has_future_breakage && !lint.eval_always)) continue;
    const level_spec = root_map.lint_level_spec_at_node(tcx, LintId.of(lint), CRATE_HIR_ID);
    // Only include lints that are allowed at crate root or by default.
    if (!(level_spec.is_allow() || (level_spec.src.$ === "Default" && Lint.default_level(lint, tcx.sess.edition()) === "Allow"))) continue;
    skippable.add(LintId.of(lint));
  }

  for (const owner of hir_crate_items_owners(tcx)) {
    const map = tcx.shallow_lint_levels_on(owner) as ShallowLintLevelMap;

    // All lints that appear with a non-allow level must be run.
    for (const specs of map.specs.values()) {
      for (const [lint, level_spec] of specs) {
        if (!level_spec.is_allow()) {
          skippable.delete(lint);
        }
      }
    }
  }

  return skippable;
}

/** `tcx.hir_crate_items(()).owners()`. PORT: HIR (M3). */
function hir_crate_items_owners(_tcx: TyCtxt): Iterable<OwnerId> {
  return unported("rustc_middle::hir::TyCtxt::hir_crate_items (HIR, M3)");
}

// #[instrument(level = "trace", skip(tcx), ret)]
// rustc: compiler/rustc_lint/src/levels.rs:156 shallow_lint_levels_on
function shallow_lint_levels_on(tcx: TyCtxt, owner: OwnerId): ShallowLintLevelMap {
  const store = unerased_lint_store(tcx.sess);
  void store;
  void owner;
  // `let attrs = tcx.hir_attr_map(owner);` and the HIR visit below.
  return unported("rustc_lint::levels::shallow_lint_levels_on (tcx.hir_attr_map / hir_owner_node: HIR, M3)");
}

export class TopDown {
  constructor(
    public sets: LintLevelSets,
    public cur: LintStackIndex,
  ) {}

  // rustc: compiler/rustc_lint/src/levels.rs:241 current_specs
  current_specs(): Map<LintId, UnstableLevelSpec> {
    return this.sets.list[this.cur]!.specs;
  }

  // rustc: compiler/rustc_lint/src/levels.rs:245 insert
  insert(id: LintId, level_spec: UnstableLevelSpec): void {
    this.sets.list[this.cur]!.specs.set(id, level_spec);
  }

  // rustc: compiler/rustc_lint/src/levels.rs:249 get_lint_level_spec
  get_lint_level_spec(lint: Lint, sess: Session): UnstableLevelSpec {
    return this.sets.get_lint_level_spec(lint, this.cur, this.current_specs(), sess);
  }

  // rustc: compiler/rustc_lint/src/levels.rs:253 push_expectation
  push_expectation(_: UnstableLintExpectationId, __: LintExpectation): void {}

  // rustc: compiler/rustc_lint/src/levels.rs:255 mk_lint_expectation_id
  mk_lint_expectation_id(attr_id: AttrId, _attr_index: number, lint_index: number): UnstableLintExpectationId {
    return { attr_id, lint_index };
  }

  into_level_spec(level_spec: UnstableLevelSpec): LevelSpec {
    return LevelSpec.from_UnstableLevelSpec(level_spec);
  }
}

export interface LintLevelsProvider<Id> {
  // type LintExpectationId: Copy + Debug + Into<LintExpectationId>;

  // rustc: compiler/rustc_lint/src/levels.rs:218 current_specs
  current_specs(): Map<LintId, LevelSpec<Id>>;

  // rustc: compiler/rustc_lint/src/levels.rs:220 insert
  insert(id: LintId, level_spec: LevelSpec<Id>): void;

  // rustc: compiler/rustc_lint/src/levels.rs:222 get_lint_level_spec
  get_lint_level_spec(lint: Lint, sess: Session): LevelSpec<Id>;

  // rustc: compiler/rustc_lint/src/levels.rs:228 push_expectation
  push_expectation(id: Id, expectation: LintExpectation): void;

  // rustc: compiler/rustc_lint/src/levels.rs:230 mk_lint_expectation_id
  mk_lint_expectation_id(attr_id: AttrId, attr_index: number, lint_index: number): Id;

  /** PORT: `LevelSpec<Self::LintExpectationId>: Into<LevelSpec>` (lint.rs `From` impls). */
  into_level_spec(level_spec: LevelSpec<Id>): LevelSpec;
}

class LintLevelQueryMap {
  constructor(
    public tcx: TyCtxt,
    public cur: HirId,
    public specs: ShallowLintLevelMap,
    /// Empty hash map to simplify code.
    public empty: Map<LintId, StableLevelSpec>,
    public attrs: unknown,
  ) {}

  // rustc: compiler/rustc_lint/src/levels.rs:277 current_specs
  current_specs(): Map<LintId, StableLevelSpec> {
    return this.specs.specs.get(this.cur.local_id) ?? this.empty;
  }

  // rustc: compiler/rustc_lint/src/levels.rs:281 insert
  insert(id: LintId, level_spec: StableLevelSpec): void {
    let m = this.specs.specs.get(this.cur.local_id);
    if (m === undefined) {
      m = new Map();
      this.specs.specs.set(this.cur.local_id, m);
    }
    m.set(id, level_spec);
  }

  // rustc: compiler/rustc_lint/src/levels.rs:285 get_lint_level_spec
  get_lint_level_spec(lint: Lint, _: Session): StableLevelSpec {
    return this.specs.lint_level_spec_at_node(this.tcx, LintId.of(lint), this.cur);
  }

  // rustc: compiler/rustc_lint/src/levels.rs:289 push_expectation
  push_expectation(id: StableLintExpectationId, expectation: LintExpectation): void {
    this.specs.expectations.push([id, expectation]);
  }

  // rustc: compiler/rustc_lint/src/levels.rs:293 mk_lint_expectation_id
  mk_lint_expectation_id(_attr_id: AttrId, attr_index_: number, lint_index: number): StableLintExpectationId {
    // `attr_index.try_into().unwrap()` (usize -> u16)
    if (attr_index_ > 0xffff) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
    const attr_index = attr_index_;
    return { hir_id: this.cur, attr_index, lint_index };
  }

  into_level_spec(level_spec: StableLevelSpec): LevelSpec {
    return LevelSpec.from_StableLevelSpec(level_spec);
  }
}

export class LintLevelsBuilder<P extends LintLevelsProvider<Id>, Id> {
  constructor(
    private sess_: Session,
    private features_: Features,
    public provider: P,
    private lint_added_lints: boolean,
    private store: LintStore,
    private registered_lint_tools: RegisteredTools,
  ) {}

  // ---- impl<'tcx> LintLevelsBuilder<'_, LintLevelQueryMap<'tcx>> ----

  // rustc: compiler/rustc_lint/src/levels.rs:305 add_id
  add_id(this: LintLevelsBuilder<LintLevelQueryMap, StableLintExpectationId>, hir_id: HirId): void {
    this.provider.cur = hir_id;
    void hir_id;
    // `self.add(self.provider.attrs.get(hir_id.local_id), hir_id == hir::CRATE_HIR_ID)`
    unported("rustc_lint::levels::LintLevelsBuilder::add_id (hir::AttributeMap / AttributeExt for hir attributes, M3)");
  }

  // ---- impl<'tcx> Visitor<'tcx> for LintLevelsBuilder<'_, LintLevelQueryMap<'tcx>> ----
  // PORT: rustc_hir::intravisit is not ported (M3); every visit method records the node's attributes (`add_id`)
  // and would then walk it.

  // rustc: compiler/rustc_lint/src/levels.rs:314 maybe_tcx
  maybe_tcx(this: LintLevelsBuilder<LintLevelQueryMap, StableLintExpectationId>): TyCtxt {
    return this.provider.tcx;
  }

  // rustc: compiler/rustc_lint/src/levels.rs:318 visit_param
  visit_param(_param: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_param (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:323 visit_item
  visit_item(_it: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_item (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:328 visit_foreign_item
  visit_foreign_item(_it: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_foreign_item (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:333 visit_stmt
  visit_stmt(_s: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_stmt (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:338 visit_expr
  visit_expr(_e: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_expr (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:343 visit_pat_field
  visit_pat_field(_f: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_pat_field (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:348 visit_expr_field
  visit_expr_field(_f: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_expr_field (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:353 visit_field_def
  visit_field_def(_s: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_field_def (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:358 visit_variant
  visit_variant(_v: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_variant (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:363 visit_local
  visit_local(_l: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_local (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:368 visit_arm
  visit_arm(_a: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_arm (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:373 visit_trait_item
  visit_trait_item(_trait_item: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_trait_item (hir intravisit, M3)");
  }

  // rustc: compiler/rustc_lint/src/levels.rs:378 visit_impl_item
  visit_impl_item(_impl_item: unknown): void {
    unported("rustc_lint::levels::LintLevelsBuilder::visit_impl_item (hir intravisit, M3)");
  }

  // ---- impl<'s> LintLevelsBuilder<'s, TopDown> ----

  // rustc: compiler/rustc_lint/src/levels.rs:398 new
  static new(
    sess: Session,
    features: Features,
    lint_added_lints: boolean,
    store: LintStore,
    registered_lint_tools: RegisteredTools,
  ): LintLevelsBuilder<TopDown, UnstableLintExpectationId> {
    const builder = new LintLevelsBuilder<TopDown, UnstableLintExpectationId>(
      sess,
      features,
      new TopDown(LintLevelSets.new(), COMMAND_LINE),
      lint_added_lints,
      store,
      registered_lint_tools,
    );
    builder.process_command_line();
    assert(builder.provider.sets.list.length === 1, "assertion `left == right` failed\n  left: " + builder.provider.sets.list.length + "\n right: 1");
    return builder;
  }

  // rustc: compiler/rustc_lint/src/levels.rs:418 crate_root
  static crate_root(
    sess: Session,
    features: Features,
    lint_added_lints: boolean,
    store: LintStore,
    registered_lint_tools: RegisteredTools,
    crate_attrs: readonly ast.Attribute[],
  ): LintLevelsBuilder<TopDown, UnstableLintExpectationId> {
    const builder = LintLevelsBuilder.new(sess, features, lint_added_lints, store, registered_lint_tools);
    builder.add(crate_attrs, true, ast_attr.AttributeExt.Attribute);
    return builder;
  }

  // rustc: compiler/rustc_lint/src/levels.rs:431 process_command_line
  private process_command_line(this: LintLevelsBuilder<TopDown, UnstableLintExpectationId>): void {
    this.provider.cur = this.provider.sets.list.push({ specs: new Map(), parent: COMMAND_LINE }) - 1;
    this.add_command_line();
  }

  /// Pushes a list of AST lint attributes onto this context.
  ///
  /// This function will return a `BuilderPush` object which should be passed
  /// to `pop` when this scope for the attributes provided is exited.
  ///
  /// This function will perform a number of tasks:
  ///
  /// * It'll validate all lint-related attributes in `attrs`
  /// * It'll mark all lint-related attributes as used
  /// * Lint levels will be updated based on the attributes provided
  /// * Lint attributes are validated, e.g., a `#[forbid]` can't be switched to
  ///   `#[allow]`
  ///
  /// Don't forget to call `pop`!
  // rustc: compiler/rustc_lint/src/levels.rs:454 push
  push(this: LintLevelsBuilder<TopDown, UnstableLintExpectationId>, attrs: readonly ast.Attribute[], is_crate_node: boolean): BuilderPush {
    const prev = this.provider.cur;
    this.provider.cur = this.provider.sets.list.push({ specs: new Map(), parent: prev }) - 1;

    this.add(attrs, is_crate_node, ast_attr.AttributeExt.Attribute);

    if (this.provider.current_specs().size === 0) {
      this.provider.sets.list.pop();
      this.provider.cur = prev;
    }

    return new BuilderPush(prev);
  }

  /// Called after `push` when the scope of a set of attributes are exited.
  // rustc: compiler/rustc_lint/src/levels.rs:470 pop
  pop(this: LintLevelsBuilder<TopDown, UnstableLintExpectationId>, push: BuilderPush): void {
    this.provider.cur = push.prev;
    // std::mem::forget(push);
  }

  // ---- impl<'s, P: LintLevelsProvider> LintLevelsBuilder<'s, P> ----

  // rustc: compiler/rustc_lint/src/levels.rs:487 sess
  sess(): Session {
    return this.sess_;
  }

  // rustc: compiler/rustc_lint/src/levels.rs:491 features
  features(): Features {
    return this.features_;
  }

  // rustc: compiler/rustc_lint/src/levels.rs:495 add_command_line
  private add_command_line(): void {
    for (const [lint_name, level] of this.sess_.opts.lint_opts) {
      // Checks the validity of lint names derived from the command line.
      const [tool_name, lint_name_only] = parse_lint_and_tool_name(lint_name);
      if (lint_name_only === Lint.name_lower(builtin.WARNINGS) && level === "ForceWarn") {
        this.sess_.dcx().emit_err(UnsupportedGroup_diagnostic({ lint_group: Lint.name_lower(builtin.WARNINGS) }));
      }
      const r: CheckLintNameResult = this.store.check_lint_name(lint_name_only, tool_name, this.registered_lint_tools);
      switch (r.$) {
        case "Renamed": {
          const replace = r._0;
          const name = lint_name;
          const suggestion: RenamedLintSuggestion = { $: "WithoutSpan", replace };
          const requested_level: RequestedLevel = { level, lint_name };
          const lint = RenamedLintFromCommandLine_diagnostic({ name, replace, suggestion, requested_level });
          this.emit_lint(RENAMED_AND_REMOVED_LINTS, lint);
          break;
        }
        case "Removed": {
          const reason = r._0;
          const name = lint_name;
          const requested_level: RequestedLevel = { level, lint_name };
          const lint = RemovedLintFromCommandLine_diagnostic({ name, reason, requested_level });
          this.emit_lint(RENAMED_AND_REMOVED_LINTS, lint);
          break;
        }
        case "NoLint": {
          const name = lint_name;
          const suggestion: UnknownLintSuggestion | undefined =
            r._0 === undefined ? undefined : { $: "WithoutSpan", replace: r._0[0], from_rustc: r._0[1] };
          const requested_level: RequestedLevel = { level, lint_name };
          const lint = UnknownLintFromCommandLine_diagnostic({ name, suggestion, requested_level });
          this.emit_lint(UNKNOWN_LINTS, lint);
          break;
        }
        case "Tool": {
          if (r._1 === undefined) break;
          const replace = r._1;
          const name = lint_name;
          const requested_level: RequestedLevel = { level, lint_name };
          const lint = DeprecatedLintNameFromCommandLine_diagnostic({ name, replace, requested_level });
          this.emit_lint(RENAMED_AND_REMOVED_LINTS, lint);
          break;
        }
        case "NoTool": {
          if (tool_name === undefined) panic("called `Option::unwrap()` on a `None` value");
          this.sess_.dcx().emit_err(
            CheckNameUnknownTool_diagnostic({
              tool_name,
              sub: { level, lint_name },
            }),
          );
          break;
        }
        default:
          break;
      }

      const lint_flag_val = Symbol.intern(lint_name);

      const ids = this.store.find_lints(lint_name);
      if (ids === undefined) {
        // errors already handled above
        continue;
      }
      for (const id of ids) {
        // ForceWarn and Forbid cannot be overridden
        const level_spec = this.provider.current_specs().get(id);
        if (level_spec !== undefined && (level_spec.level_() === "ForceWarn" || level_spec.level_() === "Forbid")) {
          continue;
        }

        if (this.check_gated_lint(id, DUMMY_SP, true)) {
          const src: LintLevelSource = { $: "CommandLine", _0: lint_flag_val, _1: level };
          this.provider.insert(id, LevelSpec.new<Id>(level, undefined, src));
        }
      }
    }
  }

  /// Attempts to insert the `id` to `LevelSpec` map entry. If unsuccessful
  /// (e.g. if a forbid was already inserted on the same scope), then emits a
  /// diagnostic with no change to `specs`.
  // rustc: compiler/rustc_lint/src/levels.rs:569 insert_spec
  private insert_spec(id: LintId, level_spec: LevelSpec<Id>): void {
    const level = level_spec.level_();
    const lint_id = level_spec.lint_id_();
    const src = level_spec.src;

    const old_level_spec = this.provider.get_lint_level_spec(id.lint, this.sess_);
    const old_level = old_level_spec.level_();
    const old_src = old_level_spec.src;

    // Setting to a non-forbid level is an error if the lint previously had
    // a forbid level. Note that this is not necessarily true even with a
    // `#[forbid(..)]` attribute present, as that is overridden by `--cap-lints`.
    //
    // This means that this only errors if we're truly lowering the lint
    // level from forbid.
    if (this.lint_added_lints && level === "Deny" && old_level === "Forbid") {
      // Having a deny inside a forbid is fine and is ignored, so we skip this check.
      return;
    } else if (this.lint_added_lints && level !== "Forbid" && old_level === "Forbid") {
      // Backwards compatibility check:
      //
      // We used to not consider `forbid(lint_group)`
      // as preventing `allow(lint)` for some lint `lint` in
      // `lint_group`. For now, issue a future-compatibility
      // warning for this case.
      let fcw_warning: boolean;
      switch (old_src.$) {
        case "Default":
          fcw_warning = false;
          break;
        case "Node":
          fcw_warning = this.store.is_lint_group(old_src.name);
          break;
        case "CommandLine":
          fcw_warning = this.store.is_lint_group(old_src._0);
          break;
      }
      // debug!("fcw_warning={:?}, specs.get(&id) = {:?}, old_src={:?}, id_name={:?}", ..);
      let sub: OverruledAttributeSub;
      switch (old_src.$) {
        case "Default":
          sub = { $: "DefaultSource", id: LintId.to_string(id) };
          break;
        case "Node":
          sub = { $: "NodeSource", span: old_src.span, reason: old_src.reason };
          break;
        case "CommandLine":
          sub = { $: "CommandLineSource", id: old_src._0 };
          break;
      }
      if (!fcw_warning) {
        this.sess_.dcx().emit_err(
          OverruledAttribute_diagnostic({
            span: LintLevelSource.span(src),
            overruled: LintLevelSource.span(src),
            lint_level: Level.as_str(level),
            lint_source: LintLevelSource.name(src),
            sub,
          }),
        );
      } else {
        this.emit_span_lint(
          FORBIDDEN_LINT_GROUPS,
          into_MultiSpan(LintLevelSource.span(src)),
          OverruledAttributeLint_diagnostic({
            overruled: LintLevelSource.span(src),
            lint_level: Level.as_str(level),
            lint_source: LintLevelSource.name(src),
            sub,
          }),
        );
      }

      // Retain the forbid lint level, unless we are
      // issuing a FCW. In the FCW case, we want to
      // respect the new setting.
      if (!fcw_warning) {
        return;
      }
    }

    // The lint `unfulfilled_lint_expectations` can't be expected, as it would suppress itself.
    // Handling expectations of this lint would add additional complexity with little to no
    // benefit. The expect level for this lint will therefore be ignored.
    if (level === "Expect" && id === LintId.of(UNFULFILLED_LINT_EXPECTATIONS)) {
      return;
    }

    if (old_level === "ForceWarn" && level === "Expect") {
      // If the new level is an expectation store it in `ForceWarn`
      this.provider.insert(id, LevelSpec.new<Id>("ForceWarn", lint_id, old_src));
    } else if (old_level === "ForceWarn") {
      // Keep `ForceWarn` level but drop the expectation
      this.provider.insert(id, LevelSpec.new<Id>("ForceWarn", undefined, old_src));
    } else {
      // Set the lint level as normal
      this.provider.insert(id, LevelSpec.new<Id>(level, lint_id, src));
    }
  }

  // rustc: compiler/rustc_lint/src/levels.rs:669 add
  add<A>(attrs: readonly A[], is_crate_node: boolean, AE: AttributeExt<A>): void {
    const sess = this.sess_;
    for (let attr_index = 0; attr_index < attrs.length; attr_index++) {
      const attr = attrs[attr_index]!;
      if (AE.is_automatically_derived_attr(attr)) {
        this.provider.insert(LintId.of(SINGLE_USE_LIFETIMES), LevelSpec.new<Id>("Allow", undefined, LintLevelSource.Default));
        continue;
      }

      // `#[doc(hidden)]` disables missing_docs check.
      if (AE.is_doc_hidden(attr)) {
        this.provider.insert(LintId.of(MISSING_DOCS), LevelSpec.new<Id>("Allow", undefined, LintLevelSource.Default));
        continue;
      }

      const level = Level.from_opt_symbol(AE.name(attr));
      if (level === undefined) continue;

      const metas = AE.meta_item_list(attr);
      if (metas === undefined) continue;

      // Check whether `metas` is empty, and get its last element.
      const tail_li = metas[metas.length - 1];
      if (tail_li === undefined) {
        // This emits the unused_attributes lint for `#[level()]`
        continue;
      }

      // Before processing the lint names, look for a reason (RFC 2383)
      // at the end.
      let reason: Symbol | undefined = undefined;
      const item = MetaItemInner.meta_item(tail_li);
      if (item !== undefined) {
        const kind = item.kind;
        switch (kind.$) {
          case "Word":
            break; // actual lint names handled later
          case "NameValue": {
            const name_value = kind._0;
            if (item.path.eq_Symbol(sym.reason)) {
              if (name_value.kind.$ === "Str") {
                const rationale = name_value.kind._0;
                reason = rationale;
              } else {
                sess.dcx().emit_err(
                  MalformedAttribute_diagnostic({
                    span: name_value.span,
                    sub: { $: "ReasonMustBeStringLiteral", _0: name_value.span },
                  }),
                );
              }
              // found reason, reslice meta list to exclude it
              metas.pop();
            } else {
              sess.dcx().emit_err(
                MalformedAttribute_diagnostic({
                  span: item.span,
                  sub: { $: "BadAttributeArgument", _0: item.span },
                }),
              );
            }
            break;
          }
          case "List": {
            sess.dcx().emit_err(
              MalformedAttribute_diagnostic({
                span: item.span,
                sub: { $: "BadAttributeArgument", _0: item.span },
              }),
            );
            break;
          }
        }
      }

      for (let lint_index = 0; lint_index < metas.length; lint_index++) {
        const li = metas[lint_index]!;
        // `Expect` is the only lint level with a `LintExpectationId` that can be created
        // from an attribute.
        const lint_id = level === "Expect" ? this.provider.mk_lint_expectation_id(AE.id(attr), attr_index, lint_index & 0xffff) : undefined;

        const sp = MetaItemInner.span(li);
        let meta_item: ast.MetaItem;
        if (li.$ === "MetaItem" && li._0.is_word()) {
          meta_item = li._0;
        } else {
          let sub: MalformedAttributeSub;
          const item = MetaItemInner.meta_item(li);
          if (item !== undefined && item.kind.$ === "NameValue" && item.path.eq_Symbol(sym.reason)) {
            sub = { $: "ReasonMustComeLast", _0: sp };
          } else {
            sub = { $: "BadAttributeArgument", _0: sp };
          }

          sess.dcx().emit_err(MalformedAttribute_diagnostic({ span: sp, sub }));
          continue;
        }
        const tool_ident = meta_item.path.segments.length > 1 ? meta_item.path.segments.shift()!.ident : undefined;
        const tool_name = tool_ident?.name;
        const name = path_to_string(meta_item.path);
        const lint_result = this.store.check_lint_name(name, tool_name, this.registered_lint_tools);

        let ids: readonly LintId[];
        let name_: Symbol;
        switch (lint_result.$) {
          case "Ok": {
            ids = lint_result._0;
            const last = meta_item.path.segments[meta_item.path.segments.length - 1];
            if (last === undefined) panic("empty lint name");
            name_ = last.ident.name;
            break;
          }

          case "Tool": {
            ids = lint_result._0;
            const new_lint_name = lint_result._1;
            if (new_lint_name === undefined) {
              const complete_name = `${Symbol.as_str(tool_ident!.name)}::${name}`;
              name_ = Symbol.intern(complete_name);
            } else {
              this.emit_span_lint(
                builtin.RENAMED_AND_REMOVED_LINTS,
                into_MultiSpan(sp),
                DeprecatedLintName_diagnostic({
                  name,
                  suggestion: sp,
                  replace: new_lint_name,
                }),
              );
              name_ = Symbol.intern(new_lint_name);
            }
            break;
          }

          case "MissingTool":
            // If `MissingTool` is returned, then either the lint does not
            // exist in the tool or the code was not compiled with the tool and
            // therefore the lint was never added to the `LintStore`. To detect
            // this is the responsibility of the lint tool.
            continue;

          case "NoTool": {
            if (tool_name === undefined) panic("called `Option::unwrap()` on a `None` value");
            sess.dcx().emit_err(
              UnknownToolInScopedLint_diagnostic({
                span: tool_ident?.span,
                tool_name,
                lint_name: path_to_string(meta_item.path),
                is_nightly_build: sess.is_nightly_build(),
              }),
            );
            continue;
          }

          case "Renamed": {
            const replace = lint_result._0;
            if (this.lint_added_lints) {
              const suggestion: RenamedLintSuggestion = { $: "WithSpan", suggestion: sp, replace };
              const name__ = tool_ident !== undefined ? `${Symbol.as_str(tool_ident.name)}::${name}` : name;
              this.emit_span_lint(RENAMED_AND_REMOVED_LINTS, into_MultiSpan(sp), RenamedLint_diagnostic({ name: name__, replace, suggestion }));
            }

            // If this lint was renamed, apply the new lint instead of ignoring the
            // attribute. Ignore any errors or warnings that happen because the new
            // name is inaccurate.
            // NOTE: `new_name` already includes the tool name, so we don't
            // have to add it again.
            const r = this.store.check_lint_name(replace, undefined, this.registered_lint_tools);
            if (r.$ !== "Ok") {
              panic(`renamed lint does not exist: ${replace}`);
            }
            ids = r._0;

            name_ = Symbol.intern(replace);
            break;
          }

          case "Removed": {
            const reason = lint_result._0;
            if (this.lint_added_lints) {
              const name__ = tool_ident !== undefined ? `${Symbol.as_str(tool_ident.name)}::${name}` : name;
              this.emit_span_lint(RENAMED_AND_REMOVED_LINTS, into_MultiSpan(sp), RemovedLint_diagnostic({ name: name__, reason }));
            }
            continue;
          }

          case "NoLint": {
            const suggestion_ = lint_result._0;
            if (this.lint_added_lints) {
              const name__ = tool_ident !== undefined ? `${Symbol.as_str(tool_ident.name)}::${name}` : name;
              const suggestion: UnknownLintSuggestion | undefined =
                suggestion_ === undefined
                  ? undefined
                  : {
                      $: "WithSpan",
                      suggestion: sp,
                      replace: suggestion_[0],
                      from_rustc: suggestion_[1],
                    };
              this.emit_span_lint(UNKNOWN_LINTS, into_MultiSpan(sp), UnknownLint_diagnostic({ name: name__, suggestion }));
            }
            continue;
          }
        }

        const src: LintLevelSource = { $: "Node", name: name_, span: sp, reason };
        for (const id of ids) {
          if (this.check_gated_lint(id, sp, false)) {
            this.insert_spec(id, LevelSpec.new<Id>(level, lint_id, src));
          }
        }

        // This checks for instances where the user writes
        // `#[expect(unfulfilled_lint_expectations)]` in that case we want to avoid
        // overriding the lint level but instead add an expectation that can't be
        // fulfilled. The lint message will include an explanation, that the
        // `unfulfilled_lint_expectations` lint can't be expected.
        if (level === "Expect" && lint_id !== undefined) {
          const expect_id = lint_id;
          // The `unfulfilled_lint_expectations` lint is not part of any lint
          // groups. Therefore. we only need to check the slice if it contains a
          // single lint.
          const is_unfulfilled_lint_expectations = ids.length === 1 ? ids[0] === LintId.of(UNFULFILLED_LINT_EXPECTATIONS) : false;
          this.provider.push_expectation(expect_id, LintExpectation.new(reason, sp, is_unfulfilled_lint_expectations, tool_name));
        }
      }
    }

    if (this.lint_added_lints && !is_crate_node) {
      for (const [id, level_spec] of this.provider.current_specs()) {
        if (!id.lint.crate_level_only) {
          continue;
        }

        if (level_spec.src.$ !== "Node") {
          continue;
        }
        const lint_attr_name = level_spec.src.name;
        const lint_attr_span = level_spec.src.span;

        this.emit_span_lint(
          UNUSED_ATTRIBUTES,
          into_MultiSpan(lint_attr_span),
          IgnoredUnlessCrateSpecified_diagnostic({
            level: Level.as_str(level_spec.level_()),
            name: lint_attr_name,
          }),
        );
        // don't set a separate error for every lint in the group
        break;
      }
    }
  }

  /// Checks if the lint is gated on a feature that is not enabled.
  ///
  /// Returns `true` if the lint's feature is enabled.
  // #[track_caller]
  // rustc: compiler/rustc_lint/src/levels.rs:944 check_gated_lint
  private check_gated_lint(lint_id: LintId, span: Span, lint_from_cli: boolean): boolean {
    let feature: Symbol;
    const f = lint_id.lint.feature_gate;
    if (f !== undefined && !this.features_.enabled(f) && !Span.allows_unstable(span, f)) {
      // Lint is behind a feature that is not enabled; eventually return false.
      feature = f;
    } else {
      // Lint is ungated or its feature is enabled; exit early.
      return true;
    }

    if (this.lint_added_lints) {
      const lint = builtin.UNKNOWN_LINTS;
      const level_spec = this.lint_level_spec(builtin.UNKNOWN_LINTS);
      emit_lint_base(
        this.sess_,
        lint,
        this.provider.into_level_spec(level_spec),
        into_MultiSpan(span),
        UnknownLint_check_gated_lint_diagnostic({ sess: this.sess_, lint_id, feature, lint_from_cli }),
      );
    }

    return false;
  }

  /// Find the lint level for a lint.
  // rustc: compiler/rustc_lint/src/levels.rs:1001 lint_level_spec
  lint_level_spec(lint: Lint): LevelSpec<Id> {
    return this.provider.get_lint_level_spec(lint, this.sess_);
  }

  /// Used to emit a lint-related diagnostic based on the current state of
  /// this lint context.
  // #[track_caller]
  // rustc: compiler/rustc_lint/src/levels.rs:1008 opt_span_lint
  opt_span_lint(lint: Lint, span: MultiSpan | undefined, decorator: Diagnostic): void {
    const level_spec = this.lint_level_spec(lint);
    emit_lint_base(this.sess_, lint, this.provider.into_level_spec(level_spec), span, decorator);
  }

  // #[track_caller]
  // rustc: compiler/rustc_lint/src/levels.rs:1019 emit_span_lint
  emit_span_lint(lint: Lint, span: MultiSpan, decorator: Diagnostic): void {
    const level_spec = this.lint_level_spec(lint);
    emit_lint_base(this.sess_, lint, this.provider.into_level_spec(level_spec), span, decorator);
  }

  // #[track_caller]
  // rustc: compiler/rustc_lint/src/levels.rs:1030 emit_lint
  emit_lint(lint: Lint, decorator: Diagnostic): void {
    const level_spec = this.lint_level_spec(lint);
    emit_lint_base(this.sess_, lint, this.provider.into_level_spec(level_spec), undefined, decorator);
  }
}

export class BuilderPush {
  constructor(public prev: LintStackIndex) {}

  /** `#[cfg(debug_assertions)] impl Drop for BuilderPush`. PORT: JS has no destructors; `pop` forgets the push. */
  // rustc: compiler/rustc_lint/src/levels.rs:478 drop
  drop(): void {
    panic("Found a `push` without a `pop`.");
  }
}

/** `struct UnknownLint<'a>` local to `check_gated_lint`. */
interface UnknownLint_check_gated_lint {
  sess: Session;
  lint_id: LintId;
  feature: Symbol;
  lint_from_cli: boolean;
}

/** `impl<'a, 'b> Diagnostic<'a> for UnknownLint<'b>` (local to `check_gated_lint`) */
// rustc: compiler/rustc_lint/src/levels.rs:964 into_diag
function UnknownLint_check_gated_lint_into_diag(self: UnknownLint_check_gated_lint, dcx: DiagCtxtHandle, level: ErrLevel): Diag {
  const { sess, lint_id, feature, lint_from_cli } = self;
  const lint = Diag.new(dcx, level, msg("unknown lint: `{$name}`"))
    .with_arg("name", IntoDiagArg.of(Lint.name_lower(lint_id.lint), String_into_diag_arg))
    .with_note(msg("the `{$name}` lint is unstable"));
  // `staged_api` is only intended for the standard library, so don't
  // suggest enabling it just to use this lint.
  if (feature !== sym.staged_api) {
    add_feature_diagnostics_for_issue(lint, sess, feature, GateIssue.Language, lint_from_cli, undefined);
  }
  return lint;
}
function UnknownLint_check_gated_lint_diagnostic(self: UnknownLint_check_gated_lint): Diagnostic {
  return { into_diag: (dcx, level) => UnknownLint_check_gated_lint_into_diag(self, dcx, level) };
}

// rustc: compiler/rustc_lint/src/levels.rs:1036 provide
export function provide(providers: QueryProviders): void {
  providers.shallow_lint_levels_on = shallow_lint_levels_on as QueryProviders["shallow_lint_levels_on"];
  providers.skippable_lints = skippable_lints;
}

// rustc: compiler/rustc_lint/src/levels.rs:1040 parse_lint_and_tool_name
export function parse_lint_and_tool_name(lint_name: string): [Symbol | undefined, string] {
  const i = lint_name.indexOf("::");
  if (i >= 0) {
    const tool_name_ = lint_name.slice(0, i);
    const lint_name_ = lint_name.slice(i + 2);
    const tool_name = Symbol.intern(tool_name_);

    return [tool_name, lint_name_];
  } else {
    return [undefined, lint_name];
  }
}

