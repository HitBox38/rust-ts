// Port of compiler/rustc_mir_build/src/thir/pattern/migration.rs (lane thir-pattern).
//! Automatic migration of Rust 2021 patterns to a form valid in both Editions 2021 and 2024.
import { type BindingMode, BindingMode_eq, BindingMode as BindingModeC } from "../../../rustc_ast/lib.ts";
import { Mutability, Mutability_cmp } from "../../../rustc_ast_ir/lib.ts";
import { MultiSpan } from "../../../rustc_error_messages/lib.ts";
import { Applicability, type Diag, DiagDecorator, pluralize } from "../../../rustc_errors/lib.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import { RUST_2024_INCOMPATIBLE_PAT } from "../../../rustc_lint_defs/builtin.gen.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { PatAdjustment } from "../../../rustc_middle/ty/adjustment.ts";
import type { Rust2024IncompatiblePatInfo } from "../../../rustc_middle/ty/typeck_results.ts";
import { Span } from "../../../rustc_span/lib.ts";
import type { Ident } from "../../../rustc_span/symbol.ts";
import { panic } from "../../../std/panic.ts";

/// For patterns flagged for migration during HIR typeck, this handles constructing and emitting
/// a diagnostic suggestion.
// rustc-type: compiler/rustc_mir_build/src/thir/pattern/migration.rs:12 PatMigration
export class PatMigration {
  constructor(
    public suggestion: [Span, string][],
    public ref_pattern_count: number,
    public binding_mode_count: number,
    /// Internal state: the ref-mutability of the default binding mode at the subpattern being
    /// lowered, with the span where it was introduced. `None` for a by-value default mode.
    public default_mode_span: [Span, Mutability] | undefined,
    /// Labels for where incompatibility-causing by-ref default binding modes were introduced.
    // FIXME(ref_pat_eat_one_layer_2024_structural): To track the default binding mode, we duplicate
    // logic from HIR typeck (in order to avoid needing to store all changes to the dbm in
    // TypeckResults). Since the default binding mode acts differently under this feature gate, the
    // labels will be wrong.
    public default_mode_labels: Map<Span, Mutability>,
    /// Information collected from typeck, including spans for subpatterns invalid in Rust 2024.
    public info: Rust2024IncompatiblePatInfo,
  ) {}

  // rustc: compiler/rustc_mir_build/src/thir/pattern/migration.rs:30 new
  static new(info: Rust2024IncompatiblePatInfo): PatMigration {
    return new PatMigration([], 0, 0, undefined, new Map(), info);
  }

