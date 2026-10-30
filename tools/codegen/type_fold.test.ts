// Set rustc_ty of tools/codegen/types.ts (lane codegen-tyir): the golden (the rustc_type_ir data types and the rustc_middle::ty
// types of the set reproduce the committed `.gen.ts` files), derive(TypeVisitable[_Generic]) / derive(TypeFoldable[_Generic])
// (rustc_type_ir_macros/src/lib.rs, rustc_macros/src/type_visitable.rs + type_foldable.rs) on a synthetic crate and at run
// time, `#[derive_where(..)]` (derive-where 1.6.1), `I: Interner` erasure (plan-m3 D3) and the Debug format of generated
// type_ir values (expectations printed by `rustc +nightly` from mirror types with the same derives, see below).
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import { ControlFlow, VisitorResult } from "../../src/rustc_ast_ir/visit.ts";
import type { FallibleTypeFolder, TypeFolder, TypeVisitor } from "../../src/rustc_type_ir/fold.ts";
import { format_debug, PLAIN, PRETTY, debug_int } from "../../src/std/fmt.ts";
import { Err, Ok, type Result } from "../../src/std/result.ts";
import { generate, loadSet, loadTypeMap, type PAttr, type PField, type PImpl, type PItem, type ProbeJson, type PType, REPO, type SetConfig } from "./types.ts";

