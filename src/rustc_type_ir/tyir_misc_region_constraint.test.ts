// Sub-lane region-constraint (lane tyir-misc): region_constraint.rs.
//
// The oracle strings below were printed by the pinned nightly (rustc 1.101.0-nightly 6f5da406b 2026-10-10) through a
// throwaway rustc-dev program (`rustc_driver` with an `after_expansion` callback; see the lane handoff, "Probe") that
// builds the same values with rustc's own `TyCtxt` (`Region::new_var(tcx, RegionVid::from_u32(n))`,
// `tcx.lifetimes.re_static` / `re_erased`) and the real `rustc_type_ir::region_constraint` API, and prints them with
// `{:?}` / `{:#?}`. The graph queries ran on `Assumptions::new_unelaborated(vec![], builder.freeze())` with the real
// `rustc_data_structures::transitive_relation`.
import { describe, expect, test } from "bun:test";
import "../rustc_middle/lib.ts";
import { TransitiveRelationBuilder } from "../rustc_data_structures/transitive_relation.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { type Debug, debug_vec, format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import { Panic } from "../std/panic.ts";
import type { BoundRegion, BoundVar, DebruijnIndex, RegionVid, UniverseIndex } from "./decls.ts";
import type { InferCtxtLike } from "./infer_ctxt.ts";
import { DebruijnIndex as DebruijnIndexC, INNERMOST } from "./lib.ts";
import {
  And,
  type Assumptions,
  Assumptions as AssumptionsC,
  debug_And,
  debug_Assumptions,
  debug_LeafRegionConstraint,
  debug_Or,
  debug_RegionConstraint,
  eagerly_handle_placeholders_in_universe,
  LeafRegionConstraint,
  Or,
  PlaceholderReplacer,
  RegionConstraint,
  regions_outlived_by,
  regions_outliving,
} from "./region_constraint.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { debug_Region, type Region } from "./sty/mod.ts";
import type { TypeFoldable, TypeFolder } from "./fold.ts";
import type { Binder } from "./binder.ts";

/** A `TyCtxt` over a fresh `CtxtInterners` (as in rustc_middle/ty/interning.test.ts). */
function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

const tcx = mk_tcx();
const rv = (n: number): Region => tcx.intern_region({ $: "ReVar", _0: n as RegionVid });
const [r1, r2, r3, r4] = [rv(1), rv(2), rv(3), rv(4)];
const st = tcx.intern_region({ $: "ReStatic" });
const er = tcx.intern_region({ $: "ReErased" });
const lo = (a: Region, b: Region): LeafRegionConstraint => ({ $: "RegionOutlives", _0: a, _1: b, _2: null });
const amb: LeafRegionConstraint = { $: "Ambiguity", _0: null };

const debug_unit: Debug<null> = () => "()";
const dbg_leaf = (l: LeafRegionConstraint, f = PLAIN) => format_debug(l, (v, f) => debug_LeafRegionConstraint(v, f, debug_unit), f);
const dbg_and = (a: And, f = PLAIN) => format_debug(a, (v, f) => debug_And(v, f, debug_unit), f);
const dbg_or = (o: Or, f = PLAIN) => format_debug(o, (v, f) => debug_Or(v, f, debug_unit), f);
const dbg_rc = (c: RegionConstraint, f = PLAIN) => format_debug(c, (v, f) => debug_RegionConstraint(v, f, debug_unit), f);
const dbg_regions = (rs: Region[]) => format_debug(rs, (v, f) => debug_vec(v, f, debug_Region), PLAIN);

/**
 * `Assumptions::new_unelaborated(vec![], builder.freeze())` over a relation with the `'a: 'b` edges `region_outlives`
 * (added in this order), as the oracle program built them; the inverse relation comes from the real `base_edges()`.
 */
function assumptions_of(region_outlives: [Region, Region][]): Assumptions {
  const builder = TransitiveRelationBuilder.default<Region>();
  for (const [a, b] of region_outlives) builder.add(a, b);
  return AssumptionsC.new_unelaborated([], builder.freeze());
}

