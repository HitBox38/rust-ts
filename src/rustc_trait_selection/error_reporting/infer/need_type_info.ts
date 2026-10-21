// Port of compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs (lane errrep-need-type-info).
//
// - The `impl TypeErrCtxt` methods are declared in ../../decls.ts (`// error_reporting/infer/need_type_info.rs:<line>`)
//   and assigned onto `TypeErrCtxt.prototype` here; the free fns follow `Fns_error_reporting_infer_need_type_info`.
// - need_type_info.rs is not in the codegen set (the typedefs probe, syn, cannot parse its `do yeet ()`): its types are
//   written here by hand, fields in declaration order (`// rustc-type:` markers), with the derived `Debug` / `Clone`.
// - Inherent impls of the data types (`InferenceDiagnosticsData`, `InferenceDiagnosticsParentData`,
//   `UnderspecifiedArgKind`, `InferSource`, `InferSourceKind`) are on their companion consts (PORTING §8).
//   `ClosureEraser` (a `TypeFolder`) and `FindInferSourceVisitor` (an intravisit `Visitor`) are classes.
// - `impl From<TypeAnnotationNeeded> for ErrCode` is `ErrCode_from_TypeAnnotationNeeded`.
// - Iterators that upstream builds lazily (`Box<dyn Iterator>`, `filter_map` + `chain`, `comma_sep` over a `map`) are
//   generators, so the queries / inference variables their closures make happen in upstream's order.
// Init order: top-level code here may touch only the crate decls.ts (TypeErrCtxt), the generated diagnostics and other
// crates; other rustc_trait_selection modules are read inside function bodies only.
import { Mutability } from "../../../rustc_ast_ir/lib.ts";
import { type DiagArgValue } from "../../../rustc_error_messages/lib.ts";
import { type Diag, E0282, E0283, E0284, type ErrCode } from "../../../rustc_errors/lib.ts";
import { Namespace, Res } from "../../../rustc_hir/def.ts";
import * as hir from "../../../rustc_hir/lib.ts";
import type { HirTyCtxt } from "../../../rustc_hir/intravisit.ts";
import { debug_HirId, type HirId } from "../../../rustc_hir_id/lib.ts";
import { DefPathData } from "../../../rustc_hir_id/definitions.ts";
import type { InferCtxt } from "../../../rustc_infer/infer/mod.ts";
import { TyCtxt_as_HirTyCtxt } from "../../../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../../../rustc_middle/hir/nested_filter.ts";
import { Mutability_from_AutoBorrowMutability } from "../../../rustc_middle/ty/adjustment.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Const } from "../../../rustc_middle/ty/decls.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { IsSuggestable } from "../../../rustc_middle/ty/diagnostics.ts";
import { fold_GenericArg, fold_GenericArgs, GenericArg, type GenericArgs } from "../../../rustc_middle/ty/generic_args.ts";
import { GenericParamDef, type Generics } from "../../../rustc_middle/ty/generics.ts";
import { fold_Term, Term } from "../../../rustc_middle/ty/mod.ts";
import type { PrintResult } from "../../../rustc_middle/ty/print/mod.ts";
import { print_Const, print_Ty } from "../../../rustc_middle/ty/print/mod.ts";
import { FmtPrinter, print_Binder, print_FnSig, print_GenericArg, RegionHighlightMode } from "../../../rustc_middle/ty/print/pretty.ts";
import { debug_Ty, fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import type { TypeckResults } from "../../../rustc_middle/ty/typeck_results.ts";
import { debug_DefId, type DefId, LocalDefId } from "../../../rustc_span/def_id.ts";
import { type BytePos, debug_BytePos, debug_Span, DUMMY_SP, type PathBuf, Span } from "../../../rustc_span/lib.ts";
import { debug_Ident, display_Ident, display_Symbol, type Ident, sym } from "../../../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../../../rustc_type_ir/binder.ts";
import { type TypeFolder, TypeFolder_provided, type PredicateProxy, type TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import type { Clauses } from "../../../rustc_middle/ty/list.ts";
import { TyOrConstInferVar } from "../../../rustc_type_ir/solve/mod.ts";
import type { Region } from "../../../rustc_type_ir/sty/mod.ts";
import { ClosureArgs } from "../../../rustc_type_ir/ty_kind/closure.ts";
import { fold_FnSig, FnSig, PolyFnSig } from "../../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../../../rustc_type_ir/visit.ts";
import { type Debug, debug_list, debug_option, debug_str, debug_struct, debug_int, debug_bool, debug_tuple } from "../../../std/fmt.ts";
import type { MutRef } from "../../../std/mut_ref.ts";
import { panic, unwrap } from "../../../std/panic.ts";
import { bug } from "../../../rustc_span/macros.ts";
import {
  type AmbiguousImpl,
  AmbiguousImpl_diagnostic,
  type AmbiguousReturn,
  AmbiguousReturn_diagnostic,
  type AnnotationRequired,
  AnnotationRequired_diagnostic,
  type InferenceBadError,
  type SpecifyGenericParamsSuggestion,
} from "../../diagnostics.gen.ts";
import type { SourceKindSubdiag } from "../../diagnostics.gen.ts";
import { TypeErrCtxt } from "../../decls.ts";
import { Highlighted } from "./nice_region_error/placeholder_error.gen.ts";
import { Highlighted_to_string } from "./nice_region_error/placeholder_error.ts";

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:33 TypeAnnotationNeeded
export type TypeAnnotationNeeded =
  /// ```compile_fail,E0282
  /// let x;
  /// ```
  | "E0282"
  /// An implementation cannot be chosen unambiguously because of lack of information.
  /// ```compile_fail,E0790
  /// let _ = Default::default();
  /// ```
  | "E0283"
  /// ```compile_fail,E0284
  /// let mut d: u64 = 2;
  /// d = d % 1u32.into();
  /// ```
  | "E0284";
export const TypeAnnotationNeeded = { E0282: "E0282", E0283: "E0283", E0284: "E0284" } as const;

// impl From<TypeAnnotationNeeded> for ErrCode
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:51 from
export function ErrCode_from_TypeAnnotationNeeded(val: TypeAnnotationNeeded): ErrCode {
  switch (val) {
    case "E0282":
      return E0282;
    case "E0283":
      return E0283;
    case "E0284":
      return E0284;
  }
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:61 InferenceDiagnosticsData
/// Information about a constant or a type containing inference variables.
export interface InferenceDiagnosticsData {
  name: string;
  span: Span | undefined;
  kind: UnderspecifiedArgKind;
  parent: InferenceDiagnosticsParentData | undefined;
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:69 InferenceDiagnosticsParentData
/// Data on the parent definition where a generic argument was declared.
export interface InferenceDiagnosticsParentData {
  prefix: string;
  name: string;
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:75 UnderspecifiedArgKind
// PORT: `prefix: Cow<'static, str>` is a `string`.
export type UnderspecifiedArgKind = { readonly $: "Type"; prefix: string } | { readonly $: "Const"; is_parameter: boolean };

/** `#[derive(Clone)]` on `UnderspecifiedArgKind`. */
export function clone_UnderspecifiedArgKind(v: UnderspecifiedArgKind): UnderspecifiedArgKind {
  switch (v.$) {
    case "Type":
      return { $: "Type", prefix: v.prefix };
    case "Const":
      return { $: "Const", is_parameter: v.is_parameter };
  }
}

/** `impl InferenceDiagnosticsData` (PORTING §8: on the companion). */
export const InferenceDiagnosticsData = {
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:81 can_add_more_info
  can_add_more_info(self: InferenceDiagnosticsData): boolean {
    return !(self.name === "_" && self.kind.$ === "Type");
  },

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:85 where_x_is_kind
  where_x_is_kind(self: InferenceDiagnosticsData, infcx: InferCtxt, in_type: Ty): string {
    if (in_type.is_ty_or_numeric_infer()) {
      return "";
    } else if (self.name === "_") {
      const displayed_ty = fold_Ty.fold_with(infcx.deeply_resolve_ignoring_regions(in_type, fold_Ty), new ClosureEraser(infcx, 0));
      if (displayed_ty.is_ty_or_numeric_infer()) {
        return "";
      } else {
        // `.walk().filter_map(TyOrConstInferVar::maybe_from_generic_arg).take(2).count()`
        let count = 0;
        const walker = displayed_ty.walk();
        let arg: GenericArg | undefined;
        while (count < 2 && (arg = walker.next()) !== undefined) {
          if (TyOrConstInferVar.maybe_from_generic_arg(arg) !== undefined) count += 1;
        }
        switch (count) {
          case 0:
            return "";
          case 1:
            return "underscore_single";
          default:
            return "underscore_multiple";
        }
      }
    } else {
      return "has_name";
    }
  },

  /// Generate a label for a generic argument which can't be inferred. When not
  /// much is known about the argument, `use_diag` may be used to describe the
  /// labeled value.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:114 make_bad_error
  make_bad_error(self: InferenceDiagnosticsData, span: Span): InferenceBadError {
    const has_parent = self.parent !== undefined;
    const bad_kind = InferenceDiagnosticsData.can_add_more_info(self) ? "more_info" : "other";
    const [parent_prefix, parent_name] = self.parent !== undefined ? [self.parent.prefix, self.parent.name] : ["", ""];
    return {
      span,
      bad_kind,
      prefix_kind: clone_UnderspecifiedArgKind(self.kind),
      prefix: UnderspecifiedArgKind.try_get_prefix(self.kind) ?? "",
      name: self.name,
      has_parent,
      parent_prefix,
      parent_name,
    };
  },
};

/** `impl InferenceDiagnosticsParentData` (PORTING §8: on the companion). */
export const InferenceDiagnosticsParentData = {
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:136 for_parent_def_id
  for_parent_def_id(tcx: TyCtxt, parent_def_id: DefId): InferenceDiagnosticsParentData | undefined {
    const name = DefPathData.get_opt_name(tcx.def_key(parent_def_id).disambiguated_data.data);
    if (name === undefined) return undefined;
    const parent_name = display_Symbol(name);

    return {
      prefix: tcx.def_descr(parent_def_id),
      name: parent_name,
    };
  },

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:149 for_def_id
  for_def_id(tcx: TyCtxt, def_id: DefId): InferenceDiagnosticsParentData | undefined {
    return InferenceDiagnosticsParentData.for_parent_def_id(tcx, tcx.parent(def_id));
  },
};

// impl IntoDiagArg for UnderspecifiedArgKind
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:155 into_diag_arg
export function UnderspecifiedArgKind_into_diag_arg(self: UnderspecifiedArgKind, _: MutRef<PathBuf | undefined>): DiagArgValue {
  let kind: string;
  if (self.$ === "Type") {
    kind = "type";
  } else if (self.is_parameter) {
    kind = "const_with_param";
  } else {
    kind = "const";
  }
  return { $: "Str", _0: kind };
}

/** `impl UnderspecifiedArgKind` (PORTING §8: on the companion). */
export const UnderspecifiedArgKind = {
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:166 try_get_prefix
  try_get_prefix(self: UnderspecifiedArgKind): string | undefined {
    switch (self.$) {
      case "Type":
        return self.prefix;
      case "Const":
        return undefined;
    }
  },
};

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:174 ClosureEraser
export class ClosureEraser implements TypeFolder {
  constructor(
    public infcx: InferCtxt,
    public depth: number,
  ) {}

  // ---- impl<'a, 'tcx> ClosureEraser<'a, 'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:180 new_infer
  new_infer(): Ty {
    return this.infcx.next_ty_var(DUMMY_SP);
  }

  // ---- impl<'a, 'tcx> TypeFolder<TyCtxt<'tcx>> for ClosureEraser<'a, 'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:186 cx
  cx(): TyCtxt {
    return this.infcx.tcx;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:190 fold_ty
  fold_ty(ty_: Ty): Ty {
    this.depth += 1;
    let ty: Ty;
    const k = ty_.kind();
    if (k.$ === "Closure") {
      const args = k._1;
      // For a closure type, we turn it into a function pointer so that it gets rendered
      // as `fn(args) -> Ret`.
      const closure_sig = ClosureArgs.sig(args.as_closure());
      ty = Ty.new_fn_ptr(this.cx(), this.cx().signature_unclosure(closure_sig, "Safe"));
    } else if (k.$ === "Adt" && !k._1.some((a) => TypeVisitableExt.has_infer(a, fold_GenericArg))) {
      // We have a type that doesn't have any inference variables, so we replace
      // the whole thing with `_`. The type system already knows about this type in
      // its entirety and it is redundant to specify it for the user. The user only
      // needs to specify the type parameters that we *couldn't* figure out.
      ty = this.new_infer();
    } else if (k.$ === "Adt") {
      const def = k._0;
      const args = k._1;
      const generics_ = this.cx().generics_of(def.did()) as Generics;
      const generics: boolean[] = generics_.own_params.map((param) => GenericParamDef.default_value(param, this.cx()) !== undefined);
      // `generics.into_iter().zip(args.iter()).map(..)`
      const folded: GenericArg[] = [];
      const n = Math.min(generics.length, args.length);
      for (let i = 0; i < n; i++) {
        const has_default = generics[i]!;
        const arg = args[i]!;
        if (TypeVisitableExt.has_infer(arg, fold_GenericArg)) {
          // This param has an unsubstituted type variable, meaning that this
          // type has a (potentially deeply nested) type parameter from the
          // corresponding type's definition. We have explicitly asked this
          // type to not be hidden. In either case, we keep the type and don't
          // substitute with `_` just yet.
          folded.push(fold_GenericArg.fold_with(arg, this));
        } else if (has_default) {
          // We have a type param that has a default type, like the allocator
          // in Vec. We decided to show `Vec` itself, because it hasn't yet
          // been replaced by an `_` `Infer`, but we want to ensure that the
          // type parameter with default types does *not* get replaced with
          // `_` because then we'd end up with `Vec<_, _>`, instead of
          // `Vec<_>`.
          folded.push(arg);
        } else if (GenericArg.kind(arg).$ === "Type") {
          // We don't replace lifetime or const params, only type params.
          folded.push(GenericArg.from_Ty(this.new_infer()));
        } else {
          folded.push(fold_GenericArg.fold_with(arg, this));
        }
      }
      ty = Ty.new_adt(this.cx(), def, this.cx().mk_args_from_iter(folded));
    } else if (TypeVisitableExt.has_infer(ty_, fold_Ty)) {
      // This type has a (potentially nested) type parameter that we couldn't figure out.
      // We will print this depth of type, so at least the type name and at least one of
      // its type parameters.
      ty = fold_Ty.super_fold_with(ty_, this);
    } else if (this.depth === 1) {
      // We are in the top-level type, not one of its type parameters. Name it with its
      // parameters replaced.
      ty = fold_Ty.super_fold_with(ty_, this);
    } else {
      // We don't have an unknown type parameter anywhere, and we are in a type parameter.
      // Replace with `_`.
      ty = this.new_infer();
    }
    this.depth -= 1;
    return ty;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:264 fold_const
  fold_const(c: Const): Const {
    // Avoid accidentally erasing the type of the const.
    return c;
  }

  // (provided) the `TypeFolder` methods `ClosureEraser` does not override.
  fold_binder<T>(t: Binder<T>, d: TypeFoldable<T>): Binder<T> {
    return TypeFolder_provided.fold_binder(this, t, d);
  }
  fold_region(r: Region): Region {
    return TypeFolder_provided.fold_region(this, r);
  }
  fold_predicate<P>(p: P, d: PredicateProxy<P>): P {
    return TypeFolder_provided.fold_predicate(this, p, d);
  }
  fold_clauses(c: Clauses): Clauses {
    return TypeFolder_provided.fold_clauses(this, c);
  }
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:270 fmt_printer
export function fmt_printer(infcx: InferCtxt, ns: Namespace): FmtPrinter {
  const p = FmtPrinter.new(infcx.tcx, ns);
  const ty_getter = (ty_vid: Parameters<InferCtxt["type_var_origin"]>[0]) => {
    if (infcx.try_resolve_ty_var(ty_vid).$ === "Ok") {
      // warn!("resolved ty var in error message");
    }

    const var_origin = infcx.type_var_origin(ty_vid);
    const def_id = var_origin.param_def_id;
    // The `Self` param of a trait has the def-id of the trait,
    // since it's a synthetic parameter.
    if (def_id !== undefined && infcx.tcx.def_kind(def_id).$ === "TyParam") {
      const name = infcx.tcx.item_name(def_id);
      if (!Span.from_expansion(var_origin.span)) {
        const generics = infcx.tcx.generics_of(infcx.tcx.parent(def_id)) as Generics;
        const idx = unwrap(generics.param_def_id_to_index_(infcx.tcx, def_id));
        const generic_param_def = generics.param_at(idx, infcx.tcx);
        if (generic_param_def.kind.$ === "Type" && generic_param_def.kind.synthetic === true) {
          return undefined;
        } else {
          return name;
        }
      }
    }
    return undefined;
  };
  p._0.ty_infer_name_resolver = ty_getter;
  const const_getter = (ct_vid: Parameters<InferCtxt["const_var_origin"]>[0]) => {
    const origin = infcx.const_var_origin(ct_vid);
    if (origin === undefined) return undefined;
    const param_def_id = origin.param_def_id;
    if (param_def_id === undefined) return undefined;
    return infcx.tcx.item_name(param_def_id);
  };
  p._0.const_infer_name_resolver = const_getter;
  return p;
}

/** `.unwrap()` of a `fmt::Result` (`PrintResult`). */
function unwrap_print(r: PrintResult): void {
  if (r.$ === "Err") panic("called `Result::unwrap()` on an `Err` value: Error");
}

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:304 ty_to_string
export function ty_to_string(infcx: InferCtxt, ty_: Ty, called_method_def_id: DefId | undefined): string {
  const p = fmt_printer(infcx, Namespace.TypeNS);
  let ty = infcx.deeply_resolve_ignoring_regions(ty_, fold_Ty);
  // We use `fn` ptr syntax for closures, but this only works when the closure does not capture
  // anything. We also remove all type parameters that are fully known to the type system.
  ty = fold_Ty.fold_with(ty, new ClosureEraser(infcx, 0));

  if (ty.kind().$ === "FnDef") {
    // We don't want the regular output for `fn`s because it includes its path in
    // invalid pseudo-syntax, we want the `fn`-pointer output instead.
    unwrap_print(print_Binder(ty.fn_sig(infcx.tcx), p, print_FnSig, fold_FnSig));
    return p.into_buffer();
  } else if (
    called_method_def_id !== undefined &&
    ty.is_ty_or_numeric_infer() &&
    def_id_eq_opt(infcx.tcx.get_diagnostic_item(sym.iterator_collect_fn), called_method_def_id)
  ) {
    return "Vec<_>";
  } else if (ty.is_ty_or_numeric_infer()) {
    return "/* Type */";
  } else {
    unwrap_print(print_Ty(ty, p));
    return p.into_buffer();
  }
}

/** `Option<DefId> == Some(def_id)`. */
function def_id_eq_opt(a: DefId | undefined, b: DefId): boolean {
  return a !== undefined && a.krate === b.krate && a.index === b.index;
}

/// We don't want to directly use `ty_to_string` for closures as their type isn't really
/// something users are familiar with. Directly printing the `fn_sig` of closures also
/// doesn't work as they actually use the "rust-call" API.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:339 closure_as_fn_str
export function closure_as_fn_str(infcx: InferCtxt, ty: Ty): string {
  const k = ty.kind();
  if (k.$ !== "Closure") {
    return bug("cannot convert non-closure to fn str in `closure_as_fn_str`");
  }
  const args_ = k._1;
  const fn_sig = ClosureArgs.sig(args_.as_closure());
  const first = Binder.skip_binder(PolyFnSig.inputs(fn_sig))[0];
  const args =
    first !== undefined
      ? first
          .tuple_fields()
          .map((arg) => ty_to_string(infcx, arg, undefined))
          .join(", ")
      : "";
  const ret = Binder.skip_binder(PolyFnSig.output(fn_sig)).is_unit()
    ? ""
    : ` -> ${ty_to_string(infcx, Binder.skip_binder(PolyFnSig.output(fn_sig)), undefined)}`;
  return `fn(${args})${ret}`;
}

// impl<'a, 'tcx> TypeErrCtxt<'a, 'tcx>

/// Extracts data used by diagnostic for either types or constants
/// which were stuck during inference.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:368 extract_inference_diagnostics_data
TypeErrCtxt.prototype.extract_inference_diagnostics_data = function (
  this: TypeErrCtxt,
  term: Term,
  highlight: RegionHighlightMode,
): InferenceDiagnosticsData {
  const tcx = this.tcx;
  const tk = Term.kind(term);
  switch (tk.$) {
    case "Ty": {
      const ty = tk._0;
      const k = ty.kind();
      if (k.$ === "Infer" && k._0.$ === "TyVar") {
        const ty_vid = k._0._0;
        const var_origin = this.infcx.type_var_origin(ty_vid);
        const def_id = var_origin.param_def_id;
        // The `Self` param of a trait has the def-id of the trait,
        // since it's a synthetic parameter.
        if (def_id !== undefined && this.tcx.def_kind(def_id).$ === "TyParam" && !Span.from_expansion(var_origin.span)) {
          return {
            name: display_Symbol(this.tcx.item_name(def_id)),
            span: var_origin.span,
            kind: { $: "Type", prefix: "type parameter" },
            parent: InferenceDiagnosticsParentData.for_def_id(this.tcx, def_id),
          };
        }
      }

      return {
        name: Highlighted_to_string(new Highlighted(tcx, highlight, ty, Namespace.TypeNS), print_Ty),
        span: undefined,
        kind: { $: "Type", prefix: ty.prefix_string(this.tcx) },
        parent: undefined,
      };
    }
    case "Const": {
      const ct = tk._0;
      const ck = ct.kind();
      if (ck.$ === "Infer" && ck._0.$ === "Var") {
        const vid = ck._0._0;
        const origin = this.const_var_origin(vid);
        if (origin === undefined) return panic("expected unresolved const var");
        if (origin.param_def_id !== undefined) {
          const def_id = origin.param_def_id;
          return {
            name: display_Symbol(this.tcx.item_name(def_id)),
            span: origin.span,
            kind: { $: "Const", is_parameter: true },
            parent: InferenceDiagnosticsParentData.for_def_id(this.tcx, def_id),
          };
        }

        // debug_assert!(!origin.span.is_dummy());
        return {
          name: Highlighted_to_string(new Highlighted(tcx, highlight, ct, Namespace.ValueNS), print_Const),
          span: origin.span,
          kind: { $: "Const", is_parameter: false },
          parent: undefined,
        };
      } else {
        // If we end up here the `FindInferSourceVisitor`
        // won't work, as its expected argument isn't an inference variable.
        //
        // FIXME: Ideally we should look into the generic constant
        // to figure out which inference var is actually unresolved so that
        // this path is unreachable.
        return {
          name: Highlighted_to_string(new Highlighted(tcx, highlight, ct, Namespace.ValueNS), print_Const),
          span: undefined,
          kind: { $: "Const", is_parameter: false },
          parent: undefined,
        };
      }
    }
  }
};

/// Used as a fallback in [TypeErrCtxt::emit_inference_failure_err]
/// in case we weren't able to get a better error.
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:442 bad_inference_failure_err
TypeErrCtxt.prototype.bad_inference_failure_err = function (
  this: TypeErrCtxt,
  span: Span,
  arg_data: InferenceDiagnosticsData,
  error_code: TypeAnnotationNeeded,
): Diag {
  const source_kind = "other";
  const source_name = "";
  const failure_span = undefined;
  const subdiagnostic = undefined;
  const bad_label = InferenceDiagnosticsData.make_bad_error(arg_data, span);
  switch (error_code) {
    case "E0282":
      return this.dcx().create_err(
        AnnotationRequired_diagnostic({ span, source_kind, source_name, failure_span, subdiagnostic, bad_label } satisfies AnnotationRequired),
      );
    case "E0283":
      return this.dcx().create_err(
        AmbiguousImpl_diagnostic({ span, source_kind, source_name, failure_span, subdiagnostic, bad_label } satisfies AmbiguousImpl),
      );
    case "E0284":
      return this.dcx().create_err(
        AmbiguousReturn_diagnostic({ span, source_kind, source_name, failure_span, subdiagnostic, bad_label } satisfies AmbiguousReturn),
      );
  }
};

// #[instrument(level = "debug", skip(self, error_code))]
// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:482 emit_inference_failure_err
TypeErrCtxt.prototype.emit_inference_failure_err = function (
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  failure_span: Span,
  term: Term,
  error_code: TypeAnnotationNeeded,
  should_label_span: boolean,
): Diag {
  return this.emit_inference_failure_err_with_type_hint(body_def_id, failure_span, term, error_code, should_label_span, undefined);
};

// rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:500 emit_inference_failure_err_with_type_hint
TypeErrCtxt.prototype.emit_inference_failure_err_with_type_hint = function (
  this: TypeErrCtxt,
  body_def_id: LocalDefId,
  failure_span_: Span,
  term_: Term,
  error_code: TypeAnnotationNeeded,
  should_label_span: boolean,
  ty: Ty | undefined,
): Diag {
  const term = this.deeply_resolve_ignoring_regions(term_, fold_Term);
  const arg_data = this.extract_inference_diagnostics_data(term, RegionHighlightMode.default());

  const typeck_results = this.typeck_results;
  if (typeck_results === undefined) {
    // If we don't have any typeck results we're outside
    // of a body, so we won't be able to get better info
    // here.
    return this.bad_inference_failure_err(failure_span_, arg_data, error_code);
  }

  const local_visitor = FindInferSourceVisitor.new(this, typeck_results, term, ty);
  let body_from_expansion = false;
  const body = this.tcx.hir_maybe_body_owned_by(this.tcx.typeck_root_def_id_local(body_def_id));
  if (body !== undefined) {
    const expr = body.value;
    local_visitor.visit_expr(expr);
    body_from_expansion = Span.from_expansion(body.value.span);
  }

  const infer_source = local_visitor.infer_source;
  if (infer_source === undefined) {
    let silence = false;
    if (this.tcx.def_kind(body_def_id).$ === "AssocFn") {
      const parent = this.tcx.local_parent(body_def_id);
      let item: hir.Node;
      let imp: hir.ItemKind;
      let self_ty_kind: hir.TyKind;
      let res: Res;
      if (
        this.tcx.is_automatically_derived(LocalDefId.to_def_id(parent)) &&
        (item = this.tcx.hir_node_by_def_id(parent)).$ === "Item" &&
        (imp = item._0.kind).$ === "Impl" &&
        (self_ty_kind = imp._0.self_ty.kind).$ === "Path" &&
        self_ty_kind._0.$ === "Resolved" &&
        (res = self_ty_kind._0._1.res).$ === "Def" &&
        (res._0.$ === "Struct" || res._0.$ === "Enum" || res._0.$ === "Union")
      ) {
        const def_id = res._1.as_local();
        let item2: hir.Node;
        if (def_id !== undefined && (item2 = this.tcx.hir_node_by_def_id(def_id)).$ === "Item") {
          // We have encountered an inference error within an automatically derived `impl`,
          // from a `#[derive(..)]` on an item that had a parse error. Because the parse
          // error might have caused the expanded code to be malformed, we silence the
          // inference error.
          silence = hir.ItemKind.recovered(item2._0.kind);
        }
      }
    }
    const err = this.bad_inference_failure_err(failure_span_, arg_data, error_code);
    if (silence) {
      err.downgrade_to_delayed_bug();
    }
    return err;
  }
  const { span, kind } = infer_source;

  const [source_kind, name, long_ty_path] = InferSourceKind.ty_localized_msg(kind, this.infcx);
  const failure_span = should_label_span && !Span.overlaps(failure_span_, span) ? failure_span_ : undefined;

  const subdiagnostic = InferSourceKind.suggestion(
    kind,
    this.tcx,
    this.infcx,
    body_def_id,
    term,
    arg_data,
    typeck_results,
    body_from_expansion,
    span,
  );
  let delay_as_bug: boolean;
  if (kind.$ === "ClosureArg" && kind.kind.$ === "Err") {
    // We will have already emitted an error about this pattern.
    delay_as_bug = true;
  } else if (kind.$ === "GenericArg" && generic_arg_names_err_path(this.tcx, kind.hir_id, kind.argument_index)) {
    // We have already emitted a name resolution error.
    delay_as_bug = true;
  } else {
    delay_as_bug = false;
  }

  let err: Diag;
  switch (error_code) {
    case "E0282":
      err = this.dcx().create_err(
        AnnotationRequired_diagnostic({ span, source_kind, source_name: name, failure_span, subdiagnostic, bad_label: undefined }),
      );
      break;
    case "E0283":
      err = this.dcx().create_err(
        AmbiguousImpl_diagnostic({ span, source_kind, source_name: name, failure_span, subdiagnostic, bad_label: undefined }),
      );
      break;
    case "E0284":
      err = this.dcx().create_err(
        AmbiguousReturn_diagnostic({ span, source_kind, source_name: name, failure_span, subdiagnostic, bad_label: undefined }),
      );
      break;
  }
  err.long_ty_path().value = long_ty_path;
  if (delay_as_bug) {
    // We have already emitted an earlier more relevant error.
    err.downgrade_to_delayed_bug();
  }
  return err;
};

/**
 * PORT: the guard of the `InferSourceKind::GenericArg { hir_id, argument_index, .. }` arm of `delay_as_bug` in
 * `emit_inference_failure_err_with_type_hint`: the path segment's `argument_index`-th generic argument is a type
 * naming `Res::Err`.
 */
function generic_arg_names_err_path(tcx: TyCtxt, hir_id: HirId, argument_index: number): boolean {
  const node = tcx.hir_node(hir_id);
  if (node.$ !== "PathSegment") return false;
  const args = node._0.args;
  if (args === undefined) return false;
  const arg = args.args[argument_index];
  if (arg === undefined || arg.$ !== "Type") return false;
  const ty_kind = arg._0.kind;
  return ty_kind.$ === "Path" && ty_kind._0.$ === "Resolved" && ty_kind._0._1.res.$ === "Err";
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:627 InferSource
export interface InferSource {
  span: Span;
  kind: InferSourceKind;
}
/** `#[derive(Debug)]` on `InferSource`. */
export const debug_InferSource: Debug<InferSource> = (v, f) =>
  debug_struct(f, "InferSource", [
    ["span", debug_Span(v.span, f)],
    ["kind", debug_InferSourceKind(v.kind, f)],
  ]);

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:633 InferSourceKind
export type InferSourceKind =
  | { readonly $: "LetBinding"; insert_span: Span; pattern_name: Ident | undefined; ty: Ty; def_id: DefId | undefined }
  | { readonly $: "ClosureArg"; insert_span: Span; ty: Ty; kind: hir.PatKind }
  | {
      readonly $: "GenericArg";
      insert_span: Span;
      argument_index: number;
      generics_def_id: DefId;
      def_id: DefId;
      generic_args: readonly GenericArg[];
      have_turbofish: boolean;
      hir_id: HirId;
    }
  | {
      readonly $: "FullyQualifiedMethodCall";
      receiver: hir.Expr;
      /// If the method has other arguments, this is ", " and the start of the first argument,
      /// while for methods without arguments this is ")" and the end of the method call.
      successor: [string, BytePos];
      args: GenericArgs;
      def_id: DefId;
    }
  | { readonly $: "ClosureReturn"; ty: Ty; data: hir.FnRetTy; should_wrap_expr: Span | undefined };
/** `#[derive(Debug)]` on `InferSourceKind`. */
export const debug_InferSourceKind: Debug<InferSourceKind> = (v, f) => {
  const debug_args = (args: readonly GenericArg[]): string => debug_list(f, args.map((a) => debugGenericArg(a, f)));
  switch (v.$) {
    case "LetBinding":
      return debug_struct(f, "LetBinding", [
        ["insert_span", debug_Span(v.insert_span, f)],
        ["pattern_name", debug_option(v.pattern_name, f, debug_Ident)],
        ["ty", debug_Ty(v.ty, f)],
        ["def_id", debug_option(v.def_id, f, debug_DefId)],
      ]);
    case "ClosureArg":
      return debug_struct(f, "ClosureArg", [
        ["insert_span", debug_Span(v.insert_span, f)],
        ["ty", debug_Ty(v.ty, f)],
        ["kind", hir.debug_PatKind(v.kind, f)],
      ]);
    case "GenericArg":
      return debug_struct(f, "GenericArg", [
        ["insert_span", debug_Span(v.insert_span, f)],
        ["argument_index", debug_int(v.argument_index, f)],
        ["generics_def_id", debug_DefId(v.generics_def_id, f)],
        ["def_id", debug_DefId(v.def_id, f)],
        ["generic_args", debug_args(v.generic_args)],
        ["have_turbofish", debug_bool(v.have_turbofish, f)],
        ["hir_id", debug_HirId(v.hir_id, f)],
      ]);
    case "FullyQualifiedMethodCall":
      return debug_struct(f, "FullyQualifiedMethodCall", [
        ["receiver", hir.debug_Expr(v.receiver, f)],
        ["successor", debug_tuple(f, "", [debug_str(v.successor[0]), debug_BytePos(v.successor[1], f)])],
        ["args", debug_args(v.args)],
        ["def_id", debug_DefId(v.def_id, f)],
      ]);
    case "ClosureReturn":
      return debug_struct(f, "ClosureReturn", [
        ["ty", debug_Ty(v.ty, f)],
        ["data", hir.debug_FnRetTy(v.data, f)],
        ["should_wrap_expr", debug_option(v.should_wrap_expr, f, debug_Span)],
      ]);
  }
};

/** `{:?}` of a `GenericArg` (rustc_middle structural_impls.ts), read lazily (only `debug!` output uses it). */
function debugGenericArg(a: GenericArg, f: Parameters<Debug<GenericArg>>[1]): string {
  const { debug_GenericArg } = require("../../../rustc_middle/ty/structural_impls.ts") as typeof import("../../../rustc_middle/ty/structural_impls.ts");
  return debug_GenericArg(a, f);
}

/** `impl<'tcx> InferSource<'tcx>` (PORTING §8: on the companion). */
export const InferSource = {
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:670 from_expansion
  from_expansion(self: InferSource): boolean {
    let source_from_expansion: boolean;
    const k = self.kind;
    switch (k.$) {
      case "LetBinding":
      case "ClosureArg":
      case "GenericArg":
        source_from_expansion = Span.from_expansion(k.insert_span);
        break;
      case "FullyQualifiedMethodCall":
        source_from_expansion = Span.from_expansion(k.receiver.span);
        break;
      case "ClosureReturn":
        source_from_expansion =
          Span.from_expansion(hir.FnRetTy.span(k.data)) || (k.should_wrap_expr !== undefined && Span.from_expansion(k.should_wrap_expr));
        break;
    }
    return source_from_expansion || Span.from_expansion(self.span);
  },
};

/** `impl<'tcx> InferSourceKind<'tcx>` (PORTING §8: on the companion). */
export const InferSourceKind = {
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:687 ty_localized_msg
  ty_localized_msg(self: InferSourceKind, infcx: InferCtxt): [string, string, PathBuf | undefined] {
    const long_ty_path: MutRef<PathBuf | undefined> = { value: undefined };
    switch (self.$) {
      case "LetBinding":
      case "ClosureArg":
      case "ClosureReturn": {
        const ty = self.ty;
        let k: ReturnType<Ty["kind"]>;
        if (ty.is_closure()) {
          return ["closure", closure_as_fn_str(infcx, ty), long_ty_path.value];
        } else if (
          ty.is_ty_or_numeric_infer() ||
          ty.is_primitive() ||
          ((k = ty.kind()).$ === "Adt" && k._1.terms()[Symbol.iterator]().next().done === true)
        ) {
          // `ty` is either `_`, a primitive type like `u32` or a type with no type or
          // const parameters. We will not mention the type in the main inference error
          // message.
          return ["other", "", long_ty_path.value];
        } else {
          const s = infcx.tcx.short_string(ty, long_ty_path, print_Ty);
          return ["normal", s, long_ty_path.value];
        }
      }
      // FIXME: We should be able to add some additional info here.
      case "GenericArg":
      case "FullyQualifiedMethodCall":
        return ["other", "", long_ty_path.value];
    }
  },

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:719 suggestion
  suggestion(
    self: InferSourceKind,
    tcx: TyCtxt,
    infcx: InferCtxt,
    body_def_id: LocalDefId,
    term: Term,
    arg_data: InferenceDiagnosticsData,
    typeck_results: TypeckResults,
    body_from_expansion: boolean,
    span: Span,
  ): SourceKindSubdiag | undefined {
    let subdiag: SourceKindSubdiag;
    switch (self.$) {
      case "LetBinding": {
        const { insert_span, pattern_name, ty, def_id } = self;
        subdiag = {
          $: "LetLike",
          span: insert_span,
          name: pattern_name !== undefined ? display_Ident(pattern_name) : "",
          x_kind: InferenceDiagnosticsData.where_x_is_kind(arg_data, infcx, ty),
          prefix_kind: clone_UnderspecifiedArgKind(arg_data.kind),
          prefix: UnderspecifiedArgKind.try_get_prefix(arg_data.kind) ?? "",
          arg_name: arg_data.name,
          kind: pattern_name !== undefined ? "with_pattern" : "other",
          type_name: ty_to_string(infcx, ty, def_id),
        };
        break;
      }
      case "ClosureArg": {
        const { insert_span, ty } = self;
        subdiag = {
          $: "LetLike",
          span: insert_span,
          name: "",
          x_kind: InferenceDiagnosticsData.where_x_is_kind(arg_data, infcx, ty),
          prefix_kind: clone_UnderspecifiedArgKind(arg_data.kind),
          prefix: UnderspecifiedArgKind.try_get_prefix(arg_data.kind) ?? "",
          arg_name: arg_data.name,
          kind: "closure",
          type_name: ty_to_string(infcx, ty, undefined),
        };
        break;
      }
      case "GenericArg": {
        const { insert_span, argument_index, generics_def_id, generic_args, have_turbofish, hir_id } = self;
        const generics = tcx.generics_of(generics_def_id) as Generics;
        const is_type = Term.as_type(term) !== undefined;

        const parent = InferenceDiagnosticsParentData.for_parent_def_id(tcx, generics_def_id);
        const [parent_exists, parent_prefix, parent_name]: [boolean, string, string] =
          parent === undefined ? [false, "", ""] : [true, parent.prefix, parent.name];

        if (argument_index >= generics.own_params.length) {
          panic(`index out of bounds: the len is ${generics.own_params.length} but the index is ${argument_index}`);
        }
        const param = generics.own_params[argument_index]!;
        const param_name = display_Symbol(param.name);

        let used_fallback = false;
        let args: string;
        if (def_id_eq_opt(tcx.get_diagnostic_item(sym.iterator_collect_fn), generics_def_id)) {
          if (collect_into_try_return(tcx, hir_id, body_def_id)) {
            const ret = collect_try_return_adt(tcx, body_def_id)!;
            if (tcx.get_diagnostic_name(ret) === sym.Option) {
              args = "Option<_>";
            } else {
              args = "Result<_, _>";
            }
          } else {
            args = "Vec<_>";
          }
        } else {
          const p = fmt_printer(infcx, Namespace.TypeNS);
          // `generic_args.iter().copied().map(..)`: lazy, so `comma_sep` prints each mapped argument as it is made.
          function* mapped(): Generator<GenericArg> {
            for (const arg of generic_args) {
              if (IsSuggestable.is_suggestable(arg, tcx, true, fold_GenericArg)) {
                used_fallback = true;
                yield arg;
                continue;
              }
              const ak = GenericArg.kind(arg);
              switch (ak.$) {
                case "Lifetime":
                  return bug("unexpected lifetime");
                case "Type":
                  yield GenericArg.from_Ty(infcx.next_ty_var(DUMMY_SP));
                  break;
                case "Const":
                  yield GenericArg.from_Const(infcx.next_const_var(DUMMY_SP));
                  break;
              }
            }
          }
          unwrap_print(p.comma_sep(mapped(), print_GenericArg));
          args = p.into_buffer();
        }

        let suggestion: SpecifyGenericParamsSuggestion | undefined;
        if (have_turbofish || body_from_expansion) {
          suggestion = undefined;
        } else if (generic_args.length === 1 && used_fallback) {
          switch (param.kind.$) {
            case "Type":
              suggestion = { $: "GenericTypeSuggestion", span: insert_span, param: param_name };
              break;
            case "Const":
              suggestion = { $: "ConstGenericSuggestion", span: insert_span, param: param_name };
              break;
            case "Lifetime":
              return bug("unexpected lifetime");
          }
        } else {
          suggestion = { $: "GenericSuggestion", span: insert_span, arg_count: generic_args.length, args };
        }

        subdiag = { $: "Generic", span, is_type, param_name, parent_exists, parent_prefix, parent_name, suggestion };
        break;
      }
      case "FullyQualifiedMethodCall": {
        const { receiver, successor, def_id } = self;
        const placeholder = infcx.next_ty_var(DUMMY_SP);
        const args = IsSuggestable.make_suggestable(self.args, tcx, true, placeholder, fold_GenericArgs);
        if (args === undefined) return undefined;

        const p = fmt_printer(infcx, Namespace.ValueNS);
        unwrap_print(p.print_def_path(def_id, args));
        const def_path = p.into_buffer();

        // We only care about whether we have to add `&` or `&mut ` for now.
        // This is the case if the last adjustment is a borrow and the
        // first adjustment was not a builtin deref.
        const adjustments = typeck_results.expr_adjustments(receiver);
        let adjustment: string;
        const first = adjustments[0];
        const last = adjustments[adjustments.length - 1];
        if (
          adjustments.length >= 2 &&
          first!.kind.$ === "Deref" &&
          first!.kind._0.$ === "Builtin" &&
          last!.kind.$ === "Borrow" &&
          last!.kind._0.$ === "Ref"
        ) {
          adjustment = "";
        } else if (last !== undefined && last.kind.$ === "Borrow" && last.kind._0.$ === "Ref") {
          adjustment = Mutability.ref_prefix_str(Mutability_from_AutoBorrowMutability(last.kind._0._0));
        } else {
          adjustment = "";
        }

        subdiag = diagnostics().SourceKindSubdiag.new_fully_qualified(receiver.span, def_path, adjustment, successor);
        break;
      }
      case "ClosureReturn": {
        const { data, should_wrap_expr } = self;
        const placeholder = infcx.next_ty_var(DUMMY_SP);

        const ty = IsSuggestable.make_suggestable(self.ty, tcx, true, placeholder, fold_Ty);
        if (ty === undefined) return undefined;
        const ty_info = ty_to_string(infcx, ty, undefined);
        subdiag = diagnostics().SourceKindSubdiag.new_closure_return(ty_info, data, should_wrap_expr);
        break;
      }
    }

    return subdiag;
  },
};

/** rustc_trait_selection diagnostics.ts (manual impls), read lazily (init order: same crate). */
function diagnostics(): typeof import("../../diagnostics.ts") {
  return require("../../diagnostics.ts") as typeof import("../../diagnostics.ts");
}

/**
 * PORT: the `let`-chain of the `iterator_collect_fn` branch of `InferSourceKind::suggestion` (`GenericArg`), up to and
 * including `let Some(sym::Option | sym::Result) = tcx.get_diagnostic_name(adt.did())`: the `collect()` is the argument of
 * a call to a method of the `Try` trait (a `?`) inside a fn returning an `Option` / `Result`.
 */
function collect_into_try_return(tcx: TyCtxt, hir_id: HirId, body_def_id: LocalDefId): boolean {
  const node = tcx.parent_hir_node(hir_id);
  if (node.$ !== "Expr") return false;
  const ek = node._0.kind;
  if (ek.$ !== "Call") return false;
  const fk = ek._0.kind;
  if (fk.$ !== "Path" || fk._0.$ !== "Resolved") return false;
  const res = fk._0._1.res;
  if (res.$ !== "Def" || res._0.$ !== "AssocFn") return false;
  const def_id = res._1;
  const try_trait = tcx.lang_items().try_trait();
  if (try_trait === undefined) return false;
  const parent = tcx.parent(def_id);
  if (!(try_trait.krate === parent.krate && try_trait.index === parent.index)) return false;
  const dk = tcx.def_kind(LocalDefId.to_def_id(body_def_id)).$;
  if (dk !== "Fn" && dk !== "AssocFn") return false;
  const adt = collect_try_return_adt(tcx, body_def_id);
  if (adt === undefined) return false;
  const name = tcx.get_diagnostic_name(adt);
  return name === sym.Option || name === sym.Result;
}

/** `tcx.fn_sig(body).instantiate_identity().skip_binder().output()` when it is an ADT: the ADT's `DefId`. */
function collect_try_return_adt(tcx: TyCtxt, body_def_id: LocalDefId): DefId | undefined {
  const ret = FnSig.output(
    Unnormalized.skip_binder(EarlyBinder.instantiate_identity(tcx.fn_sig(LocalDefId.to_def_id(body_def_id)) as EarlyBinder<Binder<FnSig>>)),
  );
  const k = ret.kind();
  return k.$ === "Adt" ? k._0.did() : undefined;
}

// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:904 InsertableGenericArgs
export interface InsertableGenericArgs {
  insert_span: Span;
  args: GenericArgs;
  generics_def_id: DefId;
  def_id: DefId;
  have_turbofish: boolean;
  hir_id: HirId;
}
/** `#[derive(Debug)]` on `InsertableGenericArgs`. */
export const debug_InsertableGenericArgs: Debug<InsertableGenericArgs> = (v, f) =>
  debug_struct(f, "InsertableGenericArgs", [
    ["insert_span", debug_Span(v.insert_span, f)],
    ["args", debug_list(f, v.args.map((a) => debugGenericArg(a, f)))],
    ["generics_def_id", debug_DefId(v.generics_def_id, f)],
    ["def_id", debug_DefId(v.def_id, f)],
    ["have_turbofish", debug_bool(v.have_turbofish, f)],
    ["hir_id", debug_HirId(v.hir_id, f)],
  ]);

/// A visitor which searches for the "best" spot to use in the inference error.
///
/// For this it walks over the hir body and tries to check all places where
/// inference variables could be bound.
///
/// While doing so, the currently best spot is stored in `infer_source`.
/// For details on how we rank spots, see [Self::source_cost]
// rustc-type: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:920 FindInferSourceVisitor
export class FindInferSourceVisitor extends hir.intravisit.Visitor {
  // impl<'a, 'tcx> Visitor<'tcx> for FindInferSourceVisitor<'a, 'tcx>
  // type NestedFilter = nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public tecx: TypeErrCtxt,
    public typeck_results: TypeckResults,

    public target: Term,
    public ty: Ty | undefined,

    public attempt: number,
    public infer_source_cost: number,
    public infer_source: InferSource | undefined,
  ) {
    super();
  }

  // ---- impl<'a, 'tcx> FindInferSourceVisitor<'a, 'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:933 new
  static new(tecx: TypeErrCtxt, typeck_results: TypeckResults, target: Term, ty: Ty | undefined): FindInferSourceVisitor {
    return new FindInferSourceVisitor(
      tecx,
      typeck_results,

      target,
      ty,

      0,
      // PORT: `usize::MAX`.
      Number.MAX_SAFE_INTEGER,
      undefined,
    );
  }

  /// Computes cost for the given source.
  ///
  /// Sources with a small cost are prefer and should result
  /// in a clearer and idiomatic suggestion.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:956 source_cost
  source_cost(source: InferSource): number {
    // The sources are listed in order of preference here.
    const tcx = this.tecx.tcx;
    const ctx = new CostCtxt(tcx);
    const k = source.kind;
    switch (k.$) {
      case "LetBinding":
        return ctx.ty_cost(k.ty);
      case "ClosureArg":
        return ctx.ty_cost(k.ty);
      case "GenericArg": {
        let variant_cost: number;
        const dk = tcx.def_kind(k.def_id);
        // `None::<u32>` and friends are ugly.
        if (dk.$ === "Variant" || (dk.$ === "Ctor" && dk._0 === "Variant")) {
          variant_cost = 15;
        } else {
          variant_cost = 10;
        }
        return variant_cost + k.generic_args.reduce((acc, arg) => acc + ctx.arg_cost(arg), 0);
      }
      case "FullyQualifiedMethodCall":
        return 20 + k.args.reduce((acc, arg) => acc + ctx.arg_cost(arg), 0);
      case "ClosureReturn":
        return 30 + ctx.ty_cost(k.ty) + (k.should_wrap_expr !== undefined ? 10 : 0);
    }
  }

  /// Uses `fn source_cost` to determine whether this inference source is preferable to
  /// previous sources. We generally prefer earlier sources.
  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1017 update_infer_source
  update_infer_source(new_source: InferSource): void {
    if (InferSource.from_expansion(new_source)) {
      return;
    }

    const cost = this.source_cost(new_source) + this.attempt;
    // debug!(?cost);
    this.attempt += 1;
    const current = this.infer_source;
    const nk = new_source.kind;
    if (current !== undefined && current.kind.$ === "GenericArg" && nk.$ === "LetBinding" && nk.ty.is_ty_or_numeric_infer()) {
      const did = current.kind.def_id;
      // Customize the output so we talk about `let x: Vec<_> = iter.collect();` instead of
      // `let x: _ = iter.collect();`, as this is a very common case.
      nk.def_id = did;
    }

    if (cost < this.infer_source_cost) {
      this.infer_source_cost = cost;
      this.infer_source = new_source;
    }
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1041 node_args_opt
  node_args_opt(hir_id: HirId): GenericArgs | undefined {
    const args = this.typeck_results.node_args_opt(hir_id);
    return args === undefined ? undefined : this.tecx.deeply_resolve_ignoring_regions(args, fold_GenericArgs);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1046 opt_node_type
  opt_node_type(hir_id: HirId): Ty | undefined {
    const ty = this.typeck_results.node_type_opt(hir_id);
    return ty === undefined ? undefined : this.tecx.deeply_resolve_ignoring_regions(ty, fold_Ty);
  }

  // Check whether this generic argument is the inference variable we
  // are looking for.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1053 generic_arg_is_target
  generic_arg_is_target(arg: GenericArg): boolean {
    if (arg === GenericArg.from_Term(this.target)) {
      return true;
    }

    const ak = GenericArg.kind(arg);
    const tk = Term.kind(this.target);
    if (ak.$ === "Type" && tk.$ === "Ty") {
      const a = ak._0.kind();
      const b = tk._0.kind();
      if (a.$ === "Infer" && a._0.$ === "TyVar" && b.$ === "Infer" && b._0.$ === "TyVar") {
        return this.tecx.sub_unification_table_root_var(a._0._0) === this.tecx.sub_unification_table_root_var(b._0._0);
      }
      return false;
    } else if (ak.$ === "Const" && tk.$ === "Const") {
      const a = ak._0.kind();
      const b = tk._0.kind();
      if (a.$ === "Infer" && a._0.$ === "Var" && b.$ === "Infer" && b._0.$ === "Var") {
        return this.tecx.root_const_var(a._0._0) === this.tecx.root_const_var(b._0._0);
      }
      return false;
    } else {
      return false;
    }
  }

  /// Does this generic argument contain our target inference variable
  /// in a way which can be written by the user.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1084 generic_arg_contains_target
  generic_arg_contains_target(arg: GenericArg): boolean {
    const walker = GenericArg.walk(arg);
    let inner: GenericArg | undefined;
    while ((inner = walker.next()) !== undefined) {
      if (this.generic_arg_is_target(inner)) {
        return true;
      }
      const ik = GenericArg.kind(inner);
      switch (ik.$) {
        case "Lifetime":
          break;
        case "Type": {
          const k = ik._0.kind();
          if ((k.$ === "Alias" && k._1.kind.$ === "Opaque") || k.$ === "Closure" || k.$ === "CoroutineClosure" || k.$ === "Coroutine") {
            // Opaque types can't be named by the user right now.
            //
            // Both the generic arguments of closures and coroutines can
            // also not be named. We may want to only look into the closure
            // signature in case it has no captures, as that can be represented
            // using `fn(T) -> R`.

            // FIXME(type_alias_impl_trait): These opaque types
            // can actually be named, so it would make sense to
            // adjust this case and add a test for it.
            walker.skip_current_subtree();
          }
          break;
        }
        case "Const":
          if (ik._0.kind().$ === "Alias") {
            // You can't write the generic arguments for
            // alias constants.
            walker.skip_current_subtree();
          }
          break;
      }
    }
    return false;
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1125 expr_inferred_arg_iter
  expr_inferred_arg_iter(expr: hir.Expr): Iterable<InsertableGenericArgs> {
    const tcx = this.tecx.tcx;
    const ek = expr.kind;
    switch (ek.$) {
      case "Path": {
        const path = ek._0;
        const args = this.node_args_opt(expr.hir_id);
        if (args !== undefined) {
          return this.path_inferred_arg_iter(expr.hir_id, args, path);
        }
        break;
      }
      // FIXME(#98711): Ideally we would also deal with type relative
      // paths here, even if that is quite rare.
      //
      // See the `need_type_info/expr-struct-type-relative-gat.rs` test
      // for an example where that would be needed.
      //
      // However, the `type_dependent_def_id` for `Self::Output` in an
      // impl is currently the `DefId` of `Output` in the trait definition
      // which makes this somewhat difficult and prevents us from just
      // using `self.path_inferred_arg_iter` here.
      case "Struct": {
        const qpath = ek._0;
        // FIXME(TaKO8Ki): Ideally we should support other kinds,
        // such as `TyAlias` or `AssocTy`. For that we have to map
        // back from the self type to the type alias though. That's difficult.
        //
        // See the `need_type_info/issue-103053.rs` test for
        // a example.
        if (
          qpath.$ === "Resolved" &&
          qpath._1.res.$ === "Def" &&
          (qpath._1.res._0.$ === "Struct" || qpath._1.res._0.$ === "Enum" || qpath._1.res._0.$ === "Union")
        ) {
          const path = qpath._1;
          const ty = this.opt_node_type(expr.hir_id);
          let k: ReturnType<Ty["kind"]>;
          if (ty !== undefined && (k = ty.kind()).$ === "Adt") {
            return this.resolved_path_inferred_arg_iter(path, k._1);
          }
        }
        break;
      }
      case "MethodCall": {
        const segment = ek._0;
        const def_id = this.typeck_results.type_dependent_def_id(expr.hir_id);
        if (def_id !== undefined) {
          const generics = tcx.generics_of(def_id) as Generics;
          // `try { .. }`
          const insertable = ((): InsertableGenericArgs | undefined => {
            if (generics.has_impl_trait()) {
              return undefined;
            }
            const args = this.node_args_opt(expr.hir_id);
            if (args === undefined) return undefined;
            const span = tcx.hir_span(segment.hir_id);
            const insert_span = Span.with_hi(Span.shrink_to_hi(segment.ident.span), Span.hi(span));
            const have_turbofish = segment.args !== undefined && segment.args.args.some((arg) => hir.GenericArg.is_ty_or_const(arg));
            return {
              insert_span,
              args,
              generics_def_id: def_id,
              def_id,
              have_turbofish,
              hir_id: expr.hir_id,
            };
          })();
          return insertable === undefined ? [] : [insertable];
        }
        break;
      }
      default:
        break;
    }

    return [];
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1191 resolved_path_inferred_arg_iter
  resolved_path_inferred_arg_iter(path: hir.Path, args: GenericArgs): Iterable<InsertableGenericArgs> {
    const tcx = this.tecx.tcx;
    const have_turbofish = path.segments.some(
      (segment) => segment.args !== undefined && segment.args.args.some((arg) => hir.GenericArg.is_ty_or_const(arg)),
    );
    // The last segment of a path often has `Res::Err` and the
    // correct `Res` is the one of the whole path.
    //
    // FIXME: We deal with that one separately for now,
    // would be good to remove this special case.
    // `try { .. }` (with `do yeet ()`)
    const last_segment_using_path_data = ((): InsertableGenericArgs | undefined => {
      const generics_def_id = tcx.res_generics_def_id(path.res);
      if (generics_def_id === undefined) return undefined;
      const generics = tcx.generics_of(generics_def_id) as Generics;
      if (generics.has_impl_trait()) {
        return undefined;
      }
      const last = unwrap(path.segments[path.segments.length - 1]);
      const insert_span = Span.with_hi(Span.shrink_to_hi(last.ident.span), Span.hi(path.span));
      return {
        insert_span,
        args,
        generics_def_id,
        def_id: Res.def_id(path.res, debug_HirId),
        have_turbofish,
        hir_id: unwrap(path.segments[path.segments.length - 1]).hir_id,
      };
    })();

    // `path.segments.iter().filter_map(..).chain(last_segment_using_path_data)`: lazy.
    return (function* (): Generator<InsertableGenericArgs> {
      for (const segment of path.segments) {
        const res = segment.res;
        const generics_def_id = tcx.res_generics_def_id(res);
        if (generics_def_id === undefined) continue;
        const generics = tcx.generics_of(generics_def_id) as Generics;
        if (generics.has_impl_trait()) {
          continue;
        }
        const span = tcx.hir_span(segment.hir_id);
        const insert_span = Span.with_hi(Span.shrink_to_hi(segment.ident.span), Span.hi(span));
        yield {
          insert_span,
          args,
          generics_def_id,
          def_id: Res.def_id(res, debug_HirId),
          have_turbofish,
          hir_id: segment.hir_id,
        };
      }
      if (last_segment_using_path_data !== undefined) yield last_segment_using_path_data;
    })();
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1246 path_inferred_arg_iter
  path_inferred_arg_iter(hir_id: HirId, args: GenericArgs, qpath: hir.QPath): Iterable<InsertableGenericArgs> {
    const tcx = this.tecx.tcx;
    switch (qpath.$) {
      case "Resolved": {
        const path = qpath._1;
        return this.resolved_path_inferred_arg_iter(path, args);
      }
      case "TypeRelative": {
        const ty = qpath._0;
        const segment_ = qpath._1;
        const def_id = this.typeck_results.type_dependent_def_id(hir_id);
        if (def_id === undefined) {
          return [];
        }

        const generics = tcx.generics_of(def_id) as Generics;
        let segment: InsertableGenericArgs | undefined;
        if (!segment_.infer_args || generics.has_impl_trait()) {
          segment = undefined;
        } else {
          const span = tcx.hir_span(segment_.hir_id);
          const insert_span = Span.with_hi(Span.shrink_to_hi(segment_.ident.span), Span.hi(span));
          segment = {
            insert_span,
            args,
            generics_def_id: def_id,
            def_id,
            have_turbofish: false,
            hir_id: segment_.hir_id,
          };
        }

        const parent_def_id = unwrap(generics.parent);
        if (tcx.def_kind(parent_def_id).$ === "Impl") {
          const parent_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(parent_def_id) as EarlyBinder<Ty>, tcx, args, fold_Ty));
          const pk = parent_ty.kind();
          const tk = ty.kind;
          if (pk.$ === "Adt" && tk.$ === "Path" && tk._0.$ === "Resolved") {
            const def = pk._0;
            // PORT: upstream's arm binds a new `args` (the ADT's) that shadows the outer one.
            const args_ = pk._1;
            const path = tk._0._1;
            const rd = tcx.res_generics_def_id(path.res);
            if (!def_id_eq_opt(rd, def.did())) {
              switch (path.res.$) {
                case "Def":
                  if (path.res._0.$ === "TyAlias") {
                    // FIXME: Ideally we should support this. For that
                    // we have to map back from the self type to the
                    // type alias though. That's difficult.
                    //
                    // See the `need_type_info/type-alias.rs` test for
                    // some examples.
                    break;
                  }
                  // warn!("unexpected path: def={:?} args={:?} path={:?}", def, args, path);
                  break;
                // There cannot be inference variables in the self type,
                // so there's nothing for us to do here.
                case "SelfTyParam":
                case "SelfTyAlias":
                  break;
                default:
                  // warn!("unexpected path: def={:?} args={:?} path={:?}", def, args, path);
                  break;
              }
            } else {
              const first = this.resolved_path_inferred_arg_iter(path, args_);
              return (function* (): Generator<InsertableGenericArgs> {
                yield* first;
                if (segment !== undefined) yield segment;
              })();
            }
          }
        }

        return segment === undefined ? [] : [segment];
      }
    }
  }

  // ---- impl<'a, 'tcx> Visitor<'tcx> for FindInferSourceVisitor<'a, 'tcx> ----

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1324 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tecx.tcx);
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1328 visit_local
  override visit_local(local: hir.LetStmt): undefined {
    hir.intravisit.walk_local(this, local);

    let ty = this.opt_node_type(local.hir_id);
    if (ty !== undefined) {
      if (this.generic_arg_contains_target(GenericArg.from_Ty(ty))) {
        // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1333 get_did
        function get_did(typeck_results: TypeckResults, expr: hir.Expr): DefId | undefined {
          const k = expr.kind;
          let inner: hir.ExprKind;
          let base: hir.ExprKind;
          let did: DefId | undefined;
          if (k.$ === "Match" && k._2.$ === "TryDesugar" && (inner = k._0.kind).$ === "Call" && inner._1.length === 1) {
            return get_did(typeck_results, inner._1[0]!);
          } else if (
            k.$ === "Call" &&
            (base = k._0.kind).$ === "Path" &&
            base._0.$ === "Resolved" &&
            base._0._1.res.$ === "Def"
          ) {
            return base._0._1.res._1;
          } else if (k.$ === "MethodCall" && (did = typeck_results.type_dependent_def_id(expr.hir_id)) !== undefined) {
            return did;
          } else {
            return undefined;
          }
        }
        if (this.ty !== undefined && TypeVisitableExt.has_infer(ty, fold_Ty)) {
          ty = this.ty;
        }
        if (local.source === "Normal" && local.ty === undefined) {
          const typeck_results = this.typeck_results;
          this.update_infer_source({
            span: local.pat.span,
            kind: {
              $: "LetBinding",
              insert_span: Span.shrink_to_hi(local.pat.span),
              pattern_name: local.pat.simple_ident(),
              ty,
              def_id: local.init === undefined ? undefined : get_did(typeck_results, local.init),
            },
          });
        }
      }
    }
    return undefined;
  }

  /// For closures, we first visit the parameters and then the content,
  /// as we prefer those.
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1383 visit_body
  override visit_body(body: hir.Body): undefined {
    for (const param of body.params) {
      // debug!("param: span {:?}, ty_span {:?}, pat.span {:?}", param.span, param.ty_span, param.pat.span);
      if (param.ty_span !== param.pat.span) {
        // debug!("skipping param: has explicit type");
        continue;
      }

      const param_ty = this.opt_node_type(param.hir_id);
      if (param_ty === undefined) continue;

      if (this.generic_arg_contains_target(GenericArg.from_Ty(param_ty))) {
        this.update_infer_source({
          span: param.pat.span,
          kind: {
            $: "ClosureArg",
            insert_span: Span.shrink_to_hi(param.pat.span),
            ty: param_ty,
            kind: param.pat.kind,
          },
        });
      }
    }
    hir.intravisit.walk_body(this, body);
    return undefined;
  }

  // #[instrument(level = "debug", skip(self))]
  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:1411 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    const tcx = this.tecx.tcx;
    const ek = expr.kind;
    switch (ek.$) {
      // When encountering `func(arg)` first look into `arg` and then `func`,
      // as `arg` is "more specific".
      case "Call": {
        const func = ek._0;
        const args = ek._1;
        for (const arg of args) {
          this.visit_expr(arg);
        }
        this.visit_expr(func);
        break;
      }
      default:
        hir.intravisit.walk_expr(this, expr);
        break;
    }

    for (const args_ of this.expr_inferred_arg_iter(expr)) {
      // debug!(?args);
      const { insert_span, args, generics_def_id, def_id, have_turbofish, hir_id } = args_;
      const generics = tcx.generics_of(generics_def_id) as Generics;
      const argument_index_ = generics.own_args(args).findIndex((arg) => this.generic_arg_contains_target(arg));
      if (argument_index_ !== -1) {
        const args2 = this.tecx.deeply_resolve_ignoring_regions(args, fold_GenericArgs);
        const own = generics.own_args_no_defaults(tcx, args2);
        const lifetimes = generics.own_counts().lifetimes;
        if (lifetimes > own.length) {
          panic(`range start index ${lifetimes} out of range for slice of length ${own.length}`);
        }
        const generic_args = own.slice(lifetimes);
        let span: Span;
        let hir_args: hir.GenericArgs | undefined;
        let arg: hir.GenericArg | undefined;
        if (
          ek.$ === "MethodCall" &&
          have_turbofish &&
          (hir_args = ek._0.args) !== undefined &&
          argument_index_ >= lifetimes &&
          (arg = hir_args.args[hir_args.num_lifetime_args() + (argument_index_ - lifetimes)]) !== undefined
        ) {
          span = hir.GenericArg.span(arg);
        } else if (ek.$ === "MethodCall") {
          span = ek._0.ident.span;
        } else {
          span = expr.span;
        }
        let argument_index = argument_index_;
        if (generics.has_own_self()) {
          argument_index += 1;
        }

        this.update_infer_source({
          span,
          kind: {
            $: "GenericArg",
            insert_span,
            argument_index,
            generics_def_id,
            def_id,
            generic_args,
            have_turbofish,
            hir_id,
          },
        });
      }
    }

    const node_ty = this.opt_node_type(expr.hir_id);
    if (node_ty !== undefined) {
      const nk = node_ty.kind();
      if (ek.$ === "Closure" && nk.$ === "Closure") {
        const { fn_decl, body, fn_decl_span } = ek._0;
        const args = nk._1;
        const output = Binder.skip_binder(PolyFnSig.output(ClosureArgs.sig(args.as_closure())));
        if (this.generic_arg_contains_target(GenericArg.from_Ty(output))) {
          const body_ = this.tecx.tcx.hir_body(body);
          const should_wrap_expr = body_.value.kind.$ === "Block" ? undefined : Span.shrink_to_hi(body_.value.span);
          this.update_infer_source({
            span: fn_decl_span,
            kind: {
              $: "ClosureReturn",
              ty: output,
              data: fn_decl.output,
              should_wrap_expr,
            },
          });
        }
      }
    }

    const has_impl_trait = (def_id: DefId): boolean => {
      // `iter::successors(Some(tcx.generics_of(def_id)), |generics| generics.parent.map(..)).any(..)`
      let generics: Generics | undefined = tcx.generics_of(def_id) as Generics;
      while (generics !== undefined) {
        if (generics.has_impl_trait()) return true;
        generics = generics.parent === undefined ? undefined : (tcx.generics_of(generics.parent) as Generics);
      }
      return false;
    };
    let args: GenericArgs | undefined;
    let def_id: DefId | undefined;
    if (
      ek.$ === "MethodCall" &&
      (args = this.node_args_opt(expr.hir_id)) !== undefined &&
      args.some((arg) => this.generic_arg_contains_target(arg)) &&
      (def_id = this.typeck_results.type_dependent_def_id(expr.hir_id)) !== undefined &&
      this.tecx.tcx.trait_of_assoc(def_id) !== undefined &&
      !has_impl_trait(def_id) &&
      // FIXME(fn_delegation): In delegation item argument spans are equal to last path
      // segment. This leads to ICE's when emitting `multipart_suggestion`.
      tcx.hir_opt_delegation_sig_id(expr.hir_id.owner.def_id) === undefined
    ) {
      const path = ek._0;
      const receiver = ek._1;
      const method_args = ek._2;
      const span = ek._3;
      const first = method_args[0];
      const successor: [string, BytePos] = first === undefined ? [")", Span.hi(span)] : [", ", Span.lo(first.span)];
      const args2 = this.tecx.deeply_resolve_ignoring_regions(args, fold_GenericArgs);
      this.update_infer_source({
        span: path.ident.span,
        kind: {
          $: "FullyQualifiedMethodCall",
          receiver,
          successor,
          args: args2,
          def_id,
        },
      });
    }
    return undefined;
  }
}

// PORT: the fn-local `#[derive(Clone, Copy)] struct CostCtxt<'tcx> { tcx }` of `source_cost`, at module level.
class CostCtxt {
  constructor(public tcx: TyCtxt) {}

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:962 arg_cost
  arg_cost(arg: GenericArg): number {
    const k = GenericArg.kind(arg);
    switch (k.$) {
      case "Lifetime":
        return 0; // erased
      case "Type":
        return this.ty_cost(k._0);
      case "Const":
        return 3; // some non-zero value
    }
  }

  // rustc: compiler/rustc_trait_selection/src/error_reporting/infer/need_type_info.rs:969 ty_cost
  ty_cost(ty: Ty): number {
    const k = ty.kind();
    switch (k.$) {
      case "Closure":
        return 1000;
      case "FnDef":
        return 150;
      case "FnPtr":
        return 30;
      case "Adt": {
        const def = k._0;
        const args = k._1;
        return (
          5 +
          (this.tcx.generics_of(def.did()) as Generics)
            .own_args_no_defaults(this.tcx, args)
            .reduce((acc, arg) => acc + this.arg_cost(arg), 0)
        );
      }
      case "Tuple":
        return 5 + k._0.reduce((acc, arg) => acc + this.ty_cost(arg), 0);
      case "Ref":
        return 2 + this.ty_cost(k._1);
      case "Infer":
        return 0;
      default:
        return 1;
    }
  }
}
