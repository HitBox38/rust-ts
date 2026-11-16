// `clippy_utils::diagnostics` against the oracle clippy-driver (lane clippy-contract-b2).
//
// Fixtures: diagnostics_oracle/case.stderr and case.nodocs.stderr, the oracle's stderr on diagnostics_oracle/case.rs
// (written by diagnostics_oracle/capture.ts, run by hand). case.rs triggers one on-by-default clippy lint per wrapper:
// span_lint (temporary_assignment), span_lint_and_help without and with a help span (approx_constant,
// redundant_locals), span_lint_and_note without and with a note span (suspicious_assignment_formatting,
// field_reassign_with_default), span_lint_and_sugg (redundant_field_names) and span_lint_hir (partialeq_ne_impl);
// every one goes through span_lint_and_then or span_lint_hir_and_then.
//
// What the test does in place of the lints (clippy_lints is not ported yet): it compiles case.rs with the ported
// front end, lowers it to HIR, and calls each wrapper with the arguments the upstream lint passes (its `cx`, lint
// static, span, message and help/note/suggestion, as in the lint's source, quoted per call below) in the order the
// oracle printed them, through a `LateContext` at the crate root. Lint levels come from the ported `lint_level`
// machinery: no attribute names a clippy lint, so each level is its default, as for the oracle. The rendered stderr
// must equal the oracle's byte for byte: the primary message and span, the help/note/suggestion children, the docs
// link `docs_link` appends ("for further information visit https://rust-lang.github.io/rust-clippy/main/..."), the
// "`#[warn(clippy::..)]` on by default" note, and the final error count. With CLIPPY_DISABLE_DOCS_LINKS set, the
// docs link is gone (case.nodocs.stderr).
import { expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Applicability } from "../rustc_errors/lib.ts";
import { CRATE_HIR_ID } from "../rustc_hir_id/lib.ts";
import { LateContext } from "../rustc_lint/context.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { remove_var, set_var } from "../std/env.ts";
import { APPROX_CONSTANT } from "../clippy_lints/approx_const.lints.gen.ts";
import { FIELD_REASSIGN_WITH_DEFAULT } from "../clippy_lints/default.lints.gen.ts";
import { SUSPICIOUS_ASSIGNMENT_FORMATTING } from "../clippy_lints/formatting.lints.gen.ts";
import { PARTIALEQ_NE_IMPL } from "../clippy_lints/partialeq_ne_impl.lints.gen.ts";
import { REDUNDANT_FIELD_NAMES } from "../clippy_lints/redundant_field_names.lints.gen.ts";
import { REDUNDANT_LOCALS } from "../clippy_lints/redundant_locals.lints.gen.ts";
import { TEMPORARY_ASSIGNMENT } from "../clippy_lints/temporary_assignment.lints.gen.ts";
import { span_lint, span_lint_and_help, span_lint_and_note, span_lint_and_sugg, span_lint_hir } from "./diagnostics.ts";
import { render_with, type SpanAt } from "./diagnostics_oracle/harness.ts";

const DIR = join(import.meta.dir, "diagnostics_oracle");

/** The upstream lints' calls on case.rs, in the order the oracle printed them. */
function replay(tcx: TyCtxt, sp: SpanAt): void {
  const cx = new LateContext(tcx, undefined, undefined, undefined as never, undefined as never, CRATE_HIR_ID, undefined, false);
  // redundant_field_names.rs: span_lint_and_sugg(cx, REDUNDANT_FIELD_NAMES, field.span, "redundant field names in struct
  // initialization", "replace it with", field.ident.to_string(), Applicability::MachineApplicable)
  span_lint_and_sugg(cx, REDUNDANT_FIELD_NAMES, sp(27, 17, 27, 21), "redundant field names in struct initialization", "replace it with", "x", Applicability.MachineApplicable);
  // formatting.rs: span_lint_and_note(cx, SUSPICIOUS_ASSIGNMENT_FORMATTING, eqop_span, format!(..), None, format!(..))
  span_lint_and_note(
    cx,
    SUSPICIOUS_ASSIGNMENT_FORMATTING,
    sp(29, 6, 29, 10),
    "this looks like you are trying to use `.. -= ..`, but you really are doing `.. = (- ..)`",
    undefined,
    "to remove this lint, use either `-=` or `= -`",
  );
  // partialeq_ne_impl.rs: span_lint_hir(cx, PARTIALEQ_NE_IMPL, impl_item.hir_id(), cx.tcx.def_span(..), "re-implementing
  // `PartialEq::ne` is unnecessary"); PORT: the crate root's HirId stands for the impl item's (same levels here)
  span_lint_hir(cx, PARTIALEQ_NE_IMPL, CRATE_HIR_ID, sp(13, 5, 13, 32), "re-implementing `PartialEq::ne` is unnecessary");
  // default.rs: span_lint_and_note(cx, FIELD_REASSIGN_WITH_DEFAULT, first_assign.unwrap().span, "..", Some(local.span),
  // format!("consider initializing the variable with `{sugg}` and removing relevant reassignments"))
  span_lint_and_note(
    cx,
    FIELD_REASSIGN_WITH_DEFAULT,
    sp(33, 5, 33, 13),
    "field assignment outside of initializer for an instance created with Default::default()",
    sp(32, 5, 32, 30),
    "consider initializing the variable with `D { a: 1, ..Default::default() }` and removing relevant reassignments",
  );
  // approx_const.rs: span_lint_and_help(cx, APPROX_CONSTANT, span, format!("approximate value of `{module}::consts::{name}`
  // found"), None, "consider using the constant directly")
  span_lint_and_help(cx, APPROX_CONSTANT, sp(25, 14, 25, 21), "approximate value of `f{32, 64}::consts::PI` found", undefined, "consider using the constant directly");
  // redundant_locals.rs: span_lint_and_help(cx, REDUNDANT_LOCALS, local.span, format!("redundant redefinition of a binding
  // `{ident}`"), Some(binding_pat.span), format!("`{ident}` is initially defined here"))
  span_lint_and_help(cx, REDUNDANT_LOCALS, sp(31, 5, 31, 15), "redundant redefinition of a binding `y`", sp(30, 9, 30, 10), "`y` is initially defined here");
  // temporary_assignment.rs: span_lint(cx, TEMPORARY_ASSIGNMENT, expr.span, "assignment to temporary")
  span_lint(cx, TEMPORARY_ASSIGNMENT, sp(34, 5, 34, 17), "assignment to temporary");
}

test("the wrappers render as the oracle clippy-driver's diagnostics (docs links, on-by-default notes)", () => {
  remove_var("CLIPPY_DISABLE_DOCS_LINKS");
  expect(render_with("case.rs", { post: replay })).toBe(readFileSync(join(DIR, "case.stderr"), "utf8"));
});

test("CLIPPY_DISABLE_DOCS_LINKS drops the docs link", () => {
  set_var("CLIPPY_DISABLE_DOCS_LINKS", "1");
  try {
    expect(render_with("case.rs", { post: replay })).toBe(readFileSync(join(DIR, "case.nodocs.stderr"), "utf8"));
  } finally {
    remove_var("CLIPPY_DISABLE_DOCS_LINKS");
  }
});
