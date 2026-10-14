// Test helper of src/rustc_middle/hir/map.oracle.test.ts (lane middle-hir).
//
// Runs the ported driver with `override_queries` replacing `lower_to_hir` (rustc_ast_lowering, being ported by the
// wave-14 lowering lanes) by a stand-in that builds the HIR of a modules-only crate from the expanded AST: what
// lowering produces for `mod` items (transcribed from the oracle's `-Zunpretty=hir-tree`). Everything else is the
// real path: `hir_owner` / `hir_attr_map` (hir/mod.rs provide), `hir_crate_items` + `ItemCollector` (hir/map.rs),
// `hir_owner_nodes`, and `rustc_driver_impl::pretty::print`'s HirTree arm.
//
//   bun run.ts tree <rustc arguments...>        the driver as `rustc -Zunpretty=hir-tree` (stdout = the HIR tree)
//   bun run.ts accessors <rustc arguments...>   stops after expansion and prints `tcx.hir_*` results, one per line
import type { Crate, Item as AstItem } from "../../../rustc_ast/ast.gen.ts";
import type { NodeId } from "../../../rustc_ast/node_id.ts";
import { SortedMap } from "../../../rustc_data_structures/sorted_map.ts";
import { Steal } from "../../../rustc_data_structures/steal.ts";
import type { Attribute } from "../../../rustc_attr_ir/lib.ts";
import { AttributeMap, type Body, Item, ItemId, ItemLocalId_cmp, type MaybeOwner, type Mod, Node, OwnerInfo, type OwnerNode, OwnerNodes, type ParentedNode } from "../../../rustc_hir/hir.ts";
import { HirId_make_owner, ItemLocalId, OwnerId, debug_HirId, debug_OwnerId } from "../../../rustc_hir_id/lib.ts";
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import { CRATE_DEF_ID, type LocalDefId, LocalModId, debug_LocalDefId, debug_LocalModId } from "../../../rustc_span/def_id.ts";
import { debug_Span } from "../../../rustc_span/lib.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { PLAIN, format_debug } from "../../../std/fmt.ts";
import type { TyCtxt } from "../../ty/context.ts";
import type { ModuleItems } from "../mod.ts";

function OwnerNode_of(node: ParentedNode): OwnerNode {
  const o = Node.as_owner(node.node);
  if (o === undefined) throw new Error("ERROR: not an owner node");
  return o;
}

/** The stand-in `lower_to_hir`: every owner of a crate whose items are all inline `mod`s. */
function build_owners(tcx: TyCtxt): Map<LocalDefId, MaybeOwner> {
  const [resolver_steal, krate_steal] = tcx.resolver_for_lowering();
  const resolver = resolver_steal.borrow();
  const krate = (krate_steal as unknown as { borrow(): Crate }).borrow();
  const def_of = new Map<NodeId, LocalDefId>();
  for (const data of resolver.owners.values()) {
    def_of.set(data.id, data.def_id);
    for (const [n, d] of data.node_id_to_def_id) def_of.set(n, d);
  }

  const out = new Map<LocalDefId, MaybeOwner>();
  const owner_info = (node: ParentedNode, children: LocalDefId[]): OwnerInfo => {
    const bodies = SortedMap.new<ItemLocalId, Body>(ItemLocalId_cmp);
    const attrs = SortedMap.new<ItemLocalId, readonly Attribute[]>(ItemLocalId_cmp);
    // As `LoweringContext::make_owner_info` (rustc_ast_lowering lib.rs:248): `tcx.hash_owner_nodes(..)` gives
    // `OwnerNodes::opt_hash` (`Some` for lib crates). PORT: the stand-in has no attributes (the crate root's
    // `#![no_core]` is not lowered), which hir-tree does not print.
    const { bodies_hash, attrs_hash } = tcx.hash_owner_nodes(OwnerNode_of(node), bodies, attrs, undefined);
    const nodes = new OwnerNodes(bodies_hash, [node], bodies);
    // Each child item is referenced from the owner's node 0 (`Mod::item_ids`).
    const parenting = new Map(children.map((c) => [c, ItemLocalId.ZERO] as const));
    return new OwnerInfo(nodes, parenting, new AttributeMap(attrs, undefined, attrs_hash), new Map(), new Map(), Steal.new(undefined as unknown, "DelayedLints"), undefined);
  };
  const lower_items = (items: readonly AstItem[]): LocalDefId[] =>
    items.map((item) => {
      const kind = item.kind;
      if (kind.$ !== "Mod" || kind._2.$ !== "Loaded") throw new Error(`ERROR: stand-in lowering handles inline mods only`);
      const def_id = def_of.get(item.id)!;
      const children = lower_items(kind._2._0);
      const m: Mod = { spans: { inner_span: kind._2._2.inner_span, inject_use_span: kind._2._2.inject_use_span }, item_ids: children.map((c) => new ItemId(new OwnerId(c))) };
      const hir_item = new Item(new OwnerId(def_id), { $: "Mod", _0: kind._1, _1: m }, item.span, item.vis.span, false);
      out.set(def_id, { $: "Owner", _0: owner_info({ parent: ItemLocalId.INVALID, node: { $: "Item", _0: hir_item } }, children) });
      return def_id;
    });
  const children = lower_items(krate.items);
  const root: Mod = { spans: { inner_span: krate.spans.inner_span, inject_use_span: krate.spans.inject_use_span }, item_ids: children.map((c) => new ItemId(new OwnerId(c))) };
  out.set(CRATE_DEF_ID, { $: "Owner", _0: owner_info({ parent: ItemLocalId.INVALID, node: { $: "Crate", _0: root } }, children) });
  return out;
}