const SRC = join(REPO, "src");
const HAVE_UPSTREAM = existsSync(join(UPSTREAM, "compiler/rustc_type_ir/src/lib.rs"));
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
if (!HAVE_UPSTREAM && !REQUIRE_PROBES) console.log("SKIP: rustc_ty golden needs the upstream checkout; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
const pin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust.commit.slice(0, 12);

test.skipIf(!HAVE_UPSTREAM && !REQUIRE_PROBES)("golden: the rustc_ty set reproduces src/rustc_type_ir + src/rustc_middle/ty", () => {
  if (!HAVE_UPSTREAM) throw new Error(`ERROR: upstream checkout missing (${UPSTREAM}) and RUST_TS_REQUIRE_PROBES=1`);
  // fixture: `bun tools/codegen/types.ts rustc_ty --save-json ..`, with the items of the `resolve_files` dropped (unused)
  // (lane misc-blockers added the entry of ty/impls_ty.rs: the manual StableHash impls of `GenericArg` / `RawList`)
  const probe: ProbeJson = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "rustc_ty.typedefs.json"), "utf8"));
  const set = loadSet("rustc_ty");
  const res = generate(probe, set, loadTypeMap(), { set: "rustc_ty", out: SRC, srcRoot: SRC, pin, upstream: UPSTREAM });
  expect(res.report.errors).toEqual([]);
  expect(res.report.unknown_types).toEqual({});
  // the only fields without an impl are those upstream has none for either: the derived impl's where-clause never holds
  // (`ProbeKind`: `QueryResult` = `Result<Canonical<..>, NoSolution>` and `CandidateSource` are not traversable;
  // `SmallCopySet`: `[T; N]` has no TypeFoldable impl)
  expect(Object.keys(res.report.missing_type_fold).sort()).toEqual([
    "[T ; 1] (visit.rs:220 (as its slice); no TypeFoldable impl)",
    "[T ; 2] (visit.rs:220 (as its slice); no TypeFoldable impl)",
    "[T ; 3] (visit.rs:220 (as its slice); no TypeFoldable impl)",
    "rustc_type_ir::canonical::Canonical (TypeFoldable)",
    "rustc_type_ir::canonical::Canonical (TypeVisitable)",
    "rustc_type_ir::solve::CandidateSource (TypeFoldable)",
    "rustc_type_ir::solve::CandidateSource (TypeVisitable)",
    "rustc_type_ir::solve::NoSolution (TypeFoldable)",
    "rustc_type_ir::solve::NoSolution (TypeVisitable)",
  ]);
  // derive(Decodable_NoContext / TyDecodable) (lane rmeta-ty): the fields whose Decodable impl is not ported yet
  // (lane meta-mir: `rustc_abi::FieldIdx` has a serialize.json entry now; lane rmeta-gaps-a: so do `ty::ExprKind`'s
  // operands `mir::BinOp` / `mir::UnOp` / `abstract_const::CastKind`, through ty/codec.ts's lazy wrappers)
  expect(Object.keys(res.report.missing_decodable).sort()).toEqual([
    "I::LocalDefIds",
    "I::PredefinedOpaques",
    "I::RegionAssumptions",
    "rustc_middle::ty::ImplTraitInTraitData",
  ]);
  // derive(StableHash_NoContext / StableHash) of the `stable_hash_types` (lane misc-blockers: `Ty: StableHash`): every
  // field has an impl (lane stablehash-gaps: `ty::Expr`'s operator kinds `mir::BinOp` / `mir::UnOp` (set rustc_middle_mir)
  // and `abstract_const::CastKind` (set rustc_middle) are generated, stable_hash.json)
  expect(res.report.missing_stable_hash).toEqual({});
  const sum = (k: "types" | "debug_fns" | "type_fold" | "decodable" | "stable_hash") => res.report.files.reduce((a, f) => a + f[k], 0);
  // lane rmeta-ty: CoerceUnsizedInfo is generated (+1 type, +1 Debug); 94 Decodable impls; lane misc-blockers: 39 StableHash
  // impls in two more files (rustc_type_ir/ty_stable_hash.gen.ts, rustc_middle/ty_stable_hash.gen.ts); lane misc-blockers-2:
  // +19 (`EarlyBinder`, `PredicateKind` / `ClauseKind` and the 14 predicate types they hold, `Predicate`, `Clause`)
  expect([res.files.size, sum("types"), sum("debug_fns"), sum("type_fold"), sum("decodable"), sum("stable_hash")]).toEqual([37, 255, 128, 204, 94, 58]);
  for (const [file, content] of res.files) expect(content).toBe(readFileSync(file, "utf8"));
  // no stale generated file of the set left on disk (fast_reject.gen.ts / stable_hash.gen.ts belong to set rustc_type_ir,
  // typeck_results.gen.ts to set rustc_middle_typeck_results, mod.gen.ts to set rustc_middle_ty_mod, print/pretty.gen.ts to set
  // rustc_middle_ty_print, instance.gen.ts / vtable.gen.ts to set rustc_middle_ty_instance)
  const onDisk: string[] = [resolve(SRC, "rustc_middle", "ty_stable_hash.gen.ts")];
  for (const dir of ["rustc_type_ir", "rustc_middle/ty"])
    for (const f of readdirSync(join(SRC, dir), { recursive: true }) as string[])
      if (
        f.endsWith(".gen.ts") &&
        !(dir === "rustc_type_ir" && (f === "fast_reject.gen.ts" || f === "stable_hash.gen.ts")) &&
        !(
          dir === "rustc_middle/ty" &&
          (f === "typeck_results.gen.ts" || f === "mod.gen.ts" || f === join("print", "pretty.gen.ts") || f === "instance.gen.ts" || f === "vtable.gen.ts")
        )
      )
        onDisk.push(resolve(SRC, dir, f));
  expect(onDisk.sort()).toEqual([...res.files.keys()].map((f) => resolve(f)).sort());
}, 120_000); // path resolution through rustc_middle's and rustc_type_ir's glob re-exports takes a few seconds

// ---- a synthetic crate ----
const path = (name: string, ...args: PType[]): PType => ({
  kind: "path",
  text: name,
  path: { global: false, segments: name.split("::").map((n, i, a) => ({ name: n, args: i === a.length - 1 ? args.map((ty) => ({ kind: "type", ty })) : [] })) },
});
const attr = (p: string, text: string, tokens?: PAttr["tokens"]): PAttr => ({ path: p, text, ...(tokens ? { tokens } : {}) });
const ident = (v: string) => ({ t: "ident" as const, v, line: 1, col: 0 });
const punct = (v: string) => ({ t: "punct" as const, v, line: 1, col: 0 });
/** `#[derive_where(A, B; I: Interner)]` */
const dw = (...traits: string[]): PAttr =>
  attr("derive_where", `derive_where (${traits.join(" , ")} ; I : Interner)`, [...traits.flatMap((t, i) => (i ? [punct(","), ident(t)] : [ident(t)])), punct(";"), ident("I"), punct(":"), ident("Interner")]);