describe("Debug (oracle)", () => {
  test("LeafRegionConstraint", () => {
    expect(dbg_leaf(amb)).toBe("Ambiguity");
    expect(dbg_leaf(amb, PRETTY)).toBe("Ambiguity");
    expect(dbg_leaf(lo(st, r1))).toBe("RegionOutlives('static, '?1)");
    expect(dbg_leaf(lo(st, r1), PRETTY)).toBe("RegionOutlives(\n    'static,\n    '?1,\n)");
    expect(dbg_leaf(lo(r1, er))).toBe("RegionOutlives('?1, '{erased})");
    expect(dbg_leaf(lo(r1, er), PRETTY)).toBe("RegionOutlives(\n    '?1,\n    '{erased},\n)");
    // with a span (`S = Span`): the span is never printed
    const sp = 7;
    expect(format_debug(LeafRegionConstraint.with_span(amb, sp), (v, f) => debug_LeafRegionConstraint(v, f, () => "SPAN"), PLAIN)).toBe("Ambiguity");
    expect(format_debug(LeafRegionConstraint.with_span(lo(r2, r3), sp), (v, f) => debug_LeafRegionConstraint(v, f, () => "SPAN"), PLAIN)).toBe("RegionOutlives('?2, '?3)");
  });

  test("Assumptions", () => {
    const a = assumptions_of([]);
    expect(format_debug(a, debug_Assumptions, PLAIN)).toBe('Assumptions { type_outlives: [], region_graph: "elided" }');
    expect(format_debug(a, debug_Assumptions, PRETTY)).toBe('Assumptions {\n    type_outlives: [],\n    region_graph: "elided",\n}');
  });
});

describe("And / Or combinators (oracle)", () => {
  test("And::new drops reflexive and duplicate leaves", () => {
    expect(dbg_and(And.new([lo(r1, r1), lo(r1, r2), lo(r1, r2), amb, amb]))).toBe("And([RegionOutlives('?1, '?2), Ambiguity])");
    expect(dbg_and(And.new_true())).toBe("And([])");
  });

  test("Or::new keeps canonical form", () => {
    expect(dbg_or(Or.new([And.new([lo(r1, r2)]), And.new([lo(r1, r2)])]))).toBe("Or([And([RegionOutlives('?1, '?2)])])");
    expect(dbg_or(Or.new([And.new([lo(r1, r2)]), And.new([lo(r3, r3)])]))).toBe("Or([And([])])");
    expect(dbg_or(Or.new([And.new([lo(r1, r2), lo(r2, r3)]), And.new([lo(r2, r3), lo(r1, r2)]), And.new([lo(r2, r3)])]))).toBe(
      "Or([And([RegionOutlives('?1, '?2), RegionOutlives('?2, '?3)]), And([RegionOutlives('?2, '?3)])])",
    );
    expect(dbg_or(Or.new<null>([]))).toBe("Or([])");
    expect(dbg_or(Or.new([And.new([lo(r1, r2)]), And.new([lo(r3, r4), amb])]), PRETTY)).toBe(
      [
        "Or(",
        "    [",
        "        And(",
        "            [",
        "                RegionOutlives(",
        "                    '?1,",
        "                    '?2,",
        "                ),",
        "            ],",
        "        ),",
        "        And(",
        "            [",
        "                RegionOutlives(",
        "                    '?3,",
        "                    '?4,",
        "                ),",
        "                Ambiguity,",
        "            ],",
        "        ),",
        "    ],",
        ")",
      ].join("\n"),
    );
  });

  test("Or::build_and / build_or / new_ambig", () => {
    const a = Or.new([And.new([lo(r1, r2)]), And.new([lo(r2, r3)])]);
    const b = Or.new([And.new([lo(r3, r1)]), And.new([lo(r1, r2), lo(r4, st)])]);
    expect(dbg_or(Or.build_and(a, b))).toBe(
      "Or([And([RegionOutlives('?1, '?2), RegionOutlives('?3, '?1)]), And([RegionOutlives('?2, '?3), RegionOutlives('?3, '?1)]), And([RegionOutlives('?1, '?2), RegionOutlives('?4, 'static)]), And([RegionOutlives('?2, '?3), RegionOutlives('?1, '?2), RegionOutlives('?4, 'static)])])",
    );
    expect(dbg_or(Or.build_and(a, Or.new_false()))).toBe("Or([])");
    expect(dbg_or(Or.build_and(Or.new_true(), b))).toBe("Or([And([RegionOutlives('?3, '?1)]), And([RegionOutlives('?1, '?2), RegionOutlives('?4, 'static)])])");
    expect(dbg_or(Or.build_or(a, b))).toBe(
      "Or([And([RegionOutlives('?1, '?2)]), And([RegionOutlives('?2, '?3)]), And([RegionOutlives('?3, '?1)]), And([RegionOutlives('?1, '?2), RegionOutlives('?4, 'static)])])",
    );
    expect(dbg_or(Or.build_or(a, Or.new_true()))).toBe("Or([And([])])");
    expect(dbg_or(Or.build_or(Or.new_false(), b))).toBe("Or([And([RegionOutlives('?3, '?1)]), And([RegionOutlives('?1, '?2), RegionOutlives('?4, 'static)])])");
    expect(dbg_or(Or.new_ambig(null))).toBe("Or([And([Ambiguity])])");
  });

  test("Or::is_true / is_false", () => {
    const a = Or.new([And.new([lo(r1, r2)]), And.new([lo(r2, r3)])]);
    const cases: [Or, string, boolean, boolean][] = [
      [Or.new_true(), "Or([And([])])", true, false],
      [Or.new_false(), "Or([])", false, true],
      [a, "Or([And([RegionOutlives('?1, '?2)]), And([RegionOutlives('?2, '?3)])])", false, false],
      [Or.new_leaf(lo(r1, r1)), "Or([And([])])", true, false],
    ];
    for (const [o, s, t, f] of cases) {
      expect(dbg_or(o)).toBe(s);
      expect(Or.is_true(o)).toBe(t);
      expect(Or.is_false(o)).toBe(f);
    }
  });

  // rustc_infer/src/infer/solver_region_constraints/tests.rs: canonicalization_preserves_only_one_ambiguity
  test("canonicalization_preserves_only_one_ambiguity (upstream test)", () => {
    const first: LeafRegionConstraint<number> = { $: "Ambiguity", _0: 1 };
    const second: LeafRegionConstraint<number> = { $: "Ambiguity", _0: 3 };

    const c = And.new([first, second]);
    expect(c._0.length).toBe(1);

    const o = Or.new([And.new([first]), And.new([second])]);
    expect(o._0.length).toBe(1);
  });
});

