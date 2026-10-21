// Port of compiler/rustc_passes/src/dead.rs (lane passes-dead).
//
// PORT notes:
// - `MarkSymbolVisitor` extends rustc_hir intravisit's `Visitor` with `type Result = ControlFlow<ErrorGuaranteed>`
//   (`override Result = VisitorResult.ControlFlow<ErrorGuaranteed>()`); `?` on a `ControlFlow` is
//   `if (r.$ === "Break") return r;`. `DeadVisitor` is a plain class (no `Visitor` impl upstream).
// - `LocalDefIdSet` (`live_symbols`, membership and clones only) is a `Set<LocalDefId>`; `scanned`
//   (`FxHashSet<(LocalDefId, ComesFromAllowExpect)>`, membership only) a `Set<number>` keyed by `scanned_key`.
//   `LocalDefIdMap<FxIndexSet<DefId>>` (`ignored_derived_traits`: looked up by key, the inner set iterated in insertion
//   order) is a `Map<LocalDefId, DefIdSet>`. The `unsolved_map` of `mark_live_symbols_and_ignored_derived_traits` is
//   iterated (`extract_if`, `into_values`), so it is a rust_ts `FxHashMap` (hashbrown bucket order).
// - `DeadCodeLivenessSnapshot` / `DeadCodeLivenessSummary` (rustc_middle middle/dead_code.rs, two data-only structs not
//   ported yet) are declared here; the `live_symbols_and_ignored_derived_traits` query value is
//   `Result<unknown, ErrorGuaranteed>` in queries.gen.ts.
// - `tcx.emit_node_span_lint(.., diag)` takes the `#[derive(Diagnostic)]` value as a `Diagnostic` object
//   (`X_diagnostic(..)` of diagnostics.gen.ts).
// This implements the dead-code warning pass.
// All reachable symbols are live, code called from live code is live, code with certain lint
// expectations such as `#[expect(unused)]` and `#[expect(dead_code)]` is live, and everything else
// is dead.