const dwSkip = (trait_: string): PAttr => attr("derive_where", `derive_where (skip (${trait_}))`, [ident("skip"), { t: "group", delim: "(", tokens: [ident(trait_)], line: 1, col: 0 }]);
const derive = (...derives: string[]): PAttr => ({ path: "derive", text: `derive (${derives.join(", ")})`, derives });
const field = (name: string | null, index: number, ty: PType, attrs: PAttr[] = []): PField => ({ name, index, vis: "pub", ty, attrs, docs: [], line: 10 + index });
const I = { kind: "type", name: "I" };
const item = (it: Partial<PItem> & Pick<PItem, "kind" | "name" | "line">): PItem => ({ vis: "pub", module: [], attrs: [], generics: { params: [], where: [] }, ...it });
const unit = (name: string, line: number) => ({ name, line, attrs: [], docs: [], fields: { style: "unit" as const, fields: [] }, discriminant: null });
const GEN = [derive("TypeVisitable_Generic", "TypeFoldable_Generic", "Lift_Generic", "GenericTypeVisitable")];

function synth(items: PItem[], extra: Partial<SetConfig> = {}, impls: PImpl[] = []) {
  const probe: ProbeJson = { files: [{ path: "compiler/fake/src/lib.rs", attrs: [], items, uses: [], impls, macros: [], mods: [] }] };
  const set: SetConfig = { files: ["compiler/fake/src/lib.rs"], class: [], hand: [], discriminant: [], skip: [], erase_params: ["I"], typemap_extra: ["tyir.typemap.json"], derive_type_fold: true, ...extra };
  const res = generate(probe, set, loadTypeMap(), { set: "fake", out: SRC, srcRoot: SRC });
  return { res, text: res.files.get(join(SRC, "fake/lib.gen.ts")) ?? "" };
}

test("derive_where: traits before `;` derive Debug; `skip(Debug)` fields end in finish_non_exhaustive", () => {
  const { res, text } = synth([
    item({
      kind: "struct",
      name: "Early",
      line: 1,
      attrs: [dw("Clone", "Copy", "Debug")],
      generics: { params: [I, { kind: "type", name: "T" }], where: [] },
      fields: { style: "named", fields: [field("value", 0, path("T")), field("_tcx", 1, path("PhantomData"), [dwSkip("Debug")])] },
    }),
    item({ kind: "struct", name: "NoDebug", line: 2, attrs: [dw("Clone", "Hash")], fields: { style: "named", fields: [field("a", 0, path("u32"))] } }),
    item({ kind: "enum", name: "E", line: 3, attrs: [dw("Debug")], variants: [unit("A", 4), { ...unit("B", 5), fields: { style: "named", fields: [field("x", 0, path("u32")), field("y", 1, path("u32"), [dwSkip("Debug")])] } }] }),
  ]);
  expect(res.report.errors).toEqual([]);
  expect(text).toContain(
    [
      "export function debug_Early<T>(v: Early<T>, f: Fmt, debug_T: Debug<T>): string {",
      "  return debug_struct_non_exhaustive(f, \"Early\", [",
      "    [\"value\", debug_T(v.value, f)],",
      "  ]);",
      "}",
    ].join("\n"),
  );
  expect(text).not.toContain("debug_NoDebug");
  expect(text).toContain('      return debug_struct_non_exhaustive(f, "B", [\n        ["x", debug_int(v.x, f)],\n      ]);');
  expect(text).toMatch(/import \{[^}]*\bdebug_struct_non_exhaustive\b[^}]*\} from "\.\.\/std\/fmt\.ts";/);
});

