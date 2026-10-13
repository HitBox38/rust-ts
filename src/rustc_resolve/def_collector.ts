// Port of compiler/rustc_resolve/src/def_collector.rs
//
// `DefCollector` (the class, its fields) lives in ./decls.ts (the contract, docs/handoff/res-lib.md): its
// `impl` blocks are split over def_collector.rs and build_reduced_graph.rs. This file assigns the
// def_collector.rs methods and the `impl Visitor` overrides onto `DefCollector.prototype`.
// Init order: top-level code here touches only `./decls.ts` and other crates; other rustc_resolve
// modules' exports are read inside function bodies only.
//
// PORT: `InvocationParent` and `ParentScope` are `Copy`; where upstream copies one into storage or into a
// new struct, the port copies it (`clone_InvocationParent` / `clone_ParentScope`), because the visitor
// edits its own `invocation_parent` / `parent_scope` in place.
import {
  type AnonConst,
  type Arm,
  type AssocItem,
  type AttrVec,
  type Attribute,
  type Block,
  type Crate,
  type Expr,
  type ExprField,
  type FieldDef,
  type ForeignItem,
  type GenericParam,
  type InlineAsm,
  type Item,
  ItemKind,
  type Param,
  type Pat,
  type PatField,
  type Stmt,
  type Ty,
  type Variant,
  type VariantData as VariantDataT,
  type WherePredicate,
  VariantData,
} from "../rustc_ast/lib.ts";
import { debug_NodeId, NodeId } from "../rustc_ast/node_id.ts";
import {
  type AssocCtxt,
  type FnKind,
  walk_anon_const,
  walk_arm,
  walk_attribute,
  walk_expr,
  walk_expr_field,
  walk_fn,
  walk_fn_decl,
  walk_generic_param,
  walk_item,
  walk_local,
  walk_param,
  walk_pat,
  walk_pat_field,
  walk_stmt,
  walk_ty,
  walk_where_predicate,
  WalkItemKind,
} from "../rustc_ast/visit.ts";
import { Target } from "../rustc_attr_ir/target.ts";
import { AttributeParser, is_builtin_attr, ShouldEmit } from "../rustc_attr_parsing/lib.ts";
import type { SyntaxExtension } from "../rustc_expand/base.ts";
import { expand } from "../rustc_expand/lib.ts";
import type { AstFragment } from "../rustc_expand/expand.ts";
import { DefKind, type Namespace } from "../rustc_hir/def.ts";
import type { Safety as HirSafety } from "../rustc_hir/def.ts";
import type { RegisteredTools } from "../rustc_lint_defs/lib.ts";
import { PerOwnerResolverData } from "../rustc_middle/middle/resolve.ts";
import type { TyCtxtFeed } from "../rustc_middle/ty/context.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";
import { LocalExpnId } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { type Ident, sym, type Symbol } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, assert_eq, panic, unreachable } from "../std/panic.ts";
import { DefCollector, Resolver } from "./decls.ts";
import { clone_InvocationParent, type ImplTraitContext } from "./lib.gen.ts";
import type { ParentScope } from "./lib.ts";
import type { MacroRulesScopeRef } from "./macros.ts";
import * as lib from "./lib.ts";

export * from "./def_collector.gen.ts";
export { DefCollector };

/** `map[&key]` (`impl Index for HashMap`): panics when the key is absent. */
function index_map<K, V>(map: Map<K, V>, key: K): V {
  const v = map.get(key);
  if (v === undefined && !map.has(key)) return panic("key not found");
  return v as V;
}

// rustc: compiler/rustc_resolve/src/def_collector.rs:22 collect_definitions
export function collect_definitions(resolver: Resolver, fragment: AstFragment, parent_scope: ParentScope): MacroRulesScopeRef {
  const invocation_parent = clone_InvocationParent(index_map(resolver.invocation_parents, parent_scope.expansion));
  // debug!("new fragment to visit with invocation_parent: {invocation_parent:?}");
  // debug_assert_eq!(resolver.current_owner.id, DUMMY_NODE_ID);
  return lib.with_owner(resolver, invocation_parent.owner, (r) => {
    const visitor = new DefCollector(r, invocation_parent, parent_scope);
    expand.AstFragment.visit_with(fragment, visitor);
    return visitor.parent_scope.macro_rules;
  });
}