describe("RegionConstraint combinators (oracle)", () => {
  const f = RegionConstraint.new_from_or(Or.new([And.new([lo(r1, r2), lo(r2, r3)]), And.new([lo(r1, r2), lo(r3, r1)])]));

  test("new_from_or factors common leaves out", () => {
    expect(dbg_rc(f)).toBe(
      "RegionConstraint { and_constraint: And([RegionOutlives('?1, '?2)]), or_constraint: Or([And([RegionOutlives('?2, '?3)]), And([RegionOutlives('?3, '?1)])]) }",
    );
    expect(dbg_rc(f, PRETTY)).toBe(
      [
        "RegionConstraint {",
        "    and_constraint: And(",
        "        [",
        "            RegionOutlives(",
        "                '?1,",
        "                '?2,",
        "            ),",
        "        ],",
        "    ),",
        "    or_constraint: Or(",
        "        [",
        "            And(",
        "                [",
        "                    RegionOutlives(",
        "                        '?2,",
        "                        '?3,",
        "                    ),",
        "                ],",
        "            ),",
        "            And(",
        "                [",
        "                    RegionOutlives(",
        "                        '?3,",
        "                        '?1,",
        "                    ),",
        "                ],",
        "            ),",
        "        ],",
        "    ),",
        "}",
      ].join("\n"),
    );
    expect(dbg_rc(RegionConstraint.new_from_or(Or.new([And.new([lo(r1, r2), lo(r2, r3)]), And.new([lo(r1, r2)])])))).toBe(
      "RegionConstraint { and_constraint: And([RegionOutlives('?1, '?2)]), or_constraint: Or([And([])]) }",
    );
    expect(dbg_rc(RegionConstraint.new_from_or(Or.new_false()))).toBe("RegionConstraint { and_constraint: And([]), or_constraint: Or([]) }");
    expect(dbg_rc(RegionConstraint.new_from_or(Or.new([And.new([lo(r1, r2), amb])])))).toBe(
      "RegionConstraint { and_constraint: And([RegionOutlives('?1, '?2), Ambiguity]), or_constraint: Or([And([])]) }",
    );
    expect(dbg_or(RegionConstraint.splatted_and_constraints(f))).toBe(
      "Or([And([RegionOutlives('?2, '?3), RegionOutlives('?1, '?2)]), And([RegionOutlives('?3, '?1), RegionOutlives('?1, '?2)])])",
    );
  });

  test("build_and / build_or", () => {
    const l12 = RegionConstraint.new_leaf(lo(r1, r2));
    const l23 = RegionConstraint.new_leaf(lo(r2, r3));
    const am = RegionConstraint.new_ambig(null);
    expect(dbg_rc(RegionConstraint.build_and(l12, am))).toBe("RegionConstraint { and_constraint: And([RegionOutlives('?1, '?2), Ambiguity]), or_constraint: Or([And([])]) }");
    expect(dbg_rc(RegionConstraint.build_and(f, l23))).toBe(
      "RegionConstraint { and_constraint: And([RegionOutlives('?1, '?2), RegionOutlives('?2, '?3)]), or_constraint: Or([And([RegionOutlives('?2, '?3)]), And([RegionOutlives('?3, '?1)])]) }",
    );
    expect(dbg_rc(RegionConstraint.build_and(f, RegionConstraint.new_false()))).toBe("RegionConstraint { and_constraint: And([]), or_constraint: Or([]) }");
    expect(dbg_rc(RegionConstraint.build_or(l12, l23))).toBe(
      "RegionConstraint { and_constraint: And([]), or_constraint: Or([And([RegionOutlives('?1, '?2)]), And([RegionOutlives('?2, '?3)])]) }",
    );
    expect(dbg_rc(RegionConstraint.build_or(f, l12))).toBe("RegionConstraint { and_constraint: And([RegionOutlives('?1, '?2)]), or_constraint: Or([And([])]) }");
    expect(dbg_rc(RegionConstraint.build_or(f, RegionConstraint.new_true()))).toBe("RegionConstraint { and_constraint: And([]), or_constraint: Or([And([])]) }");
  });

  test("is_true / is_false / is_ambig", () => {
    const l12 = RegionConstraint.new_leaf(lo(r1, r2));
    const am = RegionConstraint.new_ambig(null);
    const cases: [RegionConstraint, string, boolean, boolean, boolean][] = [
      [RegionConstraint.new_true(), "RegionConstraint { and_constraint: And([]), or_constraint: Or([And([])]) }", true, false, false],
      [RegionConstraint.new_false(), "RegionConstraint { and_constraint: And([]), or_constraint: Or([]) }", false, true, false],
      [am, "RegionConstraint { and_constraint: And([Ambiguity]), or_constraint: Or([And([])]) }", false, false, true],
      [l12, "RegionConstraint { and_constraint: And([RegionOutlives('?1, '?2)]), or_constraint: Or([And([])]) }", false, false, false],
      [f, "RegionConstraint { and_constraint: And([RegionOutlives('?1, '?2)]), or_constraint: Or([And([RegionOutlives('?2, '?3)]), And([RegionOutlives('?3, '?1)])]) }", false, false, false],
      [RegionConstraint.build_and(am, l12), "RegionConstraint { and_constraint: And([Ambiguity, RegionOutlives('?1, '?2)]), or_constraint: Or([And([])]) }", false, false, false],
    ];
    for (const [c, s, t, fa, a] of cases) {
      expect(dbg_rc(c)).toBe(s);
      expect(RegionConstraint.is_true(c)).toBe(t);
      expect(RegionConstraint.is_false(c)).toBe(fa);
      expect(RegionConstraint.is_ambig(c)).toBe(a);
    }
  });

  test("with_spans / without_spans / span", () => {
    const ws = RegionConstraint.with_spans(f, 42);
    expect(format_debug(ws, (v, f) => debug_RegionConstraint(v, f, () => "SPAN"), PLAIN)).toBe(
      "RegionConstraint { and_constraint: And([RegionOutlives('?1, '?2)]), or_constraint: Or([And([RegionOutlives('?2, '?3)]), And([RegionOutlives('?3, '?1)])]) }",
    );
    expect(LeafRegionConstraint.span(ws.and_constraint._0[0]!)).toBe(42);
    // `ws.clone().without_spans() == f` is `true` in the oracle (derived `PartialEq`)
    expect(intern_key(RegionConstraint.without_spans(ws))).toBe(intern_key(f));
    expect(LeafRegionConstraint.is_ambig(amb)).toBe(true);
    expect(LeafRegionConstraint.is_ambig(lo(r1, r2))).toBe(false);
  });
});

