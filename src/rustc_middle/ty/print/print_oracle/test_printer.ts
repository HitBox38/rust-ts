// Test helper of lane ty-print-a (not a port): a `PrettyPrinter` for print.test.ts / print.oracle.test.ts until lane
// ty-print-b's `FmtPrinter` (pretty.rs:2072) lands. It is a reduced `FmtPrinter`: the same `Printer` /
// `PrettyPrinter` overrides (pretty.rs:2210-2635) for what the tests print (paths without generic args, types
// without regions other than `'static` / erased, no type length limit, no region naming), each following the
// upstream body; everything else is `unported`. Replace it with `FmtPrinter` once ty-print-b is merged.
import { DefPathData, type DisambiguatedDefPathData } from "../../../../rustc_hir_id/definitions.ts";
import { type CrateNum, type DefId, LOCAL_CRATE } from "../../../../rustc_span/def_id.ts";
import { display_Symbol, Ident, kw } from "../../../../rustc_span/symbol.ts";
import type { PolyExistentialPredicate, TraitRef } from "../../../../rustc_type_ir/decls.ts";
import type { Const, Region } from "../../../../rustc_type_ir/sty/mod.ts";
import { unported } from "../../../../std/panic.ts";
import type { TyCtxt } from "../../context.ts";
import type { GenericArg } from "../../generic_args.ts";
import type { List } from "../../list.ts";
import type { Ty } from "../../mod.ts";
import { PRINT_OK, type PrintResult } from "../mod.ts";
import { PrettyPrinter, with_crate_prefix, with_forced_impl_filename_line, with_resolve_crate_name } from "../pretty.ts";

export class TestPrinter extends PrettyPrinter {
  fmt = "";
  empty_path = false;
  in_value = false;

  constructor(readonly tcx_: TyCtxt) {
    super();
  }

  /** `FmtPrinter::into_buffer`. */
  into_buffer(): string {
    return this.fmt;
  }

  /** `FmtPrinter::print_string(tcx, ns, f)` (the namespace only sets `in_value`, unused without generic args). */
  static print_string(tcx: TyCtxt, f: (p: TestPrinter) => PrintResult): string {
    const p = new TestPrinter(tcx);
    const r = f(p);
    if (r.$ === "Err") throw new Error("ERROR: fmt::Error");
    return p.into_buffer();
  }

  /** `TyCtxt::def_path_str` (pretty.rs:2171; `def_path_str_with_args(def_id, &[])`). */
  static def_path_str(tcx: TyCtxt, def_id: DefId): string {
    return TestPrinter.print_string(tcx, (p) => p.print_def_path(def_id, []));
  }

  write_str(s: string): PrintResult {
    this.fmt += s;
    return PRINT_OK;
  }

  tcx(): TyCtxt {
    return this.tcx_;
  }

  override reset_path(): PrintResult {
    this.empty_path = true;
    return PRINT_OK;
  }

  override print_def_path(def_id: DefId, args: readonly GenericArg[]): PrintResult {
    if (args.length === 0) {
      const t = this.try_print_trimmed_def_path(def_id);
      if (t.$ === "Err") return t;
      if (t._0) return PRINT_OK;
      const v = this.try_print_visible_def_path(def_id);
      if (v.$ === "Err") return v;
      if (v._0) return PRINT_OK;
    }
    const key = this.tcx().def_key(def_id);
    if (key.disambiguated_data.data.$ === "Impl") {
      const use_types = !def_id.is_local() || !with_forced_impl_filename_line();
      if (!use_types) return unported("test printer: `<impl at ..>` paths");
    }
    return this.default_print_def_path(def_id, args);
  }

  print_region(region: Region): PrintResult {
    // `FmtPrinter::pretty_print_region` for the regions the tests build.
    const k = region.kind();
    if (k.$ === "ReStatic") return this.write_str("'static");
    if (k.$ === "ReErased") return this.write_str("'_");
    return unported(`test printer: region ${k.$}`);
  }

