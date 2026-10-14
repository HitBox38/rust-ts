// Tests for the search graph port (lane tyir-solve).
//
// Oracle: oracle/main.rs, a rustc-dev probe that drives the pinned nightly's own
// `rustc_type_ir::search_graph::SearchGraph` with a fake `Cx` / `Delegate` (goal graphs with cycles of every
// `PathKind`, several candidates per goal with `enter_single_candidate` / `finish_single_candidate` /
// `ignore_candidate_head_usages` / `merge_usages`, overflow, a global cache shared by several roots, proof-tree
// roots, inspect on/off). oracle/cases.ts runs the same cases through this port with the same fake delegate.
// - "hand cases": full traces copied verbatim from the probe's output.
// - "oracle fixture": fixture.txt holds sha256 prefixes of the probe's traces for `gen(1, 4000)`; the cases are
//   regenerated deterministically. (Seeds 1-8, 160k cases in total, matched when the fixture was made.)
// - the solve/mod.rs `Certainty` / `VisibleForLeakCheck` combinators against `./searchgraph certainty`, and every
//   sequence of 4 `AccessedOpaques` updates (`RerunCondition::merge`, `SmallCopySet::union`) against
//   `./searchgraph opaques` (hashes of the whole outputs).
// - small unit tests of the bit-level helpers, derived from upstream's definitions (comments say how).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PLAIN } from "../../std/fmt.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { Result } from "../../std/result.ts";
import { debug_result } from "../../std/result.ts";
import {
  AccessedOpaques,
  Certainty,
  debug_AccessedOpaques,
  debug_Certainty,
  debug_RerunNonErased,
  type RerunNonErased,
  type RerunReason,
  debug_MaybeInfo,
  type MaybeCause,
  MaybeInfo,
  type OpaqueTypesJank,
  type StalledOnCoroutines,
  VisibleForLeakCheck,
} from "../solve/mod.ts";
import { CycleHeads, HeadUsages, PathKind, PathsToNested } from "./mod.ts";
import { gen, run_case, trace_hash } from "./oracle/cases.ts";
import { StackDepth } from "./stack.ts";

describe("search graph vs oracle", () => {
  // [case, oracle trace] (oracle/main.rs output)
  const HAND: [string, string][] = [
    // coinductive 2-cycle, then the same goals as a proof-tree root (reruns until the provisional result is stable)
    [
      "5 1 2 0 0 1 1 2 1 0 1 1 1 2 1 2 1 1 1 0 0 1",
      "C0 C1 0=101 =101 1=101 =1 C0 C1 0=1 =2 1=2 =1 R0=1 C1 C0 1=101 =1 0=1 =2 C1 C0 1=2 =1 0=1 =2 P1=2/2",
    ],
    // an inductive self-cycle whose result never stabilises: FIXPOINT_STEP_LIMIT, fixpoint overflow result
    ["3 1 1 0 0 1 3 2 1 1 0 0 1 1", "C0 0=100 =3 C0 0=3 =1 C0 0=1 =4 R0=104"],
    // a chain deeper than the root depth: stack overflow
    [
      "2 1 1 0 0 5 0 1 1 1 1 0 1 0 1 1 1 2 0 1 0 1 1 1 3 0 1 0 1 1 1 4 0 1 2 0 0",
      "C0 C1 C2 3=103 =103 2=103 =103 1=103 =103 R0=103",
    ],
    // the second root is a global cache hit
    ["4 1 2 0 0 0 0 2 0 1 1 1 1 0 1 2 0 0", "C0 C1 =2 1=2 =2 R0=2 R0=2"],
    // the same with inspect on: no global cache
    ["4 0 2 0 0 0 0 2 0 1 1 1 1 0 1 2 0 0", "C0 C1 =2 1=2 =2 R0=2 C0 C1 =2 1=2 =2 R0=2"],
    // two candidates, the first one a coinductive cycle on the goal
    ["4 1 1 0 0 2 0 1 2 1 0 2 1 1 1 0 1 3 1 1 1 0 2 1", "C0 0=101 C1 0=101 =101 1=101 =101 R0=101"],
    // three candidates (ignored and merged usages); the second root hits the global cache
    [
      "6 1 2 0 0 1 0 3 3 1 1 1 1 1 1 1 2 1 0 1 1 1 2 2 1 1 1 0 2 1 0 2 1 0 0 1 1 1 1 0 1",
      "C0 C1 =1 1=1 =3 R0=3 R1=1",
    ],
  ];
  test("hand cases", () => {
    for (const [c, expected] of HAND) {
      expect(run_case(c)).toBe(expected);
    }
  });

  test("oracle fixture (gen(1, 4000))", () => {
    const lines = readFileSync(new URL("./oracle/fixture.txt", import.meta.url), "utf8").split("\n");
    const header = lines.find((l) => l.startsWith("# seed "))!;
    const [, , seed, , n] = header.split(" ");
    const expected = lines.filter((l) => l !== "" && !l.startsWith("#"));
    expect(expected.length).toBe(Number(n));
    const cases = gen(Number(seed), Number(n));
    let mismatches = 0;
    let first: string | undefined;
    for (let i = 0; i < cases.length; i++) {
      if (trace_hash(run_case(cases[i]!)) !== expected[i]) {
        mismatches++;
        first ??= `case ${i}: ${cases[i]}`;
      }
    }
    expect(first).toBeUndefined();
    expect(mismatches).toBe(0);
  });
});

