// The rustc_pattern_analysis foundation (lane pat-b, docs/handoff/pat-b.md) against upstream:
// - every fn of compiler/rustc_pattern_analysis/src/** is either ported (a `// rustc:` marker) or declared (a
//   `// stub: <path>:<line> <name> (lane <lane>)` comment over a declaration whose body calls `unported(..)` with a
//   path in the fn's own module), never both; the stubs per fill lane are the handoff's split table;
// - constructor splitting (`IntRange::split`, `Slice::split`, `ConstructorSet::split`), `DeconstructedPat` /
//   `WitnessPat` and their `Debug` work without usefulness, on the examples of the upstream doc comments and the
//   witnesses the crate tests expect (tests/exhaustiveness.rs);
// - `analyze_match` stops at the first stub on its path (usefulness, lane pat-a, until it is ported).
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import { Constructor, ConstructorSet, debug_Constructor, debug_IntRange, debug_Slice, IntRange, MaybeInfiniteInt, RangeEnd, Slice } from "./constructor.ts";
import { MatchArm } from "./lib.ts";
import { DeconstructedPat, debug_DeconstructedPat, debug_PatOrWild, debug_WitnessPat, type IndexedPat, PatOrWild, WitnessPat } from "./pat.ts";
import { analyze_match, RustcPatCtxt, RustcPatCtxtState } from "./rustc.ts";
import { CX_STATIC, Cx, type CxTypes, NEVER, pat, pats, type Ty, UNIT, USEFULNESS_PORTED } from "./tests/common/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";

const CRATE = "compiler/rustc_pattern_analysis/src/";

function scope_files(): string[] {
  const out: string[] = [];
  const w = (d: string) => {
    for (const e of readdirSync(join(UPSTREAM, d)).sort()) {
      const p = `${d}/${e}`;
      if (statSync(join(UPSTREAM, p)).isDirectory()) w(p);
      else if (p.endsWith(".rs")) out.push(p);
    }
  };
  w(CRATE.slice(0, -1));
  return out;
}
const FILES = scope_files();

/** `compiler/rustc_pattern_analysis/src/rustc/print.rs` -> `rustc_pattern_analysis::rustc::print`. */
const module_of = (file: string) =>
  "rustc_pattern_analysis::" + file.slice(CRATE.length).replace(/\.rs$/, "").replace(/^lib$/, "").split("/").join("::");
const MODULES = FILES.map(module_of);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

interface Decl {
  file: string;
  path: string;
  line: number;
  name: string;
  lane: string | undefined;
  /** the `unported("..")` path of the body below a stub */
  unported: string | undefined;
}
const markers: Decl[] = [];
const stubs: Decl[] = [];
for (const f of walk(join(REPO, "src"))) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /\/\/ (rustc|stub): (\S+):(\d+) (\w+)(?: \(lane ([^)]+)\))?/.exec(lines[i]!);
    if (!m || !FILES.includes(m[2]!)) continue;
    const d: Decl = { file: relative(REPO, f), path: m[2]!, line: Number(m[3]), name: m[4]!, lane: m[5], unported: undefined };
    if (m[1] === "rustc") {
      markers.push(d);
      continue;
    }
    for (let j = i + 1; j < Math.min(lines.length, i + 24); j++) {
      if (/\/\/ (rustc|stub): /.test(lines[j]!)) break;
      const u = /unported\(["`]([^"`]+)["`]/.exec(lines[j]!);
      if (u) {
        d.unported = u[1];
        break;
      }
    }
    stubs.push(d);
  }
}

