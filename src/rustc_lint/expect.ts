// Port of compiler/rustc_lint/src/expect.rs: the `lint_expectations` and `check_expectations` queries (unfulfilled
// `#[expect]` attributes).
import { Attribute } from "../rustc_attr_ir/attr.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { builtin, LintExpectationId, type StableLintExpectationId } from "../rustc_lint_defs/lib.ts";
import type { LintExpectation, ShallowLintLevelMap } from "../rustc_middle/lint.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import type { Providers as QueryProviders } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AttrId } from "../rustc_span/lib.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { Expectation_diagnostic, type ExpectationNote } from "./diagnostics.ts";

const { UNFULFILLED_LINT_EXPECTATIONS } = builtin;

// rustc: compiler/rustc_lint/src/expect.rs:11 provide
export function provide(providers: QueryProviders): void {
  providers.lint_expectations = lint_expectations;
  providers.check_expectations = check_expectations;
}

// rustc: compiler/rustc_lint/src/expect.rs:15 lint_expectations
function lint_expectations(tcx: TyCtxt, _: null): [StableLintExpectationId, LintExpectation][] {
  const krate = tcx.hir_crate_items(null) as ModuleItems;

  const expectations: [StableLintExpectationId, LintExpectation][] = [];

  for (const owner of krate.owners()) {
    const lints = tcx.shallow_lint_levels_on(owner) as ShallowLintLevelMap;
    expectations.push(...lints.expectations);
  }

  return expectations;
}

// rustc: compiler/rustc_lint/src/expect.rs:28 check_expectations
function check_expectations(tcx: TyCtxt, tool_filter: Symbol | undefined): null {
  const lint_expectations = tcx.lint_expectations(null) as [StableLintExpectationId, LintExpectation][];
  const fulfilled_expectations_ = tcx.dcx().steal_fulfilled_expectation_ids();

  // Turn a `LintExpectationId` into a `(AttrId, lint_index)` pair.
  // PORT: the pair is returned as its `FxHashSet` key, the string `"<attr_id>.<lint_index>"`.
  const canonicalize_id = (expect_id: LintExpectationId): string => {
    let attr_id: AttrId;
    let lint_index: number;
    switch (expect_id.$) {
      case "Unstable": {
        const id = expect_id._0;
        [attr_id, lint_index] = [id.attr_id, id.lint_index];
        break;
      }
      case "Stable": {
        const id = expect_id._0;
        // We are an `eval_always` query, so looking at the attribute's `AttrId` is ok.
        // PORT: `id.hir_id` is rustc_lint_defs' field-only `HirId` stand-in; `hir_attrs` reads only its fields.
        [attr_id, lint_index] = [Attribute.id(tcx.hir_attrs(id.hir_id as HirId)[id.attr_index]!), id.lint_index];
        break;
      }
    }
    return `${attr_id}.${lint_index}`;
  };

  const fulfilled_expectations = new Set<string>();
  for (const id of fulfilled_expectations_) fulfilled_expectations.add(canonicalize_id(id));

  for (const [expect_id_, expectation] of lint_expectations) {
    // PORT: the ids come from `LintLevelQueryMap::mk_lint_expectation_id`, whose `hir_id` is a `rustc_hir_id::HirId`.
    const hir_id = expect_id_.hir_id as HirId;
    const expect_id = canonicalize_id(LintExpectationId.Stable(expect_id_));

    if (!fulfilled_expectations.has(expect_id) && (tool_filter === undefined || expectation.lint_tool === tool_filter)) {
      const rationale: ExpectationNote | undefined = expectation.reason === undefined ? undefined : { rationale: expectation.reason };
      const note = expectation.is_unfulfilled_lint_expectations;
      tcx.emit_node_span_lint(UNFULFILLED_LINT_EXPECTATIONS, hir_id, expectation.emission_span, Expectation_diagnostic({ rationale, note }));
    }
  }
  return null;
}
