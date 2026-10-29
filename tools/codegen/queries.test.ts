// tools/codegen/queries.ts: the committed src/rustc_middle/queries.gen.ts is what the generator makes from the
// pinned upstream, and the `rustc_queries!` parser / `desc` translator behave like rustc_macros/src/query.rs on
// synthetic inputs (golden output). Needs the upstream checkout ($RUST_TS_DATA/rust); skips visibly without it.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, UPSTREAM } from "../../scripts/lib/common.ts";
import { generate, OUT_PATH, parseQueries, SRC_PATH } from "./queries.ts";

const MACROS = join(UPSTREAM, "compiler/rustc_macros/src/query.rs");
const QUERY_API = join(UPSTREAM, "compiler/rustc_middle/src/query/query_api.rs");
const SKIP = !existsSync(MACROS);
if (SKIP) console.log("SKIP: upstream checkout missing (bun scripts/upstream.ts)");

const read = (p: string): string => readFileSync(p, "utf8");
const gen = (body: string): string =>
  generate(
    `use rustc_hir::def::DefKind;\nuse rustc_hir::def_id::{CrateNum, DefId, LocalDefId};\nuse rustc_span::{ErrorGuaranteed, Symbol};\nuse crate::ty::{self, TyCtxt};\nrustc_queries! {\n${body}\n}\n`,
    read(MACROS),
    read(QUERY_API),
  ).text;

test.skipIf(SKIP)("committed queries.gen.ts is up to date", () => {
  const g = generate(read(join(UPSTREAM, SRC_PATH)), read(MACROS), read(QUERY_API));
  expect(g.queries.length).toBe(329);
  expect(g.nonQueries.map((n) => n.name)).toEqual(["Null", "Red", "SideEffect", "AnonZeroDeps", "TraitSelect", "CompileCodegenUnit", "CompileMonoItem", "Metadata"]);
  expect(g.queries.filter((q) => q.modifiers.feedable).length).toBe(26);
  expect(read(join(REPO, OUT_PATH))).toBe(g.text);
});

test.skipIf(SKIP)("parser: modifiers, key patterns, returns_error_guaranteed, doc comments", () => {
  const { queries } = parseQueries(
    `rustc_queries! {
      /// Doc line.
      query a(key: DefId) -> Result<(), ErrorGuaranteed> { desc { "a \`{}\`", tcx.def_path_str(key) } feedable separate_provide_extern }
      query b(_: ()) { eval_always no_hash desc { "b" } }
      query c((x, y): (DefId, DefId)) -> Result<Symbol, ()> { desc { "c" } arena_cache cache_on_disk }
      non_query Null
    }`,
  );
  expect(queries.map((q) => [q.name, q.key_pat, q.ret_text, q.returns_error_guaranteed, q.doc])).toEqual([
    ["a", "key", "Result<(), ErrorGuaranteed>", true, [" Doc line."]],
    ["b", "_", "()", false, []],
    ["c", "(x, y)", "Result<Symbol, ()>", false, []],
  ]);
  expect(queries[0]!.modifiers).toMatchObject({ feedable: true, separate_provide_extern: true, eval_always: false });
  expect(queries[1]!.modifiers).toMatchObject({ eval_always: true, no_hash: true });
  expect(queries[2]!.key_bind).toEqual({ k: "tuple", names: ["x", "y"] });
});

test.skipIf(SKIP)("parser rejects what the proc macro rejects", () => {
  const p = (b: string) => () => parseQueries(`rustc_queries! { ${b} }`);
  expect(p(`query a(_: ()) { desc { "a" } bogus }`)).toThrow("unknown query modifier");
  expect(p(`query a(_: ()) { desc { "a" } no_hash no_hash }`)).toThrow("duplicate modifier");
  expect(p(`query a(_: ()) { no_hash }`)).toThrow("no description provided");
  expect(p(`query a(_: ()) { desc { "a" } feedable eval_always }`)).toThrow("cannot be both `feedable` and `eval_always`");
  expect(p(`fn a() {}`)).toThrow("expected `query` or `non_query`");
});