describe("graph queries (oracle)", () => {
  // `'a: 'b` edges ('?1: '?2, '?2: '?3, '?4: '?2, '?3: 'static). `Assumptions::new_unelaborated` builds the inverse
  // relation from `base_edges()`, which iterates an `FxHashSet` (hashbrown order); the oracle's element order of the
  // inverse relation is ('static, '?3, '?2, '?4, '?1).
  const a = assumptions_of([
    [r1, r2],
    [r2, r3],
    [r4, r2],
    [r3, st],
  ]);

  test("regions_outlived_by / regions_outliving", () => {
    const cases: [Region, string, string][] = [
      [r1, "['?2, '?3, 'static, '?1]", "['?1, 'static]"],
      [r2, "['?3, 'static, '?2]", "['?4, '?1, '?2, 'static]"],
      [r3, "['static, '?3]", "['?2, '?4, '?1, '?3, 'static]"],
      [r4, "['?2, '?3, 'static, '?4]", "['?4, 'static]"],
      [st, "['static]", "['?3, '?2, '?4, '?1, 'static, 'static]"],
      [er, "['{erased}]", "['{erased}, 'static]"],
    ];
    for (const [r, by, outliving] of cases) {
      expect(dbg_regions(regions_outlived_by(r, a))).toBe(by);
      expect(dbg_regions(regions_outliving(r, a, tcx))).toBe(outliving);
    }
  });

  test("with a cycle", () => {
    const c = assumptions_of([
      [r3, r1],
      [r1, r2],
      [r2, r1],
    ]);
    const cases: [Region, string, string][] = [
      [r1, "['?1, '?2, '?1]", "['?2, '?1, '?3, '?1, 'static]"],
      [r2, "['?1, '?2, '?2]", "['?2, '?1, '?3, '?2, 'static]"],
      [r3, "['?1, '?2, '?3]", "['?3, 'static]"],
    ];
    for (const [r, by, outliving] of cases) {
      expect(dbg_regions(regions_outlived_by(r, c))).toBe(by);
      expect(dbg_regions(regions_outliving(r, c, tcx))).toBe(outliving);
    }
  });
});