  /// On Rust 2024, this emits a hard error. On earlier Editions, this emits the
  /// future-incompatibility lint `rust_2024_incompatible_pat`.
  // rustc: compiler/rustc_mir_build/src/thir/pattern/migration.rs:43 emit
  emit(tcx: TyCtxt, pat_id: HirId): void {
    const spans = MultiSpan.from_spans(this.info.primary_labels.map(([span, _]) => span));
    for (const [span, label] of this.info.primary_labels) {
      spans.push_span_label(span, label);
    }
    // If a relevant span is from at least edition 2024, this is a hard error.
    const is_hard_error = spans.primary_spans_().some((span) => Span.at_least_rust_2024(span));
    const primary_message = this.primary_message(is_hard_error);
    if (is_hard_error) {
      const err = tcx.dcx().struct_span_err(spans, primary_message);
      err.note("for more information, see <https://doc.rust-lang.org/reference/patterns.html#binding-modes>");
      this.format_subdiagnostics(err);
      err.emit();
    } else {
      tcx.emit_node_span_lint(
        RUST_2024_INCOMPATIBLE_PAT,
        pat_id,
        spans,
        DiagDecorator((diag) => {
          diag.primary_message(primary_message);
          this.format_subdiagnostics(diag);
        }),
      );
    }
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/migration.rs:70 primary_message
  primary_message(is_hard_error: boolean): string {
    let verb1: string;
    const { bad_mut_modifiers, bad_ref_modifiers, bad_ref_pats } = this.info;
    if (bad_mut_modifiers && bad_ref_modifiers) {
      verb1 = "write explicit binding modifiers";
    } else if (bad_mut_modifiers && !bad_ref_modifiers) {
      verb1 = "mutably bind by value";
    } else if (!bad_mut_modifiers && bad_ref_modifiers) {
      verb1 = "explicitly borrow";
    } else {
      verb1 = "explicitly dereference";
    }
    let or_verb2: string;
    if ((!bad_mut_modifiers && !bad_ref_modifiers) || !bad_ref_pats) {
      // We only need two verb phrases if mentioning both modifiers and reference patterns.
      or_verb2 = "";
    } else if (bad_mut_modifiers && bad_ref_pats) {
      // If mentioning `mut`, we don't have an "explicitly" yet.
      or_verb2 = " or explicitly dereference";
    } else {
      // (false, true, true)
      // If mentioning `ref`/`ref mut` but not `mut`, we already have an "explicitly".
      or_verb2 = " or dereference";
    }
    const in_rust_2024 = is_hard_error ? "" : " in Rust 2024";
    return `cannot ${verb1}${or_verb2} within an implicitly-borrowing pattern${in_rust_2024}`;
  }

  // rustc: compiler/rustc_mir_build/src/thir/pattern/migration.rs:93 format_subdiagnostics
  format_subdiagnostics(diag: Diag): void {
    // Format and emit explanatory notes about default binding modes. Reversing the spans' order
    // means if we have nested spans, the innermost ones will be visited first.
    for (const [span, def_br_mutbl] of [...this.default_mode_labels].reverse()) {
      // Don't point to a macro call site.
      if (!Span.from_expansion(span)) {
        const note_msg = "matching on a reference type with a non-reference pattern implicitly borrows the contents";
        const label_msg = `this non-reference pattern matches on a reference type \`${Mutability.ref_prefix_str(def_br_mutbl)}_\``;
        const label = MultiSpan.from_span(span);
        label.push_span_label(span, label_msg);
        diag.span_note(label, note_msg);
      }
    }

    // Format and emit the suggestion.
    const applicability = this.suggestion.every(([span, _]) => Span.can_be_used_for_suggestions(span))
      ? Applicability.MachineApplicable
      : Applicability.MaybeIncorrect;
    const plural_modes = pluralize(this.binding_mode_count);
    let msg: string;
    if (this.info.suggest_eliding_modes) {
      msg = `remove the unnecessary binding modifier${plural_modes}`;
    } else {
      const match_on_these_references =
        this.ref_pattern_count === 1
          ? "match on the reference with a reference pattern"
          : "match on these references with reference patterns";
      let and_explain_modes: string;
      if (this.binding_mode_count > 0) {
        const a = this.binding_mode_count === 1 ? "a " : "";
        and_explain_modes = ` and borrow explicitly using ${a}variable binding mode${plural_modes}`;
      } else {
        and_explain_modes = " to avoid implicitly borrowing";
      }
      msg = `${match_on_these_references}${and_explain_modes}`;
    }
    // FIXME(dianne): for peace of mind, don't risk emitting a 0-part suggestion (that panics!)
    // debug_assert!(!self.suggestion.is_empty());
    if (this.suggestion.length !== 0) {
      diag.multipart_suggestion(msg, this.suggestion, applicability);
    }
  }

  /// Tracks when we're lowering a pattern that implicitly dereferences the scrutinee.
  /// This should only be called when the pattern type adjustments list `adjustments` contains an
  /// implicit deref of a reference type. Returns the prior default binding mode; this should be
  /// followed by a call to [`PatMigration::leave_ref`] to restore it when we leave the pattern.
  // rustc: compiler/rustc_mir_build/src/thir/pattern/migration.rs:145 visit_implicit_derefs
  visit_implicit_derefs(pat_span: Span, adjustments: readonly PatAdjustment[]): [Span, Mutability] | undefined {
    // Implicitly dereferencing references changes the default binding mode, but implicit derefs
    // of smart pointers do not. Thus, we only consider implicit derefs of reference types.
    const implicit_deref_mutbls: Mutability[] = [];
    for (const adjust of adjustments) {
      const k = adjust.source.kind();
      if (k.$ === "Ref") implicit_deref_mutbls.push(k._2);
    }

    if (!this.info.suggest_eliding_modes) {
      // If we can't fix the pattern by eliding modifiers, we'll need to make the pattern
      // fully explicit. i.e. we'll need to suggest reference patterns for this.
      const suggestion_str: string = implicit_deref_mutbls.map((mutbl) => Mutability.ref_prefix_str(mutbl)).join("");
      this.suggestion.push([Span.shrink_to_lo(pat_span), suggestion_str]);
      this.ref_pattern_count += adjustments.length;
    }

    // Remember if this changed the default binding mode, in case we want to label it.
    if (implicit_deref_mutbls.length === 0) return panic("called `Option::unwrap()` on a `None` value");
    let min_mutbl = implicit_deref_mutbls[0]!;
    for (const m of implicit_deref_mutbls.slice(1)) if (Mutability_cmp(m, min_mutbl) < 0) min_mutbl = m;
    if (this.default_mode_span === undefined || Mutability_cmp(min_mutbl, this.default_mode_span[1]) < 0) {
      // This changes the default binding mode to `ref` or `ref mut`. Return the old mode so
      // it can be reinstated when we leave the pattern.
      const old = this.default_mode_span;
      this.default_mode_span = [pat_span, min_mutbl];
      return old;
    } else {
      // This does not change the default binding mode; it was already `ref` or `ref mut`.
      return this.default_mode_span;
    }
  }

  /// Tracks the default binding mode when we're lowering a `&` or `&mut` pattern.
  /// Returns the prior default binding mode; this should be followed by a call to
  /// [`PatMigration::leave_ref`] to restore it when we leave the pattern.
  // rustc: compiler/rustc_mir_build/src/thir/pattern/migration.rs:180 visit_explicit_deref
  visit_explicit_deref(): [Span, Mutability] | undefined {
    if (this.default_mode_span !== undefined) {
      const [default_mode_span, default_ref_mutbl] = this.default_mode_span;
      // If this eats a by-ref default binding mode, label the binding mode.
      this.default_mode_labels.set(default_mode_span, default_ref_mutbl);
    }
    // Set the default binding mode to by-value and return the old default binding mode so it
    // can be reinstated when we leave the pattern.
    const old = this.default_mode_span;
    this.default_mode_span = undefined;
    return old;
  }

  /// Restores the default binding mode after lowering a pattern that could change it.
  /// This should follow a call to either [`PatMigration::visit_explicit_deref`] or
  /// [`PatMigration::visit_implicit_derefs`].
  // rustc: compiler/rustc_mir_build/src/thir/pattern/migration.rs:193 leave_ref
  leave_ref(old_mode_span: [Span, Mutability] | undefined): void {
    this.default_mode_span = old_mode_span;
  }

  /// Determines if a binding is relevant to the diagnostic and adjusts the notes/suggestion if
  /// so. Bindings are relevant if they have a modifier under a by-ref default mode (invalid in
  /// Rust 2024) or if we need to suggest a binding modifier for them.
  // rustc: compiler/rustc_mir_build/src/thir/pattern/migration.rs:200 visit_binding
  visit_binding(pat_span: Span, mode: BindingMode, explicit_ba: BindingMode, ident: Ident): void {
    if (!BindingMode_eq(explicit_ba, BindingModeC.NONE) && this.default_mode_span !== undefined) {
      const [default_mode_span, default_ref_mutbl] = this.default_mode_span;
      // If this overrides a by-ref default binding mode, label the binding mode.
      this.default_mode_labels.set(default_mode_span, default_ref_mutbl);
      // If our suggestion is to elide redundnt modes, this will be one of them.
      if (this.info.suggest_eliding_modes) {
        this.suggestion.push([Span.with_hi(pat_span, Span.lo(ident.span)), ""]);
        this.binding_mode_count += 1;
      }
    }
    if (!this.info.suggest_eliding_modes && explicit_ba._0.$ === "No" && mode._0.$ === "Yes") {
      const mutbl = mode._0._1;
      // If we can't fix the pattern by eliding modifiers, we'll need to make the pattern
      // fully explicit. i.e. we'll need to suggest reference patterns for this.
      let sugg_str: string;
      switch (mutbl) {
        case "Not":
          sugg_str = "ref ";
          break;
        case "Mut":
          sugg_str = "ref mut ";
          break;
      }
      this.suggestion.push([Span.shrink_to_lo(Span.with_lo(pat_span, Span.lo(ident.span))), sugg_str]);
      this.binding_mode_count += 1;
    }
  }
}
