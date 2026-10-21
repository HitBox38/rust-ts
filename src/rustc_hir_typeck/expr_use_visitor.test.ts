// Unit tests for expr_use_visitor.ts (lane typeck-euv; not an upstream test file).
// The `TypeInformationCtxt` is a stand-in impl over fake typeck results / types (only the members the walked code
// reads), so the test exercises the walk itself: `let (a, b) = t;` reports a fake read of `t`, then per binding a
// `bind` and a copy (Copy field) or consume (non-Copy field) of `t.i`, in upstream order.
import { expect, test } from "bun:test";
import { BindingMode } from "../rustc_ast/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { CRATE_OWNER_ID, HirId, ItemLocalId } from "../rustc_hir_id/lib.ts";
import { debug_ProjectionKind, type PlaceWithHirId } from "../rustc_middle/hir/place.ts";
import type { BorrowKind } from "../rustc_middle/ty/closure.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import type { FakeReadCause, TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import type { Ident } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { Ok } from "../std/result.ts";
import "./lib.ts";
import { type Delegate, TypeInformationCtxt, type TypeInformationCtxtImpl } from "./decls.ts";
import { Delegate_provided, ExprPlaceDelegate, ExprUseVisitor } from "./expr_use_visitor.ts";

const hid = (n: number): HirId => new HirId(CRATE_OWNER_ID, ItemLocalId.from_u32(n));
const fake_ty = (name: string, kind: object = { $: "Bool" }): Ty => ({ name, kind: () => kind }) as unknown as Ty;
const U32 = fake_ty("u32");
const STRING = fake_ty("String");
const TUP = fake_ty("(u32, String)", { $: "Tuple", _0: [U32, STRING] });

/** Node types by `ItemLocalId`: 10 the expr `t`, 20 the tuple pattern, 21 / 22 the bindings `a` / `b`. */
const node_types = new Map<number, Ty>([
  [10, TUP],
  [20, TUP],
  [21, U32],
  [22, STRING],
]);

const typeck_results = {
  expr_adjustments: () => [],
  is_method_call: () => false,
  node_type_opt: (id: HirId) => node_types.get(id.local_id as number),
  node_type: (id: HirId) => node_types.get(id.local_id as number)!,
  expr_ty_opt: (e: hir.Expr) => node_types.get(e.hir_id.local_id as number),
  qpath_res: (qpath: hir.QPath) => (qpath.$ === "Resolved" ? qpath._1.res : { $: "Err" }),
  pat_adjustments: () => ({ get: () => undefined }),
  skipped_ref_pats: () => ({ contains: () => false }),
  extract_binding_mode: () => BindingMode.NONE,
  pat_binding_modes: () => ({ get: () => BindingMode.NONE }),
} as unknown as TypeckResults;

const fake_tcx = { next_trait_solver_globally: () => true, sess: undefined } as unknown as TyCtxt;

/** A `TypeInformationCtxt` impl over the fakes (u32 is Copy, String is not). */
const FakeCx: TypeInformationCtxtImpl<null> = {
  typeck_results: () => typeck_results,
  deeply_resolve_ignoring_regions: <T>(t: T) => t,
  structurally_resolve_type: (_span, ty) => ty,
  report_bug: () => {
    throw new Error("report_bug");
  },
  error_reported_in_ty: () => Ok(undefined),
  tainted_by_errors: () => Ok(undefined),
  type_is_copy_modulo_regions: (ty) => ty === U32,
  type_is_use_cloned_modulo_regions: () => false,
  body_owner_def_id: () => 0 as LocalDefId,
  tcx: () => fake_tcx,
};

function show(p: PlaceWithHirId): string {
  const base = p.place.base;
  const b = base.$ === "Local" ? `Local(${base._0.local_id})` : base.$;
  return `${b}[${p.place.projections.map((x) => debug_ProjectionKind(x.kind, PLAIN)).join(",")}]@${p.hir_id.local_id}`;
}

class Recorder implements Delegate {
  log: string[] = [];
  consume(p: PlaceWithHirId, d: HirId): void {
    this.log.push(`consume ${show(p)} diag=${d.local_id}`);
  }
  use_cloned(p: PlaceWithHirId, d: HirId): void {
    this.log.push(`use_cloned ${show(p)} diag=${d.local_id}`);
  }
  borrow(p: PlaceWithHirId, d: HirId, bk: BorrowKind): void {
    this.log.push(`borrow ${show(p)} diag=${d.local_id} ${bk}`);
  }
  copy(p: PlaceWithHirId, d: HirId): void {
    this.log.push(`copy ${show(p)} diag=${d.local_id}`);
  }
  mutate(p: PlaceWithHirId, d: HirId): void {
    this.log.push(`mutate ${show(p)} diag=${d.local_id}`);
  }
  bind(p: PlaceWithHirId, d: HirId): void {
    this.log.push(`bind ${show(p)} diag=${d.local_id}`);
  }
  fake_read(p: PlaceWithHirId, cause: FakeReadCause, d: HirId): void {
    this.log.push(`fake_read ${show(p)} ${cause.$} diag=${d.local_id}`);
  }
}

const ident = {} as Ident;
const binding = (n: number): hir.Pat => new hir.Pat(hid(n), { $: "Binding", _0: BindingMode.NONE, _1: hid(n), _2: ident, _3: undefined }, DUMMY_SP, true);

test("walk_local: `let (a, b) = t;` (t: (u32, String))", () => {
  const t = new hir.Expr(hid(10), { $: "Path", _0: { $: "Resolved", _0: undefined, _1: new hir.Path(DUMMY_SP, { $: "Local", _0: hid(1) }, []) } }, DUMMY_SP);
  const pat = new hir.Pat(hid(20), { $: "Tuple", _0: [binding(21), binding(22)], _1: hir.DotDotPos.new(undefined) }, DUMMY_SP, true);
  const d = new Recorder();
  const euv = new ExprUseVisitor(TypeInformationCtxt.of(null, FakeCx), d as Delegate, undefined);
  const r = euv.walk_local(t, pat, undefined);
  expect(r.$).toBe("Ok");
  expect(d.log).toEqual([
    "fake_read Local(1)[]@10 ForLet diag=10",
    "bind Local(21)[]@21 diag=21",
    "copy Local(1)[Field(0, 0)]@20 diag=10",
    "bind Local(22)[]@22 diag=22",
    "consume Local(1)[Field(1, 0)]@20 diag=10",
  ]);
});

test("Delegate_provided: copy is an immutable borrow, bind is a mutate; ExprPlaceDelegate is silent", () => {
  const d = new Recorder();
  const t = new hir.Expr(hid(10), { $: "Path", _0: { $: "Resolved", _0: undefined, _1: new hir.Path(DUMMY_SP, { $: "Local", _0: hid(1) }, []) } }, DUMMY_SP);
  const euv = new ExprUseVisitor(TypeInformationCtxt.of(null, FakeCx), d as Delegate, undefined);
  const place = euv.cat_expr(t);
  if (place.$ !== "Ok") throw new Error("cat_expr");
  Delegate_provided.copy(d, place._0, hid(5));
  Delegate_provided.bind(d, place._0, hid(6));
  expect(d.log).toEqual(["borrow Local(1)[]@10 diag=5 Immutable", "mutate Local(1)[]@10 diag=6"]);
  const silent = new ExprPlaceDelegate();
  expect(() => silent.copy(place._0, hid(5))).not.toThrow();
});