describe("upstream semantics", () => {
  test("eagerly_handle_placeholders_in_universe rejects the root universe", () => {
    expect(() => eagerly_handle_placeholders_in_universe({} as InferCtxtLike, RegionConstraint.new_true(), 0 as UniverseIndex)).toThrow(
      new Panic("eagerly handle placeholders called for root universe"),
    );
  });

  test("Assumptions::empty: no type-outlives clauses, empty region relations", () => {
    const a = AssumptionsC.empty();
    expect(a.type_outlives).toEqual([]);
    expect(a.region_outlives.is_empty()).toBe(true);
    expect(a.inverse_region_outlives.is_empty()).toBe(true);
    expect([...a.region_outlives.base_edges()]).toEqual([]);
  });

  test("PlaceholderReplacer replaces placeholders of its universe with fresh bound vars", () => {
    const u1 = 1 as UniverseIndex;
    const u2 = 2 as UniverseIndex;
    const ph = (u: UniverseIndex, var_: number): Region =>
      tcx.intern_region({ $: "RePlaceholder", _0: { universe: u, bound: { var: var_ as BoundVar, kind: { $: "Anon" } }, _tcx: undefined } });
    const replacer = new PlaceholderReplacer(tcx, 2, new Map(), u1, INNERMOST);
    const bound = (debruijn: DebruijnIndex, var_: number): Region => tcx.intern_bound_region(debruijn, { var: var_ as BoundVar, kind: { $: "Anon" } });

    // the first placeholder of `u1` gets var `existing_var_count + 0`, the next one `+ 1`; a repeat reuses its var
    expect(replacer.fold_region(ph(u1, 7))).toBe(bound(INNERMOST, 2));
    expect(replacer.fold_region(ph(u1, 3))).toBe(bound(INNERMOST, 3));
    expect(replacer.fold_region(ph(u1, 7))).toBe(bound(INNERMOST, 2));
    // other universes and other region kinds are left alone
    expect(replacer.fold_region(ph(u2, 7))).toBe(ph(u2, 7));
    expect(replacer.fold_region(r1)).toBe(r1);
    expect([...replacer.bound_vars.entries()].map(([k, v]: [BoundVar, BoundRegion]) => [k, v.var])).toEqual([
      [7 as BoundVar, 2 as BoundVar],
      [3 as BoundVar, 3 as BoundVar],
    ]);

    // `fold_binder` shifts `current_index` in around the binder's contents
    const seen: DebruijnIndex[] = [];
    const d: TypeFoldable<Region> = {
      visit_with: () => {
        throw new Error("unused");
      },
      try_fold_with: () => {
        throw new Error("unused");
      },
      fold_with(r: Region, folder: TypeFolder): Region {
        seen.push((folder as PlaceholderReplacer).current_index);
        return folder.fold_region(r);
      },
    };
    const b: Binder<Region> = { value: ph(u1, 9), bound_vars: tcx.mk_bound_variable_kinds([]) };
    const folded = replacer.fold_binder(b, d);
    expect(seen).toEqual([DebruijnIndexC.from_u32(1)]);
    expect(folded.value).toBe(bound(DebruijnIndexC.from_u32(1), 4));
    expect(replacer.current_index).toBe(INNERMOST);
  });
});
