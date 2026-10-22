// Port of compiler/rustc_symbol_mangling/src/test.rs (lane symbol-mangling).
//
//! Walks the crate looking for items/impl-items/trait-items that have
//! either a `rustc_dump_symbol_name` or `rustc_dump_def_path` attribute and
//! generates an error giving, respectively, the symbol name or
//! def-path. This is used for unit testing the code that generates
//! paths etc in all kinds of annoying scenarios.
//
// PORT: `find_attr!(tcx, id, Pat(span) => span)` is `find_attr(HasAttrs_LocalDefId.get_attrs(id, tcx), ..)` returning
// the span (rustc_attr_ir lib.ts). `format!("{mangled}")` is `display_SymbolName`; `{demangling}` / `{demangling:#}`
// are rustc-demangle's `Display` without / with the alternate flag.
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { CRATE_OWNER_ID, OwnerId_eq } from "../rustc_hir_id/lib.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { display_SymbolName, HasAttrs_LocalDefId, type SymbolName } from "../rustc_middle/ty/mod.ts";
import { with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { display_Demangle, try_demangle } from "../vendor/rustc_demangle/lib.ts";

// rustc: compiler/rustc_symbol_mangling/src/test.rs:12 dump_symbol_names_and_def_paths
export function dump_symbol_names_and_def_paths(tcx: TyCtxt): void {
  // if the `rustc_attrs` feature is not enabled, then the
  // attributes we are interested in cannot be present anyway, so
  // skip the walk.
  if (!tcx.features().rustc_attrs()) {
    return;
  }

  tcx.dep_graph.with_ignore(() => {
    // PORT: the `hir_crate_items` query value is `unknown` in queries.gen.ts.
    for (const id of (tcx.hir_crate_items(null) as ModuleItems).owners()) {
      if (OwnerId_eq(id, CRATE_OWNER_ID)) {
        continue;
      }

      // The format `$tag($value)` is chosen so that tests can elect to test the
      // entirety of the string, if they choose, or else just some subset.

      const span_sym = find_attr(HasAttrs_LocalDefId.get_attrs(id.def_id, tcx), (k) => (k.$ === "RustcDumpSymbolName" ? k._0 : undefined));
      if (span_sym !== undefined) {
        const def_id = LocalDefId.to_def_id(id.def_id);
        const args_ = RawList.identity_for_item(tcx, def_id);
        const args = tcx.erase_and_anonymize_regions(args_, fold_GenericArgs);
        const instance = Instance.new_raw(def_id, args);
        // PORT: the `symbol_name` query value is `unknown` in queries.gen.ts; it is `SymbolName`.
        const mangled = tcx.symbol_name(instance) as SymbolName;
        const def_span = tcx.def_span(def_id);
        const span = Span.to(span_sym, def_span);

        const err = tcx.dcx().struct_span_err(span, `symbol-name(${display_SymbolName(mangled)})`);

        const demangling = try_demangle(mangled.name);
        if (demangling.$ === "Ok") {
          err.note(`demangling(${display_Demangle(demangling._0, false)})`);
          err.note(`demangling-alt(${display_Demangle(demangling._0, true)})`);
        }
        err.emit_err();
      }

      const span_path = find_attr(HasAttrs_LocalDefId.get_attrs(id.def_id, tcx), (k) => (k.$ === "RustcDumpDefPath" ? k._0 : undefined));
      if (span_path !== undefined) {
        const def_path = with_no_trimmed_paths(() => tcx.def_path_str(id.def_id));
        tcx.dcx().span_err(span_path, `def-path(${def_path})`);
      }
    }
  });
}
