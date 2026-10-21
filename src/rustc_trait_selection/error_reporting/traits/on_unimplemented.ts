// Port of compiler/rustc_trait_selection/src/error_reporting/traits/on_unimplemented.rs (lane errrep-traits-a).
//
// The `impl TypeErrCtxt` methods are declared in ../../decls.ts (`// error_reporting/traits/on_unimplemented.rs:<line>`) and
// assigned onto `TypeErrCtxt.prototype` here.
// PORT: `find_attr!(self.tcx, def_id, OnUnimplemented { directive, .. } => directive.as_deref())` is
// `find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), ..)` (rustc_trait_selection traits/misc.ts precedent); the closure
// wraps the `Option<&Directive>` so that the first matching attribute wins even when its directive is `None`.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), this file's .gen.ts and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
import { type CustomDiagnostic, default_CustomDiagnostic, type Directive, FilterOptions, type FormatArgs } from "../../../rustc_attr_ir/diagnostic.ts";
import { find_attr } from "../../../rustc_attr_ir/lib.ts";
import type { PredicateObligation } from "../../../rustc_infer/traits/mod.ts";
import type { CodegenFnAttrs } from "../../../rustc_middle/middle/codegen_fn_attrs.ts";
import type { Ty } from "../../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../../rustc_middle/ty/generics.ts";
import { HasAttrs_DefId } from "../../../rustc_middle/ty/mod.ts";
import {
  display_GenericArg,
  display_TraitRefPrintOnlyTraitPath,
  display_TraitRefPrintSugared,
  display_Ty,
  TraitRef_print_only_trait_path,
  TraitRef_print_trait_sugared,
  with_no_trimmed_paths,
  with_no_visible_paths,
} from "../../../rustc_middle/ty/print/pretty.ts";
import { print_Ty } from "../../../rustc_middle/ty/print/mod.ts";
import { Binder, EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import type { PolyTraitClause as PolyTraitClauseT } from "../../../rustc_type_ir/decls.ts";
import { PolyTraitClause, TraitClause, TraitRef } from "../../../rustc_type_ir/predicate.ts";
import { PolyFnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { Span } from "../../../rustc_span/lib.ts";
import { display_Symbol, type Symbol } from "../../../rustc_span/symbol.ts";
import { type DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import type { PathBuf } from "../../../rustc_span/lib.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { TypeErrCtxt } from "../../decls.ts";

// impl<'tcx> TypeErrCtxt<'_, 'tcx>

/// Used to set on_unimplemented's `ItemContext`
/// to be the enclosing (async) block/function/closure
// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/on_unimplemented.rs:18 describe_enclosure
TypeErrCtxt.prototype.describe_enclosure = function (this: TypeErrCtxt, def_id: LocalDefId): string | undefined {
  const node = this.tcx.hir_node_by_def_id(def_id);
  if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    return "a function";
  } else if (node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
    return "a trait method";
  } else if (node.$ === "ImplItem" && node._0.kind.$ === "Fn") {
    return "a method";
  } else if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
    const kind = node._0.kind._0.kind;
    return this.describe_closure(kind);
  } else {
    return undefined;
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/on_unimplemented.rs:35 on_unimplemented_note
TypeErrCtxt.prototype.on_unimplemented_note = function (
  this: TypeErrCtxt,
  trait_pred: PolyTraitClauseT,
  obligation: PredicateObligation,
  long_ty_path: MutRef<PathBuf | undefined>,
): CustomDiagnostic {
  if (PolyTraitClause.polarity(trait_pred) !== "Positive") {
    return default_CustomDiagnostic();
  }
  // This is needed as `on_unimplemented` is currently not allowed on trait aliases,
  // but the "not allowed" is a warning, and this check ensures the attribute has no effect
  if (this.tcx.is_trait_alias(PolyTraitClause.def_id(trait_pred))) {
    return default_CustomDiagnostic();
  }
  const [filter_options, format_args] = this.on_unimplemented_components(trait_pred, obligation, long_ty_path, true);
  const command = find_attr(HasAttrs_DefId.get_attrs(PolyTraitClause.def_id(trait_pred), this.tcx), (k) =>
    k.$ === "OnUnimplemented" ? { directive: k.directive as Directive | undefined } : undefined,
  )?.directive;
  if (command !== undefined) {
    return command.eval(filter_options, format_args);
  } else {
    return default_CustomDiagnostic();
  }
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/traits/on_unimplemented.rs:61 on_unimplemented_components
TypeErrCtxt.prototype.on_unimplemented_components = function (
  this: TypeErrCtxt,
  trait_pred_: PolyTraitClauseT,
  obligation: PredicateObligation,
  long_ty_path: MutRef<PathBuf | undefined>,
  print_infer_ty_var: boolean,
): [FilterOptions, FormatArgs] {
  const def_id = PolyTraitClause.def_id(trait_pred_);
  const args = Binder.skip_binder(trait_pred_).trait_ref.args;
  const trait_pred = Binder.skip_binder(trait_pred_);

  const self_types: string[] = [];
  const generic_args: [Symbol, string][] = [];
  let crate_local = false;
  // FIXME(-Zlower-impl-trait-in-trait-to-assoc-ty): HIR is not present for RPITITs,
  // but I guess we could synthesize one here. We don't see any errors that rely on
  // that yet, though.
  const item_context = this.describe_enclosure(obligation.cause.body_def_id) ?? "";

  const code = obligation.cause.code_();
  let direct: boolean;
  switch (code.$) {
    case "BuiltinDerived":
    case "ImplDerived":
    case "WellFormedDerived":
      direct = false;
      break;
    default:
      // this is a "direct", user-specified, rather than derived,
      // obligation.
      direct = true;
      break;
  }

  const from_desugaring = Span.desugaring_kind(obligation.cause.span);

  const cause = obligation.cause.code_().$ === "MainFunctionType" ? "MainFunctionType" : undefined;

  // Add all types without trimmed paths or visible paths, ensuring they end up with
  // their "canonical" def path.
  with_no_trimmed_paths(() =>
    with_no_visible_paths(() => {
      const generics = this.tcx.generics_of(def_id) as Generics;
      const self_ty = TraitClause.self_ty(trait_pred);
      self_types.push(display_Ty(self_ty));
      const def0 = self_ty.ty_adt_def();
      if (def0 !== undefined) {
        // We also want to be able to select self's original
        // signature with no type arguments resolved
        self_types.push(display_Ty(type_of_identity(this, def0.did())));
      }

      for (const { name, kind, index } of generics.own_params) {
        let value: string;
        switch (kind.$) {
          case "Type":
          case "Const":
            value = display_GenericArg(args[index]!);
            break;
          case "Lifetime":
            continue;
        }
        generic_args.push([name, value]);

        if (kind.$ === "Type") {
          const param_ty = GenericArg.expect_ty(args[index]!);
          const def = param_ty.ty_adt_def();
          if (def !== undefined) {
            // We also want to be able to select the parameter's
            // original signature with no type arguments resolved
            generic_args.push([name, display_Ty(type_of_identity(this, def.did()))]);
          }
        }
      }

      const adt = self_ty.ty_adt_def();
      if (adt !== undefined) {
        if (adt.did().is_local()) {
          crate_local = true;
        }
        self_types.push(`{${adt.descr()}}`);
      }

      // Allow targeting all integers using `{integral}`, even if the exact type was resolved
      if (self_ty.is_integral()) {
        self_types.push("{integral}");
      }

      if (self_ty.is_array_slice()) {
        self_types.push("&[]");
      }

      if (self_ty.is_fn()) {
        const fn_sig = self_ty.fn_sig(this.tcx);
        const k = self_ty.kind();
        let shortname: string;
        if (k.$ === "FnDef" && (this.tcx.codegen_fn_attrs(k._0) as CodegenFnAttrs).safe_target_features) {
          shortname = "#[target_feature] fn";
        } else {
          switch (PolyFnSig.safety(fn_sig)) {
            case "Safe":
              shortname = "fn";
              break;
            case "Unsafe":
              shortname = "unsafe fn";
              break;
          }
        }
        self_types.push(shortname);
      }

      // Slices give us `[]`, `[{ty}]`
      const ks = self_ty.kind();
      if (ks.$ === "Slice") {
        const aty = ks._0;
        self_types.push("[]");
        const def = aty.ty_adt_def();
        if (def !== undefined) {
          // We also want to be able to select the slice's type's original
          // signature with no type arguments resolved
          self_types.push(`[${display_Ty(type_of_identity(this, def.did()))}]`);
        }
        if (aty.is_integral()) {
          self_types.push("[{integral}]");
        }
      }

      // Arrays give us `[]`, `[{ty}; _]` and `[{ty}; N]`
      const ka = self_ty.kind();
      if (ka.$ === "Array") {
        const aty = ka._0;
        self_types.push("[]");
        const len = ka._1.try_to_target_usize(this.tcx);
        self_types.push(`[${display_Ty(aty)}; _]`);
        if (len !== undefined) {
          self_types.push(`[${display_Ty(aty)}; ${len}]`);
        }
        const def = aty.ty_adt_def();
        if (def !== undefined) {
          // We also want to be able to select the array's type's original
          // signature with no type arguments resolved
          const def_ty = type_of_identity(this, def.did());
          self_types.push(`[${display_Ty(def_ty)}; _]`);
          if (len !== undefined) {
            self_types.push(`[${display_Ty(def_ty)}; ${len}]`);
          }
        }
        if (aty.is_integral()) {
          self_types.push("[{integral}; _]");
          if (len !== undefined) {
            self_types.push(`[{integral}; ${len}]`);
          }
        }
      }
      const kd = self_ty.kind();
      if (kd.$ === "Dynamic") {
        for (const t of kd._0) {
          const p = Binder.skip_binder(t);
          if (p.$ === "Trait") {
            self_types.push(this.tcx.def_path_str(p._0.def_id));
          }
        }
      }

      // `&[{integral}]` - `FromIterator` needs that.
      const kr = self_ty.kind();
      if (kr.$ === "Ref" && kr._2 === "Not") {
        const ref_ty = kr._1;
        const kslice = ref_ty.kind();
        if (kslice.$ === "Slice" && kslice._0.is_integral()) {
          self_types.push("&[{integral}]");
        }
      }
    }),
  );

  const this_ = this.tcx.def_path_str(trait_pred.trait_ref.def_id);
  const this_resolved = display_TraitRefPrintSugared(TraitRef_print_trait_sugared(trait_pred.trait_ref));
  const this_path = display_TraitRefPrintOnlyTraitPath(TraitRef_print_only_trait_path(TraitRef.identity(this.tcx, def_id)));

  const filter_options = new FilterOptions(self_types, from_desugaring, cause, crate_local, direct, generic_args);

  // Unlike the generic_args earlier,
  // this one is *not* collected under `with_no_trimmed_paths!`
  // for printing the type to the user
  //
  // This includes `Self`, as it is the first parameter in `own_params`.
  const generic_args2: [Symbol, string][] = [];
  for (const param of (this.tcx.generics_of(trait_pred.trait_ref.def_id) as Generics).own_params) {
    let value: string;
    switch (param.kind.$) {
      case "Type":
      case "Const": {
        const ty = GenericArg.as_type(trait_pred.trait_ref.args[param.index]!);
        if (ty !== undefined) {
          const k = ty.kind();
          if (print_infer_ty_var === false && k.$ === "Infer" && k._0.$ === "TyVar") {
            value = display_Symbol(param.name);
          } else {
            value = this.tcx.short_string(ty, long_ty_path, print_Ty);
          }
        } else {
          value = display_GenericArg(trait_pred.trait_ref.args[param.index]!);
        }
        break;
      }
      case "Lifetime":
        continue;
    }
    const name = param.name;
    generic_args2.push([name, value]);
  }

  // PORT: `FormatArgs { this, this_path, this_resolved, generic_args, item_context, .. }` with the default field values
  // (`String::new()`) for the rest.
  const format_args: FormatArgs = {
    this: this_,
    this_resolved,
    this_path,
    found: "",
    expected: "",
    unresolved: "",
    item_context,
    generic_args: generic_args2,
  };
  return [filter_options, format_args];
};

// ---- helpers ---------------------------------------------------------------------------------------------------------

/** `self.tcx.type_of(def_id).instantiate_identity().skip_norm_wip()` */
function type_of_identity(self: TypeErrCtxt, def_id: DefId): Ty {
  return Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(self.tcx.type_of(def_id) as EarlyBinder<Ty>));
}
