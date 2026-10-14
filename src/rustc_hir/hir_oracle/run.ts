// Test helper of src/rustc_hir/hir.oracle.test.ts (lane hir-types): runs the ported driver on a case of this
// directory up to expansion + name resolution (the resdump setup: `after_expansion` -> `Stop`), builds the case's HIR
// by hand from the expanded AST and the resolver's `LocalDefId`s (what lowering will produce for it, transcribed from
// the oracle's `-Zunpretty=hir-tree`), and prints what rustc_driver_impl/src/pretty.rs:298 prints for HirTree:
// `"{owner:#?} => {hir_owner_nodes(owner):#?}\n"` per owner.
//
// `opt_hash` is computed as `TyCtxt::hash_owner_nodes` (rustc_middle/src/hir/mod.rs:175) computes the bodies hash:
// `node.stable_hash(..)` then `bodies.stable_hash(..)` in `tcx.with_stable_hashing_context`, so the printed
// `Fingerprint` checks the generated derive(StableHash) of everything the case contains against the oracle.
//
//   bun src/rustc_hir/hir_oracle/run.ts <case> <rustc arguments...>
import type {
  Crate,
  Expr as AstExpr,
  FieldDef as AstFieldDef,
  GenericParam as AstGenericParam,
  Item as AstItem,
  LitKind,
  Ty as AstTy,
} from "../../rustc_ast/lib.ts";
import { clone_BindingMode, clone_MacroDef } from "../../rustc_ast/lib.ts";
import type { NodeId } from "../../rustc_ast/node_id.ts";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { SortedMap, stable_hash_SortedMap } from "../../rustc_data_structures/sorted_map.ts";
import { StableHasher } from "../../rustc_data_structures/stable_hash.ts";
import { HirId, ItemLocalId, OwnerId, debug_OwnerId } from "../../rustc_hir_id/lib.ts";
import { stable_hash_ItemLocalId } from "../../rustc_hir_id/stable_hash.gen.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { type Debug, format_debug, PRETTY } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import {
  Block,
  Body,
  debug_OwnerNodes,
  Expr,
  FnDecl,
  FnDeclFlags,
  FieldDef,
  FnHeader,
  GenericParam,
  Generics,
  Item,
  ItemId,
  ItemLocalId_cmp,
  Lifetime,
  type MutRestriction,
  type Node,
  type OwnerNode,
  OwnerNodes,
  type ParentedNode,
  Pat,
  Path,
  PathSegment,
  Ty,
} from "../hir.ts";
import { MacroKinds, type Res } from "../def.ts";
import { stable_hash_Body, stable_hash_OwnerNode } from "../stable_hash.gen.ts";

interface Owner {
  owner: OwnerId;
  /// `nodes[0]` is the owner node; the rest in `ItemLocalId` order
  nodes: ParentedNode[];
  bodies: [ItemLocalId, Body][];
}

const lid = (n: number): ItemLocalId => ItemLocalId.from_u32(n);

/** `LocalDefId` of an AST node, from the resolver's owners (an owner's `def_id`, else `node_id_to_def_id`). */
function def_id_of(tcx: TyCtxt, id: NodeId): LocalDefId {
  const [resolver] = tcx.resolver_for_lowering();
  const r = resolver.borrow();
  const owner = r.owners.get(id);
  if (owner !== undefined) return owner.def_id;
  for (const o of r.owners.values()) {
    const d = o.node_id_to_def_id.get(id);
    if (d !== undefined) return d;
  }
  return panic(`no LocalDefId for ${String(id)}`);
}

// ---- cases ------------------------------------------------------------------------------------------------------

/**
 * `fn_item.rs`: `pub fn f(x: u8) -> u8 { x }` in a `#![no_core]` lib crate (owners: the crate root, `f`).
 * The node numbering and parents are the oracle's (lowering order).
 */
