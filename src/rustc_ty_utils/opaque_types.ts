// Port of compiler/rustc_ty_utils/src/opaque_types.rs (lane ty-utils).
//
// PORT: query values typed `unknown` in queries.gen.ts (`type_of`, `generics_of`, `explicit_item_bounds`,
// `opaque_types_defined_by`, `associated_items`, `opt_rpitit_info`, `hir_attr_map`, `anon_const_kind`) are cast to
// their upstream types at the read site.
// PORT (D4): `visit_spanned` and `SpannedTypeVisitor::visit` take the value's descriptor last.
// PORT: tracing (`#[instrument]`, `trace!`) is left out.
import type { VisitorResult } from "../rustc_ast_ir/visit.ts";
import { VisitorResult as VisitorResultC } from "../rustc_ast_ir/visit.ts";
import { DefKind } from "../rustc_hir/def.ts";
import type { AttributeMap, BodyId, ItemId } from "../rustc_hir/hir.ts";
import { Defaultness } from "../rustc_hir/hir.ts";
import { Visitor } from "../rustc_hir/intravisit.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import { AssocItem, AssocItems } from "../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { ImplTraitInTraitData } from "../rustc_middle/ty/decls.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import { type List, RawList } from "../rustc_middle/ty/list.ts";
import { debug_Ty, type Ty } from "../rustc_middle/ty/mod.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import { fold_Clause, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { Clauses } from "../rustc_middle/ty/list.ts";
import { type Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { PredicateProxy } from "../rustc_type_ir/fold.ts";
import type { Const } from "../rustc_type_ir/sty/consts.ts";
import type { Region } from "../rustc_type_ir/sty/mod.ts";
import { type AliasTy, debug_Alias } from "../rustc_type_ir/ty/alias.ts";
import { AliasTy as AliasTyC, debug_AliasTyKind } from "../rustc_type_ir/ty_kind.ts";
import { as_interner, type TraitRef } from "../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitor_provided } from "../rustc_type_ir/visit.ts";
import { walk_types, type SpannedTypeVisitor } from "../rustc_ty_walk/lib.ts";
import { DefId_eq, debug_LocalDefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { PLAIN } from "../std/fmt.ts";
import { DuplicateArg_diagnostic, NotParam_diagnostic } from "./diagnostics.ts";

// rustc-type: compiler/rustc_ty_utils/src/opaque_types.rs:30 CollectionMode
type CollectionMode =
  /// For impl trait in assoc types we only permit collecting them from
  /// associated types of the same impl block.
  | "ImplTraitInAssocTypes"
  /// When collecting for an explicit `#[define_opaque]` attribute, find all TAITs
  | "Taits"
  /// By default collect RPITs and async function return types defined by this item
  | "RpitAndAsyncFnOnly";

// rustc-type: compiler/rustc_ty_utils/src/opaque_types.rs:16 OpaqueTypeCollector
class OpaqueTypeCollector implements TypeVisitor<undefined>, SpannedTypeVisitor<undefined> {
  /** `type Result = ();` (both `TypeVisitor` and `SpannedTypeVisitor`) */
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(
    readonly tcx: TyCtxt,
    public opaques: LocalDefId[],
    /// The `DefId` of the item which we are collecting opaque types for.
    readonly item: LocalDefId,

    /// Avoid infinite recursion due to recursive declarations.
    readonly seen: Set<LocalDefId>,

    public span_: Span | undefined,

    public mode: CollectionMode,
  ) {}

  // rustc: compiler/rustc_ty_utils/src/opaque_types.rs:41 new
  static new(tcx: TyCtxt, item: LocalDefId): OpaqueTypeCollector {
    let mode: CollectionMode;
    switch (tcx.def_kind(item).$) {
      case "AssocConst":
      case "AssocFn":
      case "AssocTy":
        mode = "ImplTraitInAssocTypes";
        break;
      case "TyAlias":
        mode = "Taits";
        break;
      default:
        mode = "RpitAndAsyncFnOnly";
        break;
    }
    return new OpaqueTypeCollector(tcx, [], item, new Set(), undefined, mode);
  }

  // PORT: the field `span` is `span_` (the method needs the name).
  // rustc: compiler/rustc_ty_utils/src/opaque_types.rs:52 span
  span(): Span {
    if (this.span_ !== undefined) return this.span_;
    return this.tcx.def_ident_span(this.item) ?? this.tcx.def_span(this.item);
  }

  // rustc: compiler/rustc_ty_utils/src/opaque_types.rs:58 visit_spanned
  visit_spanned<T>(span: Span, value: T, d: TypeVisitable<T>): void {
    const old = this.span_;
    this.span_ = span;
    d.visit_with(value, this);
    this.span_ = old;
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_ty_utils/src/opaque_types.rs:66 collect_taits_declared_in_body
  collect_taits_declared_in_body(): void {
    const body_ = this.tcx.hir_maybe_body_owned_by(this.item);
    if (body_ === undefined) {
      return;
    }
    const body = body_.value;
    // rustc-type: compiler/rustc_ty_utils/src/opaque_types.rs:71 TaitInBodyFinder
    class TaitInBodyFinder extends Visitor {
      constructor(readonly collector: OpaqueTypeCollector) {
        super();
      }
      // #[instrument(level = "trace", skip(self))]
      // rustc: compiler/rustc_ty_utils/src/opaque_types.rs:76 visit_nested_item
      override visit_nested_item(id_: ItemId): undefined {
        const id = id_.owner_id.def_id;
        if (this.collector.tcx.def_kind(id).$ === "TyAlias") {
          const items = this.collector.tcx.opaque_types_defined_by(id) as List<LocalDefId>;
          this.collector.opaques.push(...items);
        }
        return undefined;
      }
      // #[instrument(level = "trace", skip(self))]
      // Recurse into these, as they are type checked with their parent
      // rustc: compiler/rustc_ty_utils/src/opaque_types.rs:85 visit_nested_body
      override visit_nested_body(id: BodyId): undefined {
        const body = this.collector.tcx.hir_body(id);
        this.visit_body(body);
        return undefined;
      }
    }
    new TaitInBodyFinder(this).visit_expr(body);
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_ty_utils/src/opaque_types.rs:94 visit_opaque_ty
  visit_opaque_ty(alias_ty: AliasTy): void {
    if (alias_ty.kind.$ !== "Opaque") return bug(debug_Alias(alias_ty, PLAIN, debug_AliasTyKind));
    const def_id = alias_ty.kind.def_id;

    if (!insert(this.seen, def_id.expect_local())) {
      return;
    }

    // TAITs outside their defining scopes are ignored.
    const origin = this.tcx.local_opaque_ty_origin(def_id.expect_local());
    switch (origin.$) {
      case "FnReturn":
      case "AsyncFn":
        break;
      case "TyAlias": {
        const in_assoc_ty = origin.in_assoc_ty;
        switch (this.mode) {
          // If we are collecting opaques in an assoc method, we are only looking at assoc types
          // mentioned in the assoc method and only at opaques defined in there. We do not
          // want to collect TAITs
          case "ImplTraitInAssocTypes":
            if (!in_assoc_ty) {
              return;
            }
            break;
          // If we are collecting opaques referenced from a `define_opaque` attribute, we
          // do not want to look at opaques defined in associated types. Those can only be
          // defined by methods on the same impl.
          case "Taits":
            if (in_assoc_ty) {
              return;
            }
            break;
          case "RpitAndAsyncFnOnly":
            return;
        }
        break;
      }
    }

    // trace!(?alias_ty, "adding");
    this.opaques.push(def_id.expect_local());

    const parent_count = (this.tcx.generics_of(def_id) as Generics).parent_count;
    // Only check that the parent generics of the TAIT/RPIT are unique.
    // the args owned by the opaque are going to always be duplicate
    // lifetime params for RPITs, and empty for TAITs.
    const r = this.tcx.uses_unique_generic_params(alias_ty.args.slice(0, parent_count), "FromFunction");
    if (r.$ === "Ok") {
      // FIXME: implement higher kinded lifetime bounds on nested opaque types. They are not
      // supported at all, so this is sound to do, but once we want to support them, you'll
      // start seeing the error below.

      // Collect opaque types nested within the associated type bounds of this opaque type.
      // We use identity args here, because we already know that the opaque type uses
      // only generic parameters, and thus instantiating would not give us more information.
      for (const [pred, span] of [
        ...EarlyBinder.iter_identity_copied(this.tcx.explicit_item_bounds(def_id) as EarlyBinder<readonly (readonly [Clause, Span])[]>),
      ].map(Unnormalized.skip_norm_wip)) {
        // trace!(?pred);
        this.visit_spanned(span, pred, fold_Clause);
      }
    } else if (r._0.$ === "NotParam") {
      const arg = r._0._0;
      this.tcx.dcx().emit_err(NotParam_diagnostic({ arg, span: this.span(), opaque_span: this.tcx.def_span(def_id) }));
    } else {
      const arg = r._0._0;
      this.tcx.dcx().emit_err(DuplicateArg_diagnostic({ arg, span: this.span(), opaque_span: this.tcx.def_span(def_id) }));
    }
  }

  /// Checks the `#[define_opaque]` attributes on items and collects opaques to define
  /// from the referenced types.
  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_ty_utils/src/opaque_types.rs:175 collect_taits_from_defines_attr
  collect_taits_from_defines_attr(): void {
    const hir_id = this.tcx.local_def_id_to_hir_id(this.item);
    if (!hir_id.is_owner()) {
      return;
    }
    const defines = (this.tcx.hir_attr_map(hir_id.owner) as AttributeMap).define_opaque;
    if (defines === undefined) {
      return;
    }
    for (const [span, define] of defines) {
      // trace!(?define);
      const mode = this.mode;
      this.mode = "Taits";
      const n = this.opaques.length;
      walk_types(this.tcx, define, this);
      if (n === this.opaques.length) {
        this.tcx.dcx().span_err(span, "item does not contain any opaque types");
      }
      this.mode = mode;
    }
    // Allow using `#[define_opaque]` on assoc methods and type aliases to override the default collection mode in
    // case it was capturing too much.
    this.mode = "RpitAndAsyncFnOnly";
  }

  // ---- impl<'tcx> rustc_ty_walk::SpannedTypeVisitor<'tcx> for OpaqueTypeCollector<'tcx> ----

  // #[instrument(skip(self), ret, level = "trace")]
  // rustc: compiler/rustc_ty_utils/src/opaque_types.rs:201 visit
  visit<T>(span: Span, value: T, d: TypeVisitable<T>): undefined {
    this.visit_spanned(span, value, d);
    return undefined;
  }

  // ---- impl<'tcx> TypeVisitor<TyCtxt<'tcx>> for OpaqueTypeCollector<'tcx> ----

  // #[instrument(skip(self), ret, level = "trace")]
  // rustc: compiler/rustc_ty_utils/src/opaque_types.rs:208 visit_ty
  visit_ty(t: Ty): undefined {
    fold_Ty.super_visit_with(t, this);
    const k = t.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Opaque" && k._1.kind.def_id.is_local()) {
      const alias_ty = k._1;
      this.visit_opaque_ty(alias_ty);
    }
    // Skips type aliases, as they are meant to be transparent.
    // FIXME(type_alias_impl_trait): can we require mentioning nested type aliases explicitly?
    else if (k.$ === "Alias" && k._1.kind.$ === "Free" && k._1.kind.def_id.as_local() !== undefined) {
      const def_id = k._1.kind.def_id.as_local()!;
      const args = k._1.args;
      if (!insert(this.seen, def_id)) {
        return;
      }
      fold_Ty.visit_with(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.type_of(def_id) as EarlyBinder<Ty>, this.tcx, args, fold_Ty)), this);
    } else if (k.$ === "Alias" && k._1.kind.$ === "Projection") {
      const alias_ty = k._1;
      const alias_def_id = k._1.kind.def_id;
      // This avoids having to do normalization of `Self::AssocTy` by only
      // supporting the case of a method defining opaque types from assoc types
      // in the same impl block.
      const parent = this.tcx.trait_impl_of_assoc(LocalDefId.to_def_id(this.item));
      if (parent !== undefined) {
        const impl_trait_ref = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.impl_trait_ref(parent))) as TraitRef;
        // If the trait ref of the associated item and the impl differs,
        // then we can't use the impl's identity args below, so
        // just skip.
        if (TraitRef_eq(AliasTyC.trait_ref(alias_ty, as_interner(this.tcx)), impl_trait_ref)) {
          for (const assoc of AssocItems.in_definition_order(this.tcx.associated_items(parent) as AssocItems)) {
            // trace!(?assoc);
            const ti = AssocItem.expect_trait_impl(assoc);
            if (!(ti.$ === "Ok" && DefId_eq(ti._0, alias_def_id))) {
              continue;
            }

            // If the type is further specializable, then the type_of
            // is not actually correct below.
            if (!Defaultness.is_final(AssocItem.defaultness(assoc, this.tcx))) {
              continue;
            }

            if (!insert(this.seen, assoc.def_id.expect_local())) {
              return;
            }

            const alias_args = alias_ty.args.rebase_onto(this.tcx, impl_trait_ref.def_id, RawList.identity_for_item(this.tcx, parent));

            if (this.tcx.check_args_compatible(assoc.def_id, alias_args)) {
              fold_Ty.visit_with(
                Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.type_of(assoc.def_id) as EarlyBinder<Ty>, this.tcx, alias_args, fold_Ty)),
                this,
              );
              return;
            } else {
              this.tcx.dcx().span_delayed_bug(this.tcx.def_span(assoc.def_id), "item had incorrect args");
            }
          }
        }
      } else {
        const info = this.tcx.opt_rpitit_info(alias_def_id) as ImplTraitInTraitData | undefined;
        if (info !== undefined && info.$ === "Trait" && DefId_eq(info.fn_def_id, LocalDefId.to_def_id(this.item))) {
          // RPITIT in trait definitions get desugared to an associated type. For
          // default methods we also create an opaque type this associated type
          // normalizes to. The associated type is only known to normalize to the
          // opaque if it is fully concrete. There could otherwise be an impl
          // overwriting the default method.
          //
          // However, we have to be able to normalize the associated type while inside
          // of the default method. This is normally handled by adding an unchecked
          // `Projection(<Self as Trait>::synthetic_assoc_ty, trait_def::opaque)`
          // assumption to the `param_env` of the default method. We also separately
          // rely on that assumption here.
          const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(this.tcx.type_of(alias_def_id) as EarlyBinder<Ty>, this.tcx, alias_ty.args, fold_Ty));
          const tk = ty.kind();
          if (!(tk.$ === "Alias" && tk._1.kind.$ === "Opaque")) {
            return bug(debug_Ty(ty, PLAIN));
          }
          const alias_ty2 = tk._1;
          this.visit_opaque_ty(alias_ty2);
        }
      }
    } else {
      // trace!(kind=?t.kind())
    }
    return undefined;
  }

  // ---- provided `TypeVisitor` methods (PORTING §8) ----
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Const): undefined {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/** `FxHashSet::insert`: `true` if the value was not present. */
function insert<T>(set: Set<T>, v: T): boolean {
  if (set.has(v)) return false;
  set.add(v);
  return true;
}

/** PORT: `#[derive(PartialEq)]` of `TraitRef` (`def_id`, interned `args`; the `()` field compares equal). */
function TraitRef_eq(a: TraitRef, b: TraitRef): boolean {
  return DefId_eq(a.def_id, b.def_id) && a.args === b.args;
}

// rustc: compiler/rustc_ty_utils/src/opaque_types.rs:314 opaque_types_defined_by
function opaque_types_defined_by(tcx: TyCtxt, item: LocalDefId): List<LocalDefId> {
  // Closures and coroutines are type checked with their parent
  // Note that we also support `SyntheticCoroutineBody` since we create
  // a MIR body for the def kind, and some MIR passes (like promotion)
  // may require doing analysis using its typing env.
  if (tcx.is_typeck_child(LocalDefId.to_def_id(item))) {
    return tcx.opaque_types_defined_by(tcx.local_parent(item)) as List<LocalDefId>;
  }

  // delegation inherits its signature without defining its opaque types
  if (tcx.hir_opt_delegation_sig_id(item) !== undefined) {
    return tcx.mk_local_def_ids([]);
  }

  const kind = tcx.def_kind(item);
  // trace!(?kind);
  const collector = OpaqueTypeCollector.new(tcx, item);
  collector.collect_taits_from_defines_attr();
  walk_types(tcx, item, collector);

  switch (kind.$) {
    case "AssocFn":
    case "Fn":
    case "Static":
    case "Const":
    case "AssocConst":
    case "AnonConst": {
      // Non-type-system inline consts should be caught by `if tcx.is_typeck_child` above
      // debug_assert!(
      //     kind != DefKind::AnonConst
      //         || tcx.anon_const_kind(item) != ty::AnonConstKind::NonTypeSystemInline
      // );

      collector.collect_taits_declared_in_body();
      break;
    }
    case "AssocTy":
    case "TyAlias":
    case "GlobalAsm":
      break;
    case "OpaqueTy":
    case "Mod":
    case "Struct":
    case "Union":
    case "Enum":
    case "Variant":
    case "Trait":
    case "ForeignTy":
    case "TraitAlias":
    case "Closure":
    case "SyntheticCoroutineBody":
    case "TyParam":
    case "ConstParam":
    case "Ctor":
    case "Macro":
    case "ExternCrate":
    case "Use":
    case "ForeignMod":
    case "Field":
    case "LifetimeParam":
    case "Impl":
    case "TestBinderConstraints": {
      return span_bug(
        tcx.def_span(item),
        `\`opaque_types_defined_by\` not defined for ${DefKind.descr(kind, LocalDefId.to_def_id(item))} \`${debug_LocalDefId(item, PLAIN)}\``,
      );
    }
  }
  return tcx.mk_local_def_ids(collector.opaques);
}

// rustc: compiler/rustc_ty_utils/src/opaque_types.rs:385 provide
export function provide(providers: Providers): void {
  providers.opaque_types_defined_by = opaque_types_defined_by;
}
