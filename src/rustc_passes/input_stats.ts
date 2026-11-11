// Port of compiler/rustc_passes/src/input_stats.rs (`-Zinput-stats`).
//
// The visitors in this module collect sizes and counts of the most important
// pieces of AST and HIR. The resulting numbers are good approximations but not
// completely accurate (some things might be counted twice, others missed).
//
// PORT notes:
// - `size_of_val(val)`: every `val` upstream passes is a reference to a statically known sized type, so its size is
//   `size_of::<T>()` of the oracle compiler's layout of `T`. Those numbers come from the oracle (the `nodesizes`
//   probe, rendered into input_stats_sizes.gen.ts by tools/gen-input-stats-sizes.ts) and are never typed in; the
//   `record*` methods take the type's key in that table where upstream takes `val: &T`.
// - `StatCollector` implements both `hir_visit::Visitor` and `ast_visit::Visitor` upstream. A TS class extends one
//   base, so the two impls are the classes `StatCollector_hir` and `StatCollector_ast`, each holding the shared
//   `StatCollector` (its fields and inherent methods) and delegating `record*` to it.
// - `record_variants!` is the function `record_variants`, with the macro's variant list: the match arm taken is the
//   one whose variant name is the kind's `$` tag (a tag outside the list is `unreachable`, as the exhaustive match
//   rules out upstream).
// - `class StatCollector` holds both the struct (line 57) and its `impl` (line 81). Upstream's two entry points
//   (lines 63, 71) sit between them, so they come just before the class, keeping the fns in upstream order.
import { type AttrVec, type NodeId, visit as ast_visit } from "../rustc_ast/lib.ts";
import type * as ast from "../rustc_ast/ast.gen.ts";
import type { Attribute as HirAttribute } from "../rustc_attr_ir/lib.ts";
import { usize_with_underscores } from "../rustc_data_structures/thousands/mod.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { type AmbigArg } from "../rustc_hir/hir.gen.ts";
import { GenericArg as hir_GenericArg } from "../rustc_hir/hir.ts"; // also the `hir_id()` methods
import * as hir_visit from "../rustc_hir/intravisit.ts";
import { type HirId, HirIdSet } from "../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { LOCAL_CRATE, type LocalDefId, type LocalModId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { f64_fixed1 } from "../std/fmt.ts";
import { write_stderr } from "../std/io.ts";
import { unreachable, unwrap } from "../std/panic.ts";
import { NODE_SIZES, type NodeSizeKey } from "./input_stats_sizes.gen.ts";

// rustc-type: compiler/rustc_passes/src/input_stats.rs:14 NodeStats
class NodeStats {
  constructor(
    public count: number,
    public size: number,
  ) {}

  // rustc: compiler/rustc_passes/src/input_stats.rs:20 new
  static new(): NodeStats {
    return new NodeStats(0, 0);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:24 accum_size
  accum_size(): number {
    return this.count * this.size;
  }
}

// rustc-type: compiler/rustc_passes/src/input_stats.rs:29 Node
class Node {
  constructor(
    public stats: NodeStats,
    // PORT: `FxHashMap<&'static str, NodeStats>`; only iterated after sorting.
    public subnodes: Map<string, NodeStats>,
  ) {}