function fn_item(tcx: TyCtxt, krate: Crate): Owner[] {
  const root_def = def_id_of(tcx, krate.id);
  const ast_f = krate.items[0]! as AstItem;
  if (ast_f.kind.$ !== "Fn") return panic("fn_item: expected `fn f`");
  const fn_ = ast_f.kind._0;
  const f_def = def_id_of(tcx, ast_f.id);
  const f_owner = new OwnerId(f_def);
  const hid = (n: number): HirId => new HirId(f_owner, lid(n));

  // crate root: `Crate(Mod { spans, item_ids: [ItemId { owner_id: f }] })`
  const root_mod = { spans: { inner_span: krate.spans.inner_span, inject_use_span: krate.spans.inject_use_span }, item_ids: [new ItemId(f_owner)] };
  const root: Owner = {
    owner: new OwnerId(root_def),
    nodes: [{ parent: ItemLocalId.INVALID, node: { $: "Crate", _0: root_mod } }],
    bodies: [],
  };

  const decl = fn_.sig.decl;
  const param = decl.inputs[0]!;
  if (param.pat.kind.$ !== "Ident" || param.ty.kind.$ !== "Path") return panic("fn_item: expected `x: u8`");
  const ast_in_path = param.ty.kind._1;
  if (decl.output.$ !== "Ty" || decl.output._0.kind.$ !== "Path") return panic("fn_item: expected `-> u8`");
  const ast_out_ty = decl.output._0;
  const ast_out_path = decl.output._0.kind._1;
  const ast_block = fn_.body!;
  const ast_stmt = ast_block.stmts[0]!;
  if (ast_stmt.kind.$ !== "Expr" || ast_stmt.kind._0.kind.$ !== "Path") return panic("fn_item: expected `{ x }`");
  const ast_x = ast_stmt.kind._0;
  const ast_x_path = ast_stmt.kind._0.kind._1;

  const u8_res: Res = { $: "PrimTy", _0: { $: "Uint", _0: "U8" } };
  const u8_ty = (ty_id: number, seg_id: number, span: typeof ast_in_path.span, seg: (typeof ast_in_path.segments)[number]): Ty =>
    new Ty<null>(hid(ty_id), span, {
      $: "Path",
      _0: { $: "Resolved", _0: undefined, _1: new Path(span, u8_res, [new PathSegment(seg.ident, hid(seg_id), u8_res, undefined, false, false)]) },
    });
  const in_ty = u8_ty(7, 8, param.ty.span, ast_in_path.segments[0]!);
  const out_ty = u8_ty(9, 10, ast_out_ty.span, ast_out_path.segments[0]!);

  const pat = new Pat(hid(2), { $: "Binding", _0: clone_BindingMode(param.pat.kind._0), _1: hid(2), _2: param.pat.kind._1, _3: undefined }, param.pat.span, true);
  const hir_param = { hir_id: hid(1), pat, ty_span: param.ty.span, span: param.span };
  const x_res: Res = { $: "Local", _0: hid(2) };
  const x_expr = new Expr(
    hid(4),
    {
      $: "Path",
      _0: { $: "Resolved", _0: undefined, _1: new Path(ast_x_path.span, x_res, [new PathSegment(ast_x_path.segments[0]!.ident, hid(5), x_res, undefined, true, false)]) },
    },
    ast_x.span,
  );
  const block = new Block([], x_expr, hid(3), { $: "DefaultBlock" }, ast_block.span, false);
  const body_expr = new Expr(hid(6), { $: "Block", _0: block, _1: undefined }, ast_block.span);
  const body = new Body([hir_param], body_expr);

  const generics = new Generics([], [], false, fn_.generics.where_clause.span, fn_.generics.span);
  const hir_decl = new FnDecl([in_ty], { $: "Return", _0: out_ty }, FnDeclFlags.default_().set_lifetime_elision_allowed(false));
  const header = new FnHeader({ $: "Normal", _0: "Safe" }, { $: "NotConst" }, { $: "NotAsync" }, { $: "Rust" });
  const item = new Item(
    f_owner,
    { $: "Fn", sig: { header, decl: hir_decl, span: fn_.sig.span }, ident: fn_.ident, generics, body: { hir_id: hid(6) }, has_body: true },
    ast_f.span,
    ast_f.vis.span,
    false,
  );

  const n = (parent: number, node: Node): ParentedNode => ({ parent: lid(parent), node });
  const f: Owner = {
    owner: f_owner,
    nodes: [
      { parent: ItemLocalId.INVALID, node: { $: "Item", _0: item } },
      n(0, { $: "Param", _0: hir_param }),
      n(1, { $: "Pat", _0: pat }),
      n(6, { $: "Block", _0: block }),
      n(3, { $: "Expr", _0: x_expr }),
      n(4, { $: "PathSegment", _0: (x_expr.kind as { _0: { _1: Path } })._0._1.segments[0]! }),
      n(0, { $: "Expr", _0: body_expr }),
      n(0, { $: "Ty", _0: in_ty }),
      n(7, { $: "PathSegment", _0: (in_ty.kind as { _0: { _1: Path } })._0._1.segments[0]! }),
      n(0, { $: "Ty", _0: out_ty }),
      n(9, { $: "PathSegment", _0: (out_ty.kind as { _0: { _1: Path } })._0._1.segments[0]! }),
    ],
    bodies: [[lid(6), body]],
  };
  return [root, f];
}