test("erase_params: `I` leaves the generics and the arguments at its position; `<I as Interner>::X` reads as `I::X`", () => {
  const qself: PType = { kind: "path", text: "< I as Interner > :: GenericArgs", qself: path("I"), path: { global: false, segments: [{ name: "Interner", args: [] }, { name: "GenericArgs", args: [] }] } };
  const { res, text } = synth([
    item({ kind: "struct", name: "W", line: 1, attrs: [dw("Debug")], generics: { params: [I, { kind: "type", name: "T" }], where: [] }, fields: { style: "named", fields: [field("ty", 0, path("I::Ty")), field("t", 1, path("T"))] } }),
    item({ kind: "struct", name: "U", line: 2, attrs: [dw("Debug")], generics: { params: [I], where: [] }, fields: { style: "named", fields: [field("w", 0, path("W", path("I"), path("u32"))), field("args", 1, qself)] } }),
  ]);
  expect(res.report.errors).toEqual([]);
  expect(res.report.unknown_types).toEqual({});
  expect(text).toContain("export interface W<T> {\n  ty: Ty;\n  t: T;\n}");
  expect(text).toContain("export interface U {\n  w: W<number>;\n  args: GenericArgs;\n}");
  expect(text).toContain('["w", debug_W(v.w, f, debug_int)],');
});

test("derive(TypeVisitable_Generic / TypeFoldable_Generic): field order, ignore / identity, trivial fields, generics, enums", () => {
  const { res, text } = synth([
    item({
      kind: "struct",
      name: "S",
      line: 1,
      attrs: GEN,
      generics: { params: [I, { kind: "type", name: "T" }], where: [] },
      fields: {
        style: "named",
        fields: [
          field("def_id", 0, path("I::DefId")),
          field("args", 1, path("I::GenericArgs")),
          field("t", 2, path("T")),
          field("skip", 3, path("I::Ty"), [attr("type_visitable", "type_visitable (ignore)"), attr("type_foldable", "type_foldable (identity)")]),
          field("v", 4, path("Vec", path("T"))),
        ],
      },
    }),
    item({
      kind: "enum",
      name: "K",
      line: 2,
      attrs: GEN,
      generics: { params: [I], where: [] },
      variants: [unit("A", 3), { ...unit("B", 4), fields: { style: "unnamed", fields: [field(null, 0, path("S", path("I"), path("u32")))] } }],
    }),
    item({ kind: "enum", name: "F", line: 5, attrs: GEN, variants: [unit("X", 6), unit("Y", 7)] }),
  ]);
  expect(res.report.errors).toEqual([]);
  expect(res.report.missing_type_fold).toEqual({});
  expect(text).toContain(
    [
      "// rustc-derive: compiler/fake/src/lib.rs:1 TypeVisitable_Generic for S",
      "export function visit_with_S<T, R>(self: S<T>, __visitor: TypeVisitor<R>, visit_with_T: VisitWith<T>): R {",
      "  let r: R | undefined;",
      "  if ((r = try_visit(__visitor.Result, visit_with_GenericArgs(self.args, __visitor))) !== undefined) return r;",
      "  if ((r = try_visit(__visitor.Result, visit_with_T(self.t, __visitor))) !== undefined) return r;",
      "  if ((r = try_visit(__visitor.Result, visit_with_Vec<T, R>(self.v, __visitor, visit_with_T))) !== undefined) return r;",
      "  return __visitor.Result.output();",
      "}",
      "// rustc-derive: compiler/fake/src/lib.rs:1 TypeFoldable_Generic for S (try_fold_with)",
      "export function try_fold_with_S<T, E>(self: S<T>, __folder: FallibleTypeFolder<E>, try_fold_with_T: TryFoldWith<T>): Result<S<T>, E> {",
      "  const __1 = try_fold_with_GenericArgs(self.args, __folder);",
      '  if (__1.$ === "Err") return __1;',
      "  const __2 = try_fold_with_T(self.t, __folder);",
      '  if (__2.$ === "Err") return __2;',
      "  const __4 = try_fold_with_Vec<T, E>(self.v, __folder, try_fold_with_T);",
      '  if (__4.$ === "Err") return __4;',
      "  return Ok({ def_id: self.def_id, args: __1._0, t: __2._0, skip: self.skip, v: __4._0 });",
      "}",
      "// rustc-derive: compiler/fake/src/lib.rs:1 TypeFoldable_Generic for S (fold_with)",
      "export function fold_with_S<T>(self: S<T>, __folder: TypeFolder, fold_with_T: FoldWith<T>): S<T> {",
      "  return { def_id: self.def_id, args: fold_with_GenericArgs(self.args, __folder), t: fold_with_T(self.t, __folder), skip: self.skip, v: fold_with_Vec<T>(self.v, __folder, fold_with_T) };",
      "}",
    ].join("\n"),
  );
  // a trivially traversable type argument passes the `TrivialTypeTraversalImpls!` fns; unit variants return `self`
  expect(text).toContain("visit_with_S<number, R>(self._0, __visitor, visit_with_trivial)");
  expect(text).toContain(
    [
      "export function fold_with_K(self: K, __folder: TypeFolder): K {",
      "  switch (self.$) {",
      '    case "B": {',
      '      return { $: "B" as const, _0: fold_with_S<number>(self._0, __folder, fold_with_trivial) };',
      "    }",
      '    case "A":',
      "      return self;",
      "  }",
      "}",
    ].join("\n"),
  );
  // a fieldless enum: nothing to visit, folding returns the value
  expect(text).toContain("export function visit_with_F<R>(_self: F, __visitor: TypeVisitor<R>): R {\n  return __visitor.Result.output();\n}");
  expect(text).toContain("export function try_fold_with_F<E>(self: F, __folder: FallibleTypeFolder<E>): Result<F, E> {\n  return Ok(self);\n}");
  // Lift_Generic / GenericTypeVisitable: nothing (PORTING §3; rust-analyzer only)
  expect(text).not.toMatch(/lift|generic_visit/i);
});

