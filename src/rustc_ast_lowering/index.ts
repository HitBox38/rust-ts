// Port of compiler/rustc_ast_lowering/src/index.rs
//
// `index_hir` (the `NodeCollector` HIR visitor) builds the `OwnerNodes` node table and parenting map of one
// owner; `PerOwnerLoweringState::into_owner_info` (lib.rs) calls it.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates
// (`NodeCollector extends` rustc_hir's intravisit `Visitor`).
//
// PORT: `#[instrument(..)]` / `debug!(..)` (tracing) are dropped. `NodeCollector` is a `hand` type of codegen
// set rustc_ast_lowering: a class extending intravisit's `Visitor` (its `Result` is `()`, i.e. `undefined`).
import type { SortedMap } from "../rustc_data_structures/sorted_map.ts";
import {
  type AmbigArg,
  type AnonConst,
  type Arm,
  type AssocItemConstraint,
  type Block,
  type Body,
  type BodyId,
  type ConstArg,
  type ConstArgExprField,
  type ConstBlock,
  type Expr,
  type ExprField,
  type FieldDef,
  type ForeignItem,
  type ForeignItemId,
  type GenericParam,
  HirId,
  type ImplItem,
  type ImplItemId,
  type Item,
  type ItemId,
  ItemLocalId,
  intravisit,
  type LetStmt,
  type Lifetime,
  Node,
  type OpaqueTy,
  OwnerNode,
  type OwnerId,
  type ParentedNode,
  type Param,
  type Pat,
  type PatExpr,
  type PatField,
  type PathSegment,
  type PreciseCapturingArg,
  type Stmt,
  type TestBinderBoundTypeConstraint,
  type TestBinderExists,
  type TestBinderForall,
  type TraitItem,
  type TraitItemId,
  type TraitRef,
  type Ty,
  type TyPat,
  type UseTree,
  type Variant,
  VariantData,
  type WherePredicate,
} from "../rustc_hir/lib.ts";
import { display_HirId } from "../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { CRATE_MOD_ID, type LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { panic, unreachable, unwrap } from "../std/panic.ts";

// The generated part (index.gen.ts) only re-exports the hand type `NodeCollector` below.
export * from "./index.gen.ts";

const { Visitor } = intravisit;
type InferKind = intravisit.InferKind;