// impl<'a, 'ra, 'tcx> DefCollector<'a, 'ra, 'tcx>

// rustc: compiler/rustc_resolve/src/def_collector.rs:45 create_def
DefCollector.prototype.create_def = function (
  this: DefCollector,
  node_id: NodeId,
  name: Symbol | undefined,
  def_kind: DefKind,
  span: Span,
): TyCtxtFeed<LocalDefId> {
  const parent_def = this.invocation_parent.parent_def;
  // debug!("create_def(node_id={:?}, def_kind={:?}, parent_def={:?})", node_id, def_kind, parent_def);
  return this.r.create_def(
    parent_def,
    node_id,
    name,
    def_kind,
    LocalExpnId.to_expn_id(this.parent_scope.expansion),
    Span.with_parent(span, undefined),
    false,
  );
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:68 with_parent
DefCollector.prototype.with_parent = function (this: DefCollector, parent_def: LocalDefId, f: (this_: DefCollector) => void): void {
  const orig_parent_def = this.invocation_parent.parent_def;
  this.invocation_parent.parent_def = parent_def;
  f(this);
  this.invocation_parent.parent_def = orig_parent_def;
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:74 with_owner
DefCollector.prototype.with_owner = function (
  this: DefCollector,
  owner: NodeId,
  name: Symbol | undefined,
  def_kind: DefKind,
  span: Span,
  f: (this_: DefCollector, _1: TyCtxtFeed<LocalDefId>) => void,
): void {
  // debug_assert_ne!(owner, DUMMY_NODE_ID);
  // debug_assert_ne!(owner, CRATE_NODE_ID);
  // We only get here if the owner didn't exist yet. After the owner has been created,
  // future invocations of `collect_definitions` will get the owner out of the `owners`
  // table.
  const parent_def = this.invocation_parent.parent_def;
  const feed = this.r.create_def(
    parent_def,
    owner,
    name,
    def_kind,
    LocalExpnId.to_expn_id(this.parent_scope.expansion),
    Span.with_parent(span, undefined),
    true,
  );
  const tables = PerOwnerResolverData.new(owner, feed.key());

  const orig_invoc_owner = this.invocation_parent.owner;
  this.invocation_parent.owner = owner;
  lib.with_owner_tables(this, owner, tables, (this_) => f(this_, feed));
  const old = this.invocation_parent.owner;
  this.invocation_parent.owner = orig_invoc_owner;
  assert_eq(old, owner, (v) => debug_NodeId(v, PLAIN));
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:105 with_impl_trait
DefCollector.prototype.with_impl_trait = function (this: DefCollector, impl_trait_context: ImplTraitContext, f: (this_: DefCollector) => void): void {
  const orig_itc = this.invocation_parent.impl_trait_context;
  this.invocation_parent.impl_trait_context = impl_trait_context;
  f(this);
  this.invocation_parent.impl_trait_context = orig_itc;
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:116 collect_field
DefCollector.prototype.collect_field = function (this: DefCollector, field: FieldDef, index_: number | undefined): void {
  const index = (this_: DefCollector): number => {
    if (index_ !== undefined) return index_;
    const node_id = NodeId.placeholder_from_expn_id(this_.parent_scope.expansion);
    return index_map(this_.r.placeholder_field_indices, node_id);
  };

  if (field.is_placeholder) {
    const value = index(this);
    const had_old_index = this.r.placeholder_field_indices.has(field.id);
    this.r.placeholder_field_indices.set(field.id, value);
    assert(!had_old_index, "placeholder field index is reset for a node ID");
    this.visit_macro_invoc(field.id);
    this.visit_invoc(field.id);
  } else {
    const name = field.ident === undefined ? sym.integer(index(this)) : field.ident.name;
    const def = this.create_def(field.id, name, DefKind.Field, field.span);
    this.with_parent(def.def_id(), (this_) => this_.brg_visit_field_def(field, def));
  }
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/def_collector.rs:137 visit_macro_invoc
DefCollector.prototype.visit_macro_invoc = function (this: DefCollector, id_: NodeId): void {
  // debug!(?self.invocation_parent);

  const id = NodeId.placeholder_to_expn_id(id_);
  const had_old_parent = this.r.invocation_parents.has(id);
  this.r.invocation_parents.set(id, clone_InvocationParent(this.invocation_parent));
  assert(!had_old_parent, "parent `LocalDefId` is reset for an invocation");
};

// impl<'a, 'ra, 'tcx> visit::Visitor<'a> for DefCollector<'a, 'ra, 'tcx>

// rustc: compiler/rustc_resolve/src/def_collector.rs:147 visit_item
DefCollector.prototype.visit_item = function (this: DefCollector, i: Item): undefined {
  // Pick the def data. This need not be unique, but the more
  // information we encapsulate into, the better
  let opt_syn_ext: SyntaxExtension | undefined = undefined;
  let def_kind: DefKind;
  const kind = i.kind;
  switch (kind.$) {
    case "Impl":
      def_kind = { $: "Impl", of_trait: kind._0.of_trait !== undefined };
      break;
    case "ForeignMod":
      def_kind = DefKind.ForeignMod;
      break;
    case "Mod":
      def_kind = DefKind.Mod;
      break;
    case "Trait":
      def_kind = DefKind.Trait;
      break;
    case "TraitAlias":
      def_kind = DefKind.TraitAlias;
      break;
    case "Enum":
      def_kind = DefKind.Enum;
      break;
    case "Struct":
      def_kind = DefKind.Struct;
      break;
    case "Union":
      def_kind = DefKind.Union;
      break;
    case "ExternCrate":
      def_kind = DefKind.ExternCrate;
      break;
    case "TyAlias":
      def_kind = DefKind.TyAlias;
      break;
    case "Static": {
      const s = kind._0;
      def_kind = {
        $: "Static",
        safety: "Safe" satisfies HirSafety,
        mutability: s.mutability,
        nested: false,
      };
      break;
    }
    case "Const":
      def_kind = DefKind.Const;
      break;
    case "ConstBlock":
      def_kind = DefKind.Const;
      break;
    case "Fn":
    case "Delegation":
      def_kind = DefKind.Fn;
      break;
    case "MacroDef": {
      const ident = kind._0;
      const def = kind._1;
      const edition = Span.edition(i.span);

      // FIXME(jdonszelmann) make one of these in the resolver?
      // FIXME(jdonszelmann) don't care about tools here maybe? Just parse what we can.
      // Does that prevents errors from happening? maybe
      const parser = AttributeParser.new(
        this.r.tcx_.sess,
        this.r.features,
        this.r.tcx().registered_attr_tools(null) as RegisteredTools,
        ShouldEmit.Nothing,
      );
      const attrs = parser.parse_attribute_list(
        i.attrs,
        i.span,
        Target.MacroDef,
        undefined,
        (span) => span, // `std::convert::identity`
        (_lint_id, _span, _kind) => {
          // FIXME(jdonszelmann): emit lints here properly
          // NOTE that before new attribute parsing, they didn't happen either
          // but it would be nice if we could change that.
        },
      );

      const ext = this.r.compile_macro(def, ident, attrs, i.span, i.id, edition);
      const macro_kinds = ext.macro_kinds();
      opt_syn_ext = ext;
      def_kind = { $: "Macro", _0: macro_kinds };
      break;
    }
    case "GlobalAsm":
      def_kind = DefKind.GlobalAsm;
      break;
    case "Use": {
      this.with_owner(i.id, undefined, DefKind.Use, i.span, (this_, feed) => {
        this_.with_parent(feed.def_id(), (this_) => {
          this_.brg_visit_item(i, feed);
        });
      });
      return;
    }
    case "MacCall": {
      this.visit_macro_invoc(i.id);
      this.brg_visit_mac_call_in_module(i.id);
      return;
    }
    case "DelegationMac":
      return unreachable();
    case "TestBinderConstraints":
      def_kind = DefKind.TestBinderConstraints;
      break;
  }
  const ident = ItemKind.ident(i.kind);
  this.with_owner(i.id, ident === undefined ? undefined : ident.name, def_kind, i.span, (this_, feed) => {
    if (opt_syn_ext !== undefined) {
      const ext = opt_syn_ext;
      this_.r.local_macro_map.set(feed.def_id(), this_.r.arenas.alloc_macro(ext));
    }

    this_.with_parent(feed.def_id(), (this_) => {
      this_.with_impl_trait("Existential", (this_) => {
        this_.brg_visit_item(i, feed);
      });
    });
  });
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:235 visit_block
DefCollector.prototype.visit_block = function (this: DefCollector, block: Block): undefined {
  this.brg_visit_block(block);
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:239 visit_fn
DefCollector.prototype.visit_fn = function (this: DefCollector, fn_kind: FnKind, _1: AttrVec, span: Span, _3: NodeId): undefined {
  if (
    fn_kind.$ === "Fn" &&
    fn_kind._2.sig.header.coroutine_marker !== undefined &&
    // Foreign ones are denied, so don't create them here.
    fn_kind._0.$ !== "Foreign"
  ) {
    const { sig, ident, generics, contract, body } = fn_kind._2;
    const { header, decl } = sig;
    const coroutine_marker = header.coroutine_marker!;
    this.visit_ident(ident);
    this.visit_fn_header(header);
    this.visit_generics(generics);
    if (contract !== undefined) {
      this.visit_contract(contract);
    }

    // For async functions, we need to create their inner defs inside of a
    // closure to match their desugared representation. Besides that,
    // we must mirror everything that `visit::walk_fn` below does.
    const { inputs, output } = decl;
    for (const param of inputs) {
      this.visit_param(param);
    }

    const return_def = this.create_def(coroutine_marker.return_impl_trait_id, undefined, DefKind.OpaqueTy, coroutine_marker.span).def_id();
    this.with_parent(return_def, (this_) => this_.visit_fn_ret_ty(output));

    // If this async fn has no body (i.e. it's an async fn signature in a trait)
    // then the closure_def will never be used, and we should avoid generating a
    // def-id for it.
    if (body !== undefined) {
      const closure_def = this.create_def(coroutine_marker.closure_id, undefined, DefKind.Closure, span).def_id();
      this.with_parent(closure_def, (this_) => this_.visit_block(body));
    }
  } else if (fn_kind.$ === "Closure" && fn_kind._1 !== undefined) {
    const binder = fn_kind._0;
    const coroutine_marker = fn_kind._1;
    const decl = fn_kind._2;
    const body = fn_kind._3;
    this.visit_closure_binder(binder);
    walk_fn_decl(this, decl);

    // Async closures desugar to closures inside of closures, so
    // we must create two defs.
    const coroutine_def = this.create_def(coroutine_marker.closure_id, undefined, DefKind.Closure, span).def_id();
    this.with_parent(coroutine_def, (this_) => this_.visit_expr(body));
  } else {
    walk_fn(this, fn_kind);
  }
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:301 visit_foreign_item
DefCollector.prototype.visit_foreign_item = function (this: DefCollector, fi: ForeignItem): undefined {
  let ident: Ident;
  let def_kind: DefKind;
  const kind = fi.kind;
  switch (kind.$) {
    case "Static": {
      const { ident: ident_, mutability, safety: ast_safety } = kind._0;
      const safety: HirSafety = ast_safety.$ === "Unsafe" || ast_safety.$ === "Default" ? "Unsafe" : "Safe";

      [ident, def_kind] = [ident_, { $: "Static", safety, mutability, nested: false }];
      break;
    }
    case "Fn":
      [ident, def_kind] = [kind._0.ident, DefKind.Fn];
      break;
    case "TyAlias":
      [ident, def_kind] = [kind._0.ident, DefKind.ForeignTy];
      break;
    case "MacCall":
      this.visit_invoc_in_module(fi.id);
      this.visit_macro_invoc(fi.id);
      return;
  }

  this.with_owner(fi.id, ident.name, def_kind, fi.span, (this_, def) => {
    this_.with_parent(def.def_id(), (this_) => {
      this_.build_reduced_graph_for_foreign_item(fi, ident, def);
      walk_item(this_, fi, WalkItemKind.ForeignItemKind);
    });
  });
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:336 visit_variant
DefCollector.prototype.visit_variant = function (this: DefCollector, v: Variant): undefined {
  if (v.is_placeholder) {
    this.visit_macro_invoc(v.id);
    this.visit_invoc_in_module(v.id);
    return;
  }
  const feed = this.create_def(v.id, v.ident.name, DefKind.Variant, v.span);
  this.with_parent(feed.def_id(), (this_) => this_.brg_visit_variant(v, feed));
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:346 visit_where_predicate
DefCollector.prototype.visit_where_predicate = function (this: DefCollector, pred: WherePredicate): undefined {
  if (pred.is_placeholder) {
    this.visit_macro_invoc(pred.id);
    this.visit_invoc(pred.id);
  } else {
    walk_where_predicate(this, pred);
  }
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:355 visit_variant_data
DefCollector.prototype.visit_variant_data = function (this: DefCollector, data: VariantDataT): undefined {
  // The assumption here is that non-`cfg` macro expansion cannot change field indices.
  // It currently holds because only inert attributes are accepted on fields,
  // and every such attribute expands into a single field after it's resolved.
  const fields = VariantData.fields(data);
  for (let index = 0; index < fields.length; index++) {
    this.collect_field(fields[index]!, index);
  }
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:364 visit_generic_param
DefCollector.prototype.visit_generic_param = function (this: DefCollector, param: GenericParam): undefined {
  if (param.is_placeholder) {
    this.visit_macro_invoc(param.id);
    this.visit_invoc(param.id);
    return;
  }
  let def_kind: DefKind;
  switch (param.kind.$) {
    case "Lifetime":
      def_kind = DefKind.LifetimeParam;
      break;
    case "Type":
      def_kind = DefKind.TyParam;
      break;
    case "Const":
      def_kind = DefKind.ConstParam;
      break;
  }
  this.create_def(param.id, param.ident.name, def_kind, param.ident.span);

  // impl-Trait can happen inside generic parameters, like
  // ```
  // fn foo<U: Iterator<Item = impl Clone>>() {}
  // ```
  //
  // In that case, the impl-trait is lowered as an additional generic parameter.
  this.with_impl_trait("Universal", (this_) => {
    walk_generic_param(this_, param);
  });
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:388 visit_assoc_item
DefCollector.prototype.visit_assoc_item = function (this: DefCollector, i: AssocItem, ctxt: AssocCtxt): undefined {
  let ident: Ident;
  let def_kind: DefKind;
  let ns: Namespace;
  const kind = i.kind;
  switch (kind.$) {
    case "Fn":
    case "Delegation":
      [ident, def_kind, ns] = [kind._0.ident, DefKind.AssocFn, "ValueNS"];
      break;
    case "Const":
      [ident, def_kind, ns] = [kind._0.ident, DefKind.AssocConst, "ValueNS"];
      break;
    case "Type":
      [ident, def_kind, ns] = [kind._0.ident, DefKind.AssocTy, "TypeNS"];
      break;
    case "MacCall":
      this.visit_macro_invoc(i.id);
      this.visit_assoc_item_mac_call(i, ctxt);
      return;
    case "DelegationMac":
      return span_bug(i.span, "degation mac invoc should have already been handled");
  }

  this.with_owner(i.id, ident.name, def_kind, i.span, (this_, feed) => {
    this_.with_parent(feed.def_id(), (this_) => {
      this_.brg_visit_assoc_item(i, ctxt, ident, ns, feed);
    });
  });
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:413 visit_pat
DefCollector.prototype.visit_pat = function (this: DefCollector, pat: Pat): undefined {
  switch (pat.kind.$) {
    case "MacCall":
      this.visit_macro_invoc(pat.id);
      this.visit_invoc(pat.id);
      break;
    default:
      walk_pat(this, pat);
  }
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:423 visit_anon_const
DefCollector.prototype.visit_anon_const = function (this: DefCollector, constant: AnonConst): undefined {
  const parent = this.create_def(constant.id, undefined, DefKind.AnonConst, constant.value.span).def_id();
  this.with_parent(parent, (this_) => walk_anon_const(this_, constant));
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_resolve/src/def_collector.rs:430 visit_expr
DefCollector.prototype.visit_expr = function (this: DefCollector, expr: Expr): undefined {
  // debug!(?self.invocation_parent);

  switch (expr.kind.$) {
    case "MacCall":
      this.visit_macro_invoc(expr.id);
      this.visit_invoc(expr.id);
      break;
    case "Closure":
    case "Gen": {
      const def = this.create_def(expr.id, undefined, DefKind.Closure, expr.span).def_id();
      this.with_parent(def, (this_) => walk_expr(this_, expr));
      break;
    }
    default:
      walk_expr(this, expr);
  }
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:446 visit_ty
DefCollector.prototype.visit_ty = function (this: DefCollector, ty: Ty): undefined {
  const kind = ty.kind;
  switch (kind.$) {
    case "MacCall":
      this.visit_macro_invoc(ty.id);
      this.visit_invoc(ty.id);
      break;
    case "ImplTrait": {
      const opaque_id = kind._0;
      const name = this.r.impl_trait_names.get(ty.id) ?? span_bug(ty.span, "expected this opaque to be named");
      let def_kind: DefKind;
      switch (this.invocation_parent.impl_trait_context) {
        case "Universal":
          def_kind = DefKind.TyParam;
          break;
        case "Existential":
          def_kind = DefKind.OpaqueTy;
          break;
        case "InBinding":
          walk_ty(this, ty);
          return;
      }
      const id = this.create_def(opaque_id, name, def_kind, ty.span).def_id();
      switch (this.invocation_parent.impl_trait_context as ImplTraitContext) {
        // Do not nest APIT, as we desugar them as `impl_trait: bounds`,
        // so the `impl_trait` node is not a parent to `bounds`.
        case "Universal":
          walk_ty(this, ty);
          break;
        case "Existential":
          this.with_parent(id, (this_) => walk_ty(this_, ty));
          break;
        case "InBinding":
          unreachable();
      }
      break;
    }
    default:
      walk_ty(this, ty);
  }
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:478 visit_stmt
DefCollector.prototype.visit_stmt = function (this: DefCollector, stmt: Stmt): undefined {
  const kind = stmt.kind;
  switch (kind.$) {
    case "MacCall":
      this.brg_visit_mac_call_in_module(stmt.id);
      this.visit_macro_invoc(stmt.id);
      break;
    // FIXME(impl_trait_in_bindings): We don't really have a good way of
    // introducing the right `ImplTraitContext` here for all the cases we
    // care about, in case we want to introduce ITIB to other positions
    // such as turbofishes (e.g. `foo::<impl Fn()>(|| {})`).
    case "Let": {
      const local = kind._0;
      this.with_impl_trait("InBinding", (this_) => {
        walk_local(this_, local);
      });
      break;
    }
    default:
      walk_stmt(this, stmt);
  }
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:495 visit_arm
DefCollector.prototype.visit_arm = function (this: DefCollector, arm: Arm): undefined {
  if (arm.is_placeholder) {
    this.visit_macro_invoc(arm.id);
    this.visit_invoc(arm.id);
  } else {
    walk_arm(this, arm);
  }
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:504 visit_expr_field
DefCollector.prototype.visit_expr_field = function (this: DefCollector, f: ExprField): undefined {
  if (f.is_placeholder) {
    this.visit_macro_invoc(f.id);
    this.visit_invoc(f.id);
  } else {
    walk_expr_field(this, f);
  }
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:513 visit_pat_field
DefCollector.prototype.visit_pat_field = function (this: DefCollector, fp: PatField): undefined {
  if (fp.is_placeholder) {
    this.visit_macro_invoc(fp.id);
    this.visit_invoc(fp.id);
  } else {
    walk_pat_field(this, fp);
  }
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:522 visit_param
DefCollector.prototype.visit_param = function (this: DefCollector, p: Param): undefined {
  if (p.is_placeholder) {
    this.visit_macro_invoc(p.id);
    this.visit_invoc(p.id);
  } else {
    this.with_impl_trait("Universal", (this_) => {
      walk_param(this_, p);
    });
  }
};

// This method is called only when we are visiting an individual field
// after expanding an attribute on it.
// rustc: compiler/rustc_resolve/src/def_collector.rs:533 visit_field_def
DefCollector.prototype.visit_field_def = function (this: DefCollector, field: FieldDef): undefined {
  this.collect_field(field, undefined);
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:537 visit_crate
DefCollector.prototype.visit_crate = function (this: DefCollector, krate: Crate): undefined {
  if (krate.is_placeholder) {
    this.visit_macro_invoc(krate.id);
    this.visit_invoc_in_module(krate.id);
  } else {
    // Visit attributes after items for backward compatibility.
    // This way they can use `macro_rules` defined later.

    // We always have an invocation parent (set in `collect_definitions`)
    // of at least the crate root, even for visiting the crate root,
    // which would then remove the crate root from the tables
    // list twice and try to insert it twice afterwards.
    // debug_assert_eq!(self.r.current_owner.id, CRATE_NODE_ID);

    // `visit::walk_list!(self, visit_item, &krate.items)`
    for (const item of krate.items) this.visit_item(item);
    // `visit::walk_list!(self, visit_attribute, &krate.attrs)`
    for (const attr of krate.attrs) this.visit_attribute(attr);
    this.contains_macro_use(krate.attrs);
  }
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:557 visit_attribute
DefCollector.prototype.visit_attribute = function (this: DefCollector, attr: Attribute): undefined {
  const orig_in_attr = this.invocation_parent.in_attr;
  this.invocation_parent.in_attr = true;
  const kind = attr.kind;
  switch (kind.$) {
    case "Normal": {
      const normal = kind._0;
      if (is_builtin_attr(normal.item)) {
        this.r.builtin_attrs.push([normal.item.path.segments[0]!.ident, lib.clone_ParentScope(this.parent_scope)]);
      }
      break;
    }
    case "Synthetic": // `CfgTrace(_) | CfgAttrTrace(_)`
      break;
    case "DocComment":
      break;
  }
  walk_attribute(this, attr);
  this.invocation_parent.in_attr = orig_in_attr;
};

// rustc: compiler/rustc_resolve/src/def_collector.rs:575 visit_inline_asm
DefCollector.prototype.visit_inline_asm = function (this: DefCollector, asm: InlineAsm): undefined {
  const {
    asm_macro: _asm_macro,
    template: _template,
    template_strs: _template_strs,
    operands,
    clobber_abis: _clobber_abis,
    options: _options,
    line_spans: _line_spans,
  } = asm;
  for (const [op, _span] of operands) {
    switch (op.$) {
      case "In":
      case "InOut":
        this.visit_expr(op.expr);
        break;
      case "Out":
        if (op.expr !== undefined) {
          this.visit_expr(op.expr);
        }
        break;
      case "SplitInOut":
        this.visit_expr(op.in_expr);
        if (op.out_expr !== undefined) {
          this.visit_expr(op.out_expr);
        }
        break;
      case "Const": {
        const anon_const = op.anon_const;
        const def = this.create_def(anon_const.id, undefined, DefKind.AnonConst, anon_const.value.span).def_id();
        this.with_parent(def, (this_) => walk_anon_const(this_, anon_const));
        break;
      }
      case "Sym":
        this.visit_inline_asm_sym(op.sym);
        break;
      case "Label":
        this.visit_block(op.block);
        break;
    }
  }
};