import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { MultiSpan } from "../rustc_error_messages/lib.ts";
import { MultiSpan as MultiSpanC } from "../rustc_error_messages/lib.ts";
import { DiagSymbolList_from } from "../rustc_errors/diagnostic_impls.ts";
import { DefKind, Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { Node, VariantData } from "../rustc_hir/hir.ts";
import {
  Visitor,
  walk_anon_const,
  walk_arm,
  walk_expr,
  walk_foreign_item,
  walk_impl_item,
  walk_inline_const,
  walk_item,
  walk_opaque_ty,
  walk_pat,
  walk_pat_expr,
  walk_path,
  walk_struct_def,
  walk_trait_item,
  walk_trait_ref,
} from "../rustc_hir/intravisit.ts";
import "../rustc_hir/pat_util.ts";
import { type HirId, HirId_eq, type OwnerId } from "../rustc_hir_id/lib.ts";
import { DEAD_CODE, DEAD_CODE_PUB_IN_BINARY } from "../rustc_lint_defs/builtin.gen.ts";
import { type Level, Level_discriminant, type Lint, LintExpectationId, type StableLintExpectationId } from "../rustc_lint_defs/lib.ts";
import { CodegenFnAttrFlags, CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import { MainDefinition } from "../rustc_middle/middle/resolve.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AdtDef, BodyId as MiddleBodyId, TypeckResults } from "../rustc_middle/ty/decls.ts";
import { AssocItems } from "../rustc_middle/ty/assoc.ts";
import { type FieldDef, HasAttrs_DefId, HasAttrs_LocalDefId, type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { type DefId, DefId_eq, DefIdSet, LocalDefId, LocalModId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { kw, Symbol } from "../rustc_span/symbol.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { TraitRef } from "../rustc_type_ir/predicate.ts";
import { debug_TyKind } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { ControlFlow, VisitorResult } from "../rustc_ast_ir/visit.ts";
import { FxHashMap, type Layout as RustLayout, u32_key } from "../rust_ts/hash_map.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import {
  type ChangeFields,
  type DeadCodePubInBinaryNote,
  type EnumVariantSameName,
  type IgnoredDerivedImpls,
  type MultipleDeadCodes,
  MultipleDeadCodes_diagnostic,
  type ParentInfo,
  UselessAssignment_diagnostic,
} from "./diagnostics.ts";

// ---- rustc_middle::middle::dead_code (not ported yet; see the header) ----

/// A single snapshot of dead-code liveness analysis state.
// rustc-type: compiler/rustc_middle/src/middle/dead_code.rs:6 DeadCodeLivenessSnapshot
export interface DeadCodeLivenessSnapshot {
  live_symbols: Set<LocalDefId>;
  /// Maps each ADT to derived traits (for example `Debug` and `Clone`) that should be ignored
  /// when checking for dead code diagnostics.
  ignored_derived_traits: Map<LocalDefId, DefIdSet>;
}

/// Dead-code liveness data for both analysis phases.
///
/// `pre_deferred_seeding` is computed before reachable-public and `#[allow(dead_code)]` seeding,
/// and is used for lint `dead_code_pub_in_binary`.
/// `final_result` is the final liveness snapshot used for lint `dead_code`.
// rustc-type: compiler/rustc_middle/src/middle/dead_code.rs:20 DeadCodeLivenessSummary
export interface DeadCodeLivenessSummary {
  pre_deferred_seeding: DeadCodeLivenessSnapshot;
  final_result: DeadCodeLivenessSnapshot;
}

/** `LocalDefIdMap<FxIndexSet<DefId>>::clone()` (the inner sets are copied). */
function clone_ignored_derived_traits(m: Map<LocalDefId, DefIdSet>): Map<LocalDefId, DefIdSet> {
  return new Map([...m].map(([k, v]) => [k, new DefIdSet(v)]));
}

/** `size_of::<(LocalDefId, Vec<LocalDefId>)>()` / align: the `unsolved_map` value layout (a `Vec`: 24 bytes). */
const LAYOUT_VEC: RustLayout = { size: 24, align: 8 };

/// Any local definition that may call something in its body block should be explored. For example,
/// if it's a live function, then we should explore its block to check for codes that may need to
/// be marked as live.
// rustc: compiler/rustc_passes/src/dead.rs:37 should_explore
function should_explore(tcx: TyCtxt, def_id: LocalDefId): boolean {
  const dk = tcx.def_kind(def_id);
  switch (dk.$) {
    case "Mod":
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Trait":
    case "TyAlias":
    case "ForeignTy":
    case "TraitAlias":
    case "AssocTy":
    case "Fn":
    case "Const":
    case "Static":
    case "AssocFn":
    case "AssocConst":
    case "Macro":
    case "GlobalAsm":
    case "Impl":
    case "OpaqueTy":
    case "AnonConst":
    case "ExternCrate":
    case "Use":
    case "Ctor":
    case "ForeignMod":
      return true;

    case "TyParam":
    case "ConstParam":
    case "Field":
    case "LifetimeParam":
    case "Closure":
    case "SyntheticCoroutineBody":
    case "TestBinderConstraints":
      return false;
  }
}

/// Determine if a work from the worklist is coming from a `#[allow]`
/// or a `#[expect]` of `dead_code`
// #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
// rustc-type: compiler/rustc_passes/src/dead.rs:77 ComesFromAllowExpect
type ComesFromAllowExpect = "Yes" | "No";

/// Carries both the propagated `allow/expect` context and the current item's
/// own `allow/expect` status.
///
/// For example:
///
/// ```rust
/// #[expect(dead_code)]
/// fn root() { middle() }
///
/// fn middle() { leaf() }
///
/// #[expect(dead_code)]
/// fn leaf() {}
/// ```
///
/// The seed for `root` starts as `propagated = Yes, own = Yes`.
///
/// When `root` reaches `middle`, the propagated context stays `Yes`, but
/// `middle` itself does not have `#[allow(dead_code)]` or `#[expect(dead_code)]`,
/// so its work item becomes `propagated = Yes, own = No`.
///
/// When `middle` reaches `leaf`, that same propagated `Yes` context is preserved,
/// and since `leaf` itself has `#[expect(dead_code)]`, its work item becomes
/// `propagated = Yes, own = Yes`.
///
/// In general, `propagated` controls whether descendants are still explored
/// under an `allow/expect` context, while `own` controls whether the current
/// item itself should be excluded from `live_symbols`.
// #[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
// rustc-type: compiler/rustc_passes/src/dead.rs:111 WorkItem
interface WorkItem {
  id: LocalDefId;
  propagated: ComesFromAllowExpect;
  own: ComesFromAllowExpect;
}

// rustc-type: compiler/rustc_passes/src/dead.rs:117 ImplItemCheckResult
type ImplItemCheckResult = { readonly $: "Live"; _0: ComesFromAllowExpect } | { readonly $: "Dead"; require: LocalDefId };

/** The `scanned` set's key of `(LocalDefId, ComesFromAllowExpect)`. */
function scanned_key(id: LocalDefId, c: ComesFromAllowExpect): number {
  return id * 2 + (c === "Yes" ? 1 : 0);
}

// rustc-type: compiler/rustc_passes/src/dead.rs:122 MarkSymbolVisitor
class MarkSymbolVisitor extends Visitor<ControlFlow<ErrorGuaranteed>> {
  // impl<'tcx> Visitor<'tcx> for MarkSymbolVisitor<'tcx>: type Result = ControlFlow<ErrorGuaranteed>;
  override Result = VisitorResult.ControlFlow<ErrorGuaranteed>();

  constructor(
    public worklist: WorkItem[],
    readonly tcx: TyCtxt,
    public maybe_typeck_results: TypeckResults | undefined,
    public scanned: Set<number>,
    public live_symbols: Set<LocalDefId>,
    public repr_unconditionally_treats_fields_as_live: boolean,
    public repr_has_repr_simd_or_scalable: boolean,
    public in_pat: boolean,
    public ignore_variant_stack: DefId[],
    // maps from ADTs to ignored derived traits (e.g. Debug and Clone)
    // and the span of their respective impl (i.e., part of the derive
    // macro)
    public ignored_derived_traits: Map<LocalDefId, DefIdSet>,
    public propagated_comes_from_allow_expect: ComesFromAllowExpect,
    public unsolved_items: LocalDefId[],
  ) {
    super();
  }

  /// Gets the type-checking results for the current body.
  /// As this will ICE if called outside bodies, only call when working with
  /// `Expr` or `Pat` nodes (they are guaranteed to be found only in bodies).
  // #[track_caller]
  // rustc: compiler/rustc_passes/src/dead.rs:145 typeck_results
  typeck_results(): TypeckResults {
    const r = this.maybe_typeck_results;
    if (r === undefined) return panic("`MarkSymbolVisitor::typeck_results` called outside of body");
    return r;
  }

  /// Returns whether `def_id` itself should be treated as coming from
  /// `#[allow(dead_code)]` or `#[expect(dead_code)]` in the current
  /// propagated work-item context.
  // rustc: compiler/rustc_passes/src/dead.rs:153 own_comes_from_allow_expect
  own_comes_from_allow_expect(def_id: LocalDefId): ComesFromAllowExpect {
    if (this.propagated_comes_from_allow_expect === "Yes" && has_allow_dead_code_or_lang_attr(this.tcx, def_id) === "Yes") {
      return "Yes";
    } else {
      return "No";
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:164 check_def_id
  check_def_id(def_id_: DefId): void {
    const def_id = def_id_.as_local();
    if (def_id !== undefined) {
      const own_comes_from_allow_expect = this.own_comes_from_allow_expect(def_id);

      if (should_explore(this.tcx, def_id)) {
        this.worklist.push({
          id: def_id,
          propagated: this.propagated_comes_from_allow_expect,
          own: own_comes_from_allow_expect,
        });
      }

      if (own_comes_from_allow_expect === "No") {
        this.live_symbols.add(def_id);
      }
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:182 insert_def_id
  insert_def_id(def_id_: DefId): void {
    const def_id = def_id_.as_local();
    if (def_id !== undefined) {
      // debug_assert!(!should_explore(self.tcx, def_id));

      if (this.own_comes_from_allow_expect(def_id) === "No") {
        this.live_symbols.add(def_id);
      }
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:192 handle_res
  handle_res(res: Res): void {
    switch (res.$) {
      case "PrimTy":
      case "SelfCtor":
      case "Local":
        break;
      case "Def": {
        const def_kind = res._0;
        if (def_kind.$ === "Ctor" && def_kind._0 === "Variant") {
          const ctor_def_id = res._1;
          // Using a variant in patterns should not make the variant live,
          // since we can just remove the match arm that matches the pattern
          if (this.in_pat) {
            return;
          }
          const variant_id = this.tcx.parent(ctor_def_id);
          const enum_id = this.tcx.parent(variant_id);
          this.check_def_id(enum_id);
          if (!this.ignore_variant_stack.some((d) => DefId_eq(d, ctor_def_id))) {
            this.check_def_id(variant_id);
          }
        } else if (def_kind.$ === "Variant") {
          const variant_id = res._1;
          // Using a variant in patterns should not make the variant live,
          // since we can just remove the match arm that matches the pattern
          if (this.in_pat) {
            return;
          }
          const enum_id = this.tcx.parent(variant_id);
          this.check_def_id(enum_id);
          if (!this.ignore_variant_stack.some((d) => DefId_eq(d, variant_id))) {
            this.check_def_id(variant_id);
          }
        } else {
          this.check_def_id(res._1);
        }
        break;
      }
      case "SelfTyParam":
        this.check_def_id(res.trait_);
        break;
      case "SelfTyAlias":
        this.check_def_id(res.alias_to);
        break;
      case "ToolMod":
      case "NonMacroAttr":
      case "OpenMod":
      case "Err":
        break;
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:227 lookup_and_handle_method
  lookup_and_handle_method(id: HirId): void {
    const def_id = this.typeck_results().type_dependent_def_id(id);
    if (def_id !== undefined) {
      this.check_def_id(def_id);
    } else {
      assert(this.typeck_results().tainted_by_errors !== undefined, "no type-dependent def for method");
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:238 handle_field_access
  handle_field_access(lhs: hir.Expr, hir_id: HirId): void {
    const kind = this.typeck_results().expr_ty_adjusted(lhs).kind();
    switch (kind.$) {
      case "Adt": {
        const def = kind._0;
        const index = this.typeck_results().field_index(hir_id);
        this.insert_def_id(def.non_enum_variant().fields[index]!.did);
        break;
      }
      case "Tuple":
        break;
      case "Error":
        break;
      default:
        span_bug(lhs.span, `named field access on non-ADT: ${debug_TyKind(kind, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:250 handle_assign
  handle_assign(expr: hir.Expr): void {
    if (
      this.typeck_results()
        .expr_adjustments(expr)
        .some((adj) => adj.kind.$ === "Deref")
    ) {
      void this.visit_expr(expr);
    } else if (expr.kind.$ === "Field") {
      const base = expr.kind._0;
      // Ignore write to field
      this.handle_assign(base);
    } else {
      void this.visit_expr(expr);
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:266 check_for_self_assign
  check_for_self_assign(assign: hir.Expr): void {
    // rustc: compiler/rustc_passes/src/dead.rs:267 check_for_self_assign_helper
    function check_for_self_assign_helper(typeck_results: TypeckResults, lhs: hir.Expr, rhs: hir.Expr): boolean {
      if (lhs.kind.$ === "Path" && rhs.kind.$ === "Path") {
        const qpath_l = lhs.kind._0;
        const qpath_r = rhs.kind._0;
        const l = typeck_results.qpath_res(qpath_l, lhs.hir_id);
        const r = typeck_results.qpath_res(qpath_r, rhs.hir_id);
        if (l.$ === "Local" && r.$ === "Local") {
          if (HirId_eq(l._0, r._0)) {
            return true;
          }
        }
        return false;
      } else if (lhs.kind.$ === "Field" && rhs.kind.$ === "Field") {
        const [lhs_l, ident_l] = [lhs.kind._0, lhs.kind._1];
        const [lhs_r, ident_r] = [rhs.kind._0, rhs.kind._1];
        if (ident_l.eq(ident_r)) {
          return check_for_self_assign_helper(typeck_results, lhs_l, lhs_r);
        }
        return false;
      } else {
        return false;
      }
    }

    if (assign.kind.$ === "Assign") {
      const [lhs, rhs] = [assign.kind._0, assign.kind._1];
      if (check_for_self_assign_helper(this.typeck_results(), lhs, rhs) && !Span.from_expansion(assign.span)) {
        const is_field_assign = lhs.kind.$ === "Field";
        this.tcx.emit_node_span_lint(
          DEAD_CODE,
          assign.hir_id,
          assign.span,
          UselessAssignment_diagnostic({ is_field_assign, ty: this.typeck_results().expr_ty(lhs) }),
        );
      }
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:310 handle_field_pattern_match
  handle_field_pattern_match(lhs: hir.Pat, res: Res, pats: readonly hir.PatField[]): void {
    const kind = this.typeck_results().node_type(lhs.hir_id).kind();
    let variant;
    if (kind.$ === "Adt") {
      const adt = kind._0;
      // Marks the ADT live if its variant appears as the pattern,
      // considering cases when we have `let T(x) = foo()` and `fn foo<T>() -> T;`,
      // we will lose the liveness info of `T` cause we cannot mark it live when visiting `foo`.
      // Related issue: https://github.com/rust-lang/rust/issues/120770
      this.check_def_id(adt.did());
      variant = adt.variant_of_res(res);
    } else {
      return span_bug(lhs.span, "non-ADT in struct pattern");
    }
    for (const pat of pats) {
      if (pat.pat.kind.$ === "Wild") {
        continue;
      }
      const index = this.typeck_results().field_index(pat.hir_id);
      this.insert_def_id(variant.fields[index]!.did);
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:336 handle_tuple_field_pattern_match
  handle_tuple_field_pattern_match(lhs: hir.Pat, res: Res, pats: readonly hir.Pat[], dotdot_: hir.DotDotPos): void {
    const kind = this.typeck_results().node_type(lhs.hir_id).kind();
    let variant;
    if (kind.$ === "Adt") {
      const adt = kind._0;
      // Marks the ADT live if its variant appears as the pattern
      this.check_def_id(adt.did());
      variant = adt.variant_of_res(res);
    } else {
      this.tcx.dcx().span_delayed_bug(lhs.span, "non-ADT in tuple struct pattern");
      return;
    }
    const dotdot = dotdot_.as_opt_usize() ?? pats.length;
    const first_n: [number, hir.Pat][] = pats.map((pat, idx): [number, hir.Pat] => [idx, pat]).slice(0, dotdot);
    const missing = variant.fields.length - pats.length;
    const last_n: [number, hir.Pat][] = pats
      .map((pat, idx): [number, hir.Pat] => [idx, pat])
      .slice(dotdot)
      .map(([idx, pat]): [number, hir.Pat] => [idx + missing, pat]);
    for (const [idx, pat] of [...first_n, ...last_n]) {
      if (pat.kind.$ === "Wild") {
        continue;
      }
      this.insert_def_id(variant.fields[idx]!.did);
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:366 handle_offset_of
  handle_offset_of(expr: hir.Expr): void {
    const indices = this.typeck_results().offset_of_data().get(expr.hir_id);
    if (indices === undefined) return bug("no offset_of_data for offset_of");

    for (const [current_ty, variant, field_] of indices) {
      const kind = current_ty.kind();
      switch (kind.$) {
        case "Adt": {
          const def = kind._0;
          const field = def.variant(variant).fields[field_]!;
          this.insert_def_id(field.did);
          break;
        }
        // we don't need to mark tuple fields as live,
        // but we may need to mark subfields
        case "Tuple":
          break;
        default:
          span_bug(expr.span, "named field access on non-ADT");
      }
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:387 mark_live_symbols
  mark_live_symbols(): ControlFlow<ErrorGuaranteed> {
    let work: WorkItem | undefined;
    while ((work = this.worklist.pop()) !== undefined) {
      let { id } = work;
      const { propagated, own } = work;
      this.propagated_comes_from_allow_expect = propagated;

      // in the case of tuple struct constructors we want to check the item,
      // not the generated tuple struct constructor function
      if (this.tcx.def_kind(id).$ === "Ctor") {
        id = this.tcx.local_parent(id);
      }

      // When using `#[allow]` or `#[expect]` of `dead_code`, we do a QOL improvement
      // by declaring fn calls, statics, ... within said items as live, as well as
      // the item itself, although technically this is not the case.
      //
      // This means that the lint for said items will never be fired.
      //
      // This doesn't make any difference for the item declared with `#[allow]`, as
      // the lint firing will be a nop, as it will be silenced by the `#[allow]` of
      // the item.
      //
      // However, for `#[expect]`, the presence or absence of the lint is relevant,
      // so we don't add it to the list of live symbols when it comes from a
      // `#[expect]`. This means that we will correctly report an item as live or not
      // for the `#[expect]` case.
      //
      // Note that an item can and will be duplicated on the worklist with different
      // `ComesFromAllowExpect`, particularly if it was added from the
      // `effective_visibilities` query or from the `#[allow]`/`#[expect]` checks,
      // this "duplication" is essential as otherwise a function with `#[expect]`
      // called from a `pub fn` may be falsely reported as not live, falsely
      // triggering the `unfulfilled_lint_expectations` lint.
      switch (own) {
        case "Yes":
          break;
        case "No":
          this.live_symbols.add(id);
          break;
      }

      const key = scanned_key(id, propagated);
      if (this.scanned.has(key)) {
        continue;
      } else {
        this.scanned.add(key);
        if (propagated === "No") {
          // If the item is not coming from an `#[allow]` or `#[expect]`,
          // we also mark it as scanned with `ComesFromAllowExpect::Yes`
          // to avoid re-scanning it in the future.
          this.scanned.add(scanned_key(id, "Yes"));
        }
      }

      // Avoid accessing the HIR for the synthesized associated type generated for RPITITs.
      if (this.tcx.is_impl_trait_in_trait(LocalDefId.to_def_id(id))) {
        this.live_symbols.add(id);
        continue;
      }

      const r = this.visit_node(this.tcx.hir_node_by_def_id(id));
      if (r.$ === "Break") return r;
    }

    return ControlFlow.CONTINUE;
  }

  /// Automatically generated items marked with `rustc_trivial_field_reads`
  /// will be ignored for the purposes of dead code analysis (see PR #85200
  /// for discussion).
  // rustc: compiler/rustc_passes/src/dead.rs:450 should_ignore_impl_item
  should_ignore_impl_item(impl_item: hir.ImplItem): boolean {
    if (impl_item.impl_kind.$ === "Trait") {
      const impl_of = this.tcx.local_parent(impl_item.owner_id.def_id);
      if (this.tcx.is_automatically_derived(LocalDefId.to_def_id(impl_of))) {
        const trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.impl_trait_ref(impl_of)));
        if (find_attr(HasAttrs_DefId.get_attrs(trait_ref.def_id, this.tcx), (k) => (k.$ === "RustcTrivialFieldReads" ? null : undefined)) !== undefined) {
          const self_kind = (TraitRef.self_ty(trait_ref) as Ty).kind();
          if (self_kind.$ === "Adt") {
            const adt_def_id = self_kind._0.did().as_local();
            if (adt_def_id !== undefined) {
              let set = this.ignored_derived_traits.get(adt_def_id);
              if (set === undefined) {
                set = new DefIdSet();
                this.ignored_derived_traits.set(adt_def_id, set);
              }
              set.add(trait_ref.def_id);
            }
          }
          return true;
        }
      }
    }

    return false;
  }

  // rustc: compiler/rustc_passes/src/dead.rs:469 visit_node
  visit_node(node: Node): ControlFlow<ErrorGuaranteed> {
    if (node.$ === "ImplItem" && this.should_ignore_impl_item(node._0)) {
      return ControlFlow.CONTINUE;
    }

    const unconditionally_treated_fields_as_live = this.repr_unconditionally_treats_fields_as_live;
    const had_repr_simd_or_scalable = this.repr_has_repr_simd_or_scalable;
    this.repr_unconditionally_treats_fields_as_live = false;
    this.repr_has_repr_simd_or_scalable = false;
    let walk_result: ControlFlow<ErrorGuaranteed>;
    switch (node.$) {
      case "Item": {
        const item = node._0;
        switch (item.kind.$) {
          case "Struct":
          case "Union": {
            const def = this.tcx.adt_def(item.owner_id) as AdtDef;
            this.repr_unconditionally_treats_fields_as_live = def.repr().c() || def.repr().transparent();
            this.repr_has_repr_simd_or_scalable = def.repr().simd() || def.repr().is_scalable();

            walk_result = walk_item(this, item);
            break;
          }
          case "ForeignMod":
            walk_result = ControlFlow.CONTINUE;
            break;
          case "Trait": {
            const trait_item_refs = item.kind.items;
            // mark assoc ty live if the trait is live
            for (const trait_item of trait_item_refs) {
              if (this.tcx.def_kind(trait_item.owner_id).$ === "AssocTy") {
                this.check_def_id(trait_item.owner_id.to_def_id());
              }
            }
            walk_result = walk_item(this, item);
            break;
          }
          default:
            walk_result = walk_item(this, item);
        }
        break;
      }
      case "TraitItem": {
        const trait_item = node._0;
        // mark the trait live
        const trait_item_id = trait_item.owner_id.to_def_id();
        const trait_id = this.tcx.trait_of_assoc(trait_item_id);
        if (trait_id !== undefined) {
          this.check_def_id(trait_id);
        }
        walk_result = walk_trait_item(this, trait_item);
        break;
      }
      case "ImplItem": {
        const impl_item = node._0;
        const item = this.tcx.local_parent(impl_item.owner_id.def_id);
        if (impl_item.impl_kind.$ === "Inherent") {
          //// If it's a type whose items are live, then it's live, too.
          //// This is done to handle the case where, for example, the static
          //// method of a private type is used, but the type itself is never
          //// called directly.
          const self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(item) as EarlyBinder<Ty>));
          const k = self_ty.kind();
          switch (k.$) {
            case "Adt":
              this.check_def_id(k._0.did());
              break;
            case "Foreign":
              this.check_def_id(k._0);
              break;
            case "Dynamic": {
              const def_id = k._0.principal_def_id();
              if (def_id !== undefined) {
                this.check_def_id(def_id);
              }
              break;
            }
            default:
              break;
          }
        }
        walk_result = walk_impl_item(this, impl_item);
        break;
      }
      case "ForeignItem":
        walk_result = walk_foreign_item(this, node._0);
        break;
      case "OpaqueTy":
        walk_result = walk_opaque_ty(this, node._0);
        break;
      default:
        walk_result = ControlFlow.CONTINUE;
    }
    this.repr_has_repr_simd_or_scalable = had_repr_simd_or_scalable;
    this.repr_unconditionally_treats_fields_as_live = unconditionally_treated_fields_as_live;

    return walk_result;
  }

  // rustc: compiler/rustc_passes/src/dead.rs:546 mark_as_used_if_union
  mark_as_used_if_union(adt: AdtDef, fields: readonly hir.ExprField[]): void {
    if (adt.is_union() && adt.non_enum_variant().fields.length > 1 && adt.did().is_local()) {
      for (const field of fields) {
        const index = this.typeck_results().field_index(field.hir_id);
        this.insert_def_id(adt.non_enum_variant().fields[index]!.did);
      }
    }
  }

  /// Returns whether `local_def_id` is potentially alive or not.
  /// `local_def_id` points to an impl or an impl item,
  /// both impl and impl item that may be passed to this function are of a trait,
  /// and added into the unsolved_items during `create_and_seed_worklist`
  // rustc: compiler/rustc_passes/src/dead.rs:559 check_impl_or_impl_item_live
  check_impl_or_impl_item_live(local_def_id: LocalDefId, defer_seeds_come_from_allow: boolean): ImplItemCheckResult {
    let impl_block_id: LocalDefId;
    let trait_def_id: LocalDefId | undefined;
    const dk = this.tcx.def_kind(local_def_id);
    if (dk.$ === "AssocConst" || dk.$ === "AssocTy" || dk.$ === "AssocFn") {
      // assoc impl items of traits are live if the corresponding trait items are live
      trait_def_id = this.tcx.trait_item_of(local_def_id)?.as_local();
      impl_block_id = this.tcx.local_parent(local_def_id);
    } else if (dk.$ === "Impl" && dk.of_trait) {
      // impl items are live if the corresponding traits are live
      impl_block_id = local_def_id;
      trait_def_id = this.tcx.impl_trait_id(local_def_id).as_local();
    } else {
      return bug();
    }

    let trait_comes_from_allow: ComesFromAllowExpect | undefined = undefined;
    if (trait_def_id !== undefined) {
      if (defer_seeds_come_from_allow) {
        if (!this.live_symbols.has(trait_def_id)) {
          return { $: "Dead", require: trait_def_id };
        }
      } else {
        trait_comes_from_allow = has_allow_dead_code_or_lang_attr(this.tcx, trait_def_id);

        if (!this.live_symbols.has(trait_def_id)) {
          if (trait_comes_from_allow !== undefined) {
            return { $: "Live", _0: trait_comes_from_allow };
          } else {
            return { $: "Dead", require: trait_def_id };
          }
        }
      }
    }

    // The impl or impl item is used if the corresponding trait or trait item is used and the ty is used.
    const k = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(impl_block_id) as EarlyBinder<Ty>)).kind();
    if (k.$ === "Adt") {
      const adt_def_id = k._0.did().as_local();
      if (adt_def_id !== undefined && !this.live_symbols.has(adt_def_id)) {
        if (defer_seeds_come_from_allow) {
          return { $: "Dead", require: adt_def_id };
        }

        if (trait_comes_from_allow !== undefined) {
          return { $: "Live", _0: trait_comes_from_allow };
        } else {
          return { $: "Dead", require: adt_def_id };
        }
      }
    }

    return { $: "Live", _0: "No" };
  }

  // rustc: compiler/rustc_passes/src/dead.rs:615 collect_live_items_from_unsolved_items
  collect_live_items_from_unsolved_items(
    defer_seeds_come_from_allow: boolean,
    unsolved_items: LocalDefId[],
    unsolved_map: FxHashMap<LocalDefId, LocalDefId[]>,
  ): [LocalDefId, ComesFromAllowExpect][] {
    const items_to_check: [LocalDefId, ComesFromAllowExpect][] = [];

    for (const def_id of unsolved_items) {
      const r = this.check_impl_or_impl_item_live(def_id, defer_seeds_come_from_allow);
      switch (r.$) {
        case "Live":
          items_to_check.push([def_id, r._0]);
          break;
        case "Dead": {
          // `unsolved_map.entry(require).or_default().push(def_id)`
          let v = unsolved_map.get(r.require);
          if (v === undefined) {
            v = [];
            unsolved_map.set(r.require, v);
          }
          v.push(def_id);
          break;
        }
      }
    }
    return items_to_check;
  }

  // #[expect(rustc::potential_query_instability, reason = "The order of the unsolved items is not important, so we can
  // just collect them into a vector.")]
  // rustc: compiler/rustc_passes/src/dead.rs:640 mark_live_symbols_and_ignored_derived_traits
  mark_live_symbols_and_ignored_derived_traits(defer_seeds_come_from_allow: boolean): Result<null, ErrorGuaranteed> {
    const r0 = this.mark_live_symbols();
    if (r0.$ === "Break") {
      return Err(r0._0);
    }

    // We have marked the primary seeds as live. We now need to process unsolved items from traits
    // and trait impls: add them to the work list if the trait or the implemented type is live.
    const unsolved_items = this.unsolved_items;
    this.unsolved_items = [];
    const unsolved_map = FxHashMap.default<LocalDefId, LocalDefId[]>(u32_key as never, LAYOUT_VEC);
    let items_to_check = this.collect_live_items_from_unsolved_items(defer_seeds_come_from_allow, unsolved_items, unsolved_map);

    while (items_to_check.length !== 0) {
      for (const [id, comes_from_allow] of items_to_check) {
        const own: ComesFromAllowExpect = defer_seeds_come_from_allow ? "No" : (has_allow_dead_code_or_lang_attr(this.tcx, id) ?? "No");

        this.worklist.push({ id, propagated: comes_from_allow, own });
      }
      const r = this.mark_live_symbols();
      if (r.$ === "Break") {
        return Err(r._0);
      }

      // `unsolved_map.extract_if(|require, _| self.live_symbols.contains(require)).flat_map(|(_, items)| items).collect()`
      const extracted: [LocalDefId, LocalDefId[]][] = [];
      for (const [require, items] of unsolved_map) {
        if (this.live_symbols.has(require)) extracted.push([require, items]);
      }
      for (const [require] of extracted) unsolved_map.delete(require);
      const unsolved_items = extracted.flatMap(([, items]) => items);

      items_to_check = this.collect_live_items_from_unsolved_items(defer_seeds_come_from_allow, unsolved_items, unsolved_map);
    }

    this.unsolved_items = [...unsolved_map.values()].flat();

    return Ok(null);
  }

  // impl<'tcx> Visitor<'tcx> for MarkSymbolVisitor<'tcx>

  // rustc: compiler/rustc_passes/src/dead.rs:694 visit_nested_body
  override visit_nested_body(body: hir.BodyId): ControlFlow<ErrorGuaranteed> {
    const typeck_results = this.tcx.typeck_body(body as unknown as MiddleBodyId);

    // The result shouldn't be tainted, otherwise it will cause ICE.
    const guar = typeck_results.tainted_by_errors;
    if (guar !== undefined) {
      return ControlFlow.Break(guar);
    }

    const old_maybe_typeck_results = this.maybe_typeck_results;
    this.maybe_typeck_results = typeck_results;
    const body_ = this.tcx.hir_body(body);
    const result = this.visit_body(body_);
    this.maybe_typeck_results = old_maybe_typeck_results;

    return result;
  }

  // rustc: compiler/rustc_passes/src/dead.rs:710 visit_variant_data
  override visit_variant_data(def: hir.VariantData): ControlFlow<ErrorGuaranteed> {
    const tcx = this.tcx;
    const unconditionally_treat_fields_as_live = this.repr_unconditionally_treats_fields_as_live;
    const has_repr_simd_or_scalable = this.repr_has_repr_simd_or_scalable;
    const effective_visibilities = tcx.effective_visibilities(null);
    const live_fields = VariantData.fields(def).flatMap((f): LocalDefId[] => {
      const def_id = f.def_id;
      if (unconditionally_treat_fields_as_live || (f.is_positional() && has_repr_simd_or_scalable)) {
        return [def_id];
      }
      if (!effective_visibilities.is_reachable(f.hir_id.owner.def_id)) {
        return [];
      }
      return effective_visibilities.is_reachable(def_id) ? [def_id] : [];
    });
    for (const f of live_fields) this.live_symbols.add(f);

    return walk_struct_def(this, def);
  }

  // rustc: compiler/rustc_passes/src/dead.rs:732 visit_expr
  override visit_expr(expr: hir.Expr): ControlFlow<ErrorGuaranteed> {
    const kind = expr.kind;
    switch (kind.$) {
      case "Path":
        if (kind._0.$ === "TypeRelative") {
          const qpath = kind._0;
          const res = this.typeck_results().qpath_res(qpath, expr.hir_id);
          this.handle_res(res);
        }
        break;
      case "MethodCall":
        this.lookup_and_handle_method(expr.hir_id);
        break;
      case "Field": {
        const lhs = kind._0;
        if (this.typeck_results().opt_field_index(expr.hir_id) !== undefined) {
          this.handle_field_access(lhs, expr.hir_id);
        } else {
          this.tcx.dcx().span_delayed_bug(expr.span, "couldn't resolve index for field");
        }
        break;
      }
      case "Struct": {
        const [qpath, fields] = [kind._0, kind._1];
        const res = this.typeck_results().qpath_res(qpath, expr.hir_id);
        this.handle_res(res);
        const ty_kind = this.typeck_results().expr_ty(expr).kind();
        if (ty_kind.$ === "Adt") {
          this.mark_as_used_if_union(ty_kind._0, fields);
        }
        break;
      }
      case "Closure": {
        const cls = kind._0;
        this.insert_def_id(LocalDefId.to_def_id(cls.def_id));
        break;
      }
      case "OffsetOf":
        this.handle_offset_of(expr);
        break;
      case "Assign": {
        const lhs = kind._0;
        this.handle_assign(lhs);
        this.check_for_self_assign(expr);
        break;
      }
      default:
        break;
    }

    return walk_expr(this, expr);
  }

  // rustc: compiler/rustc_passes/src/dead.rs:771 visit_arm
  override visit_arm(arm: hir.Arm): ControlFlow<ErrorGuaranteed> {
    // Inside the body, ignore constructions of variants
    // necessary for the pattern to match. Those construction sites
    // can't be reached unless the variant is constructed elsewhere.
    const len = this.ignore_variant_stack.length;
    this.ignore_variant_stack.push(...arm.pat.necessary_variants());
    const result = walk_arm(this, arm);
    this.ignore_variant_stack.length = len;

    return result;
  }

  // rustc: compiler/rustc_passes/src/dead.rs:783 visit_pat
  override visit_pat(pat: hir.Pat): ControlFlow<ErrorGuaranteed> {
    this.in_pat = true;
    const kind = pat.kind;
    switch (kind.$) {
      case "Struct": {
        const [path, fields] = [kind._0, kind._1];
        const res = this.typeck_results().qpath_res(path, pat.hir_id);
        this.handle_field_pattern_match(pat, res, fields);
        break;
      }
      case "TupleStruct": {
        const [qpath, fields, dotdot] = [kind._0, kind._1, kind._2];
        const res = this.typeck_results().qpath_res(qpath, pat.hir_id);
        this.handle_tuple_field_pattern_match(pat, res, fields, dotdot);
        break;
      }
      default:
        break;
    }

    const result = walk_pat(this, pat);
    this.in_pat = false;

    return result;
  }

  // rustc: compiler/rustc_passes/src/dead.rs:803 visit_pat_expr
  override visit_pat_expr(expr: hir.PatExpr): ControlFlow<ErrorGuaranteed> {
    if (expr.kind.$ === "Path") {
      const qpath = expr.kind._0;
      // mark the type of variant live when meeting E::V in expr
      const k = this.typeck_results().node_type(expr.hir_id).kind();
      if (k.$ === "Adt") {
        this.check_def_id(k._0.did());
      }

      const res = this.typeck_results().qpath_res(qpath, expr.hir_id);
      this.handle_res(res);
    }
    return walk_pat_expr(this, expr);
  }

  // rustc: compiler/rustc_passes/src/dead.rs:819 visit_path
  override visit_path(path: hir.Path, _: HirId): ControlFlow<ErrorGuaranteed> {
    this.handle_res(path.res);
    return walk_path(this, path);
  }

  // rustc: compiler/rustc_passes/src/dead.rs:824 visit_anon_const
  override visit_anon_const(c: hir.AnonConst): ControlFlow<ErrorGuaranteed> {
    // When inline const blocks are used in pattern position, paths
    // referenced by it should be considered as used.
    const in_pat = this.in_pat;
    this.in_pat = false;

    this.live_symbols.add(c.def_id);
    const result = walk_anon_const(this, c);

    this.in_pat = in_pat;

    return result;
  }

  // rustc: compiler/rustc_passes/src/dead.rs:837 visit_inline_const
  override visit_inline_const(c: hir.ConstBlock): ControlFlow<ErrorGuaranteed> {
    // When inline const blocks are used in pattern position, paths
    // referenced by it should be considered as used.
    const in_pat = this.in_pat;
    this.in_pat = false;

    this.live_symbols.add(c.def_id);
    const result = walk_inline_const(this, c);

    this.in_pat = in_pat;

    return result;
  }

  // rustc: compiler/rustc_passes/src/dead.rs:850 visit_trait_ref
  override visit_trait_ref(t: hir.TraitRef): ControlFlow<ErrorGuaranteed> {
    const trait_def_id = Res.opt_def_id(t.path.res);
    const segment = t.path.segments[t.path.segments.length - 1];
    const args = segment?.args;
    if (trait_def_id !== undefined && segment !== undefined && args !== undefined) {
      for (const constraint of args.constraints) {
        const item = AssocItems.find_by_ident_and_kind(
          this.tcx.associated_items(trait_def_id) as AssocItems,
          this.tcx,
          constraint.ident,
          "Const",
          trait_def_id,
        );
        const local_def_id = item?.def_id.as_local();
        if (local_def_id !== undefined) {
          this.worklist.push({
            id: local_def_id,
            propagated: "No",
            own: "No",
          });
        }
      }
    }

    return walk_trait_ref(this, t);
  }
}

// rustc: compiler/rustc_passes/src/dead.rs:880 has_allow_dead_code_or_lang_attr
function has_allow_dead_code_or_lang_attr(tcx: TyCtxt, def_id: LocalDefId): ComesFromAllowExpect | undefined {
  // rustc: compiler/rustc_passes/src/dead.rs:884 has_allow_expect_dead_code
  function has_allow_expect_dead_code(tcx: TyCtxt, def_id: LocalDefId): boolean {
    const hir_id = tcx.local_def_id_to_hir_id(def_id);
    const lint_level = tcx.lint_level_spec_at_node(DEAD_CODE, hir_id).level_();
    return lint_level === "Allow" || lint_level === "Expect";
  }

  // rustc: compiler/rustc_passes/src/dead.rs:890 has_used_like_attr
  function has_used_like_attr(tcx: TyCtxt, def_id: LocalDefId): boolean {
    if (!DefKind.has_codegen_attrs(tcx.def_kind(def_id))) return false;
    const cg_attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;

    // #[used], #[no_mangle], #[export_name], etc also keeps the item alive
    // forcefully, e.g., for placing it in a specific section.
    return (
      CodegenFnAttrs.contains_extern_indicator(cg_attrs) ||
      CodegenFnAttrFlags.contains(cg_attrs.flags, CodegenFnAttrFlags.USED_COMPILER) ||
      CodegenFnAttrFlags.contains(cg_attrs.flags, CodegenFnAttrFlags.USED_LINKER)
    );
  }

  if (has_allow_expect_dead_code(tcx, def_id)) {
    return "Yes";
  } else if (
    has_used_like_attr(tcx, def_id) ||
    find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "Lang" || k.$ === "RustcCanonicalSymbol" ? null : undefined)) !== undefined
  ) {
    return "No";
  } else {
    return undefined;
  }
}

/// Examine the given definition and record it in the worklist if it should be considered live.
///
/// We want to explicitly consider as live:
/// * Item annotated with #[allow(dead_code)]
///       This is done so that if we want to suppress warnings for a
///       group of dead functions, we only have to annotate the "root".
///       For example, if both `f` and `g` are dead and `f` calls `g`,
///       then annotating `f` with `#[allow(dead_code)]` will suppress
///       warning for both `f` and `g`.
///
/// * Item annotated with #[lang=".."]
///       Lang items are always callable from elsewhere.
///
/// For trait methods and implementations of traits, we are not certain that the definitions are
/// live at this stage. We record them in `unsolved_items` for later examination.
// rustc: compiler/rustc_passes/src/dead.rs:928 maybe_record_as_seed
function maybe_record_as_seed(
  tcx: TyCtxt,
  owner_id: OwnerId,
  push_into_worklist: (work_item: WorkItem) => void,
  unsolved_items: LocalDefId[],
): void {
  const allow_dead_code = has_allow_dead_code_or_lang_attr(tcx, owner_id.def_id);
  if (allow_dead_code !== undefined) {
    const comes_from_allow = allow_dead_code;
    push_into_worklist({
      id: owner_id.def_id,
      propagated: comes_from_allow,
      own: comes_from_allow,
    });
  }

  const dk = tcx.def_kind(owner_id);
  switch (dk.$) {
    case "Enum":
      if (allow_dead_code !== undefined) {
        const comes_from_allow = allow_dead_code;
        const adt = tcx.adt_def(owner_id) as AdtDef;
        for (const variant of adt.variants()) {
          push_into_worklist({
            id: variant.def_id.expect_local(),
            propagated: comes_from_allow,
            own: comes_from_allow,
          });
        }
      }
      break;
    case "AssocFn":
    case "AssocConst":
    case "AssocTy":
      if (allow_dead_code === undefined) {
        const parent = tcx.local_parent(owner_id.def_id);
        const pk = tcx.def_kind(parent);
        if ((pk.$ === "Impl" && !pk.of_trait) || pk.$ === "Trait") {
          // nothing
        } else if (pk.$ === "Impl" && pk.of_trait) {
          // We only care about associated items of traits,
          // because they cannot be visited directly,
          // so we later mark them as live if their corresponding traits
          // or trait items and self types are both live,
          // but inherent associated items can be visited and marked directly.
          unsolved_items.push(owner_id.def_id);
        } else {
          bug();
        }
      }
      break;
    case "Impl":
      if (dk.of_trait && allow_dead_code === undefined) {
        unsolved_items.push(owner_id.def_id);
      }
      break;
    case "GlobalAsm":
      // global_asm! is always live.
      push_into_worklist({
        id: owner_id.def_id,
        propagated: "No",
        own: "No",
      });
      break;
    case "Const":
      if (tcx.item_name(owner_id.def_id) === kw.Underscore) {
        // `const _` is always live, as that syntax only exists for the side effects
        // of type checking and evaluating the constant expression, and marking them
        // as dead code would defeat that purpose.
        push_into_worklist({
          id: owner_id.def_id,
          propagated: "No",
          own: "No",
        });
      }
      break;
    default:
      break;
  }
}

// #[derive(Default)]
// rustc-type: compiler/rustc_passes/src/dead.rs:1001 DeferredSeeds
interface DeferredSeeds {
  pub_reachables: WorkItem[];
  come_from_allow: WorkItem[];
}

// rustc-type: compiler/rustc_passes/src/dead.rs:1006 SeedWorklists
interface SeedWorklists {
  worklist: WorkItem[];
  deferred_seeds: DeferredSeeds;
  unsolved_items: LocalDefId[];
}

// rustc: compiler/rustc_passes/src/dead.rs:1012 create_and_seed_worklist
function create_and_seed_worklist(tcx: TyCtxt): SeedWorklists {
  const unsolved_items: LocalDefId[] = [];
  const deferred_seeds: DeferredSeeds = { pub_reachables: [], come_from_allow: [] };
  const worklist: WorkItem[] = [];

  const entry = tcx.entry_fn(null);
  if (entry !== undefined) {
    const local_def_id = entry[0].as_local();
    if (local_def_id !== undefined) {
      worklist.push({
        id: local_def_id,
        propagated: "No",
        own: "No",
      });
    }
  }

  // Under `--test`, what `main` resolves to is the would-be entry point of a normal build,
  // so keep it live, unless a stripped user `#[rustc_main]` would have been the entry instead.
  if (tcx.sess.is_test_crate() && !tcx.sess.removed_rustc_main_attr) {
    const main_def = tcx.resolutions(null).main_def;
    const def_id = main_def !== undefined ? MainDefinition.opt_fn_def_id(main_def) : undefined;
    const local_def_id = def_id?.as_local();
    if (local_def_id !== undefined) {
      worklist.push({
        id: local_def_id,
        propagated: "No",
        own: "No",
      });
    }
  }

  for (const [id, effective_vis] of tcx.effective_visibilities(null).iter()) {
    if (effective_vis.is_public_at_level("Reachable")) {
      deferred_seeds.pub_reachables.push({
        id,
        propagated: "No",
        own: "No",
      });
    }
  }

  const push_into_worklist = (work_item: WorkItem): void => {
    switch (work_item.own) {
      case "Yes":
        deferred_seeds.come_from_allow.push(work_item);
        break;
      case "No":
        worklist.push(work_item);
        break;
    }
  };
  const crate_items = tcx.hir_crate_items(null) as ModuleItems;
  for (const id of crate_items.owners()) {
    maybe_record_as_seed(tcx, id, push_into_worklist, unsolved_items);
  }

  return { worklist, deferred_seeds, unsolved_items };
}

// rustc: compiler/rustc_passes/src/dead.rs:1064 live_symbols_and_ignored_derived_traits
function live_symbols_and_ignored_derived_traits(tcx: TyCtxt, _: null): Result<DeadCodeLivenessSummary, ErrorGuaranteed> {
  const { worklist, deferred_seeds, unsolved_items } = create_and_seed_worklist(tcx);
  const symbol_visitor = new MarkSymbolVisitor(
    worklist,
    tcx,
    /* maybe_typeck_results */ undefined,
    /* scanned */ new Set(),
    /* live_symbols */ new Set(),
    /* repr_unconditionally_treats_fields_as_live */ false,
    /* repr_has_repr_simd_or_scalable */ false,
    /* in_pat */ false,
    /* ignore_variant_stack */ [],
    /* ignored_derived_traits */ new Map(),
    /* propagated_comes_from_allow_expect */ "No",
    unsolved_items,
  );
  let r = symbol_visitor.mark_live_symbols_and_ignored_derived_traits(true);
  if (r.$ === "Err") return r;
  const pre_deferred_seeding: DeadCodeLivenessSnapshot = {
    live_symbols: new Set(symbol_visitor.live_symbols),
    ignored_derived_traits: clone_ignored_derived_traits(symbol_visitor.ignored_derived_traits),
  };

  if (deferred_seeds.pub_reachables.length !== 0) {
    symbol_visitor.worklist.push(...deferred_seeds.pub_reachables);
    r = symbol_visitor.mark_live_symbols_and_ignored_derived_traits(true);
    if (r.$ === "Err") return r;
  }

  if (deferred_seeds.come_from_allow.length !== 0) {
    symbol_visitor.worklist.push(...deferred_seeds.come_from_allow);
    r = symbol_visitor.mark_live_symbols_and_ignored_derived_traits(false);
    if (r.$ === "Err") return r;
  }

  return Ok({
    pre_deferred_seeding,
    final_result: {
      live_symbols: symbol_visitor.live_symbols,
      ignored_derived_traits: symbol_visitor.ignored_derived_traits,
    },
  });
}

// rustc-type: compiler/rustc_passes/src/dead.rs:1108 DeadItem
interface DeadItem {
  def_id: LocalDefId;
  name: Symbol;
  level_plus: [Level, StableLintExpectationId | undefined];
}

/** `(lint::Level, Option<StableLintExpectationId>)`'s derived `PartialEq`. */
function level_plus_eq(a: [Level, StableLintExpectationId | undefined], b: [Level, StableLintExpectationId | undefined]): boolean {
  if (a[0] !== b[0]) return false;
  const [x, y] = [a[1], b[1]];
  if (x === undefined || y === undefined) return x === y;
  return x.hir_id.owner.def_id === y.hir_id.owner.def_id && x.hir_id.local_id === y.hir_id.local_id && x.attr_index === y.attr_index && x.lint_index === y.lint_index;
}

// rustc-type: compiler/rustc_passes/src/dead.rs:1121 ShouldWarnAboutField
type ShouldWarnAboutField = "Yes" | "No";

// #[derive(Debug, Copy, Clone, PartialEq, Eq)]
// rustc-type: compiler/rustc_passes/src/dead.rs:1127 ReportOn
type ReportOn =
  /// Report on something that hasn't got a proper name to refer to
  | "TupleField"
  /// Report on something that has got a name, which could be a field but also a method
  | "NamedField";

// rustc-type: compiler/rustc_passes/src/dead.rs:1114 DeadVisitor
class DeadVisitor {
  constructor(
    readonly tcx: TyCtxt,
    readonly target_lint: Lint,
    readonly live_symbols: Set<LocalDefId>,
    readonly ignored_derived_traits: Map<LocalDefId, DefIdSet>,
  ) {}

  // rustc: compiler/rustc_passes/src/dead.rs:1135 should_warn_about_field
  should_warn_about_field(field: FieldDef): ShouldWarnAboutField {
    if (this.live_symbols.has(field.did.expect_local())) {
      return "No";
    }
    const field_type = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(field.did) as EarlyBinder<Ty>));
    if (field_type.is_phantom_data()) {
      return "No";
    }
    const is_positional = starts_with_ascii_digit(Symbol.as_str(field.name));
    if (is_positional) {
      const layout = this.tcx.layout_of(TypingEnv.non_body_analysis(this.tcx, field.did).as_query_input(field_type));
      // `.map_or(true, |layout| layout.is_zst())`
      if (layout.$ === "Err" || layout._0.is_zst()) {
        return "No";
      }
    }
    return "Yes";
  }

  // rustc: compiler/rustc_passes/src/dead.rs:1158 def_lint_level_plus
  def_lint_level_plus(id: LocalDefId): [Level, StableLintExpectationId | undefined] {
    const hir_id = this.tcx.local_def_id_to_hir_id(id);
    const level_spec = this.tcx.lint_level_spec_at_node(this.target_lint, hir_id);
    return [level_spec.level_(), level_spec.lint_id_()];
  }

  // rustc: compiler/rustc_passes/src/dead.rs:1167 fulfill_dead_code_expectations
  fulfill_dead_code_expectations(def_id: LocalDefId, include: boolean): void {
    const fulfill_if_expected = (node_: DefId): void => {
      // Only consider local, dead symbols where lint level carries an expectation
      const node = node_.as_local();
      if (node !== undefined && !this.live_symbols.has(node)) {
        const [, expectation] = this.def_lint_level_plus(node);
        if (expectation !== undefined) {
          // Same mechanism as LintContext::fulfill_expectation.
          this.tcx.dcx().fulfill_expectation(LintExpectationId.Stable(expectation));
        }
      }
    };

    if (include) {
      fulfill_if_expected(LocalDefId.to_def_id(def_id));
    }

    const dk = this.tcx.def_kind(def_id);
    switch (dk.$) {
      case "Struct":
      case "Union":
      case "Enum": {
        const adt = this.tcx.adt_def(def_id) as AdtDef;
        for (const variant of adt.variants()) {
          if (!DefId_eq(variant.def_id, LocalDefId.to_def_id(def_id))) {
            fulfill_if_expected(variant.def_id);
          }
          for (const field of variant.fields) {
            fulfill_if_expected(field.did);
          }
        }
        break;
      }
      case "Variant": {
        const parent_enum = this.tcx.local_parent(def_id);
        const variant = (this.tcx.adt_def(parent_enum) as AdtDef).variant_with_id(LocalDefId.to_def_id(def_id));
        //Check to see if fields carry expectation
        for (const field of variant.fields) {
          fulfill_if_expected(field.did);
        }
        break;
      }
      case "Trait":
        for (const assoc_def_id of this.tcx.associated_item_def_ids(def_id)) {
          fulfill_if_expected(assoc_def_id);
        }
        break;
      default:
        break;
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:1212 dead_code_pub_in_binary_note
  dead_code_pub_in_binary_note(): DeadCodePubInBinaryNote | undefined {
    return this.target_lint.name === DEAD_CODE_PUB_IN_BINARY.name ? {} : undefined;
  }

  // # Panics
  // All `dead_codes` must have the same lint level, otherwise we will intentionally ICE.
  // This is because we emit a multi-spanned lint using the lint level of the `dead_codes`'s
  // first local def id.
  // Prefer calling `Self.warn_dead_code` or `Self.warn_dead_code_grouped_by_lint_level`
  // since those methods group by lint level before calling this method.
  // rustc: compiler/rustc_passes/src/dead.rs:1222 lint_at_single_level
  lint_at_single_level(dead_codes: readonly DeadItem[], participle: string, parent_item: LocalDefId | undefined, report_on: ReportOn): void {
    const first_item = dead_codes[0];
    if (first_item === undefined) return;
    const tcx = this.tcx;

    const first_lint_level_plus = first_item.level_plus;
    assert(
      dead_codes.slice(1).every((item) => level_plus_eq(item.level_plus, first_lint_level_plus)),
      "assertion failed: dead_codes.iter().skip(1).all(|item| item.level_plus == first_lint_level_plus)",
    );

    const names: Symbol[] = dead_codes.map((item) => item.name);
    const spans: Span[] = dead_codes.map((item) => {
      const span = tcx.def_span(item.def_id);
      const ident_span = tcx.def_ident_span(item.def_id);
      // FIXME(cjgillot) this SyntaxContext manipulation does not make any sense.
      return ident_span !== undefined ? Span.with_ctxt(ident_span, Span.ctxt(span)) : span;
    });

    let descr = tcx.def_descr(LocalDefId.to_def_id(first_item.def_id));
    // `impl` blocks are "batched" and (unlike other batching) might
    // contain different kinds of associated items.
    if (dead_codes.some((item) => tcx.def_descr(LocalDefId.to_def_id(item.def_id)) !== descr)) {
      descr = "associated item";
    }

    const num = dead_codes.length;
    const multiple = num > 6;
    const name_list = DiagSymbolList_from(names);

    let parent_info: ParentInfo | undefined = undefined;
    if (parent_item !== undefined) {
      const parent_descr = tcx.def_descr(LocalDefId.to_def_id(parent_item));
      const span = tcx.def_kind(parent_item).$ === "Impl" ? tcx.def_span(parent_item) : unwrap_span(tcx.def_ident_span(parent_item));
      parent_info = { num, descr, parent_descr, span };
    }

    let encl_def_id = parent_item ?? first_item.def_id;
    // `ignored_derived_traits` is computed for the enum, not for the variants.
    if (tcx.def_kind(encl_def_id).$ === "Variant") {
      encl_def_id = tcx.local_parent(encl_def_id);
    }

    let ignored_derived_impls: IgnoredDerivedImpls | undefined = undefined;
    const ign_traits = this.ignored_derived_traits.get(encl_def_id);
    if (ign_traits !== undefined) {
      const trait_list = [...ign_traits].map((trait_id) => this.tcx.item_name(trait_id));
      const trait_list_len = trait_list.length;
      ignored_derived_impls = {
        name: this.tcx.item_name(LocalDefId.to_def_id(encl_def_id)),
        trait_list: DiagSymbolList_from(trait_list),
        trait_list_len,
      };
    }

    let diag: MultipleDeadCodes;
    switch (report_on) {
      case "TupleField": {
        let tuple_fields: readonly hir.FieldDef[] = [];
        if (parent_item !== undefined) {
          const node = tcx.hir_node_by_def_id(parent_item);
          if (node.$ === "Item" && node._0.kind.$ === "Struct" && node._0.kind._2.$ === "Tuple") {
            tuple_fields = node._0.kind._2._0;
          }
        }

        const trailing_tuple_fields: Set<LocalDefId> =
          tuple_fields.length >= dead_codes.length ? new Set(tuple_fields.slice(tuple_fields.length - dead_codes.length).map((f) => f.def_id)) : new Set();

        const fields_suggestion: ChangeFields =
          // Suggest removal if all tuple fields are at the end.
          // Otherwise suggest removal or changing to unit type
          dead_codes.every((dc) => trailing_tuple_fields.has(dc.def_id)) ? { $: "Remove", num } : { $: "ChangeToUnitTypeOrRemove", num, spans: [...spans] };

        diag = {
          $: "UnusedTupleStructFields",
          multiple,
          num,
          descr,
          participle,
          name_list,
          dead_code_pub_in_binary_note: this.dead_code_pub_in_binary_note(),
          change_fields_suggestion: fields_suggestion,
          parent_info,
          ignored_derived_impls,
        };
        break;
      }
      case "NamedField": {
        const enum_variants_with_same_name: EnumVariantSameName[] = dead_codes.flatMap((dead_item): EnumVariantSameName[] => {
          const dk = tcx.def_kind(dead_item.def_id);
          if (dk.$ === "AssocFn" || dk.$ === "AssocConst") {
            const impl_did = tcx.local_parent(dead_item.def_id);
            const ik = tcx.def_kind(impl_did);
            if (ik.$ === "Impl" && !ik.of_trait) {
              const k = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(impl_did) as EarlyBinder<Ty>)).kind();
              if (k.$ === "Adt") {
                const maybe_enum = k._0;
                if (maybe_enum.is_enum()) {
                  const variant = maybe_enum.variants().find((i) => i.name === dead_item.name);
                  if (variant !== undefined) {
                    return [
                      {
                        dead_descr: tcx.def_descr(LocalDefId.to_def_id(dead_item.def_id)),
                        dead_name: dead_item.name,
                        variant_span: tcx.def_span(variant.def_id),
                      },
                    ];
                  }
                }
              }
            }
          }
          return [];
        });

        diag = {
          $: "DeadCodes",
          multiple,
          num,
          descr,
          participle,
          name_list,
          dead_code_pub_in_binary_note: this.dead_code_pub_in_binary_note(),
          parent_info,
          ignored_derived_impls,
          enum_variants_with_same_name,
        };
        break;
      }
    }

    const hir_id = tcx.local_def_id_to_hir_id(first_item.def_id);
    this.tcx.emit_node_span_lint(this.target_lint, hir_id, MultiSpanC.from_spans(spans) as MultiSpan, MultipleDeadCodes_diagnostic(diag));
  }

  // rustc: compiler/rustc_passes/src/dead.rs:1376 warn_multiple
  warn_multiple(def_id: LocalDefId, participle: string, dead_codes_: DeadItem[], report_on: ReportOn): void {
    const dead_codes = dead_codes_.filter((v) => !Symbol.as_str(v.name).startsWith("_"));
    if (dead_codes.length === 0) {
      return;
    }
    // FIXME: `dead_codes` should probably be morally equivalent to
    // `IndexMap<(Level, StableLintExpectationId), (DefId, Symbol)>`
    // `sort_by_key` is stable (as `Array.prototype.sort`).
    dead_codes.sort((a, b) => Level_discriminant[a.level_plus[0]] - Level_discriminant[b.level_plus[0]]);
    // `chunk_by(|a, b| a.level_plus == b.level_plus)`
    let start = 0;
    for (let i = 1; i <= dead_codes.length; i++) {
      if (i === dead_codes.length || !level_plus_eq(dead_codes[i - 1]!.level_plus, dead_codes[i]!.level_plus)) {
        const group = dead_codes.slice(start, i);
        this.lint_at_single_level(group, participle, def_id, report_on);
        start = i;
      }
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:1398 warn_dead_code
  warn_dead_code(id: LocalDefId, participle: string): void {
    const item: DeadItem = {
      def_id: id,
      name: this.tcx.item_name(LocalDefId.to_def_id(id)),
      level_plus: this.def_lint_level_plus(id),
    };
    this.lint_at_single_level([item], participle, undefined, "NamedField");
  }

  // rustc: compiler/rustc_passes/src/dead.rs:1407 check_definition
  check_definition(def_id: LocalDefId): void {
    if (this.is_live_code(def_id)) {
      return;
    }
    const dk = this.tcx.def_kind(def_id);
    switch (dk.$) {
      case "AssocConst":
      case "AssocTy":
      case "AssocFn":
      case "Fn":
      case "Static":
      case "Const":
      case "TyAlias":
      case "Enum":
      case "Union":
      case "ForeignTy":
      case "Trait":
        this.warn_dead_code(def_id, "used");
        break;
      case "Struct":
        this.warn_dead_code(def_id, "constructed");
        break;
      case "Variant":
      case "Field":
        bug("should be handled specially");
        break;
      default:
        break;
    }
  }

  // rustc: compiler/rustc_passes/src/dead.rs:1429 is_live_code
  is_live_code(def_id: LocalDefId): boolean {
    // if we cannot get a name for the item, then we just assume that it is
    // live. I mean, we can't really emit a lint.
    const name = this.tcx.opt_item_name(LocalDefId.to_def_id(def_id));
    if (name === undefined) {
      return true;
    }

    return this.live_symbols.has(def_id) || Symbol.as_str(name).startsWith("_");
  }
}

/** `str::starts_with(|c: char| c.is_ascii_digit())` */
function starts_with_ascii_digit(s: string): boolean {
  const c = s.charCodeAt(0);
  return c >= 0x30 && c <= 0x39;
}

/** `Option<Span>::unwrap()` */
function unwrap_span(s: Span | undefined): Span {
  if (s === undefined) return bug("called `Option::unwrap()` on a `None` value");
  return s;
}

// rustc: compiler/rustc_passes/src/dead.rs:1440 check_mod_deathness
function check_mod_deathness(tcx: TyCtxt, module: LocalModId): null {
  const r = tcx.live_symbols_and_ignored_derived_traits(null) as Result<DeadCodeLivenessSummary, ErrorGuaranteed>;
  if (r.$ !== "Ok") {
    return null;
  }
  const { pre_deferred_seeding, final_result } = r._0;

  const module_items = tcx.hir_module_items(module) as ModuleItems;

  if (tcx.crate_types().includes("Executable")) {
    const is_unused_pub = (def_id: LocalDefId): boolean =>
      tcx.effective_visibilities(null).is_public_at_level(def_id, "Reachable") && !pre_deferred_seeding.live_symbols.has(def_id);

    lint_dead_codes(
      tcx,
      DEAD_CODE_PUB_IN_BINARY,
      module,
      pre_deferred_seeding.live_symbols,
      pre_deferred_seeding.ignored_derived_traits,
      module_items.free_items().filter((free_item) => is_unused_pub(free_item.owner_id.def_id)),
      module_items.foreign_items().filter((foreign_item) => is_unused_pub(foreign_item.owner_id.def_id)),
    );
  }

  lint_dead_codes(
    tcx,
    DEAD_CODE,
    module,
    final_result.live_symbols,
    final_result.ignored_derived_traits,
    module_items.free_items(),
    module_items.foreign_items(),
  );
  return null;
}

// rustc: compiler/rustc_passes/src/dead.rs:1479 lint_dead_codes
function lint_dead_codes(
  tcx: TyCtxt,
  target_lint: Lint,
  module: LocalModId,
  live_symbols: Set<LocalDefId>,
  ignored_derived_traits: Map<LocalDefId, DefIdSet>,
  free_items: Iterable<hir.ItemId>,
  foreign_items: Iterable<hir.ForeignItemId>,
): void {
  const visitor = new DeadVisitor(tcx, target_lint, live_symbols, ignored_derived_traits);
  for (const item of free_items) {
    const def_kind = tcx.def_kind(item.owner_id);

    const dead_codes: DeadItem[] = [];
    // Only diagnose unused assoc items in inherent impl and used trait,
    // for unused assoc items in impls of trait,
    // we have diagnosed them in the trait if they are unused,
    // for unused assoc items in unused trait,
    // we have diagnosed the unused trait.
    if ((def_kind.$ === "Impl" && !def_kind.of_trait) || (def_kind.$ === "Trait" && live_symbols.has(item.owner_id.def_id))) {
      for (const def_id of tcx.associated_item_def_ids(item.owner_id.def_id)) {
        const local_def_id = def_id.as_local();
        if (local_def_id !== undefined && !visitor.is_live_code(local_def_id)) {
          const name = tcx.item_name(def_id);
          const level_plus = visitor.def_lint_level_plus(local_def_id);
          dead_codes.push({ def_id: local_def_id, name, level_plus });
        }
      }
    }
    if (dead_codes.length !== 0) {
      visitor.warn_multiple(item.owner_id.def_id, "used", dead_codes, "NamedField");
    }

    if (!live_symbols.has(item.owner_id.def_id)) {
      const parent = tcx.local_parent(item.owner_id.def_id);
      if (parent !== LocalModId.to_local_def_id(module) && !live_symbols.has(parent)) {
        // We already have diagnosed something, but check parent's field for #[expect]
        visitor.fulfill_dead_code_expectations(item.owner_id.def_id, true);
        continue;
      }
      visitor.check_definition(item.owner_id.def_id);
      visitor.fulfill_dead_code_expectations(item.owner_id.def_id, false);
      continue;
    }

    if (def_kind.$ === "Struct" || def_kind.$ === "Union" || def_kind.$ === "Enum") {
      const adt = tcx.adt_def(item.owner_id) as AdtDef;
      const dead_variants: DeadItem[] = [];

      for (const variant of adt.variants()) {
        const def_id = variant.def_id.expect_local();
        if (!live_symbols.has(def_id)) {
          // Record to group diagnostics.
          const level_plus = visitor.def_lint_level_plus(def_id);
          dead_variants.push({ def_id, name: variant.name, level_plus });
          visitor.fulfill_dead_code_expectations(def_id, false);
          continue;
        }

        const first = variant.fields[0];
        const is_positional = first !== undefined && starts_with_ascii_digit(Symbol.as_str(first.name));
        const report_on: ReportOn = is_positional ? "TupleField" : "NamedField";
        const dead_fields: DeadItem[] = variant.fields.flatMap((field): DeadItem[] => {
          const def_id = field.did.expect_local();
          if (visitor.should_warn_about_field(field) === "Yes") {
            const level_plus = visitor.def_lint_level_plus(def_id);
            return [{ def_id, name: field.name, level_plus }];
          } else {
            return [];
          }
        });
        visitor.warn_multiple(def_id, "read", dead_fields, report_on);
      }

      visitor.warn_multiple(item.owner_id.def_id, "constructed", dead_variants, "NamedField");
    }
  }

  for (const foreign_item of foreign_items) {
    visitor.check_definition(foreign_item.owner_id.def_id);
  }
}

// rustc: compiler/rustc_passes/src/dead.rs:1576 provide
export function provide(providers: Providers): void {
  providers.live_symbols_and_ignored_derived_traits = live_symbols_and_ignored_derived_traits;
  providers.check_mod_deathness = check_mod_deathness;
}