test("derive(TypeVisitable / TypeFoldable) (rustc_macros): manual impls come from the hand module; a missing impl is unported", () => {
  const manual: PImpl = { line: 30, module: [], attrs: [], trait: "TypeFoldable", self_ty: path("M"), self_name: "M", fns: [{ name: "try_fold_with", line: 31 }] };
  const { res, text } = synth(
    [
      item({ kind: "struct", name: "M", line: 1, fields: { style: "named", fields: [field("a", 0, path("u32"))] } }),
      item({ kind: "struct", name: "Uses", line: 2, attrs: [derive("TypeFoldable", "TypeVisitable")], fields: { style: "unnamed", fields: [field(null, 0, path("M")), field(null, 1, path("Nope"))] } }),
    ],
    {},
    [manual],
  );
  expect(res.report.errors).toEqual([]);
  // `M` has a manual TypeFoldable but no TypeVisitable: the visit is unported, the fold comes from src/fake/lib.ts
  expect(Object.keys(res.report.missing_type_fold).sort()).toEqual(["Nope", "fake::M (TypeVisitable)"]);
  expect(text).toContain("  const __0 = try_fold_with_M(self._0, __folder);\n");
  expect(text).toContain("  return unported_type_fold(self._1);\n}");
  expect(text).toMatch(/import \{ fold_with_M, try_fold_with_M \} from "\.\/lib\.ts";/);
});

// ---- run time: the committed generated impls with test visitors / folders ----
import { fold_with_ExpectedFound, try_fold_with_ExpectedFound, visit_with_ExpectedFound } from "../../src/rustc_type_ir/error.ts";
import { fold_with_AliasBoundKind, visit_with_AliasBoundKind } from "../../src/rustc_type_ir/solve/mod.ts";

