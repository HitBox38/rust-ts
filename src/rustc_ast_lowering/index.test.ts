// Tests of the port of compiler/rustc_ast_lowering/src/index.rs (`index_hir` + `NodeCollector`; upstream has no
// tests for it).
//
// Oracle check: `index_oracle/index_case.rs` is a `#![no_core]` lib crate. Its fixture
// `index_oracle/index_case.hir-tree.stdout` is the pinned rustc's `-Zunpretty=hir-tree` output; per owner it prints
// `parents: [(local_id, parent), ..]`, i.e. exactly the `ParentedNode::parent` column `index_hir` computes. The test
// builds each owner's HIR by hand with the oracle's `HirId`s (lowering's output, the input of `index_hir`;
// transcribed from the same fixture), runs `index_hir`, and compares the parent column with the fixture, and the
// `Node` kind of every slot with the HIR it was built from. `REGEN=1 bun test src/rustc_ast_lowering/index.test.ts`
// rewrites the fixture (needs the pinned toolchain; with it present the fixture is re-checked on every run).
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";
import { BindingMode } from "../rustc_ast/lib.ts";
import { SortedMap } from "../rustc_data_structures/sorted_map.ts";
import {
  type Arm,
  Block,
  Body,
  type BodyId,
  ConstArg,
  DotDotPos,
  Expr,
  type ExprKind,
  FieldDef,
  FnDecl,
  FnDeclFlags,
  FnHeader,
  GenericParam,
  Generics,
  HirId,
  Item,
  ItemId,
  type ItemKind,
  ItemLocalId,
  ItemLocalId_cmp,
  type LetStmt,
  Lifetime,
  type Mod,
  type OwnerNode,
  OwnerId,
  type Param,
  Pat,
  type PatKind,
  Path,
  PathSegment,
  type QPath,
  type Stmt,
  Ty,
  type TyKind,
  type Variant,
  type VariantData,
  WhereBoundPredicate,
  type WherePredicate,
} from "../rustc_hir/lib.ts";
import { Res } from "../rustc_hir/def.ts";
import { display_HirId } from "../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { Ident, type Symbol } from "../rustc_span/symbol.ts";
import { Panic } from "../std/panic.ts";
import { index_hir } from "./index.ts";

const DIR = join(import.meta.dir, "index_oracle");
const FIXTURE = join(DIR, "index_case.hir-tree.stdout");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

// As src/rustc_hir/hir.oracle.test.ts: the case directory is remapped so `opt_hash` does not depend on the checkout.
const oracle_cmd = (sysroot: string): string[] => [
  "rustc",
  `+${PIN.toolchain}`,
  "-Zunpretty=hir-tree",
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot,
  "--crate-type",
  "lib",
  "--edition=2021",
  `--remap-path-prefix=${DIR}=/index_oracle`,
  "index_case.rs",
];

function run_oracle(s: string): { exit: number; stdout: string } {
  const r = Bun.spawnSync(oracle_cmd(s), { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString() };
}

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  const r = run_oracle(s);
  if (r.exit !== 0) throw new Error(`ERROR: oracle exit ${r.exit} on index_case.rs`);
  writeFileSync(FIXTURE, r.stdout);
}

