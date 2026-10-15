// Port of compiler/rustc_mir_build/src/thir/pattern/migration.rs: STUB (lane thir-pattern; "How to fill a stub" in
// pattern/mod.ts).
//! Automatic migration of Rust 2021 patterns to a form valid in both Editions 2021 and 2024.
import type { Mutability } from "../../../rustc_ast_ir/lib.ts";
import type { BindingMode } from "../../../rustc_ast/lib.ts";
import type { HirId } from "../../../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { PatAdjustment } from "../../../rustc_middle/ty/adjustment.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import type { Ident } from "../../../rustc_span/symbol.ts";
import { unported_methods } from "../../../rust_ts/stubs.ts";
import { unported } from "../../../std/panic.ts";

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
    // PORT: `&'a Rust2024IncompatiblePatInfo` (ty/typeck_results.rs); typed when the lane fills this file.
    public info: unknown,
  ) {}

  // (migration.rs:30 new: stub)
  static new(_info: unknown): PatMigration {
    return unported("rustc_mir_build::thir::pattern::migration::PatMigration::new (lane thir-pattern)");
  }
}

export interface PatMigration {
  /// On Rust 2024, this emits a hard error. On earlier Editions, this emits the
  /// future-incompatibility lint `rust_2024_incompatible_pat`.
  emit(tcx: TyCtxt, pat_id: HirId): void;
  primary_message(is_hard_error: boolean): string;
  // PORT: `diag: &mut Diag<'_>` (rustc_errors).
  format_subdiagnostics(diag: unknown): void;
  visit_implicit_derefs(pat_span: Span, adjustments: readonly PatAdjustment[]): [Span, Mutability] | undefined;
  visit_explicit_deref(): [Span, Mutability] | undefined;
  leave_ref(old_mode_span: [Span, Mutability] | undefined): void;
  visit_binding(pat_span: Span, mode: BindingMode, explicit_ba: BindingMode, ident: Ident): void;
}

unported_methods(PatMigration.prototype, "rustc_mir_build::thir::pattern::migration::PatMigration", [
  "emit",
  "primary_message",
  "format_subdiagnostics",
  "visit_implicit_derefs",
  "visit_explicit_deref",
  "leave_ref",
  "visit_binding",
]);