test("generated impls at run time: visit order and early break, try_fold stops at the first Err, fold rebuilds", () => {
  const seen: number[] = [];
  // The generated impls of non-interned types only read `Result` (the folders nothing): the hooks are never called.
  const visitor = { Result: VisitorResult.ControlFlow<number>() } as unknown as TypeVisitor<ControlFlow<number>>;
  const visit_n = <R>(n: number, v: TypeVisitor<R>): R => {
    seen.push(n);
    return (n === 1 ? ControlFlow.Break(n) : ControlFlow.CONTINUE) as R;
  };
  expect(visit_with_ExpectedFound({ expected: 2, found: 3 }, visitor, visit_n)).toEqual(ControlFlow.CONTINUE);
  expect(visit_with_ExpectedFound({ expected: 1, found: 3 }, visitor, visit_n)).toEqual(ControlFlow.Break(1));
  expect(seen).toEqual([2, 3, 1]); // the Break of `expected` returns before `found`
  const folder = {} as TypeFolder;
  expect(fold_with_ExpectedFound({ expected: 2, found: 3 }, folder, (n: number) => n * 10)).toEqual({ expected: 20, found: 30 });
  const ff = {} as FallibleTypeFolder<string>;
  const tried: number[] = [];
  const try_n = <E>(n: number, _f: FallibleTypeFolder<E>): Result<number, E> => {
    tried.push(n);
    return (n === 0 ? Err("zero") : Ok(n + 1)) as Result<number, E>;
  };
  expect(try_fold_with_ExpectedFound({ expected: 1, found: 2 }, ff, try_n)).toEqual(Ok({ expected: 2, found: 3 }));
  expect(try_fold_with_ExpectedFound({ expected: 0, found: 2 }, ff, try_n)).toEqual(Err("zero"));
  expect(tried).toEqual([1, 2, 0]);
  // a fieldless derived enum (`AliasBoundKind`): visit continues, fold is the identity
  expect(visit_with_AliasBoundKind("SelfBounds", visitor)).toEqual(ControlFlow.CONTINUE);
  expect(fold_with_AliasBoundKind("NonSelfBounds", folder)).toBe("NonSelfBounds");
});

// ---- Debug of generated type_ir values ----
// Expectations: `rustc +nightly` (the pinned toolchain) running a mirror program with the same shapes: `#[derive(Debug)]`
// enums/structs as upstream, derive_where's `skip(Debug)` expansion written out (`debug_struct(..).field(..)
// .finish_non_exhaustive()`, derive-where-1.6.1 src/trait_/debug.rs), `newtype_index!` Debug as its `debug_format`, and
// bitflags-2.10.0's internal Debug (`debug_tuple("TypeFlags").field(&format_args!("{}", to_writer(..)))`).
import { debug_IntVarValue, IntVarValue } from "../../src/rustc_type_ir/ty_kind.ts";
import { debug_EarlyBinder } from "../../src/rustc_type_ir/binder.ts";
import { debug_BoundConst } from "../../src/rustc_type_ir/binder.ts";
import { BoundVar, DebruijnIndex, debug_BoundVar, debug_DebruijnIndex, debug_UniverseIndex, UniverseIndex } from "../../src/rustc_type_ir/lib.ts";
import { debug_TyVid, TyVid } from "../../src/rustc_type_ir/ty_kind.ts";
import { debug_RegionVid, RegionVid } from "../../src/rustc_type_ir/region_kind.ts";
import { debug_TypeFlags, TypeFlags } from "../../src/rustc_type_ir/flags.ts";
import { Certainty, debug_Certainty } from "../../src/rustc_type_ir/solve/mod.ts";