describe("solve/mod.rs combinators vs oracle", () => {
  test("Certainty::and, MaybeInfo::or, VisibleForLeakCheck::and/or (./searchgraph certainty)", () => {
    const all: Certainty[] = [Certainty.Yes];
    const causes: MaybeCause[] = [
      { $: "Ambiguity" },
      { $: "Overflow", suggest_increasing_limit: false, keep_constraints: false },
      { $: "Overflow", suggest_increasing_limit: false, keep_constraints: true },
      { $: "Overflow", suggest_increasing_limit: true, keep_constraints: false },
      { $: "Overflow", suggest_increasing_limit: true, keep_constraints: true },
    ];
    for (const cause of causes) {
      for (const opaque_types_jank of ["AllGood", "ErrorIfRigidSelfTy"] as OpaqueTypesJank[]) {
        for (const stalled_on_coroutines of ["Yes", "No"] as StalledOnCoroutines[]) {
          all.push({ $: "Maybe", _0: { cause, opaque_types_jank, stalled_on_coroutines } });
        }
      }
    }
    const out: string[] = [];
    for (const a of all) {
      for (const b of all) {
        out.push(debug_Certainty(Certainty.and(a, b), PLAIN));
        if (a.$ === "Maybe" && b.$ === "Maybe") {
          out.push(debug_MaybeInfo(MaybeInfo.or(a._0, b._0), PLAIN));
        }
      }
    }
    out.push(`${debug_Certainty(Certainty.AMBIGUOUS, PLAIN)} ${debug_Certainty(Certainty.overflow(true), PLAIN)}`);
    const v: VisibleForLeakCheck[] = ["Yes", "No", "Unreachable"];
    for (const a of v) {
      for (const b of v) {
        out.push(`${VisibleForLeakCheck.and(a, b)} ${VisibleForLeakCheck.or(a, b)}`);
      }
    }
    const text = out.join("\n") + "\n";
    expect(out.length).toBe(851);
    expect(out[0]).toBe("Yes");
    expect(out[29]).toBe("MaybeInfo { cause: Ambiguity, opaque_types_jank: AllGood, stalled_on_coroutines: Yes }");
    expect(createHash("sha256").update(text).digest("hex")).toBe(
      "2286bb71e25d1c5e2b40c94ecff68086df8d4146d65fb05410942b5c6da167b7",
    );
  });
});

describe("solve/mod.rs AccessedOpaques vs oracle", () => {
  test("every sequence of 4 updates (./searchgraph opaques)", () => {
    const reasons: RerunReason[] = [
      "NormalizeOpaqueTypeRemoteCrate",
      "NormalizeOpaqueType",
      "MayUseUnstableFeature",
      "EvaluateConst",
      "SkipErasedAttempt",
      "SelfTyInfer",
      "FetchEligibleAssocItem",
      "AutoTraitLeakage",
      "TryStallCoroutine",
    ];
    const show = (r: Result<null, RerunNonErased>): string =>
      debug_result(r, PLAIN, () => "()", debug_RerunNonErased);
    const out: string[] = [];
    for (let n = 0; n < 7 ** 4; n++) {
      const a = AccessedOpaques.default_();
      const line: string[] = [];
      for (let step = 0; step < 4; step++) {
        const op = Math.floor(n / 7 ** step) % 7;
        const reason = reasons[(3 * step + op) % 9]!;
        let r: string;
        if (op === 0) r = show(AccessedOpaques.rerun_if_in_post_analysis(a, reason));
        else if (op <= 4) r = show(AccessedOpaques.rerun_if_opaque_in_opaque_type_storage(a, reason, op as LocalDefId));
        else if (op === 5) r = show(AccessedOpaques.rerun_if_any_opaque_has_infer_as_hidden_type(a, reason));
        else r = show(AccessedOpaques.rerun_always(a, reason));
        line.push(`${r} ${debug_AccessedOpaques(a, PLAIN)} ${AccessedOpaques.might_rerun(a)}`);
      }
      out.push(line.join(" | "));
    }
    expect(out[0]).toBe(
      "Ok(()) AccessedOpaques { reason: Some(NormalizeOpaqueTypeRemoteCrate), rerun: OpaqueInStorage(Empty) } true | " +
        "Ok(()) AccessedOpaques { reason: Some(EvaluateConst), rerun: OpaqueInStorage(Empty) } true | " +
        "Ok(()) AccessedOpaques { reason: Some(FetchEligibleAssocItem), rerun: OpaqueInStorage(Empty) } true | " +
        "Ok(()) AccessedOpaques { reason: Some(NormalizeOpaqueTypeRemoteCrate), rerun: OpaqueInStorage(Empty) } true",
    );
    expect(createHash("sha256").update(out.join("\n") + "\n").digest("hex")).toBe(
      "1d6732835b3d0d943a87115f2dcb2ab69e4bf7cbd3fa48ef365fabb1480942e0",
    );
  });
});

