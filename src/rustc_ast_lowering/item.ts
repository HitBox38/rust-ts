// Port of compiler/rustc_ast_lowering/src/item.rs (lane lower-item; see docs/handoff/lowering-contract.md
// "How to fill a stub").
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker.
// Init order: top-level code here may touch only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
//
// PORT: representation notes for the whole file.
// - Arenas are erased (contract): `self.arena.alloc(x)` is `x`, `self.arena.alloc_from_iter(it.map(f))` is the
//   eager `it.map(f)` (a fresh array, elements produced in iterator order).
// - Rust evaluates struct literal fields in source order; the generated HIR classes take their constructor
//   arguments in declaration order, so every field with a side effect (`lower_node_id`, `next_id`, lowering
//   that allocates ids or emits diagnostics) is computed into a local first, in source order.
// - The crate-local types of lib.rs (`ImplTraitContext`, `ImplTraitPosition`, `RelaxedBoundPolicy`,
//   `RelaxedBoundForbiddenReason`, `FnDeclKind`, `ParamMode`, `GenericArgsMode`, `DiscardParams`) are still
//   `unknown` aliases (codegen set rustc_ast_lowering has not run). Their values are written as PORTING §5
//   shapes: fieldless enums are string literals (`"StaticTy"`, `"Fn"`, `"Explicit"`, `"Yes"`), data enums are
//   `$`-tagged objects (`{ $: "Disallowed", _0: "StaticTy" }`, `{ $: "Universal" }`, `{ $: "Allowed", _0: map }`).
//   Likewise `ResolvingRestrictionKind` (diagnostics.rs, fieldless) is `"Impl"` / `"Mut"`.
// - `RelaxedBoundPolicy::Allowed(&mut FxIndexMap<DefId, Span>)` holds a `DefIdMap<Span>` (an insertion-ordered
//   `Map` keyed by `DefId` value, plan-m3 D5); the dedup map's values are those maps.
// - Copies of `Copy` AST values (`FnHeader`, `StrLit`, `Extern`, `Safety`, ...) passed by value into lowering
//   fns are not cloned: lowering only reads the AST. Explicit `.clone()`s are `clone_<T>`.
import {
  type AssocItem,
  AssocItemKind,
  BindingMode,
  BoundAsyncness,
  BoundConstness,
  BoundPolarity,
  CaptureBy,
  clone_DelimArgs,
  clone_GenericParam,
  clone_Generics,
  clone_PathSegment,
  clone_WherePredicate,
  type Const,
  ConstBlockItem,
  type CoroutineMarker,
  Defaultness,
  type EiiDecl,
  type EiiImpl,
  type Expr,
  type Extern,
  type FieldDef,
  type FnContract,
  type FnDecl,
  type FnHeader,
  type FnSig,
  type ForeignItem,
  type GenericBound,
  type GenericParam,
  type GenericParamKind,
  type Generics,
  type ImplRestriction,
  ImplPolarity,
  type Item,
  type ItemKind,
  type ModSpans,
  type MutRestriction,
  type NodeId,
  type Param,
  Path,
  type RestrictionKind,
  type Safety,
  type StrLit,
  type TestBinderBody,
  type TestBinderBoundTypeConstraint,
  type TestBinderConstraint,
  type TestBinderExists,
  type TestBinderForall,
  type TraitBoundModifiers,
  type TraitImplHeader,
  type UseTree,
  type Variant,
  type VariantData,
  visit,
  WhereClause,
  type WherePredicate,
  type Block,
} from "../rustc_ast/lib.ts";
import { display_ExternAbi, ExternAbi } from "../rustc_abi/extern_abi.ts";
import type * as attr_ir from "../rustc_attr_ir/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { Target } from "../rustc_attr_ir/target.ts";
import type { SortedMap } from "../rustc_data_structures/sorted_map.ts";
import { E0570, struct_span_code_err } from "../rustc_errors/lib.ts";
import { DefKind, Res } from "../rustc_hir/def.ts";
import * as hir from "../rustc_hir/lib.ts";
import { HirId_from_OwnerId, type HirId, type ItemLocalId, OwnerId, OwnerId_eq, debug_OwnerId } from "../rustc_hir_id/lib.ts";
import type { PerOwnerResolverData } from "../rustc_middle/middle/resolve.ts";
import { type DefId, DefIdMap, DefId_eq, debug_LocalDefId, LocalDefId, type LocalModId } from "../rustc_span/def_id.ts";
import { find_best_match_for_name } from "../rustc_span/edit_distance.ts";
import { DesugaringKind } from "../rustc_span/hygiene.ts";
import { DUMMY_SP, debug_Span, type ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { display_Symbol, Ident, kw, Symbol, sym } from "../rustc_span/symbol.ts";
import { debug_option, debug_tuple, debug_vec, PLAIN } from "../std/fmt.ts";
import { assert, assert_eq, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { LoweringContext } from "./decls.ts";
import type { DelegationResults } from "./delegation/mod.ts";
import * as diagnostics from "./diagnostics.ts";
import type { ResolvingRestrictionKind } from "./diagnostics.ts";
import type { DiscardParams, FnDeclKind, ImplTraitContext, RelaxedBoundPolicy } from "./lib.ts";
import { enabled_names, gate_unstable_abi } from "./stability.ts";

/**
 * PORT(decls): pending root. `DelegationResults` (delegation/mod.rs:67, lane lower-delegation) is an `unknown`
 * alias; this is its field list (`body_id`, `sig`, `ident`, `generics`).
 */
interface DelegationResultsView {
  body_id: hir.BodyId;
  sig: hir.FnSig;
  ident: Ident;
  generics: hir.Generics;
}

function delegation_results(r: DelegationResults): DelegationResultsView {
  return r as DelegationResultsView;
}

/// When we have a ty alias we *may* have two where clauses. To give the best diagnostics, we set
/// the span to the where clause that is preferred, if it exists. Otherwise, it sets the span to
/// the other where clause if it exists.
// rustc: compiler/rustc_ast_lowering/src/item.rs:30 add_ty_alias_where_clause
export function add_ty_alias_where_clause(generics: Generics, after_where_clause: WhereClause, prefer_first: boolean): void {
  generics.where_clause.predicates.push(...after_where_clause.predicates.map(clone_WherePredicate));

  let before: [boolean, Span] = [generics.where_clause.has_where_token, generics.where_clause.span];
  let after: [boolean, Span] = [after_where_clause.has_where_token, after_where_clause.span];
  if (!prefer_first) {
    [before, after] = [after, before];
  }
  [generics.where_clause.has_where_token, generics.where_clause.span] = before[0] || !after[0] ? before : after;
}

// rustc: compiler/rustc_ast_lowering/src/item.rs:47 lower_mod
LoweringContext.prototype.lower_mod = function (this: LoweringContext, items: readonly Item[], spans: ModSpans): hir.Mod {
  return {
    spans: {
      inner_span: this.lower_span(spans.inner_span),
      inject_use_span: this.lower_span(spans.inject_use_span),
    },
    item_ids: items.map((x) => this.lower_item_ref(x)),
  };
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:61 lower_item_ref
LoweringContext.prototype.lower_item_ref = function (this: LoweringContext, i: Item): hir.ItemId {
  return new hir.ItemId(this.owner_id(i.id));
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:65 lower_eii_decl
LoweringContext.prototype.lower_eii_decl = function (this: LoweringContext, id: NodeId, name: Ident, _0: EiiDecl): attr_ir.EiiDecl | undefined {
  const { foreign_item, impl_unsafe } = _0;
  const did = this.lower_path_simple_eii(id, foreign_item);
  return did === undefined
    ? undefined
    : {
        foreign_item: did,
        impl_unsafe: impl_unsafe,
        name,
      };
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:78 lower_eii_impl
LoweringContext.prototype.lower_eii_impl = function (this: LoweringContext, _0: EiiImpl): attr_ir.EiiImpl {
  const { node_id, eii_macro_path, impl_safety, span, inner_span, is_default, known_eii_macro_resolution } = _0;
  let resolution: attr_ir.EiiImplResolution;
  let foreign_item_did: DefId | undefined;
  let macro_did: DefId | undefined;
  const target = known_eii_macro_resolution;
  if (target !== undefined && (foreign_item_did = this.lower_path_simple_eii(node_id, target)) !== undefined) {
    resolution = { $: "Known", _0: foreign_item_did };
  } else if ((macro_did = this.lower_path_simple_eii(node_id, eii_macro_path)) !== undefined) {
    resolution = { $: "Macro", _0: macro_did };
  } else {
    resolution = { $: "Error", _0: this.dcx().span_delayed_bug(span, "eii never resolved without errors given") };
  }

  return {
    span: this.lower_span(span),
    inner_span: this.lower_span(inner_span),
    impl_unsafe_span: impl_safety.$ === "Unsafe" ? this.lower_span(impl_safety._0) : undefined,
    is_default: is_default,
    resolution,
  };
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:114 generate_extra_attrs_for_item_kind
LoweringContext.prototype.generate_extra_attrs_for_item_kind = function (this: LoweringContext, id: NodeId, i: ItemKind): attr_ir.Attribute[] {
  if ((i.$ === "Fn" && i._0.eii_impl === undefined) || (i.$ === "Static" && i._0.eii_impl === undefined)) {
    return [];
  } else if (i.$ === "Fn" || i.$ === "Static") {
    const eii_impl = i._0.eii_impl!;
    return [{ $: "Parsed", _0: { $: "EiiImpl", _0: this.lower_eii_impl(eii_impl) } }];
  } else if (i.$ === "MacroDef" && i._1.eii_declaration !== undefined) {
    const target = i._1.eii_declaration;
    const decl = this.lower_eii_decl(id, i._0, target);
    return decl === undefined ? [] : [{ $: "Parsed", _0: { $: "EiiDeclaration", _0: decl } }];
  } else {
    // ItemKind::ExternCrate(..) | Use(..) | Const(..) | ConstBlock(..) | Mod(..) | ForeignMod(..) |
    // GlobalAsm(..) | TyAlias(..) | Enum(..) | Struct(..) | Union(..) | Trait(..) | TraitAlias(..) |
    // Impl(..) | MacCall(..) | MacroDef(..) | Delegation(..) | DelegationMac(..) | TestBinderConstraints(..)
    return [];
  }
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:157 lower_item
LoweringContext.prototype.lower_item = function (this: LoweringContext, i: Item): hir.Item {
  const owner_id = this.curr_owner.owner_id();
  const hir_id: HirId = HirId_from_OwnerId(owner_id);
  const vis_span = this.lower_span(i.vis.span);

  const extra_hir_attributes = this.generate_extra_attrs_for_item_kind(i.id, i.kind);
  const attrs = this.lower_attrs_with_extra(hir_id, i.attrs, i.span, Target.from_ast_item(i), i, extra_hir_attributes);

  const kind = this.lower_item_kind(i.span, i.id, hir_id, attrs, vis_span, i.kind);
  const span = this.lower_span(i.span);
  const eii = find_attr(attrs, (k) => (k.$ === "EiiImpl" || k.$ === "EiiDeclaration" ? null : undefined)) !== undefined;
  const item = new hir.Item(owner_id, kind, span, vis_span, eii);
  return item;
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:183 lower_item_kind
LoweringContext.prototype.lower_item_kind = function (
  this: LoweringContext,
  span: Span,
  id: NodeId,
  hir_id: HirId,
  attrs: readonly attr_ir.Attribute[],
  vis_span: Span,
  i: ItemKind,
): hir.ItemKind {
  switch (i.$) {
    case "ExternCrate": {
      const orig_name = i._0;
      const ident = this.lower_ident(i._1);
      return { $: "ExternCrate", _0: orig_name, _1: ident };
    }
    case "Use": {
      const use_tree = i._0;
      return { $: "Use", _0: this.lower_use_tree(use_tree, id, vis_span, attrs) };
    }
    case "Static": {
      const { ident: ident_, ty: ty_, mutability: m, expr: e, define_opaque } = i._0;
      const ident = this.lower_ident(ident_);
      const ty = this.lower_ty_alloc(ty_, { $: "Disallowed", _0: "StaticTy" });
      const body_id = this.lower_const_body(span, e);
      this.lower_define_opaque(hir_id, define_opaque);
      return { $: "Static", _0: m, _1: ident, _2: ty, _3: body_id };
    }
    case "Const": {
      const { ident: ident_, generics: generics_, ty: ty_, body, define_opaque } = i._0;
      const ident = this.lower_ident(ident_);
      const [generics, [ty, rhs]] = this.lower_generics(generics_, { $: "Disallowed", _0: "Generic" }, (this_): [hir.Ty, hir.ConstItemRhs] => {
        const ty = this_.lower_ty_alloc(ty_, { $: "Disallowed", _0: "ConstTy" });
        const rhs = this_.lower_const_item_rhs(body, span);
        return [ty, rhs];
      });
      this.lower_define_opaque(hir_id, define_opaque);
      return { $: "Const", _0: ident, _1: generics, _2: ty, _3: rhs };
    }
    case "ConstBlock": {
      const { span, id, block } = i._0;
      const _0 = this.lower_ident(ConstBlockItem.IDENT);
      const _1 = hir.Generics.empty();
      const _2 = this.ty_tup(DUMMY_SP, []);
      const hir_id = this.lower_node_id(id);
      const kind: hir.ExprKind = { $: "Block", _0: this.lower_block(block, false), _1: undefined };
      const body = new hir.Expr(hir_id, kind, this.lower_span(span));
      const _3: hir.ConstItemRhs = { $: "Body", _0: this.record_body([], body) };
      return { $: "Const", _0, _1, _2, _3 };
    }
    case "Fn": {
      const {
        sig: { decl, header, span: fn_sig_span },
        ident: ident_,
        generics: generics_,
        body,
        contract,
        define_opaque,
      } = i._0;
      return this.with_new_scopes(fn_sig_span, (this_): hir.ItemKind => {
        // Note: we don't need to change the return type from `T` to
        // `impl Future<Output = T>` here because lower_body
        // only cares about the input argument patterns in the function
        // declaration (decl), not the return types.
        const coroutine_marker = header.coroutine_marker;
        const body_id = this_.lower_maybe_coroutine_body(fn_sig_span, span, hir_id, decl, coroutine_marker, body, attrs, contract);

        const itctx: ImplTraitContext = { $: "Universal" };
        const [generics, decl_] = this_.lower_generics(generics_, itctx, (this_) => {
          return this_.lower_fn_decl(decl, id, hir_id, "Fn", coroutine_marker, body === undefined ? "Yes" : "No");
        });
        const sig: hir.FnSig = {
          decl: decl_,
          header: this_.lower_fn_header(header, "Safe", attrs),
          span: this_.lower_span(fn_sig_span),
        };
        this_.lower_define_opaque(hir_id, define_opaque);
        const ident = this_.lower_ident(ident_);
        return {
          $: "Fn",
          ident,
          sig,
          generics,
          body: body_id,
          has_body: body !== undefined,
        };
      });
    }
    case "Mod": {
      const mod_kind = i._2;
      const ident = this.lower_ident(i._1);
      if (mod_kind.$ === "Loaded") {
        const [items, , spans] = [mod_kind._0, mod_kind._1, mod_kind._2];
        return { $: "Mod", _0: ident, _1: this.lower_mod(items, spans) };
      } else {
        // ModKind::Unloaded
        return panic("`mod` items should have been loaded by now");
      }
    }
    case "ForeignMod": {
      const fm = i._0;
      const abi = fm.abi === undefined ? ExternAbi.FALLBACK : this.lower_abi(fm.abi);
      return {
        $: "ForeignMod",
        abi,
        items: fm.items.map((x) => this.lower_foreign_item_ref(x)),
      };
    }
    case "GlobalAsm": {
      const asm = this.lower_inline_asm(span, i._0);
      const fake_body = this.lower_body((this_) => [[], this_.expr(span, { $: "InlineAsm", _0: asm })]);
      return { $: "GlobalAsm", asm, fake_body };
    }
    case "TyAlias": {
      const { ident: ident_, generics: generics_, after_where_clause, ty } = i._0;
      // We lower
      //
      // type Foo = impl Trait
      //
      // to
      //
      // type Foo = Foo1
      // opaque type Foo1: Trait
      const ident = this.lower_ident(ident_);
      const generics_clone = clone_Generics(generics_);
      add_ty_alias_where_clause(generics_clone, after_where_clause, true);
      const [generics, ty_] = this.lower_generics(generics_clone, { $: "Disallowed", _0: "Generic" }, (this_): hir.Ty => {
        if (ty === undefined) {
          const guar = this_.dcx().span_delayed_bug(span, "expected to lower type alias type, but it was missing");
          return this_.ty(span, { $: "Err", _0: guar });
        } else {
          return this_.lower_ty_alloc(ty, {
            $: "OpaqueTy",
            origin: {
              $: "TyAlias",
              parent: this_.curr_owner.owner.def_id,
              in_assoc_ty: false,
            },
          });
        }
      });
      return { $: "TyAlias", _0: ident, _1: generics, _2: ty_ };
    }
    case "Enum": {
      const enum_definition = i._2;
      const ident = this.lower_ident(i._0);
      const [generics, variants] = this.lower_generics(i._1, { $: "Disallowed", _0: "Generic" }, (this_) => {
        return enum_definition.variants.map((x) => this_.lower_variant(i, x));
      });
      return { $: "Enum", _0: ident, _1: generics, _2: { variants } };
    }
    case "Struct": {
      const struct_def = i._2;
      const ident = this.lower_ident(i._0);
      const [generics, struct_def_] = this.lower_generics(i._1, { $: "Disallowed", _0: "Generic" }, (this_) =>
        this_.lower_variant_data(hir_id, i, struct_def),
      );
      return { $: "Struct", _0: ident, _1: generics, _2: struct_def_ };
    }
    case "Union": {
      const vdata = i._2;
      const ident = this.lower_ident(i._0);
      const [generics, vdata_] = this.lower_generics(i._1, { $: "Disallowed", _0: "Generic" }, (this_) =>
        this_.lower_variant_data(hir_id, i, vdata),
      );
      return { $: "Union", _0: ident, _1: generics, _2: vdata_ };
    }
    case "Impl": {
      const { generics: ast_generics, of_trait, self_ty: ty, items: impl_items, constness: constness_ } = i._0;
      // Lower the "impl header" first. This ordering is important
      // for in-band lifetimes! Consider `'a` here:
      //
      //     impl Foo<'a> for u32 {
      //         fn method(&'a self) { .. }
      //     }
      //
      // Because we start by lowering the `Foo<'a> for u32`
      // part, we will add `'a` to the list of generics on
      // the impl. When we then encounter it later in the
      // method, it will not be considered an in-band
      // lifetime to be added, but rather a reference to a
      // parent lifetime.
      const itctx: ImplTraitContext = { $: "Universal" };
      const [generics, [of_trait_, lowered_ty]] = this.lower_generics(
        ast_generics,
        itctx,
        (this_): [hir.TraitImplHeader | undefined, hir.Ty] => {
          const of_trait_ = of_trait === undefined ? undefined : this_.lower_trait_impl_header(of_trait);

          const lowered_ty = this_.lower_ty_alloc(ty, { $: "Disallowed", _0: "ImplSelf" });

          return [of_trait_, lowered_ty];
        },
      );

      const new_impl_items = impl_items.map((item) => this.lower_impl_item_ref(item));

      const constness = this.lower_constness(attrs, constness_);

      return {
        $: "Impl",
        _0: {
          generics,
          of_trait: of_trait_,
          self_ty: lowered_ty,
          items: new_impl_items,
          constness,
        },
      };
    }
    case "Trait": {
      const { impl_restriction: impl_restriction_, constness: constness_, is_auto, safety: safety_, ident: ident_, generics: generics_, bounds: bounds_, items: items_ } = i._0;
      const constness = this.lower_constness(attrs, constness_);
      const impl_restriction = this.lower_impl_restriction(impl_restriction_, hir_id);
      const ident = this.lower_ident(ident_);
      const [generics, [safety, items, bounds]] = this.lower_generics(
        generics_,
        { $: "Disallowed", _0: "Generic" },
        (this_): [hir.Safety, readonly hir.TraitItemId[], hir.GenericBounds] => {
          const bounds = this_.lower_param_bounds(bounds_, { $: "Forbidden", _0: "SuperTrait" }, { $: "Disallowed", _0: "Bound" });
          const items = items_.map((item) => this_.lower_trait_item_ref(item));
          const safety = this_.lower_safety(safety_, "Safe");
          return [safety, items, bounds];
        },
      );
      return {
        $: "Trait",
        impl_restriction,
        constness,
        is_auto: is_auto,
        safety,
        ident,
        generics,
        bounds,
        items,
      };
    }
    case "TraitAlias": {
      const { constness: constness_, ident: ident_, generics: generics_, bounds: bounds_ } = i._0;
      const constness = this.lower_constness(attrs, constness_);
      const ident = this.lower_ident(ident_);
      const [generics, bounds] = this.lower_generics(generics_, { $: "Disallowed", _0: "Generic" }, (this_) => {
        return this_.lower_param_bounds(bounds_, { $: "Forbidden", _0: "TraitAlias" }, { $: "Disallowed", _0: "Bound" });
      });
      return { $: "TraitAlias", _0: constness, _1: ident, _2: generics, _3: bounds };
    }
    case "MacroDef": {
      const { body: body_, macro_rules } = i._1;
      const ident = this.lower_ident(i._0);
      const body = clone_DelimArgs(body_);
      const def_id = this.curr_owner.owner.def_id;
      const def_kind = this.tcx.def_kind(def_id);
      if (def_kind.$ !== "Macro") {
        return unreachable(
          `internal error: entered unreachable code: expected DefKind::Macro for macro item, found ${DefKind.descr(def_kind, LocalDefId.to_def_id(def_id))}`,
        );
      }
      const macro_kinds = def_kind._0;
      const macro_def = {
        body,
        macro_rules: macro_rules,
        eii_declaration: undefined,
      };
      return { $: "Macro", _0: ident, _1: macro_def, _2: macro_kinds };
    }
    case "Delegation": {
      const delegation = i._0;
      const delegation_results_ = delegation_results(this.lower_delegation(delegation));
      return {
        $: "Fn",
        sig: delegation_results_.sig,
        ident: delegation_results_.ident,
        generics: delegation_results_.generics,
        body: delegation_results_.body_id,
        has_body: true,
      };
    }
    case "MacCall":
    case "DelegationMac":
      return panic("macros should have been expanded by now");
    case "TestBinderConstraints": {
      const { generics: generics_, body: body_ } = i._0;
      const [generics, body] = this.lower_generics(generics_, { $: "Disallowed", _0: "Bound" }, (this_) => this_.lower_test_binder_body(body_));
      return { $: "TestBinderConstraints", generics, body };
    }
  }
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:541 lower_path_simple_eii
LoweringContext.prototype.lower_path_simple_eii = function (this: LoweringContext, id: NodeId, path: Path): DefId | undefined {
  const res = this.get_partial_res(id);
  if (res === undefined) return undefined;
  const did = Res.opt_def_id(res.expect_full_res());
  if (did === undefined) {
    this.dcx().span_delayed_bug(path.span, "should have errored in resolve");
    return undefined;
  }

  return did;
};

// #[instrument(level = "debug", skip(self))]
// rustc: compiler/rustc_ast_lowering/src/item.rs:552 lower_use_tree
LoweringContext.prototype.lower_use_tree = function (
  this: LoweringContext,
  tree: UseTree,
  id: NodeId,
  vis_span: Span,
  attrs: readonly attr_ir.Attribute[],
): hir.UseTree {
  const path = tree.prefix;
  const segments = path.segments.map(clone_PathSegment);

  const kind = tree.kind;
  switch (kind.$) {
    case "Simple": {
      const rename = kind._0;
      let ident = tree.ident();

      // First, apply the prefix to the path.
      const path_ = new Path(path.span, segments);

      // Correctly resolve `self` imports.
      if (path_.segments.length > 1 && unwrap(path_.segments[path_.segments.length - 1]).ident.name === kw.SelfLower) {
        path_.segments.pop();
        if (rename === undefined) {
          ident = unwrap(path_.segments[path_.segments.length - 1]).ident;
        }
      }

      const res = this.lower_import_res(id, path_.span);
      const path__ = this.lower_use_path(res, path_, "Explicit");
      const ident_ = this.lower_ident(ident);
      return new hir.UseTree(path__, { $: "Single", _0: ident_ });
    }
    case "Glob": {
      const res = this.expect_full_res(id);
      const res_ = this.lower_res(res);
      // Put the result in the appropriate namespace.
      const res__ = Res.in_namespace(res_);
      const path_ = new Path(path.span, segments);
      const path__ = this.lower_use_path(res__, path_, "Explicit");
      return new hir.UseTree(path__, hir.UseKind.Glob);
    }
    case "Nested": {
      const trees = kind.items;
      const res = this.expect_full_res(id);
      const res_ = this.lower_res(res);
      // Put the result in the appropriate namespace.
      const res__ = Res.in_namespace(res_);
      const prefix = this.lower_use_path(res__, path, "Explicit");
      const items = trees.map((use_tree): [hir.UseTree, HirId, LocalDefId] => {
        const id = use_tree.id;
        const hir_id = this.lower_node_id(id);
        const def_id = unwrap(this.curr_owner.owner.node_id_to_def_id.get(id));
        if (attrs.length !== 0) {
          this.curr_owner.attrs.insert(hir_id.local_id, attrs);
        }
        return [this.lower_use_tree(use_tree.inner, id, vis_span, attrs), hir_id, def_id];
      });

      return new hir.UseTree(prefix, { $: "Nested", items });
    }
  }
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:614 lower_foreign_item
LoweringContext.prototype.lower_foreign_item = function (this: LoweringContext, i: ForeignItem): hir.ForeignItem {
  const owner_id = this.curr_owner.owner_id();
  const hir_id: HirId = HirId_from_OwnerId(owner_id);
  const attrs = this.lower_attrs(hir_id, i.attrs, i.span, Target.from_foreign_item_kind(i.kind));
  let ident: Ident;
  let kind: hir.ForeignItemKind;
  const ik = i.kind;
  switch (ik.$) {
    case "Fn": {
      const { sig, ident: ident_, generics: generics_, define_opaque } = ik._0;
      const fdec = sig.decl;
      const itctx: ImplTraitContext = { $: "Universal" };
      const [generics, [decl, fn_args]] = this.lower_generics(generics_, itctx, (this_): [hir.FnDecl, readonly (Ident | undefined)[]] => {
        return [
          // Disallow `impl Trait` in foreign items.
          // Parameters are discarded because foreign functions don't have a body
          this_.lower_fn_decl(fdec, i.id, hir_id, "ExternFn", undefined, "Yes"),
          this_.lower_fn_params_to_idents(fdec),
        ];
      });

      // Unmarked safety in unsafe block defaults to unsafe.
      const header = this.lower_fn_header(sig.header, "Unsafe", attrs);

      if (define_opaque !== undefined) {
        this.dcx().span_err(i.span, "foreign functions cannot define opaque types");
      }

      ident = ident_;
      kind = { $: "Fn", _0: { header, decl, span: this.lower_span(sig.span) }, _1: fn_args, _2: generics };
      break;
    }
    case "Static": {
      const { ident: ident_, ty: ty_, mutability, safety: safety_, define_opaque } = ik._0;
      const ty = this.lower_ty_alloc(ty_, { $: "Disallowed", _0: "StaticTy" });
      const safety = this.lower_safety(safety_, "Unsafe");
      if (define_opaque !== undefined) {
        this.dcx().span_err(i.span, "foreign statics cannot define opaque types");
      }
      ident = ident_;
      kind = { $: "Static", _0: ty, _1: mutability, _2: safety };
      break;
    }
    case "TyAlias":
      ident = ik._0.ident;
      kind = hir.ForeignItemKind.Type;
      break;
    case "MacCall":
      return panic("macro shouldn't exist here");
  }

  const ident_ = this.lower_ident(ident);
  const vis_span = this.lower_span(i.vis.span);
  const span = this.lower_span(i.span);
  const item = new hir.ForeignItem(ident_, kind, owner_id, span, vis_span);
  return item;
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:686 lower_foreign_item_ref
LoweringContext.prototype.lower_foreign_item_ref = function (this: LoweringContext, i: ForeignItem): hir.ForeignItemId {
  return new hir.ForeignItemId(this.owner_id(i.id));
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:690 lower_variant
LoweringContext.prototype.lower_variant = function (this: LoweringContext, item_kind: ItemKind, v: Variant): hir.Variant {
  if (v.ident.name === kw.Underscore && this.tcx.features().unnamed_enum_variants()) {
    // FIXME(#156628): lower unnamed enum variants to HIR.
    this.dcx().span_fatal(v.span, "unnamed enum variants are not yet implemented");
  }
  const hir_id = this.lower_node_id(v.id);
  this.lower_attrs(hir_id, v.attrs, v.span, Target.Variant);
  return {
    hir_id,
    def_id: this.local_def_id(v.id),
    data: this.lower_variant_data(hir_id, item_kind, v.data),
    disr_expr: v.disr_expr === undefined ? undefined : this.lower_anon_const_to_anon_const(v.disr_expr, v.disr_expr.value.span),
    ident: this.lower_ident(v.ident),
    span: this.lower_span(v.span),
  };
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:710 lower_variant_data
LoweringContext.prototype.lower_variant_data = function (this: LoweringContext, parent_id: HirId, item_kind: ItemKind, vdata: VariantData): hir.VariantData {
  switch (vdata.$) {
    case "Struct": {
      const { fields: fields_, recovered } = vdata;
      const fields = fields_.map((f, i) => this.lower_field_def([i, f]));

      if (item_kind.$ === "Union") {
        for (const field of fields) {
          const default_ = field.default;
          if (default_ !== undefined) {
            // Unions cannot derive `Default`, and it's not clear how to use default
            // field values of unions if that was supported. Therefore, blanket reject
            // trying to use field values with unions.
            if (this.tcx.features().default_field_values()) {
              this.dcx().emit_err(diagnostics.UnionWithDefault_diagnostic({ span: default_.span }));
            } else {
              this.dcx().span_delayed_bug(
                default_.span,
                "expected union default field values feature gate error but none \
was produced",
              );
            }
          }
        }
      }

      return { $: "Struct", fields, recovered: recovered };
    }
    case "Tuple": {
      const [fields_, id] = [vdata._0, vdata._1];
      const ctor_id = this.lower_node_id(id);
      this.alias_attrs(ctor_id, parent_id);
      const fields = fields_.map((f, i) => this.lower_field_def([i, f]));
      for (const field of fields) {
        const default_ = field.default;
        if (default_ !== undefined) {
          // Default values in tuple struct and tuple variants are not allowed by the
          // RFC due to concerns about the syntax, both in the item definition and the
          // expression. We could in the future allow `struct S(i32 = 0);` and force
          // users to construct the value with `let _ = S { .. };`.
          if (this.tcx.features().default_field_values()) {
            this.dcx().emit_err(diagnostics.TupleStructWithDefault_diagnostic({ span: default_.span }));
          } else {
            this.dcx().span_delayed_bug(
              default_.span,
              "expected `default values on `struct` fields aren't supported` \
feature-gate error but none was produced",
            );
          }
        }
      }
      return { $: "Tuple", _0: fields, _1: ctor_id, _2: this.local_def_id(id) };
    }
    case "Unit": {
      const id = vdata._0;
      const ctor_id = this.lower_node_id(id);
      this.alias_attrs(ctor_id, parent_id);
      return { $: "Unit", _0: ctor_id, _1: this.local_def_id(id) };
    }
  }
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:776 lower_field_def
LoweringContext.prototype.lower_field_def = function (this: LoweringContext, _0: [number, FieldDef]): hir.FieldDef {
  const [index, f] = _0;
  const ty = this.lower_ty_alloc(f.ty, { $: "Disallowed", _0: "FieldTy" });
  const hir_id = this.lower_node_id(f.id);
  this.lower_attrs(hir_id, f.attrs, f.span, Target.Field);
  const span = this.lower_span(f.span);
  const def_id = this.local_def_id(f.id);
  const ident =
    f.ident !== undefined
      ? this.lower_ident(f.ident)
      : // FIXME(jseyfried): positional field hygiene.
        Ident.new(sym.integer(index), this.lower_span(f.span));
  const vis_span = this.lower_span(f.vis.span);
  const mut_restriction = this.lower_mut_restriction(f.mut_restriction(), hir_id);
  const v = f.default_value();
  const default_ = v === undefined ? undefined : this.lower_anon_const_to_anon_const(v, v.value.span);
  const safety = this.lower_safety(f.safety(), "Safe");
  return new hir.FieldDef(span, vis_span, mut_restriction, ident, hir_id, def_id, ty, safety, default_);
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:803 lower_trait_item
LoweringContext.prototype.lower_trait_item = function (this: LoweringContext, i: AssocItem): hir.TraitItem {
  const trait_item_def_id = this.curr_owner.owner_id();
  const hir_id: HirId = HirId_from_OwnerId(trait_item_def_id);
  const attrs = this.lower_attrs(hir_id, i.attrs, i.span, Target.from_assoc_item_kind(i.kind, visit.AssocCtxt.Trait));

  let ident: Ident;
  let generics: hir.Generics;
  let kind: hir.TraitItemKind;
  let has_value: boolean;
  const ik = i.kind;
  if (ik.$ === "Const") {
    const { ident: ident_, generics: generics_, ty, body, define_opaque } = ik._0;
    const [generics__, kind_] = this.lower_generics(generics_, { $: "Disallowed", _0: "Generic" }, (this_): hir.TraitItemKind => {
      const ty_ = this_.lower_ty_alloc(ty, { $: "Disallowed", _0: "ConstTy" });
      // Trait associated consts don't need an expression/body.
      const rhs = body !== undefined ? this_.lower_const_item_rhs(body, i.span) : undefined;
      return { $: "Const", _0: ty_, _1: rhs };
    });

    if (define_opaque !== undefined) {
      if (body !== undefined) {
        this.lower_define_opaque(hir_id, define_opaque);
      } else {
        this.dcx().span_err(i.span, "only trait consts with default bodies can define opaque types");
      }
    }

    [ident, generics, kind, has_value] = [ident_, generics__, kind_, body !== undefined];
  } else if (ik.$ === "Fn" && ik._0.body === undefined) {
    const { sig, ident: ident_, generics: generics_, define_opaque } = ik._0;
    // FIXME(contracts): Deny contract here since it won't apply to
    // any impl method or callees.
    const idents = this.lower_fn_params_to_idents(sig.decl);
    const [generics__, sig_] = this.lower_method_sig(
      generics_,
      sig,
      i.id,
      hir_id,
      "Trait",
      sig.header.coroutine_marker,
      attrs,
      // Parameters are discarded for functions without a body
      "Yes",
    );
    if (define_opaque !== undefined) {
      this.dcx().span_err(i.span, "only trait methods with default bodies can define opaque types");
    }
    [ident, generics, kind, has_value] = [ident_, generics__, { $: "Fn", _0: sig_, _1: { $: "Required", _0: idents } }, false];
  } else if (ik.$ === "Fn") {
    const { sig, ident: ident_, generics: generics_, body, contract, define_opaque } = ik._0;
    const body_id = this.lower_maybe_coroutine_body(sig.span, i.span, hir_id, sig.decl, sig.header.coroutine_marker, body, attrs, contract);
    const [generics__, sig_] = this.lower_method_sig(generics_, sig, i.id, hir_id, "Trait", sig.header.coroutine_marker, attrs, "No");
    this.lower_define_opaque(hir_id, define_opaque);
    [ident, generics, kind, has_value] = [ident_, generics__, { $: "Fn", _0: sig_, _1: { $: "Provided", _0: body_id } }, true];
  } else if (ik.$ === "Type") {
    const { ident: ident_, generics: generics_, after_where_clause, bounds, ty } = ik._0;
    const generics_clone = clone_Generics(generics_);
    add_ty_alias_where_clause(generics_clone, after_where_clause, false);
    const [generics__, kind_] = this.lower_generics(generics_clone, { $: "Disallowed", _0: "Generic" }, (this_): hir.TraitItemKind => {
      const ty_ = ty === undefined ? undefined : this_.lower_ty_alloc(ty, { $: "Disallowed", _0: "AssocTy" });
      return {
        $: "Type",
        _0: this_.lower_param_bounds(bounds, { $: "Allowed", _0: new DefIdMap<Span>() }, { $: "Disallowed", _0: "Generic" }),
        _1: ty_,
      };
    });
    [ident, generics, kind, has_value] = [ident_, generics__, kind_, ty !== undefined];
  } else if (ik.$ === "Delegation") {
    const delegation = ik._0;
    const delegation_results_ = delegation_results(this.lower_delegation(delegation));
    const item_kind: hir.TraitItemKind = {
      $: "Fn",
      _0: delegation_results_.sig,
      _1: { $: "Provided", _0: delegation_results_.body_id },
    };
    [ident, generics, kind, has_value] = [delegation.ident, delegation_results_.generics, item_kind, true];
  } else {
    // AssocItemKind::MacCall(..) | AssocItemKind::DelegationMac(..)
    return panic("macros should have been expanded by now");
  }

  const d = AssocItemKind.defaultness(i.kind);
  // We do not yet support `final` on trait associated items other than functions.
  // Even though we reject `final` on non-functions during AST validation, we still
  // need to stop propagating it here because later compiler passes do not expect
  // and cannot handle such items.
  const defaultness_ = d.$ === "Final" && !(i.kind.$ === "Fn") ? Defaultness.Implicit : d;
  const has_value_ = has_value;
  const [defaultness] = this.lower_defaultness(defaultness_, has_value, () => ({ $: "Default", has_value: has_value_ }));

  const ident_ = this.lower_ident(ident);
  const span = this.lower_span(i.span);
  const item = new hir.TraitItem(ident_, trait_item_def_id, generics, kind, span, defaultness);
  return item;
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:982 lower_trait_item_ref
LoweringContext.prototype.lower_trait_item_ref = function (this: LoweringContext, i: AssocItem): hir.TraitItemId {
  return new hir.TraitItemId(this.owner_id(i.id));
};

/// Construct `ExprKind::Err` for the given `span`.
// rustc: compiler/rustc_ast_lowering/src/item.rs:987 expr_err
LoweringContext.prototype.expr_err = function (this: LoweringContext, span: Span, guar: ErrorGuaranteed): hir.Expr {
  return this.expr(span, { $: "Err", _0: guar });
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:991 lower_trait_impl_header
LoweringContext.prototype.lower_trait_impl_header = function (this: LoweringContext, trait_impl_header: TraitImplHeader): hir.TraitImplHeader {
  const { safety: safety_, polarity: polarity_, defaultness: defaultness_, trait_ref: trait_ref_ } = trait_impl_header;
  const safety = this.lower_safety(safety_, "Safe");
  const polarity: ImplPolarity = polarity_.$ === "Positive" ? ImplPolarity.Positive : { $: "Negative", _0: this.lower_span(polarity_._0) };
  // `defaultness.has_value()` is never called for an `impl`, always `true` in order
  // to not cause an assertion failure inside the `lower_defaultness` function.
  const has_val = true;
  const [defaultness, defaultness_span] = this.lower_defaultness(defaultness_, has_val, () => hir.Defaultness.Final);
  const modifiers: TraitBoundModifiers = {
    constness: BoundConstness.Never,
    asyncness: BoundAsyncness.Normal,
    // we don't use this in bound lowering
    polarity: BoundPolarity.Positive,
  };
  const trait_ref = this.lower_trait_ref(modifiers, trait_ref_, { $: "Disallowed", _0: "Trait" });

  return {
    safety,
    polarity,
    defaultness,
    defaultness_span,
    trait_ref,
  };
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1027 check_pin_drop_sugar_impl_item
LoweringContext.prototype.check_pin_drop_sugar_impl_item = function (
  this: LoweringContext,
  i: AssocItem,
  ident: Ident,
  trait_item: Result<DefId, ErrorGuaranteed>,
): Ident {
  if (i.kind.$ === "Fn" && i.kind._0.is_pin_drop_sugar()) {
    if (trait_item.$ === "Ok") {
      // PORT: `TyCtxt::lang_items` (rustc_middle ty/context.rs:995) is not ported yet.
      const drop_trait: DefId | undefined = unported("rustc_middle::ty::context::TyCtxt::lang_items");
      if (drop_trait === undefined || !DefId_eq(this.tcx.parent(trait_item._0), drop_trait)) {
        this.dcx()
          .struct_span_err(i.span, "method `drop` with `&pin mut self` is only supported for the `Drop` trait")
          .with_span_label(i.span, "not a `Drop::pin_drop` implementation")
          .emit();
      }
    }
    return Ident.new(sym.pin_drop, ident.span);
  }

  return ident;
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1057 lower_impl_item
LoweringContext.prototype.lower_impl_item = function (this: LoweringContext, i: AssocItem): hir.ImplItem {
  const owner_id = this.curr_owner.owner_id();
  const hir_id: HirId = HirId_from_OwnerId(owner_id);
  const parent_id = this.tcx.local_parent(owner_id.def_id);
  const pk = this.tcx.def_kind(parent_id);
  const is_in_trait_impl = pk.$ === "Impl" && pk.of_trait === true;

  // Since `default impl` is not yet implemented, this is always true in impls.
  const has_value = true;
  const [defaultness] = this.lower_defaultness(AssocItemKind.defaultness(i.kind), has_value, () => hir.Defaultness.Final);
  const attrs = this.lower_attrs(hir_id, i.attrs, i.span, Target.from_assoc_item_kind(i.kind, { $: "Impl", of_trait: is_in_trait_impl }));

  let ident: Ident;
  let generics: hir.Generics;
  let kind: hir.ImplItemKind;
  const ik = i.kind;
  switch (ik.$) {
    case "Const": {
      const { ident: ident_, generics: generics_, ty, body, define_opaque } = ik._0;
      ident = ident_;
      [generics, kind] = this.lower_generics(generics_, { $: "Disallowed", _0: "Generic" }, (this_): hir.ImplItemKind => {
        const ty_ = this_.lower_ty_alloc(ty, { $: "Disallowed", _0: "ConstTy" });
        this_.lower_define_opaque(hir_id, define_opaque);
        const rhs = this_.lower_const_item_rhs(body, i.span);
        return { $: "Const", _0: ty_, _1: rhs };
      });
      break;
    }
    case "Fn": {
      const { sig, ident: ident_, generics: generics_, body, contract, define_opaque } = ik._0;
      const body_id = this.lower_maybe_coroutine_body(sig.span, i.span, hir_id, sig.decl, sig.header.coroutine_marker, body, attrs, contract);
      const [generics__, sig_] = this.lower_method_sig(
        generics_,
        sig,
        i.id,
        hir_id,
        is_in_trait_impl ? "Impl" : "Inherent",
        sig.header.coroutine_marker,
        attrs,
        body === undefined ? "Yes" : "No",
      );
      this.lower_define_opaque(hir_id, define_opaque);

      [ident, generics, kind] = [ident_, generics__, { $: "Fn", _0: sig_, _1: body_id }];
      break;
    }
    case "Type": {
      const { ident: ident_, generics: generics_, after_where_clause, ty } = ik._0;
      const generics_clone = clone_Generics(generics_);
      add_ty_alias_where_clause(generics_clone, after_where_clause, false);
      ident = ident_;
      [generics, kind] = this.lower_generics(generics_clone, { $: "Disallowed", _0: "Generic" }, (this_): hir.ImplItemKind => {
        if (ty === undefined) {
          const guar = this_.dcx().span_delayed_bug(i.span, "expected to lower associated type, but it was missing");
          const ty_ = this_.ty(i.span, { $: "Err", _0: guar });
          return { $: "Type", _0: ty_ };
        } else {
          const ty_ = this_.lower_ty_alloc(ty, {
            $: "OpaqueTy",
            origin: {
              $: "TyAlias",
              parent: this_.curr_owner.owner.def_id,
              in_assoc_ty: true,
            },
          });
          return { $: "Type", _0: ty_ };
        }
      });
      break;
    }
    case "Delegation": {
      const delegation = ik._0;
      const delegation_results_ = delegation_results(this.lower_delegation(delegation));
      [ident, generics, kind] = [
        delegation.ident,
        delegation_results_.generics,
        { $: "Fn", _0: delegation_results_.sig, _1: delegation_results_.body_id },
      ];
      break;
    }
    case "MacCall":
    case "DelegationMac":
      return panic("macros should have been expanded by now");
  }

  const span = this.lower_span(i.span);
  let effective_ident: Ident;
  let impl_kind: hir.ImplItemImplKind;
  if (is_in_trait_impl) {
    const r = this.get_partial_res(i.id);
    const did = r === undefined ? undefined : Res.opt_def_id(r.expect_full_res());
    const trait_item_def_id: Result<DefId, ErrorGuaranteed> =
      did !== undefined ? Ok(did) : Err(this.dcx().span_delayed_bug(span, "could not resolve trait item being implemented"));
    effective_ident = this.check_pin_drop_sugar_impl_item(i, ident, trait_item_def_id);
    impl_kind = { $: "Trait", defaultness, trait_item_def_id };
  } else {
    effective_ident = ident;
    impl_kind = { $: "Inherent", vis_span: this.lower_span(i.vis.span) };
  }

  const ident_ = this.lower_ident(effective_ident);
  const item = new hir.ImplItem(ident_, owner_id, generics, kind, impl_kind, span);
  return item;
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1195 lower_impl_item_ref
LoweringContext.prototype.lower_impl_item_ref = function (this: LoweringContext, i: AssocItem): hir.ImplItemId {
  return new hir.ImplItemId(this.owner_id(i.id));
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1199 lower_defaultness
LoweringContext.prototype.lower_defaultness = function (
  this: LoweringContext,
  d: Defaultness,
  has_value: boolean,
  implicit: () => hir.Defaultness,
): [hir.Defaultness, Span | undefined] {
  switch (d.$) {
    case "Implicit":
      return [implicit(), undefined];
    case "Default":
      return [{ $: "Default", has_value }, this.lower_span(d._0)];
    case "Final":
      return [hir.Defaultness.Final, this.lower_span(d._0)];
  }
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1214 record_body
LoweringContext.prototype.record_body = function (this: LoweringContext, params: readonly hir.Param[], value: hir.Expr): hir.BodyId {
  const body = new hir.Body(params, value);
  const id = body.id();
  assert_eq(id.hir_id.owner, this.curr_owner.owner_id(), (v) => debug_OwnerId(v, PLAIN), OwnerId_eq);
  this.curr_owner.bodies.push([id.hir_id.local_id, body]);
  return id;
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1226 lower_body
LoweringContext.prototype.lower_body = function (this: LoweringContext, f: (this_: LoweringContext) => [readonly hir.Param[], hir.Expr]): hir.BodyId {
  // `Option::take`
  const prev_coroutine_kind = this.coroutine_kind;
  this.coroutine_kind = undefined;
  const task_context = this.task_context;
  this.task_context = undefined;
  const [parameters, result] = f(this);
  const body_id = this.record_body(parameters, result);
  this.task_context = task_context;
  this.coroutine_kind = prev_coroutine_kind;
  return body_id;
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1239 lower_param
LoweringContext.prototype.lower_param = function (this: LoweringContext, param: Param): hir.Param {
  const hir_id = this.lower_node_id(param.id);
  this.lower_attrs(hir_id, param.attrs, param.span, Target.Param);
  return {
    hir_id,
    pat: this.lower_pat(param.pat),
    ty_span: this.lower_span(param.ty.span),
    span: this.lower_span(param.span),
  };
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1250 lower_fn_body
LoweringContext.prototype.lower_fn_body = function (
  this: LoweringContext,
  decl: FnDecl,
  contract: FnContract | undefined,
  body: (this_: LoweringContext) => hir.Expr,
): hir.BodyId {
  return this.lower_body((this_) => {
    const params = decl.inputs.map((x) => this_.lower_param(x));

    // Optionally lower the fn contract
    if (contract !== undefined) {
      return [params, this_.lower_contract(body, contract)];
    } else {
      return [params, body(this_)];
    }
  });
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1269 lower_fn_body_block
LoweringContext.prototype.lower_fn_body_block = function (this: LoweringContext, decl: FnDecl, body: Block, contract: FnContract | undefined): hir.BodyId {
  return this.lower_fn_body(decl, contract, (this_) => this_.lower_block_expr(body));
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1278 lower_const_body
LoweringContext.prototype.lower_const_body = function (this: LoweringContext, span: Span, expr: Expr | undefined): hir.BodyId {
  return this.lower_body((this_) => [
    [],
    expr !== undefined ? this_.lower_expr_mut(expr) : this_.expr_err(span, this_.dcx().span_delayed_bug(span, "no block")),
  ]);
};

/// Takes what may be the body of an `async fn` or a `gen fn` and wraps it in an `async {}` or
/// `gen {}` block as appropriate.
// rustc: compiler/rustc_ast_lowering/src/item.rs:1292 lower_maybe_coroutine_body
LoweringContext.prototype.lower_maybe_coroutine_body = function (
  this: LoweringContext,
  fn_decl_span: Span,
  span: Span,
  fn_id: HirId,
  decl: FnDecl,
  coroutine_marker: CoroutineMarker | undefined,
  body: Block | undefined,
  attrs: readonly attr_ir.Attribute[],
  contract: FnContract | undefined,
): hir.BodyId {
  if (body === undefined) {
    // Functions without a body are an error, except if this is an intrinsic. For those we
    // create a fake body so that the entire rest of the compiler doesn't have to deal with
    // this as a special case.
    return this.lower_fn_body(decl, contract, (this_) => {
      if (
        find_attr(attrs, (k) => (k.$ === "RustcIntrinsic" ? null : undefined)) !== undefined ||
        // PORT: `TyCtxt::is_sdylib_interface_build` (rustc_middle ty/context.rs:2807) is not ported yet.
        unported("rustc_middle::ty::context::TyCtxt::is_sdylib_interface_build")
      ) {
        const span_ = this_.lower_span(span);
        const empty_block = new hir.Block([], undefined, this_.next_id(), hir.BlockCheckMode.DefaultBlock, span_, false);
        const loop_: hir.ExprKind = { $: "Loop", _0: empty_block, _1: undefined, _2: "Loop", _3: span_ };
        return new hir.Expr(this_.next_id(), loop_, span_);
      } else {
        return this_.expr_err(span, unwrap(this_.dcx().has_errors()));
      }
    });
  }
  if (coroutine_marker === undefined) {
    // Typical case: not a coroutine.
    return this.lower_fn_body_block(decl, body, contract);
  }
  // FIXME(contracts): Support contracts on async fn.
  return this.lower_body((this_) => {
    const [parameters, expr] = this_.lower_coroutine_body_with_moved_arguments(
      decl,
      (this_) => this_.lower_block_expr(body),
      fn_decl_span,
      body.span,
      coroutine_marker,
      "Fn",
    );

    // FIXME(async_fn_track_caller): Can this be moved above?
    const hir_id = expr.hir_id;
    this_.maybe_forward_track_caller(fn_id, hir_id);

    return [parameters, expr];
  });
};

/// Lowers a desugared coroutine body after moving all of the arguments
/// into the body. This is to make sure that the future actually owns the
/// arguments that are passed to the function, and to ensure things like
/// drop order are stable.
// rustc: compiler/rustc_ast_lowering/src/item.rs:1357 lower_coroutine_body_with_moved_arguments
LoweringContext.prototype.lower_coroutine_body_with_moved_arguments = function (
  this: LoweringContext,
  decl: FnDecl,
  lower_body: (this_: LoweringContext) => hir.Expr,
  fn_decl_span: Span,
  body_span: Span,
  coroutine_marker: CoroutineMarker,
  coroutine_source: hir.CoroutineSource,
): [readonly hir.Param[], hir.Expr] {
  const parameters: hir.Param[] = [];
  const statements: hir.Stmt[] = [];

  // Async function parameters are lowered into the closure body so that they are
  // captured and so that the drop order matches the equivalent non-async functions.
  //
  // from:
  //
  //     async fn foo(<pattern>: <ty>, <pattern>: <ty>, <pattern>: <ty>) {
  //         <body>
  //     }
  //
  // into:
  //
  //     fn foo(__arg0: <ty>, __arg1: <ty>, __arg2: <ty>) {
  //       async move {
  //         let __arg2 = __arg2;
  //         let <pattern> = __arg2;
  //         let __arg1 = __arg1;
  //         let <pattern> = __arg1;
  //         let __arg0 = __arg0;
  //         let <pattern> = __arg0;
  //         drop-temps { <body> } // see comments later in fn for details
  //       }
  //     }
  //
  // If `<pattern>` is a simple ident, then it is lowered to a single
  // `let <pattern> = <pattern>;` statement as an optimization.
  //
  // Note that the body is embedded in `drop-temps`; an
  // equivalent desugaring would be `return { <body>
  // };`. The key point is that we wish to drop all the
  // let-bound variables and temporaries created in the body
  // (and its tail expression!) before we drop the
  // parameters (c.f. rust-lang/rust#64512).
  for (const [index, parameter_] of decl.inputs.entries()) {
    const parameter = this.lower_param(parameter_);
    const span = parameter.pat.span;

    // Check if this is a binding pattern, if so, we can optimize and avoid adding a
    // `let <pat> = __argN;` statement. In this case, we do not rename the parameter.
    let ident: Ident;
    let is_simple_parameter: boolean;
    const pk = parameter.pat.kind;
    if (pk.$ === "Binding" && pk._0._0.$ === "No") {
      [ident, is_simple_parameter] = [pk._2, true];
    } else if (pk.$ === "Binding") {
      // For `ref mut` or wildcard arguments, we can't reuse the binding, but
      // we can keep the same name for the parameter.
      // This lets rustdoc render it correctly in documentation.
      [ident, is_simple_parameter] = [pk._2, false];
    } else if (pk.$ === "Wild") {
      [ident, is_simple_parameter] = [Ident.with_dummy_span(kw.Underscore), false];
    } else {
      // Replace the ident for bindings that aren't simple.
      const name = `__arg${index}`;
      const ident_ = Ident.from_str(name);

      [ident, is_simple_parameter] = [ident_, false];
    }

    const desugared_span = this.mark_span_with_reason(DesugaringKind.Async, span, undefined);

    // Construct a parameter representing `__argN: <ty>` to replace the parameter of the
    // async function.
    //
    // If this is the simple case, this parameter will end up being the same as the
    // original parameter, but with a different pattern id.
    const stmt_attrs = this.curr_owner.attrs.get(parameter.hir_id.local_id);
    const [new_parameter_pat, new_parameter_id] = this.pat_ident(desugared_span, ident);
    const new_parameter: hir.Param = {
      hir_id: parameter.hir_id,
      pat: new_parameter_pat,
      ty_span: this.lower_span(parameter.ty_span),
      span: this.lower_span(parameter.span),
    };

    if (is_simple_parameter) {
      // If this is the simple case, then we only insert one statement that is
      // `let <pat> = <pat>;`. We re-use the original argument's pattern so that
      // `HirId`s are densely assigned.
      const expr = this.expr_ident(desugared_span, ident, new_parameter_id);
      const stmt = this.stmt_let_pat(stmt_attrs, desugared_span, expr, parameter.pat, "AsyncFn");
      statements.push(stmt);
    } else {
      // If this is not the simple case, then we construct two statements:
      //
      // ```
      // let __argN = __argN;
      // let <pat> = __argN;
      // ```
      //
      // The first statement moves the parameter into the closure and thus ensures
      // that the drop order is correct.
      //
      // The second statement creates the bindings that the user wrote.

      // Construct the `let mut __argN = __argN;` statement. It must be a mut binding
      // because the user may have specified a `ref mut` binding in the next
      // statement.
      const [move_pat, move_id] = this.pat_ident_binding_mode(desugared_span, ident, BindingMode.MUT);
      const move_expr = this.expr_ident(desugared_span, ident, new_parameter_id);
      const move_stmt = this.stmt_let_pat(undefined, desugared_span, move_expr, move_pat, "AsyncFn");

      // Construct the `let <pat> = __argN;` statement. We re-use the original
      // parameter's pattern so that `HirId`s are densely assigned.
      const pattern_expr = this.expr_ident(desugared_span, ident, move_id);
      const pattern_stmt = this.stmt_let_pat(stmt_attrs, desugared_span, pattern_expr, parameter.pat, "AsyncFn");

      statements.push(move_stmt);
      statements.push(pattern_stmt);
    }

    parameters.push(new_parameter);
  }

  const mkbody = (this_: LoweringContext): hir.Expr => {
    // Create a block from the user's function body:
    const user_body = lower_body(this_);

    // Transform into `drop-temps { <user-body> }`, an expression:
    const desugared_span = this_.mark_span_with_reason(DesugaringKind.Async, user_body.span, undefined);
    const user_body_ = this_.expr_drop_temps(desugared_span, user_body);

    // As noted above, create the final block like
    //
    // ```
    // {
    //   let $param_pattern = $raw_param;
    //   ...
    //   drop-temps { <user-body> }
    // }
    // ```
    const body = this_.block_all(desugared_span, [...statements], user_body_);

    return this_.expr_block(body);
  };
  let desugaring_kind: hir.CoroutineDesugaring;
  switch (coroutine_marker.kind) {
    case "Async":
      desugaring_kind = "Async";
      break;
    case "Gen":
      desugaring_kind = "Gen";
      break;
    case "AsyncGen":
      desugaring_kind = "AsyncGen";
      break;
  }
  const closure_id = coroutine_marker.closure_id;

  const coroutine_expr = this.make_desugared_coroutine_expr(
    // The default capture mode here is by-ref. Later on during upvar analysis,
    // we will force the captured arguments to by-move, but for async closures,
    // we want to make sure that we avoid unnecessarily moving captures, or else
    // all async closures would default to `FnOnce` as their calling mode.
    CaptureBy.Ref,
    closure_id,
    undefined,
    fn_decl_span,
    body_span,
    desugaring_kind,
    coroutine_source,
    mkbody,
  );

  const hir_id = this.lower_node_id(closure_id);
  const expr = new hir.Expr(hir_id, coroutine_expr, this.lower_span(body_span));

  return [[...parameters], expr];
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1554 lower_method_sig
LoweringContext.prototype.lower_method_sig = function (
  this: LoweringContext,
  generics: Generics,
  sig: FnSig,
  node_id: NodeId,
  hir_id: HirId,
  kind: FnDeclKind,
  coroutine_marker: CoroutineMarker | undefined,
  attrs: readonly attr_ir.Attribute[],
  discard_params: DiscardParams,
): [hir.Generics, hir.FnSig] {
  const header = this.lower_fn_header(sig.header, "Safe", attrs);
  const itctx: ImplTraitContext = { $: "Universal" };
  const [generics_, decl] = this.lower_generics(generics, itctx, (this_) => {
    return this_.lower_fn_decl(sig.decl, node_id, hir_id, kind, coroutine_marker, discard_params);
  });
  return [generics_, { header, decl, span: this.lower_span(sig.span) }];
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1573 lower_fn_header
LoweringContext.prototype.lower_fn_header = function (
  this: LoweringContext,
  h: FnHeader,
  default_safety: hir.Safety,
  attrs: readonly attr_ir.Attribute[],
): hir.FnHeader {
  let asyncness: hir.IsAsync;
  const coroutine_marker = h.coroutine_marker;
  if (coroutine_marker !== undefined && coroutine_marker.kind === "Async") {
    asyncness = { $: "Async", _0: this.lower_span(coroutine_marker.span) };
  } else {
    asyncness = hir.IsAsync.NotAsync;
  }

  const safety = this.lower_safety(h.safety, default_safety);

  // Treat safe `#[target_feature]` functions as unsafe, but also remember that we did so.
  const safety_: hir.HeaderSafety =
    find_attr(attrs, (k) => (k.$ === "TargetFeature" && k.was_forced === false ? null : undefined)) !== undefined &&
    hir.Safety.is_safe(safety) &&
    !this.tcx.sess.target.is_like_wasm
      ? hir.HeaderSafety.SafeTargetFeatures
      : hir.HeaderSafety.from(safety);

  const constness = this.lower_constness(attrs, h.constness);

  const abi = this.lower_extern(h.ext);
  return new hir.FnHeader(safety_, constness, asyncness, abi);
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1604 lower_abi
LoweringContext.prototype.lower_abi = function (this: LoweringContext, abi_str: StrLit): ExternAbi {
  const { symbol_unescaped, span } = abi_str;
  const parsed = ExternAbi.from_str(Symbol.as_str(symbol_unescaped));
  let extern_abi: ExternAbi;
  if (parsed.$ === "Ok") {
    extern_abi = parsed._0;
  } else {
    this.error_on_invalid_abi(abi_str);
    extern_abi = ExternAbi.Rust;
  }
  const tcx = this.tcx;

  // we can't do codegen for unsupported ABIs, so error now so we won't get farther
  if (!tcx.sess.target.is_abi_supported(extern_abi)) {
    const err = struct_span_code_err(
      tcx.dcx(),
      span,
      E0570,
      `${display_ExternAbi(extern_abi)} is not a supported ABI for the current target`,
    );

    if (extern_abi.$ === "Stdcall") {
      const unwind = extern_abi.unwind;
      const c_abi = ExternAbi.C(unwind);
      const system_abi = ExternAbi.System(unwind);
      err.help(
        // PORT: the Rust string continuation (`\` + newline) drops the newline and the next line's indentation.
        `if you need \`extern ${display_ExternAbi(extern_abi)}\` on win32 and \`extern ${display_ExternAbi(c_abi)}\` everywhere else, ` +
          `use \`extern ${display_ExternAbi(system_abi)}\``,
      );
    }
    err.emit();
  }
  // Show required feature gate even if we already errored, as the user is likely to build the code
  // for the actually intended target next and then they will need the feature gate.
  gate_unstable_abi(tcx.sess, tcx.features(), span, extern_abi);
  return extern_abi;
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1636 lower_extern
LoweringContext.prototype.lower_extern = function (this: LoweringContext, ext: Extern): ExternAbi {
  switch (ext.$) {
    case "None":
      return ExternAbi.Rust;
    case "Implicit":
      return ExternAbi.FALLBACK;
    case "Explicit":
      return this.lower_abi(ext._0);
  }
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1644 error_on_invalid_abi
LoweringContext.prototype.error_on_invalid_abi = function (this: LoweringContext, abi: StrLit): void {
  const abi_names = enabled_names(this.tcx.features(), abi.span).map((s) => Symbol.intern(s));
  const suggested_name = find_best_match_for_name(abi_names, abi.symbol_unescaped, undefined);
  this.dcx().emit_err(
    diagnostics.InvalidAbi_diagnostic({
      abi: abi.symbol_unescaped,
      span: abi.span,
      suggestion: suggested_name === undefined ? undefined : { span: abi.span, suggestion: display_Symbol(suggested_name) },
      command: "rustc --print=calling-conventions",
    }),
  );
};

/// Lowers constness or comptime attribute.
/// Whether `const` is allowed here is checked by ast validation.
/// Whether `comptime` is allowed here is checked by the `comptime` attribute parser.
// rustc: compiler/rustc_ast_lowering/src/item.rs:1664 lower_constness
LoweringContext.prototype.lower_constness = function (this: LoweringContext, attrs: readonly attr_ir.Attribute[], c: Const): hir.Constness {
  let constness: hir.Constness = c.$ === "Yes" ? { $: "Const", always: false } : hir.Constness.NotConst;

  const attr_span = find_attr(attrs, (k) => (k.$ === "RustcComptime" ? k._0 : undefined));
  if (attr_span !== undefined) {
    // `std::mem::replace`
    const old = constness;
    constness = { $: "Const", always: true };
    if (old.$ === "Const" && old.always === true) {
      return unreachable("internal error: entered unreachable code: lower_constness cannot produce comptime");
    } else if (old.$ === "Const" && old.always === false) {
      // A function can't be `const` and `comptime` at the same time
      if (c.$ !== "Yes") return unreachable();
      const span = c._0;
      this.dcx().emit_err(diagnostics.ConstComptimeFn_diagnostic({ span, attr_span }));
    } else {
      // Good
    }
  }
  return constness;
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1691 lower_safety
LoweringContext.prototype.lower_safety = function (this: LoweringContext, s: Safety, default_: hir.Safety): hir.Safety {
  switch (s.$) {
    case "Unsafe":
      return "Unsafe";
    case "Default":
      return default_;
    case "Safe":
      return "Safe";
  }
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1699 lower_restriction_kind
LoweringContext.prototype.lower_restriction_kind = function (
  this: LoweringContext,
  restriction_kind: RestrictionKind,
  hir_id: HirId,
  resolving_kind: ResolvingRestrictionKind,
): hir.RestrictionKind {
  switch (restriction_kind.$) {
    case "Unrestricted":
      return hir.RestrictionKind.Unrestricted;
    case "Restricted": {
      const { path, id } = restriction_kind;
      const res = this.get_partial_res(id);
      // PORT: `TyCtxt::parent_module(hir_id)` (rustc_middle hir/mod.rs:151) is not ported yet.
      void hir_id;
      const parent_module: LocalModId = unported("rustc_middle::hir::TyCtxt::parent_module");
      const did = res === undefined ? undefined : Res.opt_def_id(res.expect_full_res());
      if (did !== undefined) {
        if (!this.tcx.is_descendant_of(parent_module, did)) {
          // If the restriction path is not an ancestor of the item,
          // emit an error and recover by lowering the restriction to `Unrestricted`.
          this.dcx().emit_err(diagnostics.RestrictionAncestorOnly_diagnostic({ span: path.span, kind: resolving_kind }));
          return hir.RestrictionKind.Unrestricted;
        } else {
          const segments = path.segments.map((segment) =>
            this.lower_path_segment(path.span, segment, "Explicit", "Err", { $: "Disallowed", _0: "Path" }, undefined),
          );
          return { $: "Restricted", _0: new hir.Path<DefId>(this.lower_span(path.span), did, segments) };
        }
      } else {
        this.dcx().span_delayed_bug(path.span, "should have errored in resolve");
        return hir.RestrictionKind.Unrestricted;
      }
    }
  }
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1745 lower_impl_restriction
LoweringContext.prototype.lower_impl_restriction = function (this: LoweringContext, r: ImplRestriction, hir_id: HirId): hir.ImplRestriction {
  const kind = this.lower_restriction_kind(r.kind, hir_id, "Impl");
  return { kind, span: this.lower_span(r.span) };
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1754 lower_mut_restriction
LoweringContext.prototype.lower_mut_restriction = function (this: LoweringContext, r: MutRestriction, hir_id: HirId): hir.MutRestriction {
  const kind = this.lower_restriction_kind(r.kind, hir_id, "Mut");
  return { kind, span: this.lower_span(r.span) };
};

/// Return the pair of the lowered `generics` as `hir::Generics` and the evaluation of `f` with
/// the carried impl trait definitions and bounds.
// #[instrument(level = "debug", skip(self, f))]
// rustc: compiler/rustc_ast_lowering/src/item.rs:1766 lower_generics
LoweringContext.prototype.lower_generics = function <T>(
  this: LoweringContext,
  generics: Generics,
  itctx: ImplTraitContext,
  f: (this_: LoweringContext) => T,
): [hir.Generics, T] {
  assert(this.curr_owner.impl_trait_defs.length === 0, "assertion failed: self.curr_owner.impl_trait_defs.is_empty()");
  assert(this.curr_owner.impl_trait_bounds.length === 0, "assertion failed: self.curr_owner.impl_trait_bounds.is_empty()");

  const predicates: hir.WherePredicate[] = [];
  // We need to make sure that generic params don't have multiple relaxed bounds for the same trait
  // across generic param bounds and where bounds.
  const dedup_map = new Map<LocalDefId, DefIdMap<Span>>();
  for (const param of generics.params) {
    const key = this.local_def_id(param.id);
    // `entry(..).or_default()`
    let entry = dedup_map.get(key);
    if (entry === undefined) {
      entry = new DefIdMap<Span>();
      dedup_map.set(key, entry);
    }
    const p = this.lower_generic_bound_predicate(
      param.ident,
      param.id,
      param.kind,
      param.bounds,
      param.colon_span,
      generics.span,
      { $: "Allowed", _0: entry },
      itctx,
      "GenericParam",
    );
    if (p !== undefined) predicates.push(p);
  }
  for (const predicate of generics.where_clause.predicates) {
    predicates.push(this.lower_where_predicate(predicate, generics.params, dedup_map));
  }

  const params: hir.GenericParam[] = [...this.lower_generic_params_mut(generics.params, "Generics")];

  // Introduce extra lifetimes if late resolution tells us to.
  const extra_lifetimes = this.curr_owner.owner.extra_lifetime_params(this.curr_owner.owner.id);
  for (const [ident, node_id, kind] of extra_lifetimes) {
    // PORT: the resolver's `MissingLifetimeKind` is still `unknown` (rustc_middle middle/resolve.ts).
    params.push(this.lifetime_res_to_generic_param(ident, node_id, kind as hir.MissingLifetimeKind, "Generics"));
  }

  const has_where_clause_predicates = generics.where_clause.predicates.length !== 0;
  const where_clause_span = this.lower_span(generics.where_clause.span);
  const span = this.lower_span(generics.span);
  const res = f(this);

  // `std::mem::take`
  const impl_trait_defs = this.curr_owner.impl_trait_defs;
  this.curr_owner.impl_trait_defs = [];
  params.push(...impl_trait_defs);

  const impl_trait_bounds = this.curr_owner.impl_trait_bounds;
  this.curr_owner.impl_trait_bounds = [];
  predicates.push(...impl_trait_bounds);

  const lowered_generics = new hir.Generics(params, predicates, has_where_clause_predicates, where_clause_span, span);

  return [lowered_generics, res];
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1835 lower_define_opaque
LoweringContext.prototype.lower_define_opaque = function (this: LoweringContext, hir_id: HirId, define_opaque: [NodeId, Path][] | undefined): void {
  assert_eq(
    this.curr_owner.define_opaque,
    undefined,
    (v) =>
      debug_option(v, PLAIN, (x, f) =>
        debug_vec(x, f, (y, f) => debug_tuple(f, "", [debug_Span(y[0], f), debug_LocalDefId(y[1], f)])),
      ),
  );
  assert(hir_id.is_owner(), "assertion failed: hir_id.is_owner()");
  if (define_opaque === undefined) {
    return;
  }
  const define_opaque_: [Span, LocalDefId][] = [];
  for (const [id, path] of define_opaque) {
    const res = this.get_partial_res(id);
    const did = res === undefined ? undefined : Res.opt_def_id(res.expect_full_res());
    if (did === undefined) {
      this.dcx().span_delayed_bug(path.span, "should have errored in resolve");
      continue;
    }
    const did_ = did.as_local();
    if (did_ === undefined) {
      this.dcx().span_err(path.span, "only opaque types defined in the local crate can be defined");
      continue;
    }
    define_opaque_.push([this.lower_span(path.span), did_]);
  }
  this.curr_owner.define_opaque = define_opaque_;
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1864 lower_generic_bound_predicate
LoweringContext.prototype.lower_generic_bound_predicate = function (
  this: LoweringContext,
  ident: Ident,
  id: NodeId,
  kind: GenericParamKind,
  bounds_: readonly GenericBound[],
  colon_span: Span | undefined,
  parent_span: Span,
  rbp: RelaxedBoundPolicy,
  itctx: ImplTraitContext,
  origin: hir.PredicateOrigin,
): hir.WherePredicate | undefined {
  // Do not create a clause if we do not have anything inside it.
  if (bounds_.length === 0) {
    return undefined;
  }

  const bounds = this.lower_param_bounds(bounds_, rbp, itctx);

  const param_span = ident.span;

  // Reconstruct the span of the entire predicate from the individual generic bounds.
  const span_start = colon_span ?? Span.shrink_to_hi(param_span);
  const span_ = bounds.reduce((span_accum, bound) => {
    const bound_span = Span.find_ancestor_inside(hir.GenericBound.span(bound), parent_span);
    return bound_span !== undefined ? Span.to(span_accum, bound_span) : span_accum;
  }, span_start);
  const span = this.lower_span(span_);
  const hir_id = this.next_id();
  let kind_: hir.WherePredicateKind;
  switch (kind.$) {
    case "Const":
      return undefined;
    case "Type": {
      const def_id = LocalDefId.to_def_id(this.local_def_id(id));
      const hir_id = this.next_id();
      const res: Res = { $: "Def", _0: DefKind.TyParam, _1: def_id };
      const ident_ = this.lower_ident(ident);
      const ty_path = new hir.Path(this.lower_span(param_span), res, [hir.PathSegment.new(ident_, hir_id, res)]);
      const ty_id = this.next_id();
      const bounded_ty = this.ty_path(ty_id, param_span, { $: "Resolved", _0: undefined, _1: ty_path });
      kind_ = {
        $: "BoundPredicate",
        _0: new hir.WhereBoundPredicate(origin, [], bounded_ty, bounds),
      };
      break;
    }
    case "Lifetime": {
      const lt_id = this.next_node_id();
      const lifetime = this.new_named_lifetime(id, lt_id, ident, hir.LifetimeSource.Other, hir.LifetimeSyntax.from(ident));
      kind_ = {
        $: "RegionPredicate",
        _0: new hir.WhereRegionPredicate(false, lifetime, bounds),
      };
      break;
    }
  }
  return { hir_id, span, kind: kind_ };
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1933 lower_where_predicate
LoweringContext.prototype.lower_where_predicate = function (
  this: LoweringContext,
  pred: WherePredicate,
  params: readonly GenericParam[],
  dedup_map: Map<LocalDefId, DefIdMap<Span>>,
): hir.WherePredicate {
  const hir_id = this.lower_node_id(pred.id);
  const span = this.lower_span(pred.span);
  this.lower_attrs(hir_id, pred.attrs, span, Target.WherePredicate);
  let kind: hir.WherePredicateKind;
  const pk = pred.kind;
  switch (pk.$) {
    case "BoundPredicate": {
      const { bound_generic_params, bounded_ty, bounds } = pk._0;
      let rbp: RelaxedBoundPolicy;
      const r = bound_generic_params.length === 0 ? this.get_partial_res(bounded_ty.id) : undefined;
      const res = r === undefined ? undefined : r.full_res();
      if (
        bound_generic_params.length === 0 &&
        res !== undefined &&
        res.$ === "Def" &&
        res._0.$ === "TyParam" &&
        params.some((p) => DefId_eq(res._1, LocalDefId.to_def_id(this.local_def_id(p.id))))
      ) {
        const def_id = res._1;
        // `entry(..).or_default()`
        const key = def_id.expect_local();
        let entry = dedup_map.get(key);
        if (entry === undefined) {
          entry = new DefIdMap<Span>();
          dedup_map.set(key, entry);
        }
        rbp = { $: "Allowed", _0: entry };
      } else {
        rbp = { $: "Forbidden", _0: "WhereBound" };
      }
      const bound_generic_params_ = this.lower_generic_params(bound_generic_params, "Binder");
      const bounded_ty_ = this.lower_ty_alloc(bounded_ty, { $: "Disallowed", _0: "Bound" });
      const bounds_ = this.lower_param_bounds(bounds, rbp, { $: "Disallowed", _0: "Bound" });
      kind = {
        $: "BoundPredicate",
        _0: new hir.WhereBoundPredicate("WhereClause", bound_generic_params_, bounded_ty_, bounds_),
      };
      break;
    }
    case "RegionPredicate": {
      const { lifetime, bounds } = pk._0;
      const lifetime_ = this.lower_lifetime(lifetime, hir.LifetimeSource.Other, hir.LifetimeSyntax.from(lifetime.ident));
      const bounds_ = this.lower_param_bounds(bounds, { $: "Allowed", _0: new DefIdMap<Span>() }, { $: "Disallowed", _0: "Bound" });
      kind = {
        $: "RegionPredicate",
        _0: new hir.WhereRegionPredicate(true, lifetime_, bounds_),
      };
      break;
    }
  }
  return { hir_id, span, kind };
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:1994 lower_test_binder_body
LoweringContext.prototype.lower_test_binder_body = function (this: LoweringContext, body: TestBinderBody): hir.TestBinderBody {
  const foralls = body.foralls.map((forall) => this.lower_test_binder_forall(forall));
  const exists = body.exists.map((exists) => this.lower_test_binder_exists(exists));
  const constraints = this.lower_test_binder_constraints_as_and(body.constraints);
  const dedup_map = new Map<LocalDefId, DefIdMap<Span>>();
  const predicates = body.predicates.map((predicate) => this.lower_where_predicate(predicate, [], dedup_map));
  return { foralls, exists, constraints, predicates };
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:2011 lower_test_binder_forall
LoweringContext.prototype.lower_test_binder_forall = function (this: LoweringContext, forall: TestBinderForall): hir.TestBinderForall {
  const [generics, body] = this.lower_generics(forall.generics, { $: "Disallowed", _0: "Bound" }, (this_) =>
    this_.lower_test_binder_body(forall.body),
  );
  const assert_on_exit =
    forall.assert_on_exit === undefined ? undefined : this.lower_test_binder_constraints_as_and(forall.assert_on_exit);
  return {
    span: this.lower_span(forall.span),
    hir_id: this.lower_node_id(forall.node_id),
    generics,
    body: body,
    assert_on_exit,
  };
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:2032 lower_test_binder_exists
LoweringContext.prototype.lower_test_binder_exists = function (this: LoweringContext, exists: TestBinderExists): hir.TestBinderExists {
  const [generics, body] = this.lower_generics(
    {
      params: exists.params.map(clone_GenericParam),
      // PORT: `#[derive(Default)]` of `WhereClause`: `false`, an empty `ThinVec`, `Span::default()` (`DUMMY_SP`).
      where_clause: new WhereClause(false, [], DUMMY_SP),
      span: exists.span,
    },
    { $: "Disallowed", _0: "Bound" },
    (this_) => this_.lower_test_binder_body(exists.body),
  );
  const params = generics.params;
  return {
    span: this.lower_span(exists.span),
    hir_id: this.lower_node_id(exists.node_id),
    params,
    body: body,
  };
};

// if there are multiple constraints in a block body, automatically wrap them in an `and {}`
// rustc: compiler/rustc_ast_lowering/src/item.rs:2055 lower_test_binder_constraints_as_and
LoweringContext.prototype.lower_test_binder_constraints_as_and = function (
  this: LoweringContext,
  constraints: readonly TestBinderConstraint[],
): hir.TestBinderConstraint {
  if (constraints.length === 1) {
    return this.lower_test_binder_constraint(constraints[0]!);
  } else {
    return {
      $: "And",
      items: constraints.map((item) => this.lower_test_binder_constraint(item)),
    };
  }
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:2070 lower_test_binder_constraint
LoweringContext.prototype.lower_test_binder_constraint = function (this: LoweringContext, constraint: TestBinderConstraint): hir.TestBinderConstraint {
  switch (constraint.$) {
    case "And":
      return {
        $: "And",
        items: constraint.items.map((item) => this.lower_test_binder_constraint(item)),
      };
    case "Or":
      return {
        $: "Or",
        items: constraint.items.map((item) => this.lower_test_binder_constraint(item)),
      };
    case "Ambiguity":
      return { $: "Ambiguity", span: this.lower_span(constraint.span) };
    case "Lifetime": {
      const { lhs: lhs_, rhs: rhs_ } = constraint;
      const lhs = this.lower_lifetime(lhs_, hir.LifetimeSource.Other, hir.LifetimeSyntax.from(lhs_.ident));
      const rhs = this.lower_lifetime(rhs_, hir.LifetimeSource.OutlivesBound, hir.LifetimeSyntax.from(rhs_.ident));
      return { $: "Lifetime", lhs, rhs };
    }
    case "PlaceholderOutlives": {
      const { lhs: lhs_, rhs: rhs_ } = constraint;
      const lhs = this.lower_ty_alloc(lhs_, { $: "Disallowed", _0: "Bound" });
      const rhs = this.lower_lifetime(rhs_, hir.LifetimeSource.OutlivesBound, hir.LifetimeSyntax.from(rhs_.ident));
      return { $: "PlaceholderOutlives", lhs, rhs };
    }
    case "AliasOutlives":
      return {
        $: "AliasOutlives",
        bound_type_constraint: this.lower_test_binder_bound_type_constraint(constraint.bound_type_constraint),
      };
  }
};

// rustc: compiler/rustc_ast_lowering/src/item.rs:2109 lower_test_binder_bound_type_constraint
LoweringContext.prototype.lower_test_binder_bound_type_constraint = function (
  this: LoweringContext,
  bound_type: TestBinderBoundTypeConstraint,
): hir.TestBinderBoundTypeConstraint {
  const { span, node_id, params, lhs: lhs_, rhs: rhs_ } = bound_type;

  const [generics, [lhs, rhs]] = this.lower_generics(
    // PORT: `Default::default()` of `WhereClause`, see `lower_test_binder_exists`.
    { params: params.map(clone_GenericParam), where_clause: new WhereClause(false, [], DUMMY_SP), span: span },
    { $: "Disallowed", _0: "Bound" },
    (this_): [hir.Ty, hir.Lifetime] => {
      const lhs = this_.lower_ty_alloc(lhs_, { $: "Disallowed", _0: "Bound" });
      const rhs = this_.lower_lifetime(rhs_, hir.LifetimeSource.OutlivesBound, hir.LifetimeSyntax.from(rhs_.ident));
      return [lhs, rhs];
    },
  );

  return {
    span: this.lower_span(span),
    hir_id: this.lower_node_id(node_id),
    params: generics.params,
    lhs,
    rhs,
  };
};