/**
 * `items.rs`: a generic struct (lifetime and type params, a `&'a T` and a tuple field), a `macro_rules!` (the
 * `ast::MacroDef` token stream is hashed) and an `extern "C" fn` with literals and a binary operator.
 */
function items(tcx: TyCtxt, krate: Crate): Owner[] {
  const root_def = def_id_of(tcx, krate.id);
  const [ast_s, ast_m, ast_g] = krate.items as [AstItem, AstItem, AstItem];
  if (ast_s.kind.$ !== "Struct" || ast_m.kind.$ !== "MacroDef" || ast_g.kind.$ !== "Fn") return panic("items: unexpected items");
  const s_owner = new OwnerId(def_id_of(tcx, ast_s.id));
  const m_owner = new OwnerId(def_id_of(tcx, ast_m.id));
  const g_owner = new OwnerId(def_id_of(tcx, ast_g.id));

  const root: Owner = {
    owner: new OwnerId(root_def),
    nodes: [
      {
        parent: ItemLocalId.INVALID,
        node: {
          $: "Crate",
          _0: {
            spans: { inner_span: krate.spans.inner_span, inject_use_span: krate.spans.inject_use_span },
            item_ids: [new ItemId(s_owner), new ItemId(m_owner), new ItemId(g_owner)],
          },
        },
      },
    ],
    bodies: [],
  };

  // ---- `pub struct S<'a, T> { pub a: &'a T, b: (u8, i32) }`
  const [s_ident, s_generics, s_data] = [ast_s.kind._0, ast_s.kind._1, ast_s.kind._2];
  if (s_data.$ !== "Struct") return panic("items: expected a braced struct");
  const sh = (n: number): HirId => new HirId(s_owner, lid(n));
  const [ast_lt, ast_t] = s_generics.params as [AstGenericParam, AstGenericParam];
  const lt_def = def_id_of(tcx, ast_lt.id);
  const t_def = def_id_of(tcx, ast_t.id);
  const p_lt = new GenericParam(sh(1), lt_def, { $: "Plain", _0: ast_lt.ident }, ast_lt.ident.span, false, { $: "Lifetime", kind: { $: "Explicit" } }, undefined, "Generics");
  const p_t = new GenericParam(sh(2), t_def, { $: "Plain", _0: ast_t.ident }, ast_t.ident.span, false, { $: "Type", default: undefined, synthetic: false }, undefined, "Generics");
  const generics_s = new Generics([p_lt, p_t], [], false, s_generics.where_clause.span, s_generics.span);

  const [ast_fa, ast_fb] = s_data.fields as [AstFieldDef, AstFieldDef];
  if (ast_fa.ty.kind.$ !== "Ref" || ast_fb.ty.kind.$ !== "Tup") return panic("items: unexpected field types");
  const ast_ref_lt = ast_fa.ty.kind._0!;
  const ast_ref_inner = ast_fa.ty.kind._1;
  if (ast_ref_inner.kind.$ !== "Path") return panic("items: expected `T`");
  const t_res: Res = { $: "Def", _0: { $: "TyParam" }, _1: LocalDefId.to_def_id(t_def) };
  const t_seg = new PathSegment(ast_ref_inner.kind._1.segments[0]!.ident, sh(5), t_res, undefined, false, false);
  const ty_t = new Ty<null>(sh(4), ast_ref_inner.span, { $: "Path", _0: { $: "Resolved", _0: undefined, _1: new Path(ast_ref_inner.kind._1.span, t_res, [t_seg]) } });
  const lifetime = new Lifetime(sh(3), ast_ref_lt.ident, { $: "Param", _0: lt_def }, { $: "Reference" }, "ExplicitBound");
  const ty_ref = new Ty<null>(sh(6), ast_fa.ty.span, { $: "Ref", _0: lifetime, _1: ty_t, _2: "Not" });
  const unrestricted = (): MutRestriction => ({ kind: { $: "Unrestricted" }, span: DUMMY_SP });
  const field_a = new FieldDef(ast_fa.span, ast_fa.vis.span, unrestricted(), ast_fa.ident!, sh(7), def_id_of(tcx, ast_fa.id), ty_ref, "Safe", undefined);
  const [ast_u8, ast_i32] = ast_fb.ty.kind._0 as [AstTy, AstTy];
  const prim = (ty_id: number, seg_id: number, ast: AstTy, res: Res): [Ty, PathSegment] => {
    if (ast.kind.$ !== "Path") return panic("items: expected a primitive type path");
    const seg = new PathSegment(ast.kind._1.segments[0]!.ident, sh(seg_id), res, undefined, false, false);
    return [new Ty<null>(sh(ty_id), ast.span, { $: "Path", _0: { $: "Resolved", _0: undefined, _1: new Path(ast.kind._1.span, res, [seg]) } }), seg];
  };
  const [ty_u8, seg_u8] = prim(8, 9, ast_u8, { $: "PrimTy", _0: { $: "Uint", _0: "U8" } });
  const [ty_i32, seg_i32] = prim(10, 11, ast_i32, { $: "PrimTy", _0: { $: "Int", _0: "I32" } });
  const ty_tup = new Ty<null>(sh(12), ast_fb.ty.span, { $: "Tup", _0: [ty_u8, ty_i32] });
  const field_b = new FieldDef(ast_fb.span, ast_fb.vis.span, unrestricted(), ast_fb.ident!, sh(13), def_id_of(tcx, ast_fb.id), ty_tup, "Safe", undefined);
  const item_s = new Item(
    s_owner,
    { $: "Struct", _0: s_ident, _1: generics_s, _2: { $: "Struct", fields: [field_a, field_b], recovered: { $: "No" } } },
    ast_s.span,
    ast_s.vis.span,
    false,
  );
  const sn = (parent: number, node: Node): ParentedNode => ({ parent: lid(parent), node });
  const s: Owner = {
    owner: s_owner,
    nodes: [
      { parent: ItemLocalId.INVALID, node: { $: "Item", _0: item_s } },
      sn(0, { $: "GenericParam", _0: p_lt }),
      sn(0, { $: "GenericParam", _0: p_t }),
      sn(6, { $: "Lifetime", _0: lifetime }),
      sn(6, { $: "Ty", _0: ty_t }),
      sn(4, { $: "PathSegment", _0: t_seg }),
      sn(7, { $: "Ty", _0: ty_ref }),
      sn(0, { $: "Field", _0: field_a }),
      sn(12, { $: "Ty", _0: ty_u8 }),
      sn(8, { $: "PathSegment", _0: seg_u8 }),
      sn(12, { $: "Ty", _0: ty_i32 }),
      sn(10, { $: "PathSegment", _0: seg_i32 }),
      sn(13, { $: "Ty", _0: ty_tup }),
      sn(0, { $: "Field", _0: field_b }),
    ],
    bodies: [],
  };

  // ---- `macro_rules! m { ($x:expr) => { $x }; }`
  const item_m = new Item(m_owner, { $: "Macro", _0: ast_m.kind._0, _1: clone_MacroDef(ast_m.kind._1), _2: MacroKinds.BANG }, ast_m.span, ast_m.vis.span, false);
  const m: Owner = { owner: m_owner, nodes: [{ parent: ItemLocalId.INVALID, node: { $: "Item", _0: item_m } }], bodies: [] };

  // ---- `pub extern "C" fn g() -> u32 { 1 + 2u32 }`
  const fn_g = ast_g.kind._0;
  const gh = (n: number): HirId => new HirId(g_owner, lid(n));
  const g_out = fn_g.sig.decl.output;
  if (g_out.$ !== "Ty" || g_out._0.kind.$ !== "Path") return panic("items: expected `-> u32`");
  const u32_res: Res = { $: "PrimTy", _0: { $: "Uint", _0: "U32" } };
  const seg_u32 = new PathSegment(g_out._0.kind._1.segments[0]!.ident, gh(7), u32_res, undefined, false, false);
  const ty_u32 = new Ty<null>(gh(6), g_out._0.span, { $: "Path", _0: { $: "Resolved", _0: undefined, _1: new Path(g_out._0.kind._1.span, u32_res, [seg_u32]) } });
  const ast_body = fn_g.body!;
  const ast_bin = ast_body.stmts[0]!;
  if (ast_bin.kind.$ !== "Expr" || ast_bin.kind._0.kind.$ !== "Binary") return panic("items: expected `1 + 2u32`");
  const bin = ast_bin.kind._0.kind;
  const lit = (id: number, e: AstExpr, node: LitKind): Expr => new Expr(gh(id), { $: "Lit", _0: { node, span: e.span } }, e.span);
  const lhs = lit(3, bin._1, { $: "Int", _0: 1n, _1: { $: "Unsuffixed" } });
  const rhs = lit(4, bin._2, { $: "Int", _0: 2n, _1: { $: "Unsigned", _0: "U32" } });
  const add = new Expr(gh(2), { $: "Binary", _0: { node: bin._0.node, span: bin._0.span }, _1: lhs, _2: rhs }, ast_bin.kind._0.span);
  const g_block = new Block([], add, gh(1), { $: "DefaultBlock" }, ast_body.span, false);
  const g_value = new Expr(gh(5), { $: "Block", _0: g_block, _1: undefined }, ast_body.span);
  const g_body = new Body([], g_value);
  const header = new FnHeader({ $: "Normal", _0: "Safe" }, { $: "NotConst" }, { $: "NotAsync" }, { $: "C", unwind: false });
  const decl = new FnDecl([], { $: "Return", _0: ty_u32 }, FnDeclFlags.default_().set_lifetime_elision_allowed(false));
  const generics_g = new Generics([], [], false, fn_g.generics.where_clause.span, fn_g.generics.span);
  const item_g = new Item(
    g_owner,
    { $: "Fn", sig: { header, decl, span: fn_g.sig.span }, ident: fn_g.ident, generics: generics_g, body: { hir_id: gh(5) }, has_body: true },
    ast_g.span,
    ast_g.vis.span,
    false,
  );
  const gn = (parent: number, node: Node): ParentedNode => ({ parent: lid(parent), node });
  const g: Owner = {
    owner: g_owner,
    nodes: [
      { parent: ItemLocalId.INVALID, node: { $: "Item", _0: item_g } },
      gn(5, { $: "Block", _0: g_block }),
      gn(1, { $: "Expr", _0: add }),
      gn(2, { $: "Expr", _0: lhs }),
      gn(2, { $: "Expr", _0: rhs }),
      gn(0, { $: "Expr", _0: g_value }),
      gn(0, { $: "Ty", _0: ty_u32 }),
      gn(6, { $: "PathSegment", _0: seg_u32 }),
    ],
    bodies: [[lid(5), g_body]],
  };
  return [root, s, m, g];
}

