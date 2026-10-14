// Visit-order tests for the ports of compiler/rustc_hir/src/{intravisit,pat_util}.rs (lane hir-visit;
// upstream has no tests for these files). HIR is built by hand; fields a walk never reads are opaque
// stand-ins. Each expected order is derived from the upstream walk fns (line numbers in comments).
import { describe, expect, test } from "bun:test";
import { BindingMode } from "../rustc_ast/lib.ts";
import { ControlFlow, VisitorResult } from "../rustc_ast_ir/visit.ts";
import { HirId, type ItemLocalId, OwnerId } from "../rustc_hir_id/lib.ts";
import { CrateNum, DefId, DefIndex, type LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Ident, type Symbol } from "../rustc_span/symbol.ts";
import { Panic } from "../std/panic.ts";
import { DefKind, Res } from "./def.ts";
import {
  Block,
  type Body,
  type BodyId,
  DotDotPos,
  Expr,
  type ExprKind,
  type FnSig,
  GenericParam,
  Generics,
  Item,
  type ItemId,
  type LetStmt,
  type Mod,
  type Param,
  Pat,
  type PatKind,
  Path,
  PathSegment,
  type QPath,
  type Stmt,
  Ty,
} from "./hir.ts";
import { type FnKind, type HirTyCtxt, IgnoreNested, type NestedFilter, Visitor, walk_expr, walk_pat, walk_ty } from "./intravisit.ts";
import { enumerate_and_adjust } from "./pat_util.ts";

const sp = (n: number) => n as Span;
const sym = (n: number) => n as Symbol;
const OWNER = new OwnerId(1 as LocalDefId);
const hid = (local: number) => new HirId(OWNER, local as ItemLocalId);
/** A field the walks under test never read. */
const opaque = <T>(tag: string): T => ({ opaque: tag }) as unknown as T;
const ident = (s: number) => new Ident(sym(s), sp(0));

function path_qpath(seg_sym: number, seg_local: number): QPath {
  return { $: "Resolved", _0: undefined, _1: new Path(sp(0), Res.Err, [PathSegment.new(ident(seg_sym), hid(seg_local), Res.Err)]) };
}
function path_ty(local: number, seg_sym: number, seg_local: number): Ty {
  return new Ty<null>(hid(local), sp(0), { $: "Path", _0: path_qpath(seg_sym, seg_local) });
}
function binding(local: number, name: number): Pat {
  return new Pat(hid(local), { $: "Binding", _0: BindingMode.NONE, _1: hid(local), _2: ident(name), _3: undefined }, sp(0), true);
}
function expr(local: number, kind: ExprKind): Expr {
  return new Expr(hid(local), kind, sp(0));
}

// `fn f<T>(x: T) -> T { let y = x; y }`, owner def_id 1; the body is HirId(1, 9).
const BODY_ID: BodyId = { hir_id: hid(9) };
const T_PARAM = new GenericParam(hid(1), 2 as LocalDefId, { $: "Plain", _0: ident(11) }, sp(0), false, { $: "Type", default: undefined, synthetic: false }, undefined, "Generics");
const SIG: FnSig = {
  header: opaque("header"),
  decl: opaque("decl"),
  span: sp(0),
};
(SIG as { decl: unknown }).decl = { inputs: [path_ty(2, 11, 3)], output: { $: "Return", _0: path_ty(4, 11, 5) }, fn_decl_kind: opaque("flags") };
const FN_ITEM = new Item(OWNER, { $: "Fn", sig: SIG, ident: ident(10), generics: new Generics([T_PARAM], [], false, sp(0), sp(0)), body: BODY_ID, has_body: true }, sp(0), sp(0), false);
const LET: LetStmt = { super_: undefined, pat: binding(11, 13), ty: undefined, init: expr(12, { $: "Path", _0: path_qpath(12, 13) }), els: undefined, hir_id: hid(14), span: sp(0), source: "Normal" };
const STMT: Stmt = { hir_id: hid(10), kind: { $: "Let", _0: LET }, span: sp(0) };
const BLOCK = new Block([STMT], expr(15, { $: "Path", _0: path_qpath(13, 16) }), hid(17), { $: "DefaultBlock" }, sp(0), false);
const PARAM: Param = { hir_id: hid(6), pat: binding(7, 12), ty_span: sp(0), span: sp(0) };
const BODY: Body = opaque("body");
Object.assign(BODY, { params: [PARAM], value: expr(8, { $: "Block", _0: BLOCK, _1: undefined }) });