  // rustc: compiler/rustc_passes/src/input_stats.rs:35 new
  static new(): Node {
    return new Node(NodeStats.new(), new Map());
  }
}

// rustc: compiler/rustc_passes/src/input_stats.rs:63 print_hir_stats
export function print_hir_stats(tcx: TyCtxt): void {
  const collector = new StatCollector_hir(new StatCollector(tcx, new Map(), new HirIdSet()));
  tcx.hir_walk_toplevel_module(collector);
  tcx.hir_walk_attributes(collector);
  collector.c.print(tcx, "HIR STATS", "hir-stats");
}

// rustc: compiler/rustc_passes/src/input_stats.rs:71 print_ast_stats
export function print_ast_stats(tcx: TyCtxt, krate: ast.Crate): void {
  // use rustc_ast::visit::Visitor;

  const collector = new StatCollector_ast(new StatCollector(undefined, new Map(), new HirIdSet()));
  collector.visit_crate(krate);
  collector.c.print(tcx, "POST EXPANSION AST STATS", "ast-stats");
}

/// This type measures the size of AST and HIR nodes, by implementing the AST
/// and HIR `Visitor` traits. But we don't measure every visited type because
/// that could cause double counting.
///
/// For example, `ast::Visitor` has `visit_ident`, but `Ident`s are always
/// stored inline within other AST nodes, so we don't implement `visit_ident`
/// here. In contrast, we do implement `visit_expr` because `ast::Expr` is
/// always stored as `Box<ast::Expr>`, and every such expression should be
/// measured separately.
///
/// In general, a `visit_foo` method should be implemented here if the
/// corresponding `Foo` type is always stored on its own, e.g.: `Box<Foo>`,
/// `Box<Foo>`, `Vec<Foo>`, `Box<[Foo]>`.
///
/// There are some types in the AST and HIR tree that the visitors do not have
/// a `visit_*` method for, and so we cannot measure these, which is
/// unfortunate.
// rustc-type: compiler/rustc_passes/src/input_stats.rs:57 StatCollector
class StatCollector {
  constructor(
    public tcx: TyCtxt | undefined,
    // PORT: `FxHashMap<&'static str, Node>`; only iterated after sorting.
    public nodes: Map<string, Node>,
    public seen: HirIdSet,
  ) {}

  // Record a top-level node.
  // rustc: compiler/rustc_passes/src/input_stats.rs:82 record
  record(label: string, id: HirId | undefined, val: NodeSizeKey): void {
    this.record_inner(label, undefined, id, val);
  }

