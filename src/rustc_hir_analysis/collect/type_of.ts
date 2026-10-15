// Port of compiler/rustc_hir_analysis/src/collect/type_of.rs (lane collect-a).
//
// Init order: top-level code here may touch only ../decls.ts (the classes), this file's .gen.ts and other crates; every other
// rustc_hir_analysis export is read inside function bodies only.
import { check_static_item } from "../check/wfcheck.ts";
import { ControlFlow, VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { into_MultiSpan } from "../../rustc_error_messages/lib.ts";
import type { Diag } from "../../rustc_errors/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { debug_ItemKind, debug_Node } from "../../rustc_hir/lib.ts";
import { type HirId, HirId_eq } from "../../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { InlineConstArgs } from "../../rustc_middle/ty/sty.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import type { BoundVariableKind } from "../../rustc_type_ir/decls.ts";
import { DefiningScopeKind, Ty } from "../../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../../rustc_middle/ty/typeck_results.ts";
import { IntTypeExt } from "../../rustc_middle/ty/util.ts";
import { IsSuggestable } from "../../rustc_middle/ty/diagnostics.ts";
import { display_Ty, with_forced_trimmed_paths, with_types_for_suggestion } from "../../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { feature_err } from "../../rustc_session/diagnostics.ts";
import { type DefId, DefId_eq, LocalDefId } from "../../rustc_span/def_id.ts";
import { type ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { DUMMY_SP } from "../../rustc_span/span_encoding.ts";
import { type Ident, sym } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic, unported } from "../../std/panic.ts";
import type { HirTyLowerer, ItemCtxt } from "../decls.ts";
import { bad_placeholder, HirPlaceholderCollector, ItemCtxt as ItemCtxtC } from "../collect.ts";
import * as diagnostics from "../diagnostics.ts";
import * as opaque from "./type_of/opaque.ts";

// mod opaque;

// PORT: `#[instrument(level = "debug", skip(tcx), ret)]` (tracing) is dropped.
// rustc: compiler/rustc_hir_analysis/src/collect/type_of.rs:21 type_of
export function type_of(tcx: TyCtxt, def_id_: LocalDefId): EarlyBinder<Ty> {
  // If we are computing `type_of` the synthesized associated type for an RPITIT in the impl
  // side, use `collect_return_position_impl_trait_in_trait_tys` to infer the value of the
  // associated type in the impl.
  const rpitit = tcx.opt_rpitit_info(LocalDefId.to_def_id(def_id_));
  if (rpitit !== undefined) {
    switch (rpitit.$) {
      case "Impl": {
        const { fn_def_id } = rpitit;
        const r = tcx.collect_return_position_impl_trait_in_trait_tys(fn_def_id);
        switch (r.$) {
          case "Ok": {
            const map = r._0;
            const trait_item_def_id = tcx.trait_item_of(LocalDefId.to_def_id(def_id_));
            if (trait_item_def_id === undefined) return panic("called `Option::unwrap()` on a `None` value");
            const v = map.get(trait_item_def_id);
            if (v === undefined) return panic("key not found");
            return v as EarlyBinder<Ty>;
          }
          case "Err":
            return EarlyBinder.bind(
              tcx,
              Ty.new_error_with_message(tcx, into_MultiSpan(DUMMY_SP), "Could not collect return position impl trait in trait tys"),
              fold_Ty,
            );
        }
        break;
      }
      // For an RPITIT in a trait, just return the corresponding opaque.
      case "Trait": {
        const { opaque_def_id } = rpitit;
        return EarlyBinder.bind(tcx, Ty.new_opaque(tcx, "No", opaque_def_id, RawList.identity_for_item(tcx, opaque_def_id)), fold_Ty);
      }
    }
  }

  const new_bound_fn_def = (hir_: HirId, did: DefId): Ty => {
    const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id_));
    const x = tcx.late_bound_vars_map(hir_.owner).get(hir_.local_id) as readonly BoundVariableKind[] | undefined;
    const late_bound = x !== undefined ? tcx.mk_bound_variable_kinds(x) : undefined;
    return Ty.new_fn_def(tcx, did, late_bound !== undefined ? Binder.bind_with_vars(args, late_bound) : Binder.dummy(args, fold_GenericArgs));
  };

  const hir_id = tcx.local_def_id_to_hir_id(def_id_);
  const hir_node = tcx.hir_node(hir_id);
  let def_id: LocalDefId;
  switch (hir_node.$) {
    // For generic params, we lower in the context of the overarching item to be able to resolve
    // type-relative paths in type param defaults & const param types.
    // FIXME: Remove this special case again & simply set the `Generics.parent` for generic
    //        params in `generics_of` similar to struct fields. However, that's blocked on the
    //        removal of GCE in favor of mGCA. Doing this change now would introduce tons of
    //        query cycles for GCE.
    case "GenericParam":
      def_id = tcx.local_parent(def_id_);
      break;
    default:
      def_id = def_id_;
  }
  const icx = ItemCtxtC.new(tcx, def_id);

  let output: Ty;
  switch (hir_node.$) {
    case "TraitItem": {
      const item = hir_node._0;
      const k = item.kind;
      switch (k.$) {
        case "Fn":
          output = new_bound_fn_def(item.hir_id(), LocalDefId.to_def_id(def_id));
          break;
        case "Const": {
          const ty = k._0;
          const rhs = k._1;
          let r: Ty | undefined = undefined;
          if (rhs !== undefined && ty.is_suggestable_infer_ty()) {
            let hir_body_id: HirId | undefined;
            switch (rhs.$) {
              case "Body":
                hir_body_id = rhs._0.hir_id;
                break;
              case "Direct":
                hir_body_id = undefined;
                break;
            }
            r = infer_placeholder_type(icx.lowerer(), def_id, hir_body_id, ty.span, hir.ConstItemRhs.span(rhs, tcx), item.ident, "associated constant");
          }
          output = r ?? icx.lower_ty(ty);
          break;
        }
        case "Type": {
          const ty = k._1;
          if (ty !== undefined) {
            output = icx.lower_ty(ty);
          } else {
            return span_bug(item.span, "type_of: associated type missing default");
          }
          break;
        }
      }
      break;
    }

    case "ImplItem": {
      const item = hir_node._0;
      const k = item.kind;
      switch (k.$) {
        case "Fn":
          output = new_bound_fn_def(item.hir_id(), LocalDefId.to_def_id(def_id));
          break;
        case "Const": {
          const ty = k._0;
          const rhs = k._1;
          if (ty.is_suggestable_infer_ty()) {
            let hir_body_id: HirId | undefined;
            switch (rhs.$) {
              case "Body":
                hir_body_id = rhs._0.hir_id;
                break;
              case "Direct":
                hir_body_id = undefined;
                break;
            }
            output = infer_placeholder_type(icx.lowerer(), def_id, hir_body_id, ty.span, hir.ConstItemRhs.span(rhs, tcx), item.ident, "associated constant");
          } else {
            output = icx.lower_ty(ty);
          }
          break;
        }
        case "Type": {
          const ty = k._0;
          if (item.impl_kind.$ === "Inherent") {
            check_feature_inherent_assoc_ty(tcx, item.span);
          }

          output = icx.lower_ty(ty);
          break;
        }
      }
      break;
    }

    case "Item": {
      const item = hir_node._0;
      const k = item.kind;
      switch (k.$) {
        case "Static": {
          const ident = k._1;
          const ty = k._2;
          const body_id = k._3;
          if (ty.is_suggestable_infer_ty()) {
            output = infer_placeholder_type(icx.lowerer(), def_id, body_id.hir_id, ty.span, tcx.hir_body(body_id).value.span, ident, "static variable");
          } else {
            const ty_ = icx.lower_ty(ty);
            // MIR relies on references to statics being scalars.
            // Verify that here to avoid ill-formed MIR.
            // We skip the `Sync` check to avoid cycles for type-alias-impl-trait,
            // relying on the fact that non-Sync statics don't ICE the rest of the compiler.
            const r = check_static_item(tcx, def_id, ty_, /* should_check_for_sync */ false);
            output = r.$ === "Ok" ? ty_ : Ty.new_error(tcx, r._0);
          }
          break;
        }
        case "Const": {
          const ident = k._0;
          const ty = k._2;
          const rhs = k._3;
          if (ty.is_suggestable_infer_ty()) {
            let hir_body_id: HirId | undefined;
            switch (rhs.$) {
              case "Body":
                hir_body_id = rhs._0.hir_id;
                break;
              case "Direct":
                hir_body_id = undefined;
                break;
            }
            output = infer_placeholder_type(icx.lowerer(), def_id, hir_body_id, ty.span, hir.ConstItemRhs.span(rhs, tcx), ident, "constant");
          } else {
            output = icx.lower_ty(ty);
          }
          break;
        }
        case "TyAlias":
          output = icx.lower_ty(k._2);
          break;
        case "Impl": {
          const self_ty = k._0.self_ty;
          const spans = self_ty.find_self_aliases();
          if (spans.length > 0) {
            const guar = tcx.dcx().emit_err(diagnostics.SelfInImplSelf_diagnostic({ span: into_MultiSpan(spans), note: null }));
            output = Ty.new_error(tcx, guar);
          } else {
            output = icx.lower_ty(self_ty);
          }
          break;
        }
        case "Fn":
          output = new_bound_fn_def(item.hir_id(), LocalDefId.to_def_id(def_id));
          break;
        case "Enum":
        case "Struct":
        case "Union": {
          const def = tcx.adt_def(def_id) as AdtDef;
          const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));
          output = Ty.new_adt(tcx, def, args);
          break;
        }
        case "GlobalAsm":
          output = (tcx.typeck(def_id) as TypeckResults).node_type(hir_id);
          break;
        case "Trait":
        case "TraitAlias":
        case "Macro":
        case "Mod":
        case "ForeignMod":
        case "ExternCrate":
        case "Use":
        case "TestBinderConstraints":
          return span_bug(item.span, `type_of: unexpected item kind: ${debug_ItemKind(k, PLAIN)}`);
      }
      break;
    }

    case "OpaqueTy":
      output = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of_opaque(def_id) as EarlyBinder<Ty>));
      break;

    case "ForeignItem": {
      const foreign_item = hir_node._0;
      const k = foreign_item.kind;
      switch (k.$) {
        case "Fn":
          output = new_bound_fn_def(foreign_item.hir_id(), LocalDefId.to_def_id(def_id));
          break;
        case "Static": {
          const ty = icx.lower_ty(k._0);
          // MIR relies on references to statics being scalars.
          // Verify that here to avoid ill-formed MIR.
          // We skip the `Sync` check to avoid cycles for type-alias-impl-trait,
          // relying on the fact that non-Sync statics don't ICE the rest of the compiler.
          const r = check_static_item(tcx, def_id, ty, /* should_check_for_sync */ false);
          output = r.$ === "Ok" ? ty : Ty.new_error(tcx, r._0);
          break;
        }
        case "Type":
          output = Ty.new_foreign(tcx, LocalDefId.to_def_id(def_id));
          break;
      }
      break;
    }

    case "Ctor":
    case "Variant": {
      const def = hir_node.$ === "Ctor" ? hir_node._0 : hir_node._0.data;
      switch (def.$) {
        case "Unit":
        case "Struct":
          output = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(tcx.hir_get_parent_item(hir_id)) as EarlyBinder<Ty>));
          break;
        case "Tuple": {
          const hir_id_ = def._1;
          const ctor = def._2;
          output = new_bound_fn_def(hir_id_, LocalDefId.to_def_id(ctor));
          break;
        }
      }
      break;
    }

    case "Field":
      output = icx.lower_ty(hir_node._0.ty);
      break;

    case "Expr":
      if (hir_node._0.kind.$ === "Closure") {
        output = (tcx.typeck(def_id) as TypeckResults).node_type(hir_id);
        break;
      }
      return bug(`type_of: unexpected node kind: ${debug_Node(hir_node, PLAIN)}`);

    case "AnonConst":
      output = anon_const_type_of(icx, def_id);
      break;

    case "ConstBlock": {
      const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(def_id));
      output = InlineConstArgs.ty(args.as_inline_const());
      break;
    }

    case "GenericParam": {
      const param = hir_node._0;
      const pk = param.kind;
      if (pk.$ === "Type" && pk.default !== undefined) {
        output = icx.lower_ty(pk.default);
      } else if (pk.$ === "Const") {
        const ty = pk.ty;
        const lowered_ty = icx.lower_ty(ty);
        if (!tcx.features().generic_const_parameter_types() && TypeVisitableExt.has_param(lowered_ty, fold_Ty)) {
          const guar = tcx.dcx().emit_err(diagnostics.ParamInTyOfConstParam_diagnostic({ span: ty.span, ty: lowered_ty }));
          output = Ty.new_error(tcx, guar);
        } else {
          output = lowered_ty;
        }
      } else {
        return bug(`type_of: unexpected node kind ${debug_Node(hir_node, PLAIN)}`);
      }
      break;
    }

    default:
      return bug(`type_of: unexpected node kind: ${debug_Node(hir_node, PLAIN)}`);
  }
  const e = icx.check_tainted_by_errors();
  if (e.$ === "Err" && !TypeVisitableExt.references_error(output, fold_Ty)) {
    return EarlyBinder.bind(tcx, Ty.new_error(tcx, e._0), fold_Ty);
  } else {
    return EarlyBinder.bind(tcx, output, fold_Ty);
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/type_of.rs:290 type_of_opaque
export function type_of_opaque(tcx: TyCtxt, def_id_: DefId): EarlyBinder<Ty> {
  const def_id = def_id_.as_local();
  if (def_id !== undefined) {
    const origin = hir.Node.expect_opaque_ty(tcx.hir_node_by_def_id(def_id)).origin;
    switch (origin.$) {
      case "TyAlias":
        if (!origin.in_assoc_ty) {
          return opaque.find_opaque_ty_constraints_for_tait(tcx, def_id, DefiningScopeKind.MirBorrowck);
        } else {
          return opaque.find_opaque_ty_constraints_for_impl_trait_in_assoc_type(tcx, def_id, DefiningScopeKind.MirBorrowck);
        }
      // Opaque types desugared from `impl Trait`.
      case "FnReturn":
      case "AsyncFn": {
        const owner = origin.parent;
        const in_trait_or_impl = origin.in_trait_or_impl;
        if (in_trait_or_impl === "Trait" && !hir.Defaultness.has_value(tcx.defaultness(owner) as hir.Defaultness)) {
          return span_bug(tcx.def_span(def_id), "tried to get type of this RPITIT with no definition");
        }
        return opaque.find_opaque_ty_constraints_for_rpit(tcx, def_id, owner, DefiningScopeKind.MirBorrowck);
      }
    }
  } else {
    // Foreign opaque type will go through the foreign provider
    // and load the type from metadata.
    return tcx.type_of(def_id_) as EarlyBinder<Ty>;
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/type_of.rs:333 type_of_opaque_hir_typeck
export function type_of_opaque_hir_typeck(tcx: TyCtxt, def_id: LocalDefId): EarlyBinder<Ty> {
  const origin = hir.Node.expect_opaque_ty(tcx.hir_node_by_def_id(def_id)).origin;
  switch (origin.$) {
    case "TyAlias":
      if (!origin.in_assoc_ty) {
        return opaque.find_opaque_ty_constraints_for_tait(tcx, def_id, DefiningScopeKind.HirTypeck);
      } else {
        return opaque.find_opaque_ty_constraints_for_impl_trait_in_assoc_type(tcx, def_id, DefiningScopeKind.HirTypeck);
      }
    // Opaque types desugared from `impl Trait`.
    case "FnReturn":
    case "AsyncFn": {
      const owner = origin.parent;
      const in_trait_or_impl = origin.in_trait_or_impl;
      if (in_trait_or_impl === "Trait" && !hir.Defaultness.has_value(tcx.defaultness(owner) as hir.Defaultness)) {
        return span_bug(tcx.def_span(def_id), "tried to get type of this RPITIT with no definition");
      }
      return opaque.find_opaque_ty_constraints_for_rpit(tcx, def_id, owner, DefiningScopeKind.HirTypeck);
    }
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/type_of.rs:369 anon_const_type_of
export function anon_const_type_of(icx: ItemCtxt, def_id: LocalDefId): Ty {
  const tcx = icx.tcx;
  const hir_id = tcx.local_def_id_to_hir_id(def_id);

  const node = tcx.hir_node(hir_id);
  if (node.$ !== "AnonConst") {
    return span_bug(tcx.def_span(def_id), `expected anon const in \`anon_const_type_of\`, got ${debug_Node(node, PLAIN)}`);
  }
  const span = node._0.span;

  const parent_node_id = tcx.parent_hir_id(hir_id);
  const parent_node = tcx.hir_node(parent_node_id);

  // Anon consts "inside" the type system.
  if (parent_node.$ === "ConstArg" && parent_node._0.kind.$ === "Anon" && HirId_eq(parent_node._0.kind._0.hir_id, hir_id)) {
    const arg_hir_id = parent_node._0.hir_id;
    return const_arg_anon_type_of(icx, arg_hir_id, span);
  }

  if (parent_node.$ === "Variant" && parent_node._0.disr_expr !== undefined && HirId_eq(parent_node._0.disr_expr.hir_id, hir_id)) {
    return IntTypeExt.to_ty((tcx.adt_def(tcx.hir_get_parent_item(hir_id)) as AdtDef).repr().discr_type(), tcx);
  }

  if (parent_node.$ === "Field" && parent_node._0.default !== undefined && HirId_eq(parent_node._0.default.hir_id, hir_id)) {
    const field_def_id = parent_node._0.def_id;
    return Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(field_def_id) as EarlyBinder<Ty>));
  }

  return Ty.new_error_with_message(tcx, into_MultiSpan(span), `unexpected anon const parent in type_of(): ${debug_Node(parent_node, PLAIN)}`);
}

// rustc: compiler/rustc_hir_analysis/src/collect/type_of.rs:412 const_arg_anon_type_of
export function const_arg_anon_type_of(icx: ItemCtxt, arg_hir_id: HirId, span: Span): Ty {
  const tcx = icx.tcx;

  const parent = tcx.parent_hir_node(arg_hir_id);
  // Array length const arguments do not have `type_of` fed as there is never a corresponding
  // generic parameter definition.
  if (
    (parent.$ === "Ty" && parent._0.kind.$ === "Array" && HirId_eq(parent._0.kind._1.hir_id, arg_hir_id)) ||
    (parent.$ === "Expr" && parent._0.kind.$ === "Repeat" && HirId_eq(parent._0.kind._1.hir_id, arg_hir_id))
  ) {
    return tcx.types.usize;
  }

  if (parent.$ === "TyPat") {
    const pat = parent._0;
    const p0 = tcx.parent_hir_node(pat.hir_id);
    // Or patterns can be nested one level deep
    const node = p0.$ === "TyPat" ? tcx.parent_hir_node(p0._0.hir_id) : p0;
    const k = hir.Node.expect_ty(node).kind;
    if (k.$ !== "Pat") return bug();
    const ty = k._0;
    return icx.lower_ty(ty);
  }

  // This is not a `bug!` as const arguments in path segments that did not resolve to anything
  // will result in `type_of` never being fed.
  return Ty.new_error_with_message(tcx, into_MultiSpan(span), "`type_of` called on const argument's anon const before the const argument was lowered");
}

// rustc: compiler/rustc_hir_analysis/src/collect/type_of.rs:448 infer_placeholder_type
export function infer_placeholder_type(cx: HirTyLowerer, def_id: LocalDefId, hir_body_id: HirId | undefined, ty_span: Span, body_span: Span, item_ident: Ident, kind: string): Ty {
  const tcx = cx.tcx();
  // If the type is omitted on const with `ConstItemRhs::Direct`, we can't run type check on it,
  // since that requires the const have a body, i.e. `ConstItemRhs::Body`.
  let ty: Ty;
  if (hir_body_id !== undefined) {
    ty = (tcx.typeck(def_id) as TypeckResults).node_type(hir_body_id);
  } else {
    const trait_item_def_id = tcx.trait_item_of(LocalDefId.to_def_id(def_id));
    if (trait_item_def_id !== undefined) {
      ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(trait_item_def_id) as EarlyBinder<Ty>));
    } else {
      ty = Ty.new_error_with_message(tcx, into_MultiSpan(ty_span), "directly represented const requires an explicit type");
    }
  }

  // If this came from a free `const` or `static mut?` item,
  // then the user may have written e.g. `const A = 42;`.
  // In this case, the parser has stashed a diagnostic for
  // us to improve in typeck so we do that now.
  const guar =
    cx.dcx().try_steal_modify_and_emit_err(ty_span, "ItemNoType", (err: Diag) => {
      // HACK(#69396): A macro can expand to several missing-type items that all
      // collide on one stashed `(span, ItemNoType)` diagnostic. They can infer
      // different types, so there is no single concrete type to suggest, and which
      // one wins the steal is not even stable under the parallel front-end. Keep the
      // parser's generic suggestion instead. The fallback arm below additionally
      // checks `is_empty` for explicit `_` spans.
      if (Span.from_expansion(ty_span)) {
        return;
      }
      if (!TypeVisitableExt.references_error(ty, fold_Ty)) {
        // Only suggest adding `:` if it was missing (and suggested by parsing diagnostic).
        const colon = ty_span === Span.shrink_to_hi(item_ident.span) ? ":" : "";

        // The parser provided a sub-optimal `HasPlaceholders` suggestion for the type.
        // We are typeck and have the real type, so remove that and suggest the actual type.
        const suggestions = err.deref_mut().suggestions;
        if (suggestions.$ === "Enabled") {
          suggestions._0.length = 0;
        }

        const ty_ = IsSuggestable.make_suggestable(ty, tcx, false, undefined, fold_Ty);
        if (ty_ !== undefined) {
          err.span_suggestion(ty_span, `provide a type for the ${kind}`, with_types_for_suggestion(() => `${colon} ${display_Ty(ty_)}`), "MachineApplicable");
        } else {
          with_forced_trimmed_paths(() => err.span_note(body_span, `however, the inferred type \`${display_Ty(ty)}\` cannot be named`));
        }
      }
    }) ??
    ((): ErrorGuaranteed => {
      const visitor = new HirPlaceholderCollector();
      const node = tcx.hir_node_by_def_id(def_id);
      const ty_ = hir.Node.ty(node);
      if (ty_ !== undefined) {
        visitor.visit_ty_unambig(ty_);
      }
      // If we didn't find any infer tys, then just fallback to `span`.
      if (visitor.spans.length === 0) {
        visitor.spans.push(ty_span);
      }
      const diag = bad_placeholder(cx, visitor.spans, kind);

      // HACK(#69396): Stashing and stealing diagnostics does not interact
      // well with macros which may delay more than one diagnostic on the
      // same span. If this happens, we will fall through to this arm, so
      // we need to suppress the suggestion since it's invalid. Ideally we
      // would suppress the duplicated error too, but that's really hard.
      if (Span.is_empty(ty_span) && Span.from_expansion(ty_span)) {
        // An approximately better primary message + no suggestion...
        diag.primary_message("missing type for item");
      } else if (!TypeVisitableExt.references_error(ty, fold_Ty)) {
        const ty2 = IsSuggestable.make_suggestable(ty, tcx, false, undefined, fold_Ty);
        if (ty2 !== undefined) {
          diag.span_suggestion_verbose(ty_span, "replace this with a fully-specified type", display_Ty(ty2), "MachineApplicable");
        } else {
          with_forced_trimmed_paths(() => diag.span_note(body_span, `however, the inferred type \`${display_Ty(ty)}\` cannot be named`));
        }
      }

      return diag.emit_err();
    })();
  return Ty.new_error(tcx, guar);
}

// rustc: compiler/rustc_hir_analysis/src/collect/type_of.rs:557 check_feature_inherent_assoc_ty
export function check_feature_inherent_assoc_ty(tcx: TyCtxt, span: Span): void {
  if (!tcx.features().inherent_associated_types()) {
    feature_err(tcx.sess, sym.inherent_associated_types, span, "inherent associated types are unstable").emit();
  }
}

// rustc: compiler/rustc_hir_analysis/src/collect/type_of.rs:571 type_alias_is_checked
export function type_alias_is_checked(tcx: TyCtxt, def_id: LocalDefId): boolean {
  if (tcx.features().checked_type_aliases()) {
    return true;
  }
  // struct HasTait;
  class HasTait extends hir.intravisit.Visitor<ControlFlow<null>> {
    override Result = VisitorResult.ControlFlow<null>();

    // rustc: compiler/rustc_hir_analysis/src/collect/type_of.rs:579 visit_ty
    override visit_ty(t: hir.Ty<hir.AmbigArg>): ControlFlow<null> {
      if (t.kind.$ === "OpaqueDef") {
        return ControlFlow.Break(null);
      } else {
        return hir.intravisit.walk_ty(this, t);
      }
    }
  }
  return new HasTait().visit_ty_unambig(tcx.hir_expect_item(def_id).expect_ty_alias()[2]).$ === "Break";
}