test("every fn of rustc_pattern_analysis/src/** is ported or declared as a stub, never both", () => {
  expect(FILES.length).toBe(10);
  let total = 0;
  for (const file of FILES) {
    const fns = upstreamFns(file);
    total += fns.length;
    const mod = module_of(file);
    for (const fn of fns) {
      const key = `${fn.path}:${fn.line} ${fn.name}`;
      const same = (d: Decl) => d.path === fn.path && d.line === fn.line && d.name === fn.name;
      const m = markers.filter(same);
      const s = stubs.filter(same);
      expect(`${key}: ${m.length + s.length}`).toBe(`${key}: 1`);
      for (const d of s) {
        // the stub's body stops with a path in the fn's own module (the longest scope module that prefixes it)
        const owner = MODULES.filter((p) => d.unported?.startsWith(`${p}::`)).sort((a, b) => b.length - a.length)[0];
        expect(`${key}: ${owner ?? `no unported(..) in ${d.file}`}`).toBe(`${key}: ${mod}`);
        expect(`${key}: ${d.lane !== undefined}`).toBe(`${key}: true`);
      }
    }
    for (const d of [...stubs, ...markers].filter((d) => d.path === file)) {
      expect(`${d.path}:${d.line} ${d.name}: ${fns.some((fn) => fn.line === d.line && fn.name === d.name)}`).toBe(
        `${d.path}:${d.line} ${d.name}: true`,
      );
    }
  }
  expect(total).toBe(188);
  expect(markers.length).toBe(122);
  expect(stubs.length).toBe(66);
});

test("the stubs per fill lane are the handoff's split table", () => {
  const per_lane: Record<string, number> = {};
  for (const d of stubs) per_lane[d.lane!] = (per_lane[d.lane!] ?? 0) + 1;
  expect(per_lane).toEqual({ "pat-a": 66 });
  for (const d of stubs) {
    const lane = /\/(usefulness|pat_column|lints|checks)\.rs$/.test(d.path) ? "pat-a" : "pat-c";
    expect(`${d.path}:${d.line} ${d.name}: ${d.lane}`).toBe(`${d.path}:${d.line} ${d.name}: ${lane}`);
  }
});

const u = (n: number) => MaybeInfiniteInt.new_finite_uint(BigInt(n));
const incl = (lo: number, hi: number) => IntRange.from_range(u(lo), u(hi), RangeEnd.Included);
const debug_ctor = debug_Constructor(CX_STATIC);

test("IntRange: the module doc's splitting example and the encodings", () => {
  // constructor.rs:21: `(0 ..=100, true)`, `(50..=150, false)`, `(0 ..=200, _)`: "5 cases: `0..50`, `50..=100`,
  // `101..=150`, `151..=200` and `200..`" (on `u8`, the last one is `201..=255`).
  const u8_range = incl(0, 255);
  const split = u8_range.split([incl(0, 100), incl(50, 150), incl(0, 200)]);
  expect(split.map(([p, r]) => `${p} ${debug_IntRange(r, PLAIN)}`)).toEqual([
    "Seen 0..50",
    "Seen 50..101",
    "Seen 101..151",
    "Seen 151..201",
    "Unseen 201..256",
  ]);
  // Debug: singletons print their value, infinite ends are omitted.
  expect(debug_IntRange(IntRange.from_singleton(u(7)), PLAIN)).toBe("7");
  expect(debug_IntRange(new IntRange(MaybeInfiniteInt.NegInfinity, MaybeInfiniteInt.PosInfinity), PLAIN)).toBe("..");
  // `new_finite_int` biases signed values so that the order is preserved: -128i8 is 0, 127i8 is 255.
  expect(MaybeInfiniteInt.new_finite_int(0x80n, 8)).toEqual({ $: "Finite", _0: 0n });
  expect(MaybeInfiniteInt.new_finite_int(0x7fn, 8)).toEqual({ $: "Finite", _0: 255n });
  expect(MaybeInfiniteInt.as_finite_int(MaybeInfiniteInt.new_finite_int(0x80n, 8), 8)).toBe(0x80n);
  // `plus_one` turns `u128::MAX` into `PosInfinity`; `minus_one` of 0 is `None`.
  expect(MaybeInfiniteInt.plus_one(u(0))).toEqual(u(1));
  expect(MaybeInfiniteInt.plus_one(MaybeInfiniteInt.new_finite_uint((1n << 128n) - 1n))).toBe(MaybeInfiniteInt.PosInfinity);
  expect(MaybeInfiniteInt.minus_one(u(0))).toBeUndefined();
  expect(() => IntRange.from_range(u(5), u(5), RangeEnd.Excluded)).toThrow("malformed range pattern: Finite(5)..Finite(5)");
});