// Derived from upstream's definitions (search_graph/mod.rs): `PathKind::extend` is `max` over
// Inductive < Unknown < Coinductive < ForcedAmbiguity; `PathsToNested::extend_with` upgrades every weaker path.
describe("search graph helpers", () => {
  const ORDER: PathKind[] = ["Inductive", "Unknown", "Coinductive", "ForcedAmbiguity"];
  test("PathKind::extend is max", () => {
    for (const a of ORDER) {
      for (const b of ORDER) {
        expect(PathKind.extend(a, b)).toBe(ORDER[Math.max(ORDER.indexOf(a), ORDER.indexOf(b))]!);
      }
    }
  });

  test("PathsToNested::extend_with / iter_paths / extend_with_paths", () => {
    const P = PathsToNested;
    const all = (P.EMPTY | P.INDUCTIVE | P.UNKNOWN | P.COINDUCTIVE | P.FORCED_AMBIGUITY) as PathsToNested;
    expect(P.extend_with(all, "Inductive")).toBe((all & ~P.EMPTY) as PathsToNested);
    expect(P.extend_with(all, "Unknown")).toBe((P.UNKNOWN | P.COINDUCTIVE | P.FORCED_AMBIGUITY) as PathsToNested);
    expect(P.extend_with(all, "Coinductive")).toBe((P.COINDUCTIVE | P.FORCED_AMBIGUITY) as PathsToNested);
    expect(P.extend_with(all, "ForcedAmbiguity")).toBe(P.FORCED_AMBIGUITY);
    expect(P.extend_with(P.COINDUCTIVE, "Inductive")).toBe(P.COINDUCTIVE);
    expect(P.iter_paths(all)).toEqual(ORDER);
    expect(P.iter_paths(P.EMPTY)).toEqual([]);
    expect(P.extend_with_paths(P.EMPTY, (P.INDUCTIVE | P.COINDUCTIVE) as PathsToNested)).toBe(
      (P.INDUCTIVE | P.COINDUCTIVE) as PathsToNested,
    );
  });

  test("HeadUsages", () => {
    const u = HeadUsages.default_();
    expect(u.is_empty()).toBe(true);
    u.add_usage("Coinductive");
    u.add_usage("Coinductive");
    expect(u.is_single("Coinductive")).toBe(true);
    expect(u.is_single("Inductive")).toBe(false);
    const v = HeadUsages.default_();
    v.add_usages_from_nested(u);
    expect(v.coinductive).toBe(1);
    u.ignore_usages(v);
    expect(u.coinductive).toBe(1);
    expect(() => v.ignore_usages(u)).not.toThrow();
    expect(() => v.ignore_usages(u)).toThrow("called `Option::unwrap()` on a `None` value");
  });

  test("CycleHeads keeps BTreeMap key order and copies on insert / iter", () => {
    const heads = CycleHeads.default_();
    const u = HeadUsages.default_();
    u.add_usage("Inductive");
    heads.insert(StackDepth.from_u32(3), PathsToNested.INDUCTIVE, u);
    heads.insert(StackDepth.from_u32(1), PathsToNested.UNKNOWN, u);
    heads.insert(StackDepth.from_u32(3), PathsToNested.COINDUCTIVE, u);
    expect(heads.iter().map(([k]) => k)).toEqual([1, 3] as StackDepth[]);
    expect(heads.opt_lowest_cycle_head_index()).toBe(StackDepth.from_u32(1));
    expect(heads.highest_cycle_head_index()).toBe(StackDepth.from_u32(3));
    const [, h] = heads.highest_cycle_head();
    expect(h.paths_to_head).toBe((PathsToNested.INDUCTIVE | PathsToNested.COINDUCTIVE) as PathsToNested);
    expect(h.usages.inductive).toBe(2);
    // the stored usages are copies: mutating `u` or a yielded head leaves the map unchanged
    u.add_usage("Inductive");
    h.usages.add_usage("Inductive");
    expect(heads.highest_cycle_head()[1].usages.inductive).toBe(2);
    expect(heads.remove_highest_cycle_head().usages.inductive).toBe(2);
    expect(heads.opt_highest_cycle_head_index()).toBe(StackDepth.from_u32(1));
  });
});