  // Record a two-level entry, with a top-level enum type and a variant.
  // rustc: compiler/rustc_passes/src/input_stats.rs:87 record_variant
  record_variant(label1: string, label2: string, id: HirId | undefined, val: NodeSizeKey): void {
    this.record_inner(label1, label2, id, val);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:97 record_inner
  record_inner(label1: string, label2: string | undefined, id: HirId | undefined, val: NodeSizeKey): void {
    // `id.is_some_and(|x| !self.seen.insert(x))`
    if (id !== undefined) {
      if (this.seen.has(id)) {
        return;
      }
      this.seen.add(id);
    }

    let node = this.nodes.get(label1);
    if (node === undefined) {
      node = Node.new();
      this.nodes.set(label1, node);
    }
    node.stats.count += 1;
    node.stats.size = NODE_SIZES[val]; // `size_of_val(val)`

    if (label2 !== undefined) {
      let subnode = node.subnodes.get(label2);
      if (subnode === undefined) {
        subnode = NodeStats.new();
        node.subnodes.set(label2, subnode);
      }
      subnode.count += 1;
      subnode.size = NODE_SIZES[val]; // `size_of_val(val)`
    }
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:119 print
  print(tcx: TyCtxt, title: string, prefix: string): void {
    // use std::fmt::Write;

    // We will soon sort, so the initial order does not matter.
    // #[allow(rustc::potential_query_instability)]
    const nodes: [string, Node][] = [...this.nodes];
    // `sort_by_cached_key(|(label, node)| (node.stats.accum_size(), label.to_owned()))`: labels are ASCII, so
    // comparing code units is `String`'s byte order; no two labels are equal.
    nodes.sort((a, b) => a[1].stats.accum_size() - b[1].stats.accum_size() || cmp_str(a[0], b[0]));
    nodes.reverse(); // bigger items first

    const name_w = 18;
    const acc_size1_w = 10;
    const acc_size2_w = 8; // " (NN.N%)"
    const acc_size_w = acc_size1_w + acc_size2_w;
    const count_w = 14;
    const item_size_w = 14;
    const banner_w = name_w + acc_size_w + count_w + item_size_w;

    let total_size = 0;
    for (const [, node] of nodes) total_size += node.stats.accum_size();
    let total_count = 0;
    for (const [, node] of nodes) total_count += node.stats.count;

    // We write all the text into a string and print it with a single
    // `eprint!`. This is an attempt to minimize interleaved text if multiple
    // rustc processes are printing macro-stats at the same time (e.g. with
    // `RUSTFLAGS='-Zinput-stats' cargo build`). It still doesn't guarantee
    // non-interleaving, though.
    let s = "";
    s += `${prefix} ${"=".repeat(banner_w)}\n`;
    s += `${prefix} ${title}: ${Symbol.as_str(tcx.crate_name(LOCAL_CRATE))}\n`;
    s += `${prefix} ${pad_l("Name", name_w)}${pad_r("Accumulated Size", acc_size_w)}${pad_r("Count", count_w)}${pad_r("Item Size", item_size_w)}\n`;
    s += `${prefix} ${"-".repeat(banner_w)}\n`;

    const percent = (m: number, n: number): number => (m * 100) / n;

    for (const [label, node] of nodes) {
      const size = node.stats.accum_size();
      s += `${prefix} ${pad_l(label, name_w)}${pad_r(usize_with_underscores(size), acc_size1_w)} (${pad_r(f64_fixed1(percent(size, total_size)), 4)}%)${pad_r(usize_with_underscores(node.stats.count), count_w)}${pad_r(usize_with_underscores(node.stats.size), item_size_w)}\n`;
      if (node.subnodes.size !== 0) {
        // We will soon sort, so the initial order does not matter.
        // #[allow(rustc::potential_query_instability)]
        const subnodes: [string, NodeStats][] = [...node.subnodes];
        subnodes.sort((a, b) => a[1].accum_size() - b[1].accum_size() || cmp_str(a[0], b[0]));

        for (const [label, subnode] of subnodes) {
          const size = subnode.accum_size();
          s += `${prefix} - ${pad_l(label, name_w)}${pad_r(usize_with_underscores(size), acc_size1_w)} (${pad_r(f64_fixed1(percent(size, total_size)), 4)}%)${pad_r(usize_with_underscores(subnode.count), count_w)}\n`;
        }
      }
    }
    s += `${prefix} ${"-".repeat(banner_w)}\n`;
    s += `${prefix} ${pad_l("Total", name_w)}${pad_r(usize_with_underscores(total_size), acc_size1_w)}${pad_r("", acc_size2_w)}${pad_r(usize_with_underscores(total_count), count_w)}\n`;
    s += `${prefix} ${"=".repeat(banner_w)}\n`;
    write_stderr(s);
  }
}

/** PORT: `String`'s `Ord` on ASCII labels. */
function cmp_str(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** PORT: `{:<w$}` of an ASCII `&str` (a label or a number). */
function pad_l(s: string, w: number): string {
  return s.padEnd(w);
}

/** PORT: `{:>w$}` of an ASCII `&str` or a formatted number. */
function pad_r(s: string, w: number): string {
  return s.padStart(w);
}

// Used to avoid boilerplate for types with many variants.
// rustc-macro: compiler/rustc_passes/src/input_stats.rs:203 record_variants
function record_variants(
  self: StatCollector,
  val: NodeSizeKey,
  kind: { readonly $: string },
  id: HirId | undefined,
  ty: string,
  variants: readonly string[],
): void {
  // `match $kind { $($mod::$tykind::$variant { .. } => $self.record_variant(stringify!($ty), stringify!($variant), $id, $val)),* }`
  if (!variants.includes(kind.$)) return unreachable(`input_stats: ${ty} variant ${kind.$} is not in record_variants!`);
  self.record_variant(ty, kind.$, id, val);
}

// impl<'v> hir_visit::Visitor<'v> for StatCollector<'v>
class StatCollector_hir extends hir_visit.Visitor {
  constructor(public c: StatCollector) {
    super();
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:219 visit_param
  override visit_param(param: hir.Param): undefined {
    this.c.record("Param", param.hir_id, "hir::Param");
    return hir_visit.walk_param(this, param);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:224 visit_nested_item
  override visit_nested_item(id: hir.ItemId): undefined {
    const nested_item = unwrap(this.c.tcx).hir_item(id);
    return this.visit_item(nested_item);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:229 visit_nested_trait_item
  override visit_nested_trait_item(trait_item_id: hir.TraitItemId): undefined {
    const nested_trait_item = unwrap(this.c.tcx).hir_trait_item(trait_item_id);
    return this.visit_trait_item(nested_trait_item);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:234 visit_nested_impl_item
  override visit_nested_impl_item(impl_item_id: hir.ImplItemId): undefined {
    const nested_impl_item = unwrap(this.c.tcx).hir_impl_item(impl_item_id);
    return this.visit_impl_item(nested_impl_item);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:239 visit_nested_foreign_item
  override visit_nested_foreign_item(id: hir.ForeignItemId): undefined {
    const nested_foreign_item = unwrap(this.c.tcx).hir_foreign_item(id);
    this.visit_foreign_item(nested_foreign_item);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:244 visit_nested_body
  override visit_nested_body(body_id: hir.BodyId): undefined {
    const nested_body = unwrap(this.c.tcx).hir_body(body_id);
    return this.visit_body(nested_body);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:249 visit_item
  override visit_item(i: hir.Item): undefined {
    record_variants(this.c, "hir::Item", i.kind, i.hir_id(), "Item", [
      "ExternCrate",
      "Use",
      "Static",
      "Const",
      "Fn",
      "Macro",
      "Mod",
      "ForeignMod",
      "GlobalAsm",
      "TyAlias",
      "Enum",
      "Struct",
      "Union",
      "Trait",
      "TraitAlias",
      "Impl",
      "TestBinderConstraints",
    ]);
    return hir_visit.walk_item(this, i);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:275 visit_body
  override visit_body(b: hir.Body): undefined {
    this.c.record("Body", undefined, "hir::Body");
    hir_visit.walk_body(this, b);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:280 visit_mod
  override visit_mod(m: hir.Mod, _s: Span, _id: LocalModId): undefined {
    this.c.record("Mod", undefined, "hir::Mod");
    return hir_visit.walk_mod(this, m);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:285 visit_foreign_item
  override visit_foreign_item(i: hir.ForeignItem): undefined {
    record_variants(this.c, "hir::ForeignItem", i.kind, i.hir_id(), "ForeignItem", ["Fn", "Static", "Type"]);
    return hir_visit.walk_foreign_item(this, i);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:293 visit_local
  override visit_local(l: hir.LetStmt): undefined {
    this.c.record("Local", l.hir_id, "hir::LetStmt");
    return hir_visit.walk_local(this, l);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:298 visit_block
  override visit_block(b: hir.Block): undefined {
    this.c.record("Block", b.hir_id, "hir::Block");
    return hir_visit.walk_block(this, b);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:303 visit_stmt
  override visit_stmt(s: hir.Stmt): undefined {
    record_variants(this.c, "hir::Stmt", s.kind, s.hir_id, "Stmt", ["Let", "Item", "Expr", "Semi"]);
    return hir_visit.walk_stmt(this, s);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:311 visit_arm
  override visit_arm(a: hir.Arm): undefined {
    this.c.record("Arm", a.hir_id, "hir::Arm");
    return hir_visit.walk_arm(this, a);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:316 visit_pat
  override visit_pat(p: hir.Pat): undefined {
    record_variants(this.c, "hir::Pat", p.kind, p.hir_id, "Pat", [
      "Missing",
      "Wild",
      "Binding",
      "Struct",
      "TupleStruct",
      "Or",
      "Never",
      "Tuple",
      "Deref",
      "Ref",
      "Expr",
      "Guard",
      "Range",
      "Slice",
      "Err",
    ]);
    return hir_visit.walk_pat(this, p);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:340 visit_pat_field
  override visit_pat_field(f: hir.PatField): undefined {
    this.c.record("PatField", f.hir_id, "hir::PatField");
    return hir_visit.walk_pat_field(this, f);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:345 visit_expr
  override visit_expr(e: hir.Expr): undefined {
    record_variants(this.c, "hir::Expr", e.kind, e.hir_id, "Expr", [
      "ConstBlock",
      "Array",
      "Call",
      "MethodCall",
      "Use",
      "Tup",
      "Binary",
      "Unary",
      "Lit",
      "Cast",
      "Type",
      "DropTemps",
      "Let",
      "If",
      "Loop",
      "Match",
      "Closure",
      "Block",
      "Assign",
      "AssignOp",
      "Field",
      "Index",
      "Path",
      "AddrOf",
      "Break",
      "Continue",
      "Ret",
      "Become",
      "InlineAsm",
      "OffsetOf",
      "Struct",
      "Repeat",
      "Yield",
      "UnsafeBinderCast",
      "Err",
    ]);
    return hir_visit.walk_expr(this, e);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:389 visit_expr_field
  override visit_expr_field(f: hir.ExprField): undefined {
    this.c.record("ExprField", f.hir_id, "hir::ExprField");
    return hir_visit.walk_expr_field(this, f);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:394 visit_ty
  override visit_ty(t: hir.Ty<AmbigArg>): undefined {
    record_variants(this.c, "hir::Ty<AmbigArg>", t.kind, t.hir_id, "Ty", [
      "InferDelegation",
      "Slice",
      "Array",
      "Ptr",
      "Ref",
      "FnPtr",
      "UnsafeBinder",
      "Never",
      "Tup",
      "Path",
      "OpaqueDef",
      "TraitAscription",
      "TraitObject",
      "Infer",
      "Pat",
      "FieldOf",
      "View",
      "Err",
    ]);
    return hir_visit.walk_ty(this, t);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:421 visit_generic_param
  override visit_generic_param(p: hir.GenericParam): undefined {
    this.c.record("GenericParam", p.hir_id, "hir::GenericParam");
    return hir_visit.walk_generic_param(this, p);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:426 visit_generics
  override visit_generics(g: hir.Generics): undefined {
    this.c.record("Generics", undefined, "hir::Generics");
    return hir_visit.walk_generics(this, g);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:431 visit_where_predicate
  override visit_where_predicate(p: hir.WherePredicate): undefined {
    record_variants(this.c, "hir::WherePredicate", p.kind, p.hir_id, "WherePredicate", ["BoundPredicate", "RegionPredicate"]);
    return hir_visit.walk_where_predicate(this, p);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:439 visit_fn
  override visit_fn(fk: hir_visit.FnKind, fd: hir.FnDecl, b: hir.BodyId, _: Span, id: LocalDefId): undefined {
    this.c.record("FnDecl", undefined, "hir::FnDecl");
    return hir_visit.walk_fn(this, fk, fd, b, id);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:451 visit_use
  override visit_use(tree: hir.UseTree, _hir_id: HirId, _def_id: LocalDefId): undefined {
    // This is `visit_use`, but the type is `Path` so record it that way.
    this.c.record("Path", undefined, "hir::UseTree");
    // Don't call `hir_visit::walk_use(self, p, hir_id)`: it calls
    // `visit_path` up to three times, once for each namespace result in
    // `p.res`, by building temporary `Path`s that are not part of the real
    // HIR, which causes `p` to be double- or triple-counted. Instead just
    // walk the path internals (i.e. the segments) directly.
    const { segments } = tree.prefix;
    for (const segment of segments) this.visit_path_segment(segment); // `ast_visit::walk_list!`
    switch (tree.kind.$) {
      case "Single":
      case "Glob":
        break;
      case "Nested": {
        const { items } = tree.kind;
        for (const [tree, id, def_id] of items) {
          this.visit_use(tree, id, def_id);
        }
        break;
      }
    }
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:471 visit_trait_item
  override visit_trait_item(ti: hir.TraitItem): undefined {
    record_variants(this.c, "hir::TraitItem", ti.kind, ti.hir_id(), "TraitItem", ["Const", "Fn", "Type"]);
    return hir_visit.walk_trait_item(this, ti);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:479 visit_trait_item_ref
  override visit_trait_item_ref(ti: hir.TraitItemId): undefined {
    this.c.record("TraitItemId", ti.hir_id(), "hir::TraitItemId");
    return hir_visit.walk_trait_item_ref(this, ti);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:484 visit_impl_item
  override visit_impl_item(ii: hir.ImplItem): undefined {
    record_variants(this.c, "hir::ImplItem", ii.kind, ii.hir_id(), "ImplItem", ["Const", "Fn", "Type"]);
    return hir_visit.walk_impl_item(this, ii);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:492 visit_foreign_item_ref
  override visit_foreign_item_ref(fi: hir.ForeignItemId): undefined {
    this.c.record("ForeignItemId", fi.hir_id(), "hir::ForeignItemId");
    return hir_visit.walk_foreign_item_ref(this, fi);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:497 visit_impl_item_ref
  override visit_impl_item_ref(ii: hir.ImplItemId): undefined {
    this.c.record("ImplItemId", ii.hir_id(), "hir::ImplItemId");
    return hir_visit.walk_impl_item_ref(this, ii);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:502 visit_param_bound
  override visit_param_bound(b: hir.GenericBound): undefined {
    record_variants(this.c, "hir::GenericBound", b, undefined, "GenericBound", ["Trait", "Outlives", "Use"]);
    return hir_visit.walk_param_bound(this, b);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:510 visit_field_def
  override visit_field_def(s: hir.FieldDef): undefined {
    this.c.record("FieldDef", s.hir_id, "hir::FieldDef");
    return hir_visit.walk_field_def(this, s);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:515 visit_variant
  override visit_variant(v: hir.Variant): undefined {
    this.c.record("Variant", undefined, "hir::Variant");
    return hir_visit.walk_variant(this, v);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:520 visit_generic_arg
  override visit_generic_arg(ga: hir.GenericArg): undefined {
    record_variants(this.c, "hir::GenericArg", ga, hir_GenericArg.hir_id(ga), "GenericArg", ["Lifetime", "Type", "Const", "Infer"]);
    switch (ga.$) {
      case "Lifetime":
        return this.visit_lifetime(ga._0);
      case "Type":
        return this.visit_ty(ga._0);
      case "Const":
        return this.visit_const_arg(ga._0);
      case "Infer":
        return this.visit_id(ga._0.hir_id);
    }
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:533 visit_lifetime
  override visit_lifetime(lifetime: hir.Lifetime): undefined {
    this.c.record("Lifetime", lifetime.hir_id, "hir::Lifetime");
    return hir_visit.walk_lifetime(this, lifetime);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:538 visit_path
  override visit_path(path: hir.Path, _id: HirId): undefined {
    this.c.record("Path", undefined, "hir::Path");
    return hir_visit.walk_path(this, path);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:543 visit_path_segment
  override visit_path_segment(path_segment: hir.PathSegment): undefined {
    this.c.record("PathSegment", undefined, "hir::PathSegment");
    return hir_visit.walk_path_segment(this, path_segment);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:548 visit_generic_args
  override visit_generic_args(ga: hir.GenericArgs): undefined {
    this.c.record("GenericArgs", undefined, "hir::GenericArgs");
    return hir_visit.walk_generic_args(this, ga);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:553 visit_assoc_item_constraint
  override visit_assoc_item_constraint(constraint: hir.AssocItemConstraint): undefined {
    this.c.record("AssocItemConstraint", constraint.hir_id, "hir::AssocItemConstraint");
    return hir_visit.walk_assoc_item_constraint(this, constraint);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:558 visit_attribute
  override visit_attribute(_attr: HirAttribute): undefined {
    this.c.record("Attribute", undefined, "rustc_attr_ir::Attribute");
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:562 visit_inline_asm
  override visit_inline_asm(asm: hir.InlineAsm, id: HirId): undefined {
    this.c.record("InlineAsm", undefined, "hir::InlineAsm");
    hir_visit.walk_inline_asm(this, asm, id);
  }
}

// impl<'v> ast_visit::Visitor<'v> for StatCollector<'v>
class StatCollector_ast extends ast_visit.Visitor {
  constructor(public c: StatCollector) {
    super();
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:569 visit_foreign_item
  override visit_foreign_item(i: ast.ForeignItem): undefined {
    record_variants(this.c, "ast::ForeignItem", i.kind, undefined, "ForeignItem", ["Static", "Fn", "TyAlias", "MacCall"]);
    return ast_visit.walk_item(this, i, ast_visit.WalkItemKind.ForeignItemKind);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:577 visit_item
  override visit_item(i: ast.Item): undefined {
    record_variants(this.c, "ast::Item", i.kind, undefined, "Item", [
      "ExternCrate",
      "Use",
      "Static",
      "Const",
      "ConstBlock",
      "Fn",
      "Mod",
      "ForeignMod",
      "GlobalAsm",
      "TyAlias",
      "Enum",
      "Struct",
      "Union",
      "Trait",
      "TraitAlias",
      "Impl",
      "MacCall",
      "MacroDef",
      "Delegation",
      "DelegationMac",
      "TestBinderConstraints",
    ]);
    return ast_visit.walk_item(this, i, ast_visit.WalkItemKind.ItemKind);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:607 visit_local
  override visit_local(l: ast.Local): undefined {
    this.c.record("Local", undefined, "ast::Local");
    return ast_visit.walk_local(this, l);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:612 visit_block
  override visit_block(b: ast.Block): undefined {
    this.c.record("Block", undefined, "ast::Block");
    return ast_visit.walk_block(this, b);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:617 visit_stmt
  override visit_stmt(s: ast.Stmt): undefined {
    record_variants(this.c, "ast::Stmt", s.kind, undefined, "Stmt", ["Let", "Item", "Expr", "Semi", "Empty", "MacCall"]);
    return ast_visit.walk_stmt(this, s);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:625 visit_param
  override visit_param(p: ast.Param): undefined {
    this.c.record("Param", undefined, "ast::Param");
    return ast_visit.walk_param(this, p);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:630 visit_arm
  override visit_arm(a: ast.Arm): undefined {
    this.c.record("Arm", undefined, "ast::Arm");
    return ast_visit.walk_arm(this, a);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:635 visit_pat
  override visit_pat(p: ast.Pat): undefined {
    record_variants(this.c, "ast::Pat", p.kind, undefined, "Pat", [
      "Missing",
      "Wild",
      "Ident",
      "Struct",
      "TupleStruct",
      "Or",
      "Path",
      "Tuple",
      "Deref",
      "Ref",
      "Expr",
      "Range",
      "Slice",
      "Rest",
      "Never",
      "Guard",
      "Paren",
      "MacCall",
      "Err",
    ]);
    return ast_visit.walk_pat(this, p);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:663 visit_expr
  override visit_expr(e: ast.Expr): undefined {
    // #[rustfmt::skip]
    record_variants(this.c, "ast::Expr", e.kind, undefined, "Expr", [
      "Array", "ConstBlock", "Call", "MethodCall", "Tup", "Binary", "Unary", "Lit", "Cast", "Type", "Let",
      "If", "While", "ForLoop", "Loop", "Match", "Closure", "Block", "Await", "Move", "Use", "TryBlock", "Assign",
      "AssignOp", "Field", "Index", "Range", "Underscore", "Path", "AddrOf", "Break", "Continue", "Ret",
      "InlineAsm", "FormatArgs", "OffsetOf", "MacCall", "Struct", "Repeat", "Paren", "Try", "Yield", "Yeet",
      "Become", "IncludedBytes", "Gen", "UnsafeBinderCast", "GcaMacro", "Err", "Dummy",
    ]);
    return ast_visit.walk_expr(this, e);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:678 visit_ty
  override visit_ty(t: ast.Ty): undefined {
    record_variants(this.c, "ast::Ty", t.kind, undefined, "Ty", [
      "Slice",
      "Array",
      "Ptr",
      "Ref",
      "PinnedRef",
      "FnPtr",
      "UnsafeBinder",
      "Never",
      "Tup",
      "Path",
      "Pat",
      "TraitObject",
      "ImplTrait",
      "Paren",
      "Infer",
      "ImplicitSelf",
      "MacCall",
      "CVarArgs",
      "FieldOf",
      "View",
      "GcaMacro",
      "Dummy",
      "Err",
    ]);

    return ast_visit.walk_ty(this, t);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:711 visit_generic_param
  override visit_generic_param(g: ast.GenericParam): undefined {
    this.c.record("GenericParam", undefined, "ast::GenericParam");
    return ast_visit.walk_generic_param(this, g);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:716 visit_where_predicate
  override visit_where_predicate(p: ast.WherePredicate): undefined {
    record_variants(this.c, "ast::WherePredicate", p.kind, undefined, "WherePredicate", ["BoundPredicate", "RegionPredicate"]);
    return ast_visit.walk_where_predicate(this, p);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:724 visit_fn
  override visit_fn(fk: ast_visit.FnKind, _: AttrVec, _span: Span, _id: NodeId): undefined {
    this.c.record("FnDecl", undefined, "ast::FnDecl"); // `fk.decl()`
    return ast_visit.walk_fn(this, fk);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:729 visit_assoc_item
  override visit_assoc_item(i: ast.AssocItem, ctxt: ast_visit.AssocCtxt): undefined {
    record_variants(this.c, "ast::AssocItem", i.kind, undefined, "AssocItem", ["Const", "Fn", "Type", "MacCall", "Delegation", "DelegationMac"]);
    ast_visit.walk_assoc_item(this, i, ctxt, ast_visit.WalkItemKind.AssocItemKind);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:737 visit_param_bound
  override visit_param_bound(b: ast.GenericBound, _ctxt: ast_visit.BoundKind): undefined {
    record_variants(this.c, "ast::GenericBound", b, undefined, "GenericBound", ["Trait", "Outlives", "Use"]);
    return ast_visit.walk_param_bound(this, b);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:745 visit_field_def
  override visit_field_def(s: ast.FieldDef): undefined {
    this.c.record("FieldDef", undefined, "ast::FieldDef");
    return ast_visit.walk_field_def(this, s);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:750 visit_variant
  override visit_variant(v: ast.Variant): undefined {
    this.c.record("Variant", undefined, "ast::Variant");
    return ast_visit.walk_variant(this, v);
  }

  // `UseTree` has one inline use (in `ast::ItemKind::Use`) and one
  // non-inline use (in `ast::UseTreeKind::Nested`). The former case is more
  // common, so we don't implement `visit_use_tree` and tolerate the missed
  // coverage in the latter case.

  // `PathSegment` has one inline use (in `ast::ExprKind::MethodCall`) and
  // one non-inline use (in `ast::Path::segments`). The latter case is more
  // common than the former case, so we implement this visitor and tolerate
  // the double counting in the former case.
  // rustc: compiler/rustc_passes/src/input_stats.rs:764 visit_path_segment
  override visit_path_segment(path_segment: ast.PathSegment): undefined {
    this.c.record("PathSegment", undefined, "ast::PathSegment");
    return ast_visit.walk_path_segment(this, path_segment);
  }

  // `GenericArgs` has one inline use (in `ast::AssocItemConstraint::gen_args`) and one
  // non-inline use (in `ast::PathSegment::args`). The latter case is more
  // common, so we implement `visit_generic_args` and tolerate the double
  // counting in the former case.
  // rustc: compiler/rustc_passes/src/input_stats.rs:773 visit_generic_args
  override visit_generic_args(g: ast.GenericArgs): undefined {
    record_variants(this.c, "ast::GenericArgs", g, undefined, "GenericArgs", ["AngleBracketed", "Parenthesized", "ParenthesizedElided"]);
    return ast_visit.walk_generic_args(this, g);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:781 visit_attribute
  override visit_attribute(attr: ast.Attribute): undefined {
    record_variants(this.c, "ast::Attribute", attr.kind, undefined, "Attribute", ["Normal", "Synthetic", "DocComment"]);
    return ast_visit.walk_attribute(this, attr);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:789 visit_expr_field
  override visit_expr_field(f: ast.ExprField): undefined {
    this.c.record("ExprField", undefined, "ast::ExprField");
    return ast_visit.walk_expr_field(this, f);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:794 visit_crate
  override visit_crate(krate: ast.Crate): undefined {
    this.c.record("Crate", undefined, "ast::Crate");
    return ast_visit.walk_crate(this, krate);
  }

  // rustc: compiler/rustc_passes/src/input_stats.rs:799 visit_inline_asm
  override visit_inline_asm(asm: ast.InlineAsm): undefined {
    this.c.record("InlineAsm", undefined, "ast::InlineAsm");
    return ast_visit.walk_inline_asm(this, asm);
  }
}