test("Slice: the doc's splitting example, arrays and `Slice::new`", () => {
  // constructor.rs:517: `[true, true, ..]`, `[.., false, false]`, `[..]` on `&[bool]`: lengths 0..4 separately, then
  // everything from length 4 as `[_, _, .., _, _]`.
  const varlen = (p: number, s: number) => Slice.new(undefined, { $: "VarLen", _0: p, _1: s });
  const split = varlen(0, 0).split([varlen(2, 0), varlen(0, 2), varlen(0, 0)]);
  expect(split.map(([p, s]) => `${p} ${debug_Slice(s, PLAIN)}`)).toEqual([
    "Seen Slice { array_len: None, kind: FixedLen(0) }",
    "Seen Slice { array_len: None, kind: FixedLen(1) }",
    "Seen Slice { array_len: None, kind: FixedLen(2) }",
    "Seen Slice { array_len: None, kind: FixedLen(3) }",
    "Seen Slice { array_len: None, kind: VarLen(2, 2) }",
  ]);
  // Fixed-length patterns push `L` past the largest one; unseen lengths are `Unseen`.
  const fixed = (n: number) => Slice.new(undefined, { $: "FixedLen", _0: n });
  expect(varlen(0, 0).split([fixed(2)]).map(([p, s]) => `${p} ${s.arity()}`)).toEqual(["Unseen 0", "Unseen 1", "Seen 2", "Unseen 3"]);
  // On an array there is one output slice: `max_slice` (`[_, ..]` here), capped at the array length when it reaches it.
  const array3 = Slice.new(3, { $: "VarLen", _0: 0, _1: 0 });
  expect(array3.split([]).map(([p, s]) => `${p} ${debug_Slice(s, PLAIN)}`)).toEqual([
    "Unseen Slice { array_len: Some(3), kind: VarLen(1, 0) }",
  ]);
  expect(array3.split([Slice.new(3, { $: "FixedLen", _0: 3 })]).map(([p, s]) => `${p} ${debug_Slice(s, PLAIN)}`)).toEqual([
    "Seen Slice { array_len: Some(3), kind: FixedLen(3) }",
  ]);
  // A `..` of length 0 in an array is fixed-length; a longer pattern than the array is a bug.
  expect(debug_Slice(Slice.new(2, { $: "VarLen", _0: 1, _1: 1 }), PLAIN)).toBe("Slice { array_len: Some(2), kind: FixedLen(2) }");
  expect(() => Slice.new(1, { $: "VarLen", _0: 1, _1: 1 })).toThrow("Slice pattern of length 2 longer than its array length 1");
  expect(varlen(1, 1).is_covered_by(varlen(0, 0))).toBe(true);
  expect(varlen(0, 0).is_covered_by(varlen(1, 1))).toBe(false);
});