const CASES: Record<string, (tcx: TyCtxt, krate: Crate) => Owner[]> = { fn_item, items };

// ---- printing ---------------------------------------------------------------------------------------------------

/** `TyCtxt::hash_owner_nodes`'s first hash (`h1`): the owner node, then the bodies. */
function bodies_hash(tcx: TyCtxt, node: OwnerNode, bodies: SortedMap<ItemLocalId, Body>): Fingerprint {
  return tcx.with_stable_hashing_context((hcx) => {
    const stable_hasher = StableHasher.new();
    stable_hash_OwnerNode(node, hcx, stable_hasher);
    // Bodies are stored out of line, so we need to pull them explicitly in the hash.
    stable_hash_SortedMap(bodies, hcx, stable_hasher, stable_hash_ItemLocalId, stable_hash_Body);
    return stable_hasher.finish(Fingerprint);
  });
}

function dump(case_: string, tcx: TyCtxt): string {
  const [, krate_steal] = tcx.resolver_for_lowering();
  const krate = (krate_steal as unknown as { borrow(): Crate }).borrow();
  const owners = CASES[case_]!(tcx, krate);
  let out = "";
  for (const o of owners) {
    const bodies = SortedMap.from_presorted_elements(o.bodies, ItemLocalId_cmp);
    const nodes = new OwnerNodes(undefined, o.nodes, bodies);
    nodes.opt_hash = bodies_hash(tcx, nodes.node(), bodies);
    out += `${format_debug(o.owner, debug_OwnerId as Debug<OwnerId>, PRETTY)} => ${format_debug(nodes, debug_OwnerNodes, PRETTY)}\n`;
  }
  return out;
}

async function main(args: string[]): Promise<number> {
  const [case_, ...rustc_args] = args;
  if (case_ === undefined || CASES[case_] === undefined) {
    console.error(`ERROR: unknown case ${case_}`);
    return 2;
  }
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType, std_print } = await import("../../rustc_session/config.ts");
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  void early_dcx;
  const callbacks = {
    // As rustc's `TimePassesCallbacks::config` (rustc_driver_impl/src/lib.rs), minus time-passes (as resdump.ts).
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      std_print(dump(case_, tcx));
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...rustc_args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