const ALL: NestedFilter = { INTER: true, INTRA: true };
const TCX: HirTyCtxt = {
  hir_node: () => opaque("node"),
  hir_body: (id) => {
    expect(id).toBe(BODY_ID);
    return BODY;
  },
  hir_item: () => FN_ITEM,
  hir_trait_item: () => opaque("trait item"),
  hir_impl_item: () => opaque("impl item"),
  hir_foreign_item: () => opaque("foreign item"),
};

/** Records hooks in call order and walks on (`super`). */
class Recorder extends Visitor {
  log: string[] = [];
  override visit_id(id: HirId): undefined {
    this.log.push(`id ${id.local_id}`);
    return undefined;
  }
  override visit_name(name: Symbol): undefined {
    this.log.push(`name ${name}`);
    return undefined;
  }
  override visit_fn(fk: FnKind, fd: Parameters<Visitor["visit_fn"]>[1], b: BodyId, s: Span, id: LocalDefId): undefined {
    this.log.push(`fn ${fk.$}`);
    return super.visit_fn(fk, fd, b, s, id);
  }
  override visit_nested_body(id: BodyId): undefined {
    this.log.push(`nested_body ${id.hir_id.local_id}`);
    return super.visit_nested_body(id);
  }
  override visit_ty(t: Ty<never>): undefined {
    this.log.push(`ty ${t.hir_id.local_id}`);
    return super.visit_ty(t);
  }
  override visit_pat(p: Pat): undefined {
    this.log.push(`pat ${p.hir_id.local_id}`);
    return super.visit_pat(p);
  }
  override visit_expr(e: Expr): undefined {
    this.log.push(`expr ${e.hir_id.local_id}`);
    return super.visit_expr(e);
  }
  override visit_local(l: LetStmt): undefined {
    this.log.push(`local ${l.hir_id.local_id}`);
    return super.visit_local(l);
  }
  override visit_block(b: Block): undefined {
    this.log.push(`block ${b.hir_id.local_id}`);
    return super.visit_block(b);
  }
  override visit_generics(g: Generics): undefined {
    this.log.push("generics");
    return super.visit_generics(g);
  }
  override visit_path_segment(s: PathSegment): undefined {
    this.log.push(`seg ${s.ident.name}`);
    return super.visit_path_segment(s);
  }
}

class Nested extends Recorder {
  override NestedFilter = ALL;
  override maybe_tcx(): HirTyCtxt {
    return TCX;
  }
}

// The order upstream's walks imply for FN_ITEM with a nested-body visitor.
const FN_ORDER = [
  // walk_item (intravisit.rs:550): visit_id(item.hir_id()), then the `ItemKind::Fn` arm (:572)
  "id 0",
  "name 10", // visit_ident(ident) -> walk_ident -> visit_name (:671)
  "fn ItemFn", // visit_fn(FnKind::ItemFn(..)) -> walk_fn (:1248)
  // walk_fn: visit_fn_decl -> walk_fn_decl (:1232): inputs, then visit_fn_ret_ty
  "ty 2", // visit_ty_unambig -> walk_unambig_ty (:1014) -> visit_ty -> walk_ty (:1024)
  "id 2",
  "seg 11", // TyKind::Path -> visit_qpath -> walk_qpath (:1495) -> visit_path -> walk_path -> visit_path_segment
  "name 11", // walk_path_segment (:1518): ident, then id
  "id 3",
  "ty 4", // walk_fn_ret_ty (:1241): FnRetTy::Return
  "id 4",
  "seg 11",
  "name 11",
  "id 5",
  "generics", // walk_fn_kind (:1260): FnKind::ItemFn -> visit_generics -> walk_generics (:1190)
  "id 1", // walk_generic_param (:1149): id, then ParamName::Plain ident; no default
  "name 11",
  "nested_body 9", // walk_fn: visit_nested_body (:281), INTRA -> visit_body -> walk_body (:665)
  "id 6", // walk_param (:544)
  "pat 7", // walk_pat (:759): id, then PatKind::Binding ident
  "id 7",
  "name 12",
  "expr 8", // body.value -> walk_expr (:832): id, ExprKind::Block -> visit_block
  "id 8",
  "block 17", // walk_block (:717): id, stmts, expr
  "id 17",
  "id 10", // walk_stmt (:725): id, StmtKind::Let -> visit_local
  "local 14", // walk_local (:705): init first, then id, pat, els, ty
  "expr 12",
  "id 12",
  "seg 12",
  "name 12",
  "id 13",
  "id 14",
  "pat 11",
  "id 11",
  "name 13",
  "expr 15", // the block's tail expr
  "id 15",
  "seg 13",
  "name 13",
  "id 16",
];

