// Unit tests of lane lower-lib-a (rustc_ast_lowering lib.rs:1..1756): the parts that need no `TyCtxt`. Expected
// values are read off the upstream fns (lib.rs line in each test name); lib.oracle.test.ts checks the rest against
// the oracle.
import { expect, test } from "bun:test";
import { DUMMY_NODE_ID, NodeId } from "../rustc_ast/lib.ts";
import { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import type { Res } from "../rustc_hir/def.ts";
import { ItemLocalId } from "../rustc_hir_id/lib.ts";
import { PerParentDisambiguatorState } from "../rustc_hir_id/definitions.ts";
import { PartialRes, PerOwnerResolverData, type ResolverAstLowering } from "../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { DefId, DefIdMap, LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { Panic } from "../std/panic.ts";
import {
  display_ImplTraitPosition,
  HIR_ARENA,
  ImplTraitPosition,
  LoweringContext,
  PerOwnerLoweringState,
  RelaxedBoundPolicy,
  SpanLowerer,
  TryBlockScope,
} from "./lib.ts";
import { SortedMap } from "../rustc_data_structures/sorted_map.ts";
import { ItemLocalId_cmp } from "../rustc_hir/lib.ts";

const nid = (n: number): NodeId => NodeId.from_u32(n);
const ldid = (n: number): LocalDefId => LocalDefId.new(n);

/** A `LoweringContext` for owner `NodeId(10)` / `DefId(0:3)`, with `next_node_id` 100 and no `TyCtxt`. */
function lctx(): LoweringContext {
  const owner = PerOwnerResolverData.new(nid(10), ldid(3));
  owner.node_id_to_def_id.set(nid(11), ldid(4));
  owner.trait_map.set(nid(12), ["trait candidates of 12"]);
  const resolver: ResolverAstLowering = {
    partial_res_map: new Map([[nid(20), PartialRes.new({ $: "Def", _0: { $: "Struct" }, _1: new DefId(LocalDefId.local_def_index(ldid(7)), 0 as never) })]]),
    next_node_id: nid(100),
    owners: new Map([[nid(10), owner]]),
    lint_buffer: undefined as never,
    disambiguators: new Map(),
  };
  const curr_owner = new PerOwnerLoweringState(
    owner,
    PerParentDisambiguatorState.new(ldid(3)),
    ItemLocalId.new(1),
    new Map(),
    SortedMap.default(ItemLocalId_cmp),
    [],
    undefined,
    new Map(),
    [],
    new Map(),
    [],
    [],
  );
  return new LoweringContext(
    undefined as unknown as TyCtxt,
    resolver,
    curr_owner,
    HIR_ARENA,
    undefined,
    undefined,
    undefined,
    undefined,
    TryBlockScope.Function,
    undefined,
    false,
    false,
    resolver.next_node_id,
    new Map(),
    new Map(),
    [],
    false,
    undefined as unknown as AttributeParser,
  );
}

function panic_message(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof Panic) return e.message;
    throw e;
  }
  throw new Error("no panic");
}

test("lib.rs:535 Display for ImplTraitPosition", () => {
  const all = Object.values(ImplTraitPosition).map(display_ImplTraitPosition);
  expect(all).toEqual([
    "paths",
    "the type of variable bindings",
    "traits",
    "bounds",
    "generics",
    "`extern fn` parameters",
    "closure parameters",
    "`fn` pointer parameters",
    "the parameters of `Fn` trait bounds",
    "`extern fn` return types",
    "closure return types",
    "`fn` pointer return types",
    "the return type of `Fn` trait bounds",
    "generic parameter defaults",
    "const types",
    "static types",
    "associated types",
    "field types",
    "cast expression types",
    "impl headers",
    "`offset_of!` parameters",
  ]);
});

test("lib.rs:457 RelaxedBoundPolicy::reborrow shares the map", () => {
  const m = new DefIdMap<Span>();
  const a: RelaxedBoundPolicy = { $: "Allowed", _0: m };
  const b = RelaxedBoundPolicy.reborrow(a);
  expect(b.$).toBe("Allowed");
  expect(b.$ === "Allowed" && b._0 === m).toBe(true);
  expect(RelaxedBoundPolicy.reborrow({ $: "Forbidden", _0: "WhereBound" })).toEqual({ $: "Forbidden", _0: "WhereBound" });
});

test("lib.rs:402 SpanLowerer::lower keeps the span without incremental", () => {
  expect(new SpanLowerer(false, ldid(3)).lower(DUMMY_SP)).toBe(DUMMY_SP);
});