test("ConstructorSet::split: present / missing / missing_empty", () => {
  const show = (cs: Constructor<CxTypes>[]) => cs.map((c) => debug_ctor(c, PLAIN));
  // Booleans: `true` before `false` (tests/exhaustiveness.rs: "Assert we put `true` before `false`").
  let s = ConstructorSet.split<CxTypes>({ $: "Bool" }, [{ $: "Bool", _0: false }, Constructor.Wildcard]);
  expect([show(s.present), show(s.missing), show(s.missing_empty)]).toEqual([["Bool(false)"], ["Bool(true)"], []]);
  // Variants: hidden ones are summarized as `Hidden`, empty ones are `missing_empty`, non-exhaustive adds `NonExhaustive`.
  s = ConstructorSet.split<CxTypes>({ $: "Variants", variants: ["Visible", "Hidden", "Empty", "Visible"], non_exhaustive: true }, [
    { $: "Variant", _0: 3 },
  ]);
  expect([show(s.present), show(s.missing), show(s.missing_empty)]).toEqual([
    ["Variant(3)"],
    ["Variant(0)", "Hidden", "NonExhaustive"],
    ["Variant(2)"],
  ]);
  // Opaques are always present (point 4 of `SplitConstructorSet`), deref patterns make everything else irrelevant.
  s = ConstructorSet.split<CxTypes>({ $: "Struct", empty: false }, [{ $: "Opaque", _0: 7 as never }]);
  expect([show(s.present), show(s.missing)]).toEqual([["Opaque(OpaqueId(7))"], ["Struct"]]);
  s = ConstructorSet.split<CxTypes>({ $: "Unlistable" }, [{ $: "DerefPattern", _0: UNIT }, { $: "DerefPattern", _0: UNIT }]);
  expect([show(s.present), show(s.missing)]).toEqual([["DerefPattern(Tuple([]))"], []]);
  // Integers (`char`'s two ranges) and empty slices.
  s = ConstructorSet.split<CxTypes>({ $: "Integers", range_1: incl(0, 9), range_2: incl(20, 29) }, [
    { $: "IntRange", _0: incl(5, 25) },
  ]);
  expect([show(s.present), show(s.missing)]).toEqual([
    ["IntRange(5..10)", "IntRange(20..26)"],
    ["IntRange(0..5)", "IntRange(26..30)"],
  ]);
  s = ConstructorSet.split<CxTypes>({ $: "Slice", array_len: undefined, subtype_is_empty: true }, []);
  expect([show(s.missing), show(s.missing_empty)]).toEqual([
    ["Slice(Slice { array_len: None, kind: FixedLen(0) })"],
    ["Slice(Slice { array_len: None, kind: VarLen(1, 0) })"],
  ]);
  s = ConstructorSet.split<CxTypes>({ $: "NoConstructors" }, []);
  expect(show(s.missing_empty)).toEqual(["Never"]);
  // `all_empty`
  expect(ConstructorSet.all_empty({ $: "Slice", array_len: 1, subtype_is_empty: true })).toBe(true);
  expect(ConstructorSet.all_empty({ $: "Slice", array_len: 0, subtype_is_empty: true })).toBe(false);
  expect(ConstructorSet.all_empty({ $: "Variants", variants: ["Empty"], non_exhaustive: false })).toBe(true);
});

test("Constructor::is_covered_by", () => {
  const cx = new Cx(false);
  const is = (a: Constructor<CxTypes>, b: Constructor<CxTypes>) => {
    const r = Constructor.is_covered_by(a, cx, b);
    return r.$ === "Ok" ? r._0 : "Err";
  };
  expect(is({ $: "IntRange", _0: incl(3, 4) }, { $: "IntRange", _0: incl(0, 9) })).toBe(true);
  expect(is({ $: "IntRange", _0: incl(3, 14) }, { $: "IntRange", _0: incl(0, 9) })).toBe(false);
  expect(is(Constructor.Missing, Constructor.Struct)).toBe(false);
  expect(is(Constructor.Missing, Constructor.Wildcard)).toBe(true);
  expect(is({ $: "Variant", _0: 1 }, { $: "Variant", _0: 1 })).toBe(true);
  expect(is({ $: "Opaque", _0: 1 as never }, Constructor.Struct)).toBe(false);
  expect(() => is(Constructor.Wildcard, Constructor.Struct)).toThrow("Constructor splitting should not have returned `Wildcard`");
  // `Cx::delayed_bug` is the provided one (`bug`, a panic in the tests' `Cx`).
  expect(() => is(Constructor.Struct, { $: "Bool", _0: true })).toThrow("trying to compare incompatible constructors Struct and Bool(true)");
});