test.skipIf(SKIP)("golden: declarations, desc translation (format args, named args, match), unported desc", () => {
  const t = gen(`
    /// Kind of a def.
    query k(def_id: DefId) -> DefKind {
        desc { "looking up kind of \`{}\`", tcx.def_path_str(def_id) }
        separate_provide_extern
        feedable
    }
    query t(key: DefId) -> Symbol {
        desc {
            "{action} \`{path}\`",
            action = match tcx.k(key) {
                DefKind::TyAlias => "expanding type alias",
                _ => "computing type of",
            },
            path = tcx.def_path_str(key),
        }
    }
    query n(_: CrateNum) -> Symbol { desc { "crate name" } }
    query u(key: LocalDefId) -> Result<(), ErrorGuaranteed> { desc { "{:?}", key.local_def_index } }
  `);
  expect(t).toContain(
    "  k: { Key: DefId; KeyArg: Parameters<typeof into_query_key_DefId>[0]; LocalKey: LocalQueryKeyOf<typeof KEY_DefId>; Value: DefKind; ProvidedValue: DefKind };",
  );
  expect(t).toContain("    desc: (tcx, def_id) => { const __0 = tcx.def_path_str(def_id); return `looking up kind of \\`${__0}\\``; },");
  expect(t).toContain(
    '    desc: (tcx, key) => { const __0 = (() => { const __m = tcx.k(key); if (__m.$ === "TyAlias") return "expanding type alias"; return "computing type of"; })(); const __1 = tcx.def_path_str(key); return `${__0} \\`${__1}\\``; },',
  );
  expect(t).toContain("    desc: (_tcx, _key) => `crate name`,");
  expect(t).toContain('    desc: () => unported("desc of query `u` (field `.local_def_index`)"),');
  expect(t).toContain("    debug_value: (v, f) => debug_DefKind(v, f),");
  expect(t).toContain('export type FeedableQuery = "k";');
  expect(t).toContain('export type ErrorGuaranteedQuery = "u";');
  expect(t).toContain('export type ExternQuery = "k";');
  expect(t).toContain("    key: KEY_CrateNum,");
});

test.skipIf(SKIP)("golden: desc fields of structs and type aliases, methods on non-tcx receivers, constants", () => {
  const t = gen(`
    query l(key: ty::PseudoCanonicalInput<'tcx, ty::Ty<'tcx>>) -> Symbol { desc { "computing layout of \`{}\`", key.value } }
    query e(key: ty::PseudoCanonicalInput<'tcx, crate::mir::interpret::GlobalId<'tcx>>) -> Symbol {
        desc { "simplifying constant for the type system \`{}\`", key.value.display(tcx) }
    }
    query o(goal: crate::traits::query::CanonicalPredicateGoal<'tcx>) -> Symbol {
        desc { "evaluating trait selection obligation \`{}\`", goal.canonical.value.value }
    }
    query a(key: ()) -> Symbol { desc { "running analysis passes on crate \`{}\`", tcx.crate_name(rustc_hir::def_id::LOCAL_CRATE) } }
    query crate_name(_: CrateNum) -> Symbol { desc { "crate name" } }
    query x(key: ty::PseudoCanonicalInput<'tcx, ty::Ty<'tcx>>) -> Symbol { desc { "{}", key.typing_env } }
    query y(key: ty::PseudoCanonicalInput<'tcx, ty::Ty<'tcx>>) -> Symbol { desc { "{}", key.value.kind() } }
    query n(goal: crate::traits::query::CanonicalTypeOpNormalizeGoal<'tcx, ty::Ty<'tcx>>) -> Symbol {
        desc { "normalizing \`{}\`", goal.canonical.value.value.value.skip_normalization() }
    }
  `);
  expect(t).toContain(
    "    desc: (_tcx, goal) => { const __0 = Unnormalized.skip_normalization(goal.canonical.value.value.value); return `normalizing \\`${display_Ty(__0)}\\``; },",
  );
  expect(t).toContain("    desc: (_tcx, key) => { const __0 = key.value; return `computing layout of \\`${display_Ty(__0)}\\``; },");
  expect(t).toContain("    desc: (tcx, key) => { const __0 = key.value.display(tcx); return `simplifying constant for the type system \\`${__0}\\``; },");
  expect(t).toContain(
    "    desc: (_tcx, goal) => { const __0 = goal.canonical.value.value; return `evaluating trait selection obligation \\`${display_Predicate(__0)}\\``; },",
  );
  expect(t).toContain("    desc: (tcx, _key) => { const __0 = tcx.crate_name(LOCAL_CRATE); return `running analysis passes on crate \\`${display_Symbol(__0)}\\``; },");
  expect(t).toContain('    desc: () => unported("desc of query `x` (field `.typing_env`)"),');
  expect(t).toContain('    desc: () => unported("desc of query `y` (method `.kind()` on a non-tcx receiver)"),');
});

test.skipIf(SKIP)("key impls: every query key has a `QueryKey` impl (lane query-keys)", () => {
  const g = generate(read(join(UPSTREAM, SRC_PATH)), read(MACROS), read(QUERY_API));
  expect(g.report.unported_keys).toEqual({});
  expect(g.text).not.toContain("key_unported(");
  expect(g.text).toContain("    key: KEY_LocalExpnId_TokenStream,");
  expect(g.text).toContain("    key: KEY_Instance_CollectionMode,");
  expect(g.text).toContain("  items_of_instance: { Key: [Instance, CollectionMode]; KeyArg: [Instance, CollectionMode]; LocalKey: [Instance, CollectionMode];");
  // a key type with no entry in queries.config.json `keys` still falls back to `key_unported(..)`
  const t = gen(`query z(key: (DefId, CrateNum, Symbol)) -> Symbol { desc { "z" } }`);
  expect(t).toContain('    key: key_unported("(DefId, CrateNum, Symbol)"),');
});