test("lib.rs:849 next_node_id counts up from the resolver's next_node_id", () => {
  const cx = lctx();
  expect(cx.next_node_id()).toBe(nid(100));
  expect(cx.next_node_id()).toBe(nid(101));
  expect(cx.next_node_id_).toBe(nid(102));
  // `NodeId::from_u32` rejects ids above `0xFFFF_FF00`
  cx.next_node_id_ = NodeId.MAX;
  expect(panic_message(() => cx.next_node_id())).toBe("assertion failed: value <= 0xFFFF_FF00");
});

test("lib.rs:899 lower_node_id / lib.rs:925 next_id allocate ItemLocalIds of the current owner", () => {
  const cx = lctx();
  expect(panic_message(() => cx.lower_node_id(DUMMY_NODE_ID))).toBe(
    "assertion `left != right` failed\n  left: NodeId(4294967040)\n right: NodeId(4294967040)",
  );
  const a = cx.lower_node_id(nid(11)); // has a `LocalDefId`: recorded as a non-owner child
  const b = cx.next_id();
  const c = cx.lower_node_id(nid(12)); // has trait candidates: copied to the owner's trait map
  expect([a, b, c].map((h) => [h.owner.def_id, h.local_id])).toEqual([
    [ldid(3), ItemLocalId.new(1)],
    [ldid(3), ItemLocalId.new(2)],
    [ldid(3), ItemLocalId.new(3)],
  ]);
  expect(cx.curr_owner.item_local_id_counter).toBe(ItemLocalId.new(4));
  expect([...cx.curr_owner.children]).toEqual([[ldid(4), { $: "NonOwner", _0: a }]]);
  expect([...cx.curr_owner.trait_map]).toEqual([[ItemLocalId.new(3), ["trait candidates of 12"] as never]]);
  cx.curr_owner.item_local_id_counter = ItemLocalId.ZERO;
  expect(panic_message(() => cx.next_id())).toBe("assertion `left != right` failed\n  left: 0\n right: 0");
});

test("lib.rs:859 opt_local_def_id: lowering's own map first, then the owner's", () => {
  const cx = lctx();
  expect(cx.opt_local_def_id(nid(11))).toBe(ldid(4));
  cx.node_id_to_def_id.set(nid(11), ldid(9));
  expect(cx.opt_local_def_id(nid(11))).toBe(ldid(9));
  expect(cx.opt_local_def_id(nid(13))).toBeUndefined();
  expect(panic_message(() => cx.local_def_id(nid(13)))).toBe("no entry for node id: `NodeId(13)`");
  expect(cx.owner_id(nid(10)).def_id).toBe(ldid(3));
  expect(panic_message(() => cx.owner_id(nid(13)))).toBe("no entry found for key");
});

test("lib.rs:881 get_partial_res / lib.rs:951 expect_full_res / lib.rs:934 lower_res", () => {
  const cx = lctx();
  expect(cx.get_partial_res(nid(21))).toBeUndefined();
  expect(cx.expect_full_res(nid(21))).toEqual({ $: "Err" });
  expect(cx.expect_full_res(nid(20)).$).toBe("Def");
  cx.partial_res_overrides.set(nid(20), nid(30));
  expect(cx.expect_full_res(nid(20))).toEqual({ $: "Local", _0: nid(30) });

  // `Res::Local(NodeId)` maps through `ident_and_label_to_local_id`; a local of another owner is `Res::Err`.
  cx.curr_owner.ident_and_label_to_local_id.set(nid(30), ItemLocalId.new(5));
  const local = cx.lower_res({ $: "Local", _0: nid(30) });
  expect(local.$ === "Local" && [local._0.owner.def_id, local._0.local_id]).toEqual([ldid(3), ItemLocalId.new(5)]);
  expect(cx.lower_res({ $: "Local", _0: nid(31) })).toEqual({ $: "Err" });
  const prim: Res<NodeId> = { $: "PrimTy", _0: { $: "Bool" } as never };
  expect(cx.lower_res(prim)).toEqual(prim as never);
});

test("lib.rs:1108 with_dyn_type_scope / lib.rs:1119 with_new_scopes restore the outer state", () => {
  const cx = lctx();
  const seen = cx.with_dyn_type_scope(true, (this_) => this_.is_in_dyn_type);
  expect([seen, cx.is_in_dyn_type]).toEqual([true, false]);

  cx.is_in_loop_condition = true;
  cx.try_block_scope = { $: "Homogeneous", _0: cx.next_id() };
  const inner = cx.with_new_scopes(DUMMY_SP, (this_) => [
    this_.current_item_span,
    this_.is_in_loop_condition,
    this_.try_block_scope.$,
    this_.loop_scope,
    this_.contract_ensures,
  ]);
  expect(inner).toEqual([DUMMY_SP, false, "Function", undefined, undefined]);
  expect([cx.current_item_span, cx.is_in_loop_condition, cx.try_block_scope.$]).toEqual([undefined, true, "Homogeneous"]);
});