test("DeconstructedPat: pats!, Debug, specialize, walk, or-patterns", () => {
  const TY: Ty = { $: "Enum", _0: [{ $: "Bool" }, UNIT] };
  const ty: Ty = { $: "Tuple", _0: [TY, TY] };
  const debug = debug_DeconstructedPat(CX_STATIC);
  const ps = pats(ty, "(Variant.0(false), _), (_, Variant.1)");
  expect(ps.map((p) => debug(p, PLAIN))).toEqual(["(Enum::Variant0(false), _)", "(_, Enum::Variant1(_))"]);
  expect(ps[0]!.uid).not.toBe(ps[1]!.uid);
  expect(ps[0]!.eq(ps[0]!)).toBe(true);
  expect(ps[0]!.eq(ps[1]!)).toBe(false);
  // `.i: pat` and `BigStruct`
  const big: Ty = { $: "BigStruct", arity: 3, ty: { $: "Bool" } };
  expect(debug(pat(big, "Struct { .2: true }"), PLAIN)).toBe("BigStruct(_, _, true)");
  // specialize by the pattern's own constructor fills the fields, missing ones are `Wild`
  const sp = ps[1]!.specialize(Constructor.Struct, 2);
  expect(sp.map((p) => debug_PatOrWild(CX_STATIC)(p, PLAIN))).toEqual(["_", "Enum::Variant1(_)"]);
  expect(ps[0]!.specialize(Constructor.PrivateUninhabited, 2)).toEqual([]);
  // walk: top-down, `false` stops the descent
  const seen: string[] = [];
  ps[0]!.walk((p) => {
    seen.push(debug(p, PLAIN));
    return p.ctor().$ !== "Variant";
  });
  expect(seen).toEqual(["(Enum::Variant0(false), _)", "Enum::Variant0(false)", "_"]);
  // integer ranges print through `IntRange`'s Debug
  expect(pats({ $: "U8" }, "0..=9, 10.., 3").map((p) => debug(p, PLAIN))).toEqual(["0..10", "10..", "3"]);
});

test("DeconstructedPat: slices and or-patterns (constructed directly)", () => {
  const b = (v: boolean) => pat({ $: "Bool" }, `${v}`);
  const debug = debug_DeconstructedPat(CX_STATIC);
  // `[true, .., false]` as a slice pattern of arity 2, specialized to length 4: the suffix moves to the end.
  const sp = DeconstructedPatOf({ $: "Slice", _0: Slice.new(undefined, { $: "VarLen", _0: 1, _1: 1 }) }, [b(true).at_index(0), b(false).at_index(1)], 2);
  expect(debug(sp, PLAIN)).toBe("[true, .., false]");
  const spec = sp.specialize({ $: "Slice", _0: Slice.new(undefined, { $: "FixedLen", _0: 4 }) }, 4);
  expect(spec.map((p) => debug_PatOrWild(CX_STATIC)(p, PLAIN))).toEqual(["true", "_", "_", "false"]);
  // or-patterns: `expand_or_pat` expands one level, `flatten_or_pat` all of them
  const inner = DeconstructedPatOf(Constructor.Or, [b(true).at_index(0), b(false).at_index(1)], 2);
  const or = DeconstructedPatOf(Constructor.Or, [inner.at_index(0), b(true).at_index(1)], 2);
  expect(debug(or, PLAIN)).toBe("true | false | true");
  expect(PatOrWild.expand_or_pat<CxTypes>({ $: "Pat", _0: or }).length).toBe(2);
  expect(PatOrWild.flatten_or_pat<CxTypes>({ $: "Pat", _0: or }).map((p) => debug_PatOrWild(CX_STATIC)(p, PLAIN))).toEqual([
    "true",
    "false",
    "true",
  ]);
  expect(PatOrWild.ctor(PatOrWild.Wild)).toBe(Constructor.Wildcard);
  expect(debug_PatOrWild(CX_STATIC)(PatOrWild.Wild, PLAIN)).toBe("_");
});

