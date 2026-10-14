// Port of compiler/rustc_passes/src/check_export.rs
import { ControlFlow, VisitorResult as VisitorResultC, type VisitorResult } from "../rustc_ast_ir/visit.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/hir.gen.ts";
import { type HirTyCtxt, Visitor, walk_item } from "../rustc_hir/intravisit.ts";
import { TyCtxt_as_HirTyCtxt } from "../rustc_middle/hir/map.ts";
import { All } from "../rustc_middle/hir/nested_filter.ts";
import { EffectiveVisibility, Level } from "../rustc_middle/middle/privacy.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import { HasAttrs_LocalDefId, type Ty, TypingEnv, Visibility, visit_with_Ty } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { Const, Region } from "../rustc_middle/ty/decls.ts";
import { type DefId, DefIdMap, DefIdSet, LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { type Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { fold_FnSig, FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { PredicateProxy } from "../rustc_type_ir/fold.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../rustc_type_ir/visit.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { unreachable, unwrap } from "../std/panic.ts";
import { UnexportableItem_diagnostic } from "./diagnostics.ts";

// impl<'tcx> ExportableItemCollector<'tcx> (check_export.rs:29) and its `Visitor` impl (:100) are the methods of the
// class below, in upstream order (PORTING §8).
// rustc-type: compiler/rustc_passes/src/check_export.rs:22 ExportableItemCollector
class ExportableItemCollector extends Visitor {
  // `type NestedFilter = nested_filter::All;`
  override NestedFilter = All;

  constructor(
    public tcx: TyCtxt,
    // PORT: `FxIndexSet<DefId>` is a `DefIdSet` (keyed by value, insertion-ordered).
    public exportable_items: DefIdSet,
    public in_exportable_mod: boolean,
    public seen_exportable_in_mod: boolean,
  ) {
    super();
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:30 new
  static new(tcx: TyCtxt): ExportableItemCollector {
    return new ExportableItemCollector(tcx, new DefIdSet(), false, false);
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:39 report_wrong_site
  report_wrong_site(def_id: LocalDefId): void {
    const def_descr = this.tcx.def_descr(LocalDefId.to_def_id(def_id));
    this.tcx.dcx().emit_err(
      UnexportableItem_diagnostic({
        $: "Item",
        descr: def_descr,
        span: this.tcx.def_span(def_id),
      }),
    );
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:47 item_is_exportable
  item_is_exportable(def_id: LocalDefId): boolean {
    const has_attr = find_attr(HasAttrs_LocalDefId.get_attrs(def_id, this.tcx), (k) => (k.$ === "ExportStable" ? null : undefined)) !== undefined;
    if (!this.in_exportable_mod && !has_attr) {
      return false;
    }

    const visibilities = this.tcx.effective_visibilities(null);
    const is_pub = visibilities.is_directly_public(def_id);

    if (has_attr && !is_pub) {
      const vis_ =
        visibilities.effective_vis(def_id) ??
        EffectiveVisibility.from_vis({ $: "Restricted", _0: this.tcx.parent_module_from_def_id(def_id) });
      const vis = vis_.at_level(Level.Direct);
      const span = this.tcx.def_span(def_id);

      this.tcx.dcx().emit_err(
        UnexportableItem_diagnostic({
          $: "PrivItem",
          vis_note: span,
          vis_descr: Visibility.to_string(vis, def_id, this.tcx),
          span,
        }),
      );
      return false;
    }

    return is_pub && (has_attr || this.in_exportable_mod);
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:76 add_exportable
  add_exportable(def_id: LocalDefId): void {
    this.seen_exportable_in_mod = true;
    this.exportable_items.add(LocalDefId.to_def_id(def_id));
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:81 walk_item_with_mod
  walk_item_with_mod(item: hir.Item): void {
    const def_id = item.hir_id().owner.def_id;
    const old_exportable_mod = this.in_exportable_mod;
    if (find_attr(HasAttrs_LocalDefId.get_attrs(def_id, this.tcx), (k) => (k.$ === "ExportStable" ? null : undefined)) !== undefined) {
      this.in_exportable_mod = true;
    }
    const old_seen_exportable_in_mod = this.seen_exportable_in_mod;
    this.seen_exportable_in_mod = false;

    walk_item(this, item);

    if (this.seen_exportable_in_mod || this.in_exportable_mod) {
      this.exportable_items.add(LocalDefId.to_def_id(def_id));
    }

    this.seen_exportable_in_mod = old_seen_exportable_in_mod;
    this.in_exportable_mod = old_exportable_mod;
  }

  // impl<'tcx> Visitor<'tcx> for ExportableItemCollector<'tcx>

  // rustc: compiler/rustc_passes/src/check_export.rs:103 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:107 visit_item
  override visit_item(item: hir.Item): undefined {
    const def_id = item.hir_id().owner.def_id;
    // Applying #[extern] attribute to modules is simply equivalent to
    // applying the attribute to every public item within it.
    if (item.kind.$ === "Mod") {
      this.walk_item_with_mod(item);
      return;
    } else if (item.kind.$ === "Impl" && item.kind._0.of_trait === undefined) {
      this.walk_item_with_mod(item);
      return;
    } else {
      // _ => {}
    }

    if (!this.item_is_exportable(def_id)) {
      return;
    }

    const kind = item.kind;
    if (kind.$ === "Fn" || kind.$ === "Struct" || kind.$ === "Enum" || kind.$ === "Union" || kind.$ === "TyAlias") {
      this.add_exportable(def_id);
    } else if (kind.$ === "Use") {
      const tree = kind._0;
      for (const res of tree.resolutions()) {
        for (const res_ of res.present_items()) {
          // Only local items are exportable.
          const res_id = Res.opt_def_id(res_);
          const res_id_ = res_id?.as_local();
          if (res_id !== undefined && res_id_ !== undefined) {
            this.add_exportable(res_id_);
          }
        }
      }
    }
    // handled above
    // `hir::ItemKind::Mod(..) => unreachable!()`: TS has already narrowed `Mod` away.
    else if (kind.$ === "Impl" && kind._0.of_trait === undefined) {
      unreachable();
    } else {
      this.tcx.dcx().delayed_bug("Target is checked by attribute parser");
    }
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:158 visit_impl_item
  override visit_impl_item(item: hir.ImplItem): undefined {
    const def_id = item.hir_id().owner.def_id;
    if (!this.item_is_exportable(def_id)) {
      return;
    }
    if (item.kind.$ === "Fn" || item.kind.$ === "Type") {
      this.add_exportable(def_id);
    } else {
      this.report_wrong_site(def_id);
    }
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:171 visit_foreign_item
  override visit_foreign_item(item: hir.ForeignItem): undefined {
    const def_id = item.hir_id().owner.def_id;
    if (!this.item_is_exportable(def_id)) {
      this.report_wrong_site(def_id);
    }
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:178 visit_trait_item
  override visit_trait_item(item: hir.TraitItem): undefined {
    const def_id = item.hir_id().owner.def_id;
    if (!this.item_is_exportable(def_id)) {
      this.report_wrong_site(def_id);
    }
  }
}

// impl<'tcx, 'a> ExportableItemsChecker<'tcx, 'a> (check_export.rs:192) and its `TypeVisitor` impl (:273) are the
// methods of the class below, in upstream order (PORTING §8).
// rustc-type: compiler/rustc_passes/src/check_export.rs:186 ExportableItemsChecker
class ExportableItemsChecker implements TypeVisitor<ControlFlow<Ty>> {
  // type Result = ControlFlow<Ty<'tcx>>;
  readonly Result: VisitorResult<ControlFlow<Ty>, unknown> = VisitorResultC.ControlFlow<Ty>();

  constructor(
    public tcx: TyCtxt,
    public exportable_items: DefIdSet,
    public item_id: DefId,
  ) {}

  // rustc: compiler/rustc_passes/src/check_export.rs:193 check
  check(): void {
    const k = this.tcx.def_kind(this.item_id);
    if (k.$ === "Fn" || k.$ === "AssocFn") {
      this.check_fn();
    } else if (k.$ === "Enum" || k.$ === "Struct" || k.$ === "Union") {
      this.check_ty();
    } else {
      // _ => {}
    }
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:201 check_fn
  check_fn(): void {
    const def_id = this.item_id.expect_local();
    const span = this.tcx.def_span(def_id);

    if ((this.tcx.generics_of(def_id) as Generics).requires_monomorphization(this.tcx)) {
      this.tcx.dcx().emit_err(UnexportableItem_diagnostic({ $: "GenericFn", _0: span }));
      return;
    }

    const sig0 = Unnormalized.skip_binder(EarlyBinder.instantiate_identity(this.tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
    if (!(FnSig.abi(sig0).$ === "C")) {
      this.tcx.dcx().emit_err(UnexportableItem_diagnostic({ $: "FnAbi", _0: span }));
      return;
    }

    const normalized = this.tcx.try_normalize_erasing_regions(TypingEnv.non_body_analysis(this.tcx, def_id), Unnormalized.new_wip(sig0), fold_FnSig);
    const sig = normalized.$ === "Ok" ? normalized._0 : sig0;

    const hir_id = this.tcx.local_def_id_to_hir_id(def_id);
    const decl = unwrap(this.tcx.hir_fn_decl_by_hir_id(hir_id));

    // `iter::zip(sig.inputs(), decl.inputs)`
    const inputs = FnSig.inputs(sig);
    for (let i = 0; i < Math.min(inputs.length, decl.inputs.length); i++) {
      const input_ty = inputs[i]!;
      const input_hir = decl.inputs[i]!;
      this.check_nested_types_are_exportable(input_ty, input_hir.span);
    }

    if (decl.output.$ === "Return") {
      const ret_hir = decl.output._0;
      this.check_nested_types_are_exportable(FnSig.output(sig), ret_hir.span);
    }
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:236 check_ty
  check_ty(): void {
    const ty = EarlyBinder.skip_binder(this.tcx.type_of(this.item_id) as EarlyBinder<Ty>);
    const k = ty.kind();
    if (k.$ === "Adt") {
      const adt_def: AdtDef = k._0;
      if (!adt_def.repr().inhibit_struct_field_reordering()) {
        this.tcx.dcx().emit_err(UnexportableItem_diagnostic({ $: "TypeRepr", _0: this.tcx.def_span(this.item_id) }));
      }

      // FIXME: support `#[export(unsafe_stable_abi = "hash")]` syntax
      for (const variant of adt_def.variants()) {
        for (const field of variant.fields) {
          if (!Visibility.is_public(field.vis)) {
            this.tcx.dcx().emit_err(
              UnexportableItem_diagnostic({
                $: "AdtWithPrivFields",
                span: this.tcx.def_span(this.item_id),
                vis_note: this.tcx.def_span(field.did),
                field_name: Symbol.as_str(field.name),
              }),
            );
          }
        }
      }
    }
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:260 check_nested_types_are_exportable
  check_nested_types_are_exportable(ty: Ty, ty_span: Span): void {
    const res = visit_with_Ty(ty, this);
    if (res.$ === "Break") {
      const err_cause = res._0;
      this.tcx.dcx().emit_err(
        UnexportableItem_diagnostic({
          $: "TypeInInterface",
          span: this.tcx.def_span(this.item_id),
          desc: this.tcx.def_descr(this.item_id),
          ty: display_Ty(err_cause),
          ty_span,
        }),
      );
    }
  }

  // impl<'tcx, 'a> TypeVisitor<TyCtxt<'tcx>> for ExportableItemsChecker<'tcx, 'a>

  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:276 visit_ty
  visit_ty(ty: Ty): ControlFlow<Ty> {
    const k = ty.kind();
    switch (k.$) {
      case "Adt": {
        const adt_def = k._0;
        const did = adt_def.did();
        const exportable = did.is_local() ? this.exportable_items.has(did) : this.tcx.is_exportable(did);
        if (!exportable) {
          return ControlFlow.Break(ty);
        }
        for (const variant of adt_def.variants()) {
          for (const field of variant.fields) {
            const field_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(field.did) as EarlyBinder<Ty>));
            const r = visit_with_Ty(field_ty, this);
            if (r.$ === "Break") return r;
          }
        }

        return fold_Ty.super_visit_with(ty, this);
      }

      case "Int":
      case "Uint":
      case "Float":
      case "Bool":
      case "Char":
      case "Error":
        break;

      case "Array":
      case "Ref":
      case "Param":
      case "Closure":
      case "Dynamic":
      case "Coroutine":
      case "Foreign":
      case "Str":
      case "Tuple":
      case "Pat":
      case "Slice":
      case "RawPtr":
      case "FnDef":
      case "FnPtr":
      case "CoroutineClosure":
      case "CoroutineWitness":
      case "Never":
      case "UnsafeBinder":
        return ControlFlow.Break(ty);

      case "Alias":
        // `ty::Alias(_, ty::AliasTy { kind: ty::AliasTyKind::Opaque { .. }, .. })` breaks; any other alias is
        // unreachable (with `Infer`, `Placeholder`, `Bound`).
        if (k._1.kind.$ === "Opaque") {
          return ControlFlow.Break(ty);
        }
        return unreachable();

      case "Infer":
      case "Placeholder":
      case "Bound":
        return unreachable();
    }
    return ControlFlow.CONTINUE;
  }

  visit_region(r: Region): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_region(this, r);
  }

  visit_const(c: Const): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_const(this, c);
  }

  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }

  visit_clauses(c: Clauses): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }

  visit_error(guar: ErrorGuaranteed): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/// Exportable items:
///
/// 1. Structs/enums/unions with a stable representation (e.g. repr(i32) or repr(C)).
/// 2. Primitive types.
/// 3. Non-generic functions with a stable ABI (e.g. extern "C") for which every user
///    defined type used in the signature is also marked as `#[export]`.
// rustc: compiler/rustc_passes/src/check_export.rs:335 exportable_items_provider_local
function exportable_items_provider_local(tcx: TyCtxt, _: unknown): readonly DefId[] {
  if (!tcx.crate_types().includes("Sdylib") && !tcx.is_sdylib_interface_build()) {
    return [];
  }

  const visitor = ExportableItemCollector.new(tcx);
  tcx.hir_walk_toplevel_module(visitor);
  const exportable_items = visitor.exportable_items;
  for (const item_id of exportable_items) {
    const validator = new ExportableItemsChecker(tcx, exportable_items, item_id);
    validator.check();
  }

  return [...exportable_items];
}

// impl<'tcx> ImplsOrderVisitor<'tcx> (check_export.rs:357) and its `Visitor` impl (:363) are the methods of the
// class below, in upstream order (PORTING §8).
// rustc-type: compiler/rustc_passes/src/check_export.rs:352 ImplsOrderVisitor
class ImplsOrderVisitor extends Visitor {
  // `type NestedFilter = nested_filter::All;`
  override NestedFilter = All;

  constructor(
    public tcx: TyCtxt,
    // PORT: `FxIndexMap<DefId, usize>` is a `DefIdMap` (keyed by value, insertion-ordered).
    public order: DefIdMap<number>,
  ) {
    super();
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:358 new
  static new(tcx: TyCtxt): ImplsOrderVisitor {
    return new ImplsOrderVisitor(tcx, new DefIdMap());
  }

  // impl<'tcx> Visitor<'tcx> for ImplsOrderVisitor<'tcx>

  // rustc: compiler/rustc_passes/src/check_export.rs:366 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_passes/src/check_export.rs:370 visit_item
  override visit_item(item: hir.Item): undefined {
    if (item.kind.$ === "Impl" && item.kind._0.of_trait === undefined && this.tcx.is_exportable(LocalDefId.to_def_id(item.owner_id.def_id))) {
      this.order.set(LocalDefId.to_def_id(item.owner_id.def_id), this.order.size);
    }
    walk_item(this, item);
  }
}

/// During symbol mangling rustc uses a special index to distinguish between two impls of
/// the same type in the same module(See `DisambiguatedDefPathData`). For exportable items
/// we cannot use the current approach because it is dependent on the compiler's
/// implementation.
///
/// In order to make disambiguation independent of the compiler version we can assign an
/// id to each impl according to the relative order of elements in the source code.
// rustc: compiler/rustc_passes/src/check_export.rs:388 stable_order_of_exportable_impls
function stable_order_of_exportable_impls(tcx: TyCtxt, _: unknown): Map<DefId, number> {
  if (!tcx.crate_types().includes("Sdylib") && !tcx.is_sdylib_interface_build()) {
    return new DefIdMap<number>();
  }

  const vis = ImplsOrderVisitor.new(tcx);
  tcx.hir_walk_toplevel_module(vis);
  return vis.order;
}

// rustc: compiler/rustc_passes/src/check_export.rs:401 provide
export function provide(providers: Providers): void {
  providers.exportable_items = exportable_items_provider_local;
  providers.stable_order_of_exportable_impls = stable_order_of_exportable_impls;
}
