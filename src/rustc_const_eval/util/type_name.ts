// Port of compiler/rustc_const_eval/src/util/type_name.rs (declared by lane interp-contract, ported by lane ctfe-util).
// PORT: `write!(self, "..")` is one `write_str` of the text (rustc_middle ty/print/pretty.ts header); `write!(self.path,
// "::{}", ..)` appends to `path` directly, as upstream (it bypasses `fmt::Write for TypeNamePrinter`, which does the same).
// PORT: pretty.ts first: it loads ty/print/mod.ts (the `Printer` base class) before extending it.
import { PrettyPrinter, print_GenericArg } from "../../rustc_middle/ty/print/pretty.ts";
import { display_DefPathData, type DisambiguatedDefPathData } from "../../rustc_hir_id/definitions.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_GenericArgs, type GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { type List } from "../../rustc_middle/ty/list.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type PolyExistentialPredicate } from "../../rustc_middle/ty/predicate.ts";
import { type Print, PRINT_OK, type PrintError } from "../../rustc_middle/ty/print/mod.ts";
import { type Region } from "../../rustc_middle/ty/region.ts";
import { type CrateNum, type DefId } from "../../rustc_span/def_id.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { type TraitRef } from "../../rustc_type_ir/predicate.ts";
import { debug_RegionKind } from "../../rustc_type_ir/region_kind.ts";
import { CoroutineArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic, unwrap } from "../../std/panic.ts";
import type { PrintResult } from "../../rustc_middle/ty/print/mod.ts";
import type { Const } from "../../rustc_middle/ty/consts.gen.ts";
import { unwrap_result } from "../../std/result.ts";

export * from "./type_name.gen.ts";

// rustc-type: compiler/rustc_const_eval/src/util/type_name.rs:10 TypeNamePrinter
// PORT: `impl Printer` / `impl PrettyPrinter` / `impl fmt::Write` are the methods of a class extending rustc_middle's
// abstract `PrettyPrinter` (ty/print/pretty.ts header); the field `tcx` is `tcx_` because `Printer::tcx()` keeps its
// name there.
export class TypeNamePrinter extends PrettyPrinter {
  constructor(
    public tcx_: TyCtxt,
    public path: string,
  ) {
    super();
  }