/** `DefId(0:N ~ ..) => OwnerNodes { .. parents: [(i, p), ..] .. }` of the fixture, keyed by the owner's def index. */
function oracle_parents(text: string): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const block of text.split(/^(?=DefId\()/m)) {
    const owner = /^DefId\(0:(\d+) /.exec(block);
    const parents = /\n {4}parents: \[\n([\s\S]*?)\n {4}\],/.exec(block);
    if (owner === null || parents === null) continue;
    const rows = [...parents[1]!.matchAll(/\((\d+), (\d+)\)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    rows.forEach(([i], k) => expect(i).toBe(k));
    out.set(Number(owner[1]), rows.map(([, p]) => p));
  }
  return out;
}

// ---- hand-built HIR of index_case.rs (HirIds from the fixture) --------------------------------------------------

const sp: Span = DUMMY_SP;
const ident = (n: number): Ident => new Ident(n as Symbol, sp);
const lid = (n: number): ItemLocalId => ItemLocalId.from_u32(n);
const owner = (def_index: number): OwnerId => new OwnerId(def_index as LocalDefId);
const ids = (o: OwnerId) => (n: number): HirId => new HirId(o, lid(n));
const qpath = (seg: HirId): QPath => ({ $: "Resolved", _0: undefined, _1: new Path(sp, Res.Err, [new PathSegment(ident(1), seg, Res.Err, undefined, false, false)]) });
const path_ty = (h: HirId, seg: HirId): Ty => new Ty<null>(h, sp, { $: "Path", _0: qpath(seg) });
const ty = (h: HirId, kind: TyKind): Ty => new Ty<null>(h, sp, kind);
const expr = (h: HirId, kind: ExprKind): Expr => new Expr(h, kind, sp);
const path_expr = (h: HirId, seg: HirId): Expr => expr(h, { $: "Path", _0: qpath(seg) });
const pat = (h: HirId, kind: PatKind): Pat => new Pat(h, kind, sp, true);
const binding = (h: HirId, name: number): Pat => pat(h, { $: "Binding", _0: BindingMode.NONE, _1: h, _2: ident(name), _3: undefined });
const lit_int = (n: bigint) => ({ node: { $: "Int" as const, _0: n, _1: { $: "Unsuffixed" as const } }, span: sp });
const no_generics = (): Generics => new Generics([], [], false, sp, sp);
const header = (): FnHeader => new FnHeader({ $: "Normal", _0: "Safe" }, { $: "NotConst" }, { $: "NotAsync" }, { $: "Rust" });
const item = (o: OwnerId, kind: ItemKind): Item => new Item(o, kind, sp, sp, false);
const field = (h: HirId, def: number, t: Ty): FieldDef =>
  new FieldDef(sp, sp, { kind: { $: "Unrestricted" }, span: DUMMY_SP }, ident(2), h, def as LocalDefId, t, "Safe", undefined);

interface Case {
  owner: OwnerId;
  node: OwnerNode;
  bodies: [ItemLocalId, Body][];
  num_nodes: number;
  /** `Node` variant expected in each slot (`nodes[0]` is the owner node) */
  kinds: string[];
  /** `parenting` expected from `insert_nested` */
  parenting: [number, number][];
}

// `#![no_core]` crate root: `Crate(Mod { item_ids: [P, T, E, f] })`
function crate_root(): Case {
  const m: Mod = { spans: { inner_span: sp, inject_use_span: sp }, item_ids: [1, 3, 6, 12].map((d) => new ItemId(owner(d))) };
  return { owner: owner(0), node: { $: "Crate", _0: m }, bodies: [], num_nodes: 1, kinds: ["Crate"], parenting: [] };
}

// `pub struct P { pub x: u8 }`
function struct_p(): Case {
  const o = owner(1);
  const h = ids(o);
  const data: VariantData = { $: "Struct", fields: [field(h(3), 2, path_ty(h(1), h(2)))], recovered: { $: "No" } };
  const i = item(o, { $: "Struct", _0: ident(3), _1: no_generics(), _2: data });
  return { owner: o, node: { $: "Item", _0: i }, bodies: [], num_nodes: 4, kinds: ["Item", "Ty", "PathSegment", "Field"], parenting: [] };
}

// `pub struct T(u8);`: the constructor is registered by `visit_item`
function struct_t(): Case {
  const o = owner(3);
  const h = ids(o);
  const data: VariantData = { $: "Tuple", _0: [field(h(4), 5, path_ty(h(2), h(3)))], _1: h(1), _2: 4 as LocalDefId };
  const i = item(o, { $: "Struct", _0: ident(4), _1: no_generics(), _2: data });
  return { owner: o, node: { $: "Item", _0: i }, bodies: [], num_nodes: 5, kinds: ["Item", "Ctor", "Ty", "PathSegment", "Field"], parenting: [] };
}

// `pub enum E { A, B(u8) }`: variant constructors are registered by `visit_variant`
function enum_e(): Case {
  const o = owner(6);
  const h = ids(o);
  const a: Variant = { ident: ident(5), hir_id: h(1), def_id: 7 as LocalDefId, data: { $: "Unit", _0: h(2), _1: 8 as LocalDefId }, disr_expr: undefined, span: sp };
  const b: Variant = {
    ident: ident(6),
    hir_id: h(3),
    def_id: 9 as LocalDefId,
    data: { $: "Tuple", _0: [field(h(7), 11, path_ty(h(5), h(6)))], _1: h(4), _2: 10 as LocalDefId },
    disr_expr: undefined,
    span: sp,
  };
  const i = item(o, { $: "Enum", _0: ident(7), _1: no_generics(), _2: { variants: [a, b] } });
  return {
    owner: o,
    node: { $: "Item", _0: i },
    bodies: [],
    num_nodes: 8,
    kinds: ["Item", "Variant", "Ctor", "Variant", "Ctor", "Ty", "PathSegment", "Field"],
    parenting: [],
  };
}

// pub fn f<'a, U>(r: &'a U, (a, _): (u8, u8)) -> [u8; 2] where U: 'a {
//     fn inner() {}
//     let P { x, .. } = P { x: a };
//     let _w: _ = a;
//     match x { 0 => [x, a], _ => [a, x] }
// }
function fn_f(): Case {
  const o = owner(12);
  const h = ids(o);
  const lt = (n: number, source: Lifetime["source"]) => new Lifetime(h(n), ident(8), { $: "Param", _0: 13 as LocalDefId }, source, "ExplicitBound");

  // signature
  const in_r = ty(h(54), { $: "Ref", _0: lt(51, { $: "Reference" }), _1: path_ty(h(52), h(53)), _2: "Not" });
  const in_tup = ty(h(59), { $: "Tup", _0: [path_ty(h(55), h(56)), path_ty(h(57), h(58))] });
  const len = new ConstArg<null>(h(64), { $: "Anon", _0: { hir_id: h(62), def_id: 15 as LocalDefId, body: { hir_id: h(63) }, span: sp } }, sp);
  const out = ty(h(65), { $: "Array", _0: path_ty(h(60), h(61)), _1: len });
  const decl = new FnDecl([in_r, in_tup], { $: "Return", _0: out }, FnDeclFlags.default_());
  const p_a = new GenericParam(h(49), 13 as LocalDefId, { $: "Plain", _0: ident(8) }, sp, false, { $: "Lifetime", kind: { $: "Explicit" } }, undefined, "Generics");
  const p_u = new GenericParam(h(50), 14 as LocalDefId, { $: "Plain", _0: ident(9) }, sp, false, { $: "Type", default: undefined, synthetic: false }, undefined, "Generics");
  const where_u: WherePredicate = {
    hir_id: h(45),
    span: sp,
    kind: { $: "BoundPredicate", _0: new WhereBoundPredicate("WhereClause", [], path_ty(h(46), h(47)), [{ $: "Outlives", _0: lt(48, { $: "OutlivesBound" }) }]) },
  };
  const generics = new Generics([p_a, p_u], [where_u], true, sp, sp);

  // body
  const params: Param[] = [
    { hir_id: h(1), pat: binding(h(2), 10), ty_span: sp, span: sp },
    { hir_id: h(3), pat: pat(h(4), { $: "Tuple", _0: [binding(h(5), 11), pat(h(6), { $: "Wild" })], _1: DotDotPos.new(undefined) }), ty_span: sp, span: sp },
  ];
  const s_inner: Stmt = { hir_id: h(8), kind: { $: "Item", _0: new ItemId(owner(16)) }, span: sp };
  const let_p: LetStmt = {
    super_: undefined,
    pat: pat(h(16), { $: "Struct", _0: qpath(h(17)), _1: [{ hir_id: h(18), ident: ident(12), pat: binding(h(19), 12), is_shorthand: true, span: sp }], _2: sp }),
    ty: undefined,
    init: expr(h(10), { $: "Struct", _0: qpath(h(11)), _1: [{ hir_id: h(12), ident: ident(12), expr: path_expr(h(13), h(14)), span: sp, is_shorthand: false }], _2: { $: "None" } }),
    els: undefined,
    hir_id: h(15),
    span: sp,
    source: "Normal",
  };
  const let_w: LetStmt = {
    super_: undefined,
    pat: binding(h(25), 13),
    ty: ty(h(21), { $: "Infer", _0: null }),
    init: path_expr(h(22), h(23)),
    els: undefined,
    hir_id: h(24),
    span: sp,
    source: "Normal",
  };
  const arms: Arm[] = [
    {
      hir_id: h(31),
      span: sp,
      pat: pat(h(29), { $: "Expr", _0: { hir_id: h(30), span: sp, kind: { $: "Lit", lit: lit_int(0n), negated: false } } }),
      guard: undefined,
      body: expr(h(32), { $: "Array", _0: [path_expr(h(33), h(34)), path_expr(h(35), h(36))] }),
    },
    {
      hir_id: h(38),
      span: sp,
      pat: pat(h(37), { $: "Wild" }),
      guard: undefined,
      body: expr(h(39), { $: "Array", _0: [path_expr(h(40), h(41)), path_expr(h(42), h(43))] }),
    },
  ];
  const m = expr(h(26), { $: "Match", _0: path_expr(h(27), h(28)), _1: arms, _2: { $: "Normal" } });
  const block = new Block(
    [s_inner, { hir_id: h(9), kind: { $: "Let", _0: let_p }, span: sp }, { hir_id: h(20), kind: { $: "Let", _0: let_w }, span: sp }],
    m,
    h(7),
    { $: "DefaultBlock" },
    sp,
    false,
  );
  const body_id: BodyId = { hir_id: h(44) };
  const body = new Body(params, expr(h(44), { $: "Block", _0: block, _1: undefined }));
  const len_body = new Body([], expr(h(63), { $: "Lit", _0: lit_int(2n) }));

  const i = item(o, { $: "Fn", sig: { header: header(), decl, span: sp }, ident: ident(14), generics, body: body_id, has_body: true });
  // prettier-ignore
  const kinds = [
    "Item",
    "Param", "Pat", "Param", "Pat", "Pat", "Pat", "Block", "Stmt", "Stmt", // 1..9
    "Expr", "PathSegment", "ExprField", "Expr", "PathSegment", "LetStmt", "Pat", "PathSegment", "PatField", "Pat", // 10..19
    "Stmt", "Ty", "Expr", "PathSegment", "LetStmt", "Pat", "Expr", "Expr", "PathSegment", "Pat", // 20..29
    "PatExpr", "Arm", "Expr", "Expr", "PathSegment", "Expr", "PathSegment", "Pat", "Arm", "Expr", // 30..39
    "Expr", "PathSegment", "Expr", "PathSegment", "Expr", "WherePredicate", "Ty", "PathSegment", "Lifetime", "GenericParam", // 40..49
    "GenericParam", "Lifetime", "Ty", "PathSegment", "Ty", "Ty", "PathSegment", "Ty", "PathSegment", "Ty", // 50..59
    "Ty", "PathSegment", "AnonConst", "Expr", "ConstArg", "Ty", // 60..65
  ];
  return {
    owner: o,
    node: { $: "Item", _0: i },
    bodies: [
      [lid(44), body],
      [lid(63), len_body],
    ],
    num_nodes: 66,
    kinds,
    // `fn inner` is a nested item of the statement `HirId(f.8)`
    parenting: [[16, 8]],
  };
}

// `fn inner() {}`
function fn_inner(): Case {
  const o = owner(16);
  const h = ids(o);
  const decl = new FnDecl([], { $: "DefaultReturn", _0: sp }, FnDeclFlags.default_());
  const body = new Body([], expr(h(2), { $: "Block", _0: new Block([], undefined, h(1), { $: "DefaultBlock" }, sp, false), _1: undefined }));
  const i = item(o, { $: "Fn", sig: { header: header(), decl, span: sp }, ident: ident(15), generics: no_generics(), body: { hir_id: h(2) }, has_body: true });
  return { owner: o, node: { $: "Item", _0: i }, bodies: [[lid(2), body]], num_nodes: 3, kinds: ["Item", "Block", "Expr"], parenting: [] };
}

const CASES = [crate_root, struct_p, struct_t, enum_e, fn_f, fn_inner];

interface DelayedBug {
  span: Span;
  msg: string;
}
/** `index_hir` reads `tcx` only for `tcx.dcx().span_delayed_bug(..)` (unvisited slots). */
function fake_tcx(bugs: DelayedBug[]): TyCtxt {
  const dcx = { span_delayed_bug: (span: Span, msg: string) => void bugs.push({ span, msg }) };
  return { dcx: () => dcx } as unknown as TyCtxt;
}

function run(c: Case, num_nodes = c.num_nodes) {
  const bugs: DelayedBug[] = [];
  const [nodes, parenting] = index_hir(fake_tcx(bugs), c.node, SortedMap.from_presorted_elements(c.bodies, ItemLocalId_cmp), num_nodes);
  return { nodes, parenting, bugs };
}

// ---- tests ------------------------------------------------------------------------------------------------------

test("index_oracle fixture is the current oracle output", () => {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  const r = run_oracle(s);
  expect({ exit: r.exit, stdout: r.stdout }).toEqual({ exit: 0, stdout: readFileSync(FIXTURE, "utf8") });
}, 120_000);

test("index_hir: the parent of every node equals the oracle's hir-tree `parents` (index_case.rs)", () => {
  const oracle = oracle_parents(readFileSync(FIXTURE, "utf8"));
  // owners: crate root, P, T, E, f, f::inner
  expect([...oracle.keys()]).toEqual([0, 1, 3, 6, 12, 16]);
  for (const make of CASES) {
    const c = make();
    const { nodes, parenting, bugs } = run(c);
    const def = c.owner.def_id as number;
    expect({ def, parents: nodes.map((n) => n.parent as number) }).toEqual({ def, parents: oracle.get(def)! });
    expect({ def, kinds: nodes.map((n): string => n.node.$) }).toEqual({ def, kinds: c.kinds });
    expect({ def, parenting: [...parenting].map(([k, v]) => [k as number, v as number]) }).toEqual({ def, parenting: c.parenting });
    expect(bugs).toEqual([]);
  }
});

test("index_hir: slot 0 is the owner node with the INVALID parent; nodes are the HIR objects themselves", () => {
  const c = struct_t();
  const { nodes } = run(c);
  expect(nodes[0]!.parent).toBe(ItemLocalId.INVALID);
  expect(nodes[0]!.node).toEqual({ $: "Item", _0: (c.node as { _0: Item })._0 });
  expect((nodes[0]!.node as { _0: Item })._0).toBe((c.node as { _0: Item })._0);
  const data = ((c.node as { _0: Item })._0.kind as { _2: VariantData })._2;
  expect((nodes[1]!.node as { _0: VariantData })._0).toBe(data);
});

test("index_hir: every slot no node was inserted into is reported with span_delayed_bug, in id order", () => {
  const c = fn_inner();
  const { nodes, bugs } = run(c, 5);
  expect(nodes.map((n): string => n.node.$)).toEqual(["Item", "Block", "Expr", "Err", "Err"]);
  // `err_node` has parent ZERO and the owner's span
  expect(nodes[3]!.parent).toBe(ItemLocalId.ZERO);
  expect(bugs.map((b) => b.msg)).toEqual(
    [3, 4].map((n) => `ID ${display_HirId(new HirId(c.owner, lid(n)))} not encountered when visiting item HIR`),
  );
  expect(bugs.map((b) => b.span)).toEqual([sp, sp]);
});

test("index_hir: a body missing from `bodies` panics like `SortedMap`'s Index", () => {
  const c = fn_inner();
  expect(() => index_hir(fake_tcx([]), c.node, SortedMap.from_presorted_elements([], ItemLocalId_cmp), c.num_nodes)).toThrow(Panic);
  expect(() => index_hir(fake_tcx([]), c.node, SortedMap.from_presorted_elements([], ItemLocalId_cmp), c.num_nodes)).toThrow("no entry found for key");
});

test("index_hir: a HirId beyond num_nodes panics (IndexVec bounds check); a Synthetic owner is unreachable", () => {
  const c = fn_inner();
  expect(() => run(c, 2)).toThrow("index out of bounds: the len is 2 but the index is 2");
  expect(() => index_hir(fake_tcx([]), { $: "Synthetic" }, SortedMap.from_presorted_elements([], ItemLocalId_cmp), 1)).toThrow(Panic);
});