test("Debug of generated type_ir values matches rustc's {:?} / {:#?}", () => {
  const both = <T>(v: T, d: (v: T, f: typeof PLAIN) => string) => `${format_debug(v, d, PLAIN)}|${format_debug(v, d, PRETTY)}`;
  void IntVarValue;
  // rustc_ast_ir `impl Debug for IntTy` writes `name_str()` (mirror: `IntType(i8)`)
  expect(both({ $: "IntType", _0: "I8" } as IntVarValue, debug_IntVarValue)).toBe("IntType(i8)|IntType(\n    i8,\n)");
  expect(both({ value: 5, _tcx: undefined }, (v, f) => debug_EarlyBinder(v, f, debug_int))).toBe("EarlyBinder { value: 5, .. }|EarlyBinder {\n    value: 5,\n    ..\n}");
  expect(both({ var: BoundVar.from_u32(3), _tcx: undefined }, debug_BoundConst)).toBe("BoundConst { var: 3, .. }|BoundConst {\n    var: 3,\n    ..\n}");
  expect(format_debug(BoundVar.from_u32(7), debug_BoundVar, PLAIN)).toBe("7");
  expect(format_debug(DebruijnIndex.from_u32(1), debug_DebruijnIndex, PLAIN)).toBe("DebruijnIndex(1)");
  expect(format_debug(UniverseIndex.from_u32(2), debug_UniverseIndex, PLAIN)).toBe("U2");
  expect(format_debug(TyVid.from_u32(3), debug_TyVid, PLAIN)).toBe("?3t");
  expect(format_debug(RegionVid.from_u32(4), debug_RegionVid, PLAIN)).toBe("'?4");
  const flags = TypeFlags.union(TypeFlags.HAS_TY_PARAM, TypeFlags.HAS_RE_PARAM);
  expect(both(flags, debug_TypeFlags)).toBe("TypeFlags(HAS_TY_PARAM | HAS_RE_PARAM)|TypeFlags(\n    HAS_TY_PARAM | HAS_RE_PARAM,\n)");
  expect(format_debug(TypeFlags.empty(), debug_TypeFlags, PLAIN)).toBe("TypeFlags(0x0)");
  const c: Certainty = { $: "Maybe", _0: { cause: { $: "Overflow", suggest_increasing_limit: true, keep_constraints: false }, opaque_types_jank: "AllGood", stalled_on_coroutines: "No" } };
  expect(both(c, debug_Certainty)).toBe(
    "Maybe(MaybeInfo { cause: Overflow { suggest_increasing_limit: true, keep_constraints: false }, opaque_types_jank: AllGood, stalled_on_coroutines: No })|Maybe(\n    MaybeInfo {\n        cause: Overflow {\n            suggest_increasing_limit: true,\n            keep_constraints: false,\n        },\n        opaque_types_jank: AllGood,\n        stalled_on_coroutines: No,\n    },\n)",
  );
  expect(format_debug(Certainty.Yes as Certainty, debug_Certainty, PLAIN)).toBe("Yes");
});

test("type_fold_hand: hand types get generated impls; a hand class is rebuilt with `new` (lane typeck-gaps)", () => {
  const { res, text } = synth(
    [
      item({ kind: "struct", name: "H", line: 1, attrs: GEN, fields: { style: "named", fields: [field("ty", 0, path("I::Ty")), field("n", 1, path("u32"))] } }),
      item({ kind: "struct", name: "C", line: 2, attrs: GEN, fields: { style: "named", fields: [field("h", 0, path("H")), field("ty", 1, path("I::Ty"))] } }),
      item({ kind: "struct", name: "N", line: 3, attrs: GEN, fields: { style: "named", fields: [field("ty", 0, path("I::Ty"))] } }),
    ],
    { hand: ["H", "C", "N"], class: ["C"], type_fold_hand: ["H", "C"] },
  );
  expect(res.report.errors).toEqual([]);
  expect(res.report.missing_type_fold).toEqual({});
  expect(text).toContain("export function fold_with_H(self: H, __folder: TypeFolder): H {\n  return { ty: fold_with_Ty(self.ty, __folder), n: self.n };\n}");
  expect(text).toContain("export function fold_with_C(self: C, __folder: TypeFolder): C {\n  return new C(fold_with_H(self.h, __folder), fold_with_Ty(self.ty, __folder));\n}");
  // the class is imported as a value from the hand module; a hand type not listed gets no impls
  expect(text).toMatch(/import \{[^}]*\bC\b[^}]*\} from "\.\/lib\.ts";/);
  expect(text).not.toContain("visit_with_N");
});