describe("intravisit walk order", () => {
  test("fn item with nested bodies follows walk_item/walk_fn/walk_body", () => {
    const v = new Nested();
    v.visit_item(FN_ITEM);
    expect(v.log).toEqual(FN_ORDER);
  });

  test("IgnoreNested (the default) skips the body (visit_nested_body, intravisit.rs:281)", () => {
    const v = new Recorder();
    expect(v.NestedFilter).toBe(IgnoreNested);
    v.visit_item(FN_ITEM);
    const i = FN_ORDER.indexOf("nested_body 9");
    expect(v.log).toEqual(FN_ORDER.slice(0, i + 1));
  });

  test("visit_nested_item goes through maybe_tcx only with INTER (intravisit.rs:237)", () => {
    const m: Mod = { spans: opaque("spans"), item_ids: [opaque<ItemId>("id")] };
    const shallow = new Recorder();
    shallow.visit_mod(m, sp(0), opaque("mod id"));
    expect(shallow.log).toEqual([]);
    const deep = new Nested();
    deep.visit_mod(m, sp(0), opaque("mod id"));
    expect(deep.log).toEqual(FN_ORDER);
  });

  test("a nested filter without maybe_tcx panics (intravisit.rs:222)", () => {
    class NoTcx extends Recorder {
      override NestedFilter = ALL;
    }
    expect(() => new NoTcx().visit_nested_body(BODY_ID)).toThrow(Panic);
  });

  test("ControlFlow result stops the walk at the first Break", () => {
    class FindPat extends Visitor<ControlFlow<number>> {
      override Result = VisitorResult.ControlFlow<number>();
      override NestedFilter = ALL;
      seen: number[] = [];
      override maybe_tcx(): HirTyCtxt {
        return TCX;
      }
      override visit_id(id: HirId): ControlFlow<number> {
        this.seen.push(id.local_id);
        return ControlFlow.CONTINUE;
      }
      override visit_pat(p: Pat): ControlFlow<number> {
        return ControlFlow.Break(p.hir_id.local_id);
      }
    }
    const v = new FindPat();
    expect(v.visit_item(FN_ITEM)).toEqual(ControlFlow.Break(7));
    // ids up to the param's id; nothing of the body's value is visited
    expect(v.seen).toEqual([0, 2, 3, 4, 5, 1, 6]);
  });

  test("walk_local visits init before the pattern; ExprKind::Let matches (intravisit.rs:705, :885)", () => {
    const v = new Recorder();
    const init = expr(21, { $: "Path", _0: path_qpath(30, 22) });
    v.visit_expr(expr(20, { $: "Let", _0: { span: sp(0), pat: binding(23, 31), ty: path_ty(24, 32, 25), init, recovered: opaque("recovered") } }));
    expect(v.log).toEqual(["expr 20", "id 20", "expr 21", "id 21", "seg 30", "name 30", "id 22", "pat 23", "id 23", "name 31", "ty 24", "id 24", "seg 32", "name 32", "id 25"]);
  });

  test("Assign visits rhs before lhs (intravisit.rs:924)", () => {
    const v = new Recorder();
    v.visit_expr(expr(30, { $: "Assign", _0: expr(31, { $: "Err", _0: opaque("guar") }), _1: expr(32, { $: "Err", _0: opaque("guar") }), _2: sp(0) }));
    expect(v.log).toEqual(["expr 30", "id 30", "expr 32", "id 32", "expr 31", "id 31"]);
  });

  test("an infer type goes to visit_infer, not visit_ty (walk_unambig_ty, intravisit.rs:1014)", () => {
    const v = new Recorder();
    v.visit_ty_unambig(new Ty(hid(40), sp(0), { $: "Infer", _0: null }));
    expect(v.log).toEqual(["id 40"]); // default visit_infer -> visit_id (:376)
    // and walk_ty itself is reachable for ambiguous types
    const w = new Recorder();
    walk_ty(w, path_ty(41, 33, 42) as Ty<never>);
    expect(w.log).toEqual(["id 41", "seg 33", "name 33", "id 42"]);
  });

  test("walk_pat: Slice visits before, slice, after; walk_expr on a Tup", () => {
    const v = new Recorder();
    const kind: PatKind = { $: "Slice", _0: [binding(51, 1)], _1: binding(52, 2), _2: [binding(53, 3)] };
    walk_pat(v, new Pat(hid(50), kind, sp(0), true));
    expect(v.log).toEqual(["id 50", "pat 51", "id 51", "name 1", "pat 52", "id 52", "name 2", "pat 53", "id 53", "name 3"]);
    const w = new Recorder();
    walk_expr(w, expr(60, { $: "Tup", _0: [expr(61, { $: "Err", _0: opaque("g") }), expr(62, { $: "Err", _0: opaque("g") })] }));
    expect(w.log).toEqual(["id 60", "expr 61", "id 61", "expr 62", "id 62"]);
  });
});