  // ---- impl Printer for TypeNamePrinter ----

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:16 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:20 print_region
  print_region(_region: Region): PrintResult {
    // FIXME: most regions have been erased by the time this code runs.
    // Just printing `'_` is a bit hacky but gives mostly good results, and
    // doing better is difficult. See `should_print_optional_region`.
    return this.write_str("'_");
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:27 print_type
  print_type(ty: Ty): PrintResult {
    const kind = ty.kind();
    switch (kind.$) {
      // Types without identity.
      case "Bool":
      case "Char":
      case "Int":
      case "Uint":
      case "Float":
      case "Str":
      case "Pat":
      case "Array":
      case "Slice":
      case "RawPtr":
      case "Ref":
      case "FnPtr":
      case "Never":
      case "Tuple":
      case "Dynamic":
      case "UnsafeBinder":
        return this.pretty_print_type(ty);

      // Placeholders (all printed as `_` to uniformize them).
      case "Param":
      case "Bound":
      case "Placeholder":
      case "Infer":
      case "Error": {
        const r = this.write_str("_");
        if (r.$ === "Err") return r;
        return PRINT_OK;
      }

      // Types with identity (print the module path).
      case "Adt":
        return this.print_def_path(kind._0.did(), kind._1);
      case "Alias": {
        const alias = kind._1;
        switch (alias.kind.$) {
          case "Projection":
          case "Opaque":
            return this.print_def_path(alias.kind.def_id, alias.args);
          case "Free":
            return bug("type_name: unexpected free alias");
          case "Inherent":
            return bug("type_name: unexpected inherent projection");
        }
        break;
      }
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
        return this.print_def_path(kind._0, kind._1);
      case "Foreign":
        return this.print_def_path(kind._0, []);

      case "FnDef":
        return this.print_def_path(kind._0, unwrap(Binder.no_bound_vars(kind._1, fold_GenericArgs)));
      case "CoroutineWitness":
        return bug("type_name: unexpected `CoroutineWitness`");
    }
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:77 print_const
  print_const(ct: Const): PrintResult {
    return this.pretty_print_const(ct, false);
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:81 print_dyn_existential
  print_dyn_existential(predicates: List<PolyExistentialPredicate>): PrintResult {
    return this.pretty_print_dyn_existential(predicates);
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:88 print_crate_name
  print_crate_name(cnum: CrateNum): PrintResult {
    this.path += Symbol.as_str(this.tcx_.crate_name(cnum));
    return PRINT_OK;
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:93 print_path_with_qualified
  print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    return this.pretty_print_path_with_qualified(self_ty, trait_ref);
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:101 print_path_with_impl
  print_path_with_impl(print_prefix: (p: this) => PrintResult, self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    return this.pretty_print_path_with_impl(
      (cx) => {
        const r = print_prefix(cx);
        if (r.$ === "Err") return r;

        cx.path += "::";

        return PRINT_OK;
      },
      self_ty,
      trait_ref,
    );
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:120 print_path_with_simple
  print_path_with_simple(print_prefix: (p: this) => PrintResult, disambiguated_data: DisambiguatedDefPathData): PrintResult {
    const r = print_prefix(this);
    if (r.$ === "Err") return r;

    this.path += `::${display_DefPathData(disambiguated_data.data)}`;

    return PRINT_OK;
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:132 print_path_with_generic_args
  print_path_with_generic_args(print_prefix: (p: this) => PrintResult, args: readonly GenericArg[]): PrintResult {
    const r = print_prefix(this);
    if (r.$ === "Err") return r;
    if (!(args.length === 0)) {
      return this.generic_delimiters((cx) => cx.comma_sep(args, print_GenericArg as Print<GenericArg, this>));
    } else {
      return PRINT_OK;
    }
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:145 print_coroutine_with_kind
  override print_coroutine_with_kind(def_id: DefId, parent_args: readonly GenericArg[], kind: Ty): PrintResult {
    const r = this.print_def_path(def_id, parent_args);
    if (r.$ === "Err") return r;

    // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
    const k = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx_.type_of(def_id) as EarlyBinder<Ty>)).kind();
    if (k.$ !== "Coroutine") {
      // Could be `ty::Error`.
      return PRINT_OK;
    }
    const args = k._1;

    const default_kind = CoroutineArgs.kind_ty(args.as_coroutine());

    const closure_kind = kind.to_opt_closure_kind();
    if (kind === default_kind) {
      // No need to mark the closure if it's the deduced coroutine kind.
    } else if (closure_kind === "Fn" || closure_kind === undefined) {
      // Should never happen. Just don't mark anything rather than panicking.
    } else if (closure_kind === "FnMut") {
      this.path += "::{{call_mut}}";
    } else if (closure_kind === "FnOnce") {
      this.path += "::{{call_once}}";
    }

    return PRINT_OK;
  }

  // ---- impl PrettyPrinter for TypeNamePrinter ----

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:178 should_print_optional_region
  should_print_optional_region(region: Region): boolean {
    // Bound regions are always printed (as `'_`), which gives some idea that they are special,
    // even though the `for` is omitted by the pretty printer.
    // E.g. `for<'a, 'b> fn(&'a u32, &'b u32)` is printed as "fn(&'_ u32, &'_ u32)".
    const kind = region.kind();
    switch (region.kind().$) {
      case "ReErased":
      case "ReEarlyParam":
      case "ReStatic":
        return false;
      case "ReBound":
        return true;
      default:
        return panic(`type_name unhandled region: ${debug_RegionKind(kind, PLAIN)}`);
    }
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:190 generic_delimiters
  generic_delimiters(f: (p: this) => PrintResult): PrintResult {
    let r: PrintResult;
    if ((r = this.write_str("<")).$ === "Err") return r;

    if ((r = f(this)).$ === "Err") return r;

    if ((r = this.write_str(">")).$ === "Err") return r;

    return PRINT_OK;
  }

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:203 should_print_verbose
  override should_print_verbose(): boolean {
    // `std::any::type_name` should never print verbose type names
    return false;
  }

  // ---- impl fmt::Write for TypeNamePrinter ----

  // rustc: compiler/rustc_const_eval/src/util/type_name.rs:210 write_str
  override write_str(s: string): PrintResult {
    this.path += s;
    return PRINT_OK;
  }
}

// rustc: compiler/rustc_const_eval/src/util/type_name.rs:216 type_name
export function type_name(tcx: TyCtxt, ty: Ty): string {
  const p = new TypeNamePrinter(tcx, "");
  unwrap_result<undefined, PrintError>(p.print_type(ty));
  return p.path;
}