/** `DeconstructedPat::new(ctor, fields, arity, ty, ())` with a placeholder type (unused by Debug / specialize). */
function DeconstructedPatOf(ctor: Constructor<CxTypes>, fields: IndexedPat<CxTypes>[], arity: number): DeconstructedPat<CxTypes> {
  return DeconstructedPat.new<CxTypes>(ctor, fields, arity, UNIT, null);
}

test("WitnessPat: Debug of the crate tests' witnesses, wildcard / wild_from_ctor, clone", () => {
  const cx = new Cx(false);
  const debug = debug_WitnessPat(CX_STATIC);
  const TY: Ty = { $: "Enum", _0: [{ $: "Bool" }, UNIT] };
  const ty: Ty = { $: "Tuple", _0: [TY, TY] };
  const w = (ctor: Constructor<CxTypes>, fields: WitnessPat<CxTypes>[], t: Ty) => WitnessPat.new<CxTypes>(ctor, fields, t);
  // tests/exhaustiveness.rs:139 "(Enum::Variant0(false), Enum::Variant0(true))"
  const v0 = (b: boolean) => w({ $: "Variant", _0: 0 }, [w({ $: "Bool", _0: b }, [], { $: "Bool" })], TY);
  expect(debug(w(Constructor.Struct, [v0(false), v0(true)], ty), PLAIN)).toBe("(Enum::Variant0(false), Enum::Variant0(true))");
  // tests/exhaustiveness.rs:130 "(Enum::Variant1(_), _)": `wild_from_ctor` fills the fields with wildcards
  const v1 = WitnessPat.wild_from_ctor<CxTypes>(cx, { $: "Variant", _0: 1 }, TY);
  expect(debug(w(Constructor.Struct, [v1, WitnessPat.wildcard<CxTypes>(cx, TY)], ty), PLAIN)).toBe("(Enum::Variant1(_), _)");
  // tests/exhaustiveness.rs:177 "_" for `NonExhaustive`
  expect(debug(w(Constructor.NonExhaustive, [], TY), PLAIN)).toBe("_");
  // an empty type's wildcard is `!`
  const never = WitnessPat.wildcard<CxTypes>(cx, NEVER);
  expect(debug(never, PLAIN)).toBe("!");
  expect(never.is_never_pattern()).toBe(true);
  expect(w(Constructor.Struct, [never, v0(true)], ty).is_never_pattern()).toBe(true);
  expect(w(Constructor.Or, [never, v0(true)], ty).is_never_pattern()).toBe(false);
  // clone is deep: writing a field of the clone leaves the original alone
  const orig = w(Constructor.Struct, [v0(false), v0(true)], ty);
  const copy = orig.clone();
  copy.fields[0] = v1;
  expect(debug(orig, PLAIN)).toBe("(Enum::Variant0(false), Enum::Variant0(true))");
  expect(debug(copy, PLAIN)).toBe("(Enum::Variant1(_), Enum::Variant0(true))");
  // MatchArm is Copy
  const arm: MatchArm<CxTypes> = { pat: pat(TY, "_"), has_guard: false, arm_data: null };
  expect(MatchArm.clone(arm)).toEqual(arm);
});

// Lane pat-c ported rustc.rs: `analyze_match` now passes `reveal_opaque_ty` and stops in usefulness (lane pat-a) until
// that is ported (then this test is skipped; the end-to-end checks are rustc.test.ts's and the suites').
test.skipIf(USEFULNESS_PORTED)("analyze_match stops at the first stub on its path (lane pat-a)", () => {
  const BOOL = { kind: () => ({ $: "Bool" }) };
  const tcx = { pattern_complexity_limit: () => ({ _0: undefined }) };
  const tycx = new RustcPatCtxt(
    tcx as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined,
    undefined as never,
    undefined,
    undefined as never,
    true,
    true,
    RustcPatCtxtState.default(),
  );
  let err: unknown;
  try {
    analyze_match(tycx, [], BOOL as never);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Unported);
  expect((err as Unported).what).toBe("rustc_pattern_analysis::usefulness::PlaceValidity::from_bool");
});