describe("pat_util", () => {
  test("enumerate_and_adjust skips the `..` gap (pat_util.rs:21, :43)", () => {
    expect([...enumerate_and_adjust(["a", "b", "c"], 5, DotDotPos.new(1))]).toEqual([
      [0, "a"],
      [3, "b"],
      [4, "c"],
    ]);
    // no `..`: gap_pos = expected_len
    const it = enumerate_and_adjust(["a", "b"], 2, DotDotPos.new(undefined));
    expect(it.size_hint()).toEqual([2, 2]);
    expect([...it]).toEqual([
      [0, "a"],
      [1, "b"],
    ]);
  });

  test("each_binding visits bindings in walk order; simple_ident", () => {
    const tuple = new Pat(hid(70), { $: "Tuple", _0: [binding(71, 1), binding(72, 2)], _1: DotDotPos.new(undefined) }, sp(0), true);
    const names: number[] = [];
    tuple.each_binding((_bm, id, _sp, ident) => names.push(id.local_id, ident.name));
    expect(names).toEqual([71, 1, 72, 2]);
    expect(binding(73, 5).simple_ident()?.name).toBe(sym(5));
    expect(tuple.simple_ident()).toBeUndefined();
    expect(tuple.contains_explicit_ref_binding()).toBeUndefined();
    const by_ref = new Pat(hid(74), { $: "Binding", _0: BindingMode.REF_MUT, _1: hid(74), _2: ident(6), _3: undefined }, sp(0), true);
    expect(by_ref.contains_explicit_ref_binding()).toBe("Mut");
  });

  test("necessary_variants dedups in first-seen order and stops at or-patterns (pat_util.rs:104)", () => {
    const v1 = new DefId(DefIndex.from_u32(7), CrateNum.from_u32(0));
    const v2 = new DefId(DefIndex.from_u32(8), CrateNum.from_u32(0));
    const variant = (local: number, id: DefId): Pat =>
      new Pat(hid(local), { $: "TupleStruct", _0: { $: "Resolved", _0: undefined, _1: new Path(sp(0), { $: "Def", _0: DefKind.Variant, _1: id }, []) }, _1: [], _2: DotDotPos.new(undefined) }, sp(0), true);
    const or = new Pat(hid(80), { $: "Or", _0: [variant(81, v1)] }, sp(0), true);
    const tuple = new Pat(hid(82), { $: "Tuple", _0: [variant(83, v2), variant(84, v1), variant(85, v2), or], _1: DotDotPos.new(undefined) }, sp(0), true);
    expect(tuple.necessary_variants()).toEqual([v2, v1]);
  });
});