  print_type(ty: Ty): PrintResult {
    return this.pretty_print_type(ty);
  }

  print_dyn_existential(predicates: List<PolyExistentialPredicate>): PrintResult {
    return this.pretty_print_dyn_existential(predicates);
  }

  print_const(ct: Const): PrintResult {
    return this.pretty_print_const(ct, false);
  }

  print_crate_name(cnum: CrateNum): PrintResult {
    this.empty_path = true;
    if (cnum === LOCAL_CRATE && !with_resolve_crate_name()) {
      if (with_crate_prefix()) {
        const r = this.write_str(display_Symbol(kw.Crate));
        if (r.$ === "Err") return r;
        this.empty_path = false;
      }
    } else {
      const r = this.write_str(display_Symbol(this.tcx().crate_name(cnum)));
      if (r.$ === "Err") return r;
      this.empty_path = false;
    }
    return PRINT_OK;
  }

  print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    const r = this.pretty_print_path_with_qualified(self_ty, trait_ref);
    if (r.$ === "Err") return r;
    this.empty_path = false;
    return PRINT_OK;
  }

  print_path_with_impl(print_prefix: (p: this) => PrintResult, self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    const r = this.pretty_print_path_with_impl(
      (p) => {
        const r = print_prefix(p);
        if (r.$ === "Err") return r;
        if (!p.empty_path) return p.write_str("::");
        return PRINT_OK;
      },
      self_ty,
      trait_ref,
    );
    if (r.$ === "Err") return r;
    this.empty_path = false;
    return PRINT_OK;
  }

  print_path_with_simple(print_prefix: (p: this) => PrintResult, disambiguated_data: DisambiguatedDefPathData): PrintResult {
    let r = print_prefix(this);
    if (r.$ === "Err") return r;
    // Skip `::{{extern}}` blocks and `::{{constructor}}` on tuple/unit structs.
    if (disambiguated_data.data.$ === "ForeignMod" || disambiguated_data.data.$ === "Ctor") return PRINT_OK;
    const name = DefPathData.name(disambiguated_data.data);
    if (!this.empty_path) {
      if ((r = this.write_str("::")).$ === "Err") return r;
    }
    if (name.$ === "Named" && Ident.with_dummy_span(name._0).is_raw_guess()) {
      if ((r = this.write_str("r#")).$ === "Err") return r;
    }
    const verbose = this.should_print_verbose();
    if ((r = this.write_str(display_Symbol(disambiguated_data.as_sym(verbose)))).$ === "Err") return r;
    this.empty_path = false;
    return PRINT_OK;
  }

  print_path_with_generic_args(print_prefix: (p: this) => PrintResult, args: readonly GenericArg[]): PrintResult {
    const r = print_prefix(this);
    if (r.$ === "Err") return r;
    if (args.length !== 0) return unported("test printer: generic args");
    return PRINT_OK;
  }

  generic_delimiters(f: (p: this) => PrintResult): PrintResult {
    let r = this.write_str("<");
    if (r.$ === "Err") return r;
    const was_in_value = this.in_value;
    this.in_value = false;
    if ((r = f(this)).$ === "Err") return r;
    this.in_value = was_in_value;
    return this.write_str(">");
  }

  should_print_optional_region(region: Region): boolean {
    // `FmtPrinter::should_print_optional_region` for `'static` / erased (no highlighting in the tests).
    if (this.should_print_verbose()) return true;
    const k = region.kind();
    if (k.$ === "ReStatic") return true;
    if (k.$ === "ReErased") return false;
    return unported(`test printer: optional region ${k.$}`);
  }

  override pretty_print_value_path(def_id: DefId, args: readonly GenericArg[]): PrintResult {
    const was_in_value = this.in_value;
    this.in_value = true;
    const r = this.print_def_path(def_id, args);
    if (r.$ === "Err") return r;
    this.in_value = was_in_value;
    return PRINT_OK;
  }
}