const config = (c: Config): void => {
  c.opts.trimmed_def_paths = true;
  c.override_queries = (_sess, providers) => {
    let owners: Map<LocalDefId, MaybeOwner> | undefined;
    providers.queries.lower_to_hir = (tcx, def_id) => (owners ??= build_owners(tcx)).get(def_id)!;
  };
};

/** One line per accessor, `<expr> = <Debug>`. */
function accessors(tcx: TyCtxt): string {
  const by_name = (name: string): LocalDefId => {
    for (const owner of (tcx.hir_crate_items(null) as ModuleItems).owners()) {
      if (owner.def_id !== CRATE_DEF_ID && Symbol.as_str(tcx.hir_name(HirId_make_owner(owner.def_id))) === name) return owner.def_id;
    }
    throw new Error(`ERROR: no owner ${name}`);
  };
  const [m, n, k] = [by_name("m"), by_name("n"), by_name("k")];
  const hid = (d: LocalDefId) => HirId_make_owner(d);
  const h = (d: Parameters<typeof debug_HirId>[0]) => debug_HirId(d, PLAIN);
  const sp = (s: Parameters<typeof debug_Span>[0]) => debug_Span(s, PLAIN);
  const items = tcx.hir_crate_items(null) as ModuleItems;
  const lines = [
    `owners = ${items.owners().map((o) => debug_OwnerId(o, PLAIN)).join(", ")}`,
    `submodules = ${items.submodules.map((s) => debug_LocalModId(s, PLAIN)).join(", ")}`,
    `body_owners = ${items.body_owners.length}`,
    `parent_hir_id(n) = ${h(tcx.parent_hir_id(hid(n)))}`,
    `parent_hir_id(m) = ${h(tcx.parent_hir_id(hid(m)))}`,
    `parent_hir_id(root) = ${h(tcx.parent_hir_id(hid(CRATE_DEF_ID)))}`,
    `hir_parent_id_iter(n) = ${[...tcx.hir_parent_id_iter(hid(n))].map(h).join(", ")}`,
    `hir_parent_owner_iter(n) = ${[...tcx.hir_parent_owner_iter(hid(n))].map(([o, node]) => `${debug_OwnerId(o, PLAIN)}:${node.$}`).join(", ")}`,
    `hir_get_parent_item(n) = ${debug_OwnerId(tcx.hir_get_parent_item(hid(n)), PLAIN)}`,
    `hir_get_enclosing_scope(n) = ${h(tcx.hir_get_enclosing_scope(hid(n))!)}`,
    `hir_get_defining_scope(n) = ${h(tcx.hir_get_defining_scope(hid(n)))}`,
    `parent_module(n) = ${debug_LocalModId(tcx.parent_module(hid(n)), PLAIN)}`,
    `hir_span(m) = ${sp(tcx.hir_span(hid(m)))}`,
    `hir_span_with_body(m) = ${sp(tcx.hir_span_with_body(hid(m)))}`,
    `hir_span(root) = ${sp(tcx.hir_span(hid(CRATE_DEF_ID)))}`,
    `def_ident_span(k) = ${sp(tcx.def_ident_span(k)!)}`,
    `hir_get_module(m) = ${tcx.hir_get_module(LocalModId.new_unchecked(m))[0].item_ids.length} items, ${sp(tcx.hir_get_module(LocalModId.new_unchecked(m))[1])}`,
    `hir_module_items(m).free_items = ${(tcx.hir_module_items(LocalModId.new_unchecked(m)) as ModuleItems).free_items().map((i) => debug_LocalDefId(i.owner_id.def_id, PLAIN)).join(", ")}`,
    `hir_root_module().item_ids = ${tcx.hir_root_module().item_ids.length}`,
    `hir_free_items = ${tcx.hir_free_items().length}`,
    `local_def_id_to_hir_id(k) = ${h(tcx.local_def_id_to_hir_id(k))}`,
    `hir_krate_attrs = ${tcx.hir_krate_attrs().length}`,
    `hir_body_owners = ${tcx.hir_body_owners().length}`,
  ];
  return lines.join("\n") + "\n";
}

async function main(args: string[]): Promise<number> {
  const [mode, ...rustc_args] = args;
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../../rustc_session/config.ts");
  if (mode === "tree") return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...rustc_args], { config }));
  if (mode === "accessors") {
    const callbacks = {
      config,
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        std_print(accessors(tcx));
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...rustc_args], callbacks));
  }
  console.error(`ERROR: unknown mode ${mode}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