/** PORT: `IndexVec` / slice `IndexMut`: an out-of-range index panics like Rust's bounds check. */
function index_set<T>(v: T[], i: number, x: T): void {
  if (i >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  v[i] = x;
}

// rustc: compiler/rustc_ast_lowering/src/index.rs:30 index_hir
export function index_hir(
  tcx: TyCtxt,
  item: OwnerNode,
  bodies: SortedMap<ItemLocalId, Body>,
  num_nodes: number,
): [ParentedNode[], Map<LocalDefId, ItemLocalId>] {
  const err_node: ParentedNode = { parent: ItemLocalId.ZERO, node: { $: "Err", _0: OwnerNode.span(item) } };
  // PORT: `IndexVec::from_elem_n(err_node, n)`: every slot is the same `Copy` value (HIR values are never edited
  // in place; `insert` replaces whole slots).
  const nodes: ParentedNode[] = new Array<ParentedNode>(num_nodes).fill(err_node);
  // This node's parent should never be accessed: the owner's parent is computed by the
  // hir_owner_parent query. Make it invalid (= ItemLocalId::MAX) to force an ICE whenever it is
  // used.
  index_set(nodes, ItemLocalId.ZERO, { parent: ItemLocalId.INVALID, node: Node.from_OwnerNode(item) });
  const collector = new NodeCollector(
    tcx,
    bodies,
    nodes,
    /* parenting */ new Map(),
    /* parent_node */ ItemLocalId.ZERO,
    /* owner */ OwnerNode.def_id(item),
  );

  switch (item.$) {
    case "Crate": {
      const citem = item._0;
      collector.visit_mod(citem, citem.spans.inner_span, CRATE_MOD_ID);
      break;
    }
    case "Item":
      collector.visit_item(item._0);
      break;
    case "TraitItem":
      collector.visit_trait_item(item._0);
      break;
    case "ImplItem":
      collector.visit_impl_item(item._0);
      break;
    case "ForeignItem":
      collector.visit_foreign_item(item._0);
      break;
    case "Synthetic":
      unreachable();
  }

  for (let local_id = 0; local_id < collector.nodes.length; local_id++) {
    const node = collector.nodes[local_id]!;
    if (node.node.$ === "Err") {
      const span = node.node._0;
      const hir_id = new HirId(OwnerNode.def_id(item), local_id as ItemLocalId);
      const msg = `ID ${display_HirId(hir_id)} not encountered when visiting item HIR`;
      tcx.dcx().span_delayed_bug(span, msg);
    }
  }

  return [collector.nodes, collector.parenting];
}

/// A visitor that walks over the HIR and collects `Node`s into a HIR map.
// rustc-type: compiler/rustc_ast_lowering/src/index.rs:14 NodeCollector
export class NodeCollector extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public bodies: SortedMap<ItemLocalId, Body>,
    /// Outputs
    public nodes: ParentedNode[],
    public parenting: Map<LocalDefId, ItemLocalId>,
    /// The parent of this node
    public parent_node: ItemLocalId,
    public owner: OwnerId,
  ) {
    super();
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:73 insert
  insert(span: Span, hir_id: HirId, node: Node): void {
    // debug_assert_eq!(self.owner, hir_id.owner);
    // debug_assert_ne!(hir_id.local_id.as_u32(), 0);
    // debug_assert_ne!(hir_id.local_id, self.parent_node);

    // Make sure that the DepNode of some node coincides with the HirId
    // owner of that node.
    // PORT: `if cfg!(debug_assertions) { .. }` is `if false` in the oracle (a release build without
    // debug_assertions), so its body (two `span_bug!` consistency checks) is kept as a comment:
    // if cfg!(debug_assertions) {
    //     if hir_id.owner != self.owner {
    //         span_bug!(
    //             span,
    //             "inconsistent HirId at `{:?}` for `{node:?}`: \
    //              current_dep_node_owner={} ({:?}), hir_id.owner={} ({:?})",
    //             self.tcx.sess.source_map().span_to_diagnostic_string(span),
    //             self.tcx
    //                 .definitions_untracked()
    //                 .def_path(self.owner.def_id)
    //                 .to_string_no_crate_verbose(),
    //             self.owner,
    //             self.tcx
    //                 .definitions_untracked()
    //                 .def_path(hir_id.owner.def_id)
    //                 .to_string_no_crate_verbose(),
    //             hir_id.owner,
    //         )
    //     }
    //     if self.tcx.sess.opts.incremental.is_some()
    //         && span.parent().is_none()
    //         && !span.is_dummy()
    //     {
    //         span_bug!(span, "span without a parent: {:#?}, {node:?}", span.data())
    //     }
    // }
    void span;

    index_set(this.nodes, hir_id.local_id, { parent: this.parent_node, node });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:110 with_parent
  with_parent(parent_node_id: HirId, f: (this_: NodeCollector) => void): void {
    // debug_assert_eq!(parent_node_id.owner, self.owner);
    const parent_node = this.parent_node;
    this.parent_node = parent_node_id.local_id;
    f(this);
    this.parent_node = parent_node;
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:118 insert_nested
  insert_nested(item: LocalDefId): void {
    if (this.parent_node !== ItemLocalId.ZERO) {
      this.parenting.set(item, this.parent_node);
    }
  }

  // impl<'a, 'hir> Visitor<'hir> for NodeCollector<'a, 'hir>
  // Because we want to track parent items and so forth, enable
  // deep walking so that we walk nested items in the context of
  // their outer items.

  // rustc: compiler/rustc_ast_lowering/src/index.rs:130 visit_nested_item
  override visit_nested_item(item: ItemId): undefined {
    // debug!("visit_nested_item: {:?}", item);
    this.insert_nested(item.owner_id.def_id);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:135 visit_nested_trait_item
  override visit_nested_trait_item(item_id: TraitItemId): undefined {
    this.insert_nested(item_id.owner_id.def_id);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:139 visit_nested_impl_item
  override visit_nested_impl_item(item_id: ImplItemId): undefined {
    this.insert_nested(item_id.owner_id.def_id);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:143 visit_nested_foreign_item
  override visit_nested_foreign_item(foreign_id: ForeignItemId): undefined {
    this.insert_nested(foreign_id.owner_id.def_id);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:147 visit_nested_body
  override visit_nested_body(id: BodyId): undefined {
    // debug_assert_eq!(id.hir_id.owner, self.owner);
    // PORT: `self.bodies[&id.hir_id.local_id]` (`impl Index for SortedMap`, sorted_map.rs:324).
    const body = unwrap(this.bodies.get(id.hir_id.local_id), "no entry found for key");
    this.visit_body(body);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:153 visit_use
  override visit_use(tree: UseTree, hir_id: HirId, _def_id: LocalDefId): undefined {
    if (!hir_id.is_owner()) {
      this.insert(tree.prefix.span, hir_id, { $: "NestedUseTree", _0: tree });
    }
    intravisit.walk_use(this, tree, hir_id);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:160 visit_param
  override visit_param(param: Param): undefined {
    const node: Node = { $: "Param", _0: param };
    this.insert(param.pat.span, param.hir_id, node);
    this.with_parent(param.hir_id, (this_) => {
      intravisit.walk_param(this_, param);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:169 visit_item
  override visit_item(i: Item): undefined {
    // debug_assert_eq!(i.owner_id, self.owner);
    this.with_parent(i.hir_id(), (this_) => {
      if (i.kind.$ === "Struct") {
        const struct_def = i.kind._2;
        // If this is a tuple or unit-like struct, register the constructor.
        const ctor_hir_id = VariantData.ctor_hir_id(struct_def);
        if (ctor_hir_id !== undefined) {
          this_.insert(i.span, ctor_hir_id, { $: "Ctor", _0: struct_def });
        }
      }
      intravisit.walk_item(this_, i);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:183 visit_foreign_item
  override visit_foreign_item(fi: ForeignItem): undefined {
    // debug_assert_eq!(fi.owner_id, self.owner);
    this.with_parent(fi.hir_id(), (this_) => {
      intravisit.walk_foreign_item(this_, fi);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:190 visit_generic_param
  override visit_generic_param(param: GenericParam): undefined {
    this.insert(param.span, param.hir_id, { $: "GenericParam", _0: param });
    intravisit.walk_generic_param(this, param);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:195 visit_const_param_default
  override visit_const_param_default(param: HirId, ct: ConstArg): undefined {
    this.with_parent(param, (this_) => {
      intravisit.walk_const_param_default(this_, ct);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:202 visit_trait_item
  override visit_trait_item(ti: TraitItem): undefined {
    // debug_assert_eq!(ti.owner_id, self.owner);
    this.with_parent(ti.hir_id(), (this_) => {
      intravisit.walk_trait_item(this_, ti);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:210 visit_impl_item
  override visit_impl_item(ii: ImplItem): undefined {
    // debug_assert_eq!(ii.owner_id, self.owner);
    this.with_parent(ii.hir_id(), (this_) => {
      intravisit.walk_impl_item(this_, ii);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:217 visit_pat
  override visit_pat(pat: Pat): undefined {
    this.insert(pat.span, pat.hir_id, { $: "Pat", _0: pat });

    this.with_parent(pat.hir_id, (this_) => {
      intravisit.walk_pat(this_, pat);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:225 visit_pat_expr
  override visit_pat_expr(expr: PatExpr): undefined {
    this.insert(expr.span, expr.hir_id, { $: "PatExpr", _0: expr });

    this.with_parent(expr.hir_id, (this_) => {
      intravisit.walk_pat_expr(this_, expr);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:233 visit_pat_field
  override visit_pat_field(field: PatField): undefined {
    this.insert(field.span, field.hir_id, { $: "PatField", _0: field });
    this.with_parent(field.hir_id, (this_) => {
      intravisit.walk_pat_field(this_, field);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:240 visit_arm
  override visit_arm(arm: Arm): undefined {
    const node: Node = { $: "Arm", _0: arm };

    this.insert(arm.span, arm.hir_id, node);

    this.with_parent(arm.hir_id, (this_) => {
      intravisit.walk_arm(this_, arm);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:250 visit_opaque_ty
  override visit_opaque_ty(opaq: OpaqueTy): undefined {
    this.insert(opaq.span, opaq.hir_id, { $: "OpaqueTy", _0: opaq });

    this.with_parent(opaq.hir_id, (this_) => {
      intravisit.walk_opaque_ty(this_, opaq);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:258 visit_anon_const
  override visit_anon_const(constant: AnonConst): undefined {
    this.insert(constant.span, constant.hir_id, { $: "AnonConst", _0: constant });

    this.with_parent(constant.hir_id, (this_) => {
      intravisit.walk_anon_const(this_, constant);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:266 visit_inline_const
  override visit_inline_const(constant: ConstBlock): undefined {
    this.insert(DUMMY_SP, constant.hir_id, { $: "ConstBlock", _0: constant });

    this.with_parent(constant.hir_id, (this_) => {
      intravisit.walk_inline_const(this_, constant);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:274 visit_expr
  override visit_expr(expr: Expr): undefined {
    this.insert(expr.span, expr.hir_id, { $: "Expr", _0: expr });

    this.with_parent(expr.hir_id, (this_) => {
      intravisit.walk_expr(this_, expr);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:282 visit_expr_field
  override visit_expr_field(field: ExprField): undefined {
    this.insert(field.span, field.hir_id, { $: "ExprField", _0: field });
    this.with_parent(field.hir_id, (this_) => {
      intravisit.walk_expr_field(this_, field);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:289 visit_const_arg_expr_field
  override visit_const_arg_expr_field(field: ConstArgExprField): undefined {
    this.insert(field.span, field.hir_id, { $: "ConstArgExprField", _0: field });
    this.with_parent(field.hir_id, (this_) => {
      intravisit.walk_const_arg_expr_field(this_, field);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:296 visit_stmt
  override visit_stmt(stmt: Stmt): undefined {
    this.insert(stmt.span, stmt.hir_id, { $: "Stmt", _0: stmt });

    this.with_parent(stmt.hir_id, (this_) => {
      intravisit.walk_stmt(this_, stmt);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:304 visit_path_segment
  override visit_path_segment(path_segment: PathSegment): undefined {
    // FIXME: walk path segment with `path_segment.hir_id` parent.
    this.insert(path_segment.ident.span, path_segment.hir_id, { $: "PathSegment", _0: path_segment });
    intravisit.walk_path_segment(this, path_segment);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:310 visit_ty
  override visit_ty(ty: Ty<AmbigArg>): undefined {
    this.insert(ty.span, ty.hir_id, { $: "Ty", _0: ty.as_unambig_ty() });

    this.with_parent(ty.hir_id, (this_) => {
      intravisit.walk_ty(this_, ty);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:318 visit_const_arg
  override visit_const_arg(const_arg: ConstArg<AmbigArg>): undefined {
    this.insert(const_arg.as_unambig_ct().span, const_arg.hir_id, { $: "ConstArg", _0: const_arg.as_unambig_ct() });

    this.with_parent(const_arg.hir_id, (this_) => {
      intravisit.walk_const_arg(this_, const_arg);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:330 visit_infer
  override visit_infer(inf_id: HirId, inf_span: Span, kind: InferKind): undefined {
    switch (kind.$) {
      case "Ty":
        this.insert(inf_span, inf_id, { $: "Ty", _0: kind._0 });
        break;
      case "Const":
        this.insert(inf_span, inf_id, { $: "ConstArg", _0: kind._0 });
        break;
      case "Ambig":
        this.insert(inf_span, inf_id, { $: "Infer", _0: kind._0 });
        break;
    }

    this.visit_id(inf_id);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:345 visit_trait_ref
  override visit_trait_ref(tr: TraitRef): undefined {
    this.insert(tr.path.span, tr.hir_ref_id, { $: "TraitRef", _0: tr });

    this.with_parent(tr.hir_ref_id, (this_) => {
      intravisit.walk_trait_ref(this_, tr);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:353 visit_block
  override visit_block(block: Block): undefined {
    this.insert(block.span, block.hir_id, { $: "Block", _0: block });
    this.with_parent(block.hir_id, (this_) => {
      intravisit.walk_block(this_, block);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:360 visit_local
  override visit_local(l: LetStmt): undefined {
    this.insert(l.span, l.hir_id, { $: "LetStmt", _0: l });
    this.with_parent(l.hir_id, (this_) => {
      intravisit.walk_local(this_, l);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:367 visit_lifetime
  override visit_lifetime(lifetime: Lifetime): undefined {
    this.insert(lifetime.ident.span, lifetime.hir_id, { $: "Lifetime", _0: lifetime });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:371 visit_variant
  override visit_variant(v: Variant): undefined {
    this.insert(v.span, v.hir_id, { $: "Variant", _0: v });
    this.with_parent(v.hir_id, (this_) => {
      // Register the constructor of this variant.
      const ctor_hir_id = VariantData.ctor_hir_id(v.data);
      if (ctor_hir_id !== undefined) {
        this_.insert(v.span, ctor_hir_id, { $: "Ctor", _0: v.data });
      }
      intravisit.walk_variant(this_, v);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:382 visit_field_def
  override visit_field_def(field: FieldDef): undefined {
    this.insert(field.span, field.hir_id, { $: "Field", _0: field });
    this.with_parent(field.hir_id, (this_) => {
      intravisit.walk_field_def(this_, field);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:389 visit_assoc_item_constraint
  override visit_assoc_item_constraint(constraint: AssocItemConstraint): undefined {
    this.insert(constraint.span, constraint.hir_id, { $: "AssocItemConstraint", _0: constraint });
    this.with_parent(constraint.hir_id, (this_) => {
      intravisit.walk_assoc_item_constraint(this_, constraint);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:396 visit_trait_item_ref
  override visit_trait_item_ref(id: TraitItemId): undefined {
    this.visit_nested_trait_item(id);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:400 visit_impl_item_ref
  override visit_impl_item_ref(id: ImplItemId): undefined {
    this.visit_nested_impl_item(id);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:404 visit_foreign_item_ref
  override visit_foreign_item_ref(id: ForeignItemId): undefined {
    this.visit_nested_foreign_item(id);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:408 visit_where_predicate
  override visit_where_predicate(predicate: WherePredicate): undefined {
    this.insert(predicate.span, predicate.hir_id, { $: "WherePredicate", _0: predicate });
    this.with_parent(predicate.hir_id, (this_) => {
      intravisit.walk_where_predicate(this_, predicate);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:415 visit_pattern_type_pattern
  override visit_pattern_type_pattern(pat: TyPat): undefined {
    this.insert(pat.span, pat.hir_id, { $: "TyPat", _0: pat });

    this.with_parent(pat.hir_id, (this_) => {
      intravisit.walk_ty_pat(this_, pat);
    });
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:423 visit_precise_capturing_arg
  override visit_precise_capturing_arg(arg: PreciseCapturingArg): undefined {
    switch (arg.$) {
      case "Lifetime":
        // This is represented as a `Node::Lifetime`, intravisit will get to it below.
        break;
      case "Param": {
        const param = arg._0;
        this.insert(param.ident.span, param.hir_id, { $: "PreciseCapturingNonLifetimeArg", _0: param });
        break;
      }
    }
    intravisit.walk_precise_capturing_arg(this, arg);
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:440 visit_test_binder_forall
  override visit_test_binder_forall(forall: TestBinderForall): undefined {
    this.insert(forall.span, forall.hir_id, { $: "TestBinderForall", _0: forall });
    this.with_parent(forall.hir_id, (this_) => intravisit.walk_test_binder_forall(this_, forall));
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:445 visit_test_binder_exists
  override visit_test_binder_exists(exists: TestBinderExists): undefined {
    this.insert(exists.span, exists.hir_id, { $: "TestBinderExists", _0: exists });
    this.with_parent(exists.hir_id, (this_) => intravisit.walk_test_binder_exists(this_, exists));
  }

  // rustc: compiler/rustc_ast_lowering/src/index.rs:450 visit_test_binder_bound_type_constraint
  override visit_test_binder_bound_type_constraint(bound_type: TestBinderBoundTypeConstraint): undefined {
    this.insert(bound_type.span, bound_type.hir_id, { $: "TestBinderBoundTypeConstraint", _0: bound_type });
    this.with_parent(bound_type.hir_id, (this_) => {
      intravisit.walk_test_binder_bound_type_constraint(this_, bound_type);
    });
  }
}
