// Port of compiler/rustc_const_eval/src/util/type_name.rs: DECLARED (lane interp-contract, plan-m4 wave 23b). Every fn is a stub
// (`// stub: <path>:<line> <name> (lane <lane>)` over its final signature, body `unported(..)`) for the lane
// ctfe-util; docs/handoff/interp-contract.md has the split table, the conventions and "How to fill a stub"
// (interpret/eval_context.ts's header has the representation notes).
import { type DisambiguatedDefPathData } from "../../rustc_hir_id/definitions.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { type List } from "../../rustc_middle/ty/list.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { type PolyExistentialPredicate } from "../../rustc_middle/ty/predicate.ts";
import { type PrintError } from "../../rustc_middle/ty/print/mod.ts";
import { type Region } from "../../rustc_middle/ty/region.ts";
import { type CrateNum, type DefId } from "../../rustc_span/def_id.ts";
import { type TraitRef } from "../../rustc_type_ir/predicate.ts";
import { unported } from "../../std/panic.ts";
import { PrettyPrinter } from "../../rustc_middle/ty/print/pretty.ts";
import type { PrintResult } from "../../rustc_middle/ty/print/mod.ts";
import type { Const } from "../../rustc_middle/ty/consts.gen.ts";
import { type Result } from "../../std/result.ts";

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

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:16 tcx (lane ctfe-util)
  tcx(): TyCtxt {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::tcx");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:20 print_region (lane ctfe-util)
  print_region(_region: Region): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::print_region");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:27 print_type (lane ctfe-util)
  print_type(ty: Ty): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::print_type");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:77 print_const (lane ctfe-util)
  print_const(ct: Const): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::print_const");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:81 print_dyn_existential (lane ctfe-util)
  print_dyn_existential(predicates: List<PolyExistentialPredicate>): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::print_dyn_existential");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:88 print_crate_name (lane ctfe-util)
  print_crate_name(cnum: CrateNum): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::print_crate_name");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:93 print_path_with_qualified (lane ctfe-util)
  print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::print_path_with_qualified");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:101 print_path_with_impl (lane ctfe-util)
  print_path_with_impl(print_prefix: (p: this) => PrintResult, self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::print_path_with_impl");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:120 print_path_with_simple (lane ctfe-util)
  print_path_with_simple(print_prefix: (p: this) => PrintResult, disambiguated_data: DisambiguatedDefPathData): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::print_path_with_simple");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:132 print_path_with_generic_args (lane ctfe-util)
  print_path_with_generic_args(print_prefix: (p: this) => PrintResult, args: readonly GenericArg[]): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::print_path_with_generic_args");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:145 print_coroutine_with_kind (lane ctfe-util)
  override print_coroutine_with_kind(def_id: DefId, parent_args: readonly GenericArg[], kind: Ty): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::print_coroutine_with_kind");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:178 should_print_optional_region (lane ctfe-util)
  should_print_optional_region(region: Region): boolean {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::should_print_optional_region");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:190 generic_delimiters (lane ctfe-util)
  generic_delimiters(f: (p: this) => PrintResult): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::generic_delimiters");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:203 should_print_verbose (lane ctfe-util)
  override should_print_verbose(): boolean {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::should_print_verbose");
  }

  // stub: compiler/rustc_const_eval/src/util/type_name.rs:210 write_str (lane ctfe-util)
  override write_str(s: string): PrintResult {
    return unported("rustc_const_eval::util::type_name::TypeNamePrinter::write_str");
  }

}

// stub: compiler/rustc_const_eval/src/util/type_name.rs:216 type_name (lane ctfe-util)
export function type_name(tcx: TyCtxt, ty: Ty): string {
  return unported("rustc_const_eval::util::type_name::type_name");
}
