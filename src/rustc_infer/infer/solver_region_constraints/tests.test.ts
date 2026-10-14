// Port of compiler/rustc_infer/src/infer/solver_region_constraints/tests.rs (lane infcx-contract).
import { expect, test } from "bun:test";
import { type BytePos, create_default_session_globals_then, Span } from "../../../rustc_span/lib.ts";
import { And, type LeafRegionConstraint, Or } from "../../../rustc_type_ir/region_constraint.ts";
import { assert_eq } from "../../../std/panic.ts";

// rustc: compiler/rustc_infer/src/infer/solver_region_constraints/tests.rs:6 canonicalization_preserves_only_one_ambiguity
test("canonicalization_preserves_only_one_ambiguity", () => {
  create_default_session_globals_then(() => {
    const first_span = Span.with_root_ctxt(1 as BytePos, 2 as BytePos);
    const second_span = Span.with_root_ctxt(3 as BytePos, 4 as BytePos);

    const first: LeafRegionConstraint<Span> = { $: "Ambiguity", _0: first_span };
    const second: LeafRegionConstraint<Span> = { $: "Ambiguity", _0: second_span };

    const c = And.new([first, second]);
    assert_eq(c._0.length, 1, String);
    expect(c._0.length).toBe(1);

    // PORT: upstream shadows `c`; the second binding is `c_`.
    const c_ = Or.new([And.new([first]), And.new([second])]);
    assert_eq(c_._0.length, 1, String);
    expect(c_._0.length).toBe(1);
  });
});
