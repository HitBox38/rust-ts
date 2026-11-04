// Port of compiler/rustc_monomorphize/src/util.rs (lane mono-collector).
//
// PORT: `OpenOptions::new().create(true).append(true)` is `openSync(.., "a")`; `writeln!` is one `writeSync`.
import { closeSync, openSync, writeSync } from "node:fs";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { TypeckResults } from "../rustc_middle/ty/typeck_results.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { debug_str, PLAIN } from "../std/fmt.ts";
import { debug_LayoutError } from "../rustc_middle/ty/layout.ts";
import { debug_LineInfo, debug_SpanLinesError } from "../rustc_span/lib.ts";
import { debug_option } from "../std/fmt.ts";

/// For a given closure, writes out the data for the profiling the impact of RFC 2229 on
/// closure size into a CSV.
///
/// During the same compile all closures dump the information in the same file
/// "closure_profile_XXXXX.csv", which is created in the directory where the compiler is invoked.
// rustc: compiler/rustc_monomorphize/src/util.rs:11 dump_closure_profile
export function dump_closure_profile(tcx: TyCtxt, closure_instance: Instance): void {
  let file: number;
  try {
    file = openSync(`closure_profile_${process.pid}.csv`, "a");
  } catch {
    console.error("Couldn't open file for writing closure profile");
    return;
  }

  try {
    const closure_def_id = Instance.def_id(closure_instance).expect_local();
    const typeck_results = tcx.typeck(closure_def_id) as TypeckResults;

    if (typeck_results.closure_size_eval.has(closure_def_id)) {
      const typing_env = TypingEnv.fully_monomorphized();

      const { before_feature_tys, after_feature_tys } = typeck_results.closure_size_eval.get(closure_def_id)!;

      const before_feature_tys_ = tcx.instantiate_and_normalize_erasing_regions(
        closure_instance.args,
        typing_env,
        EarlyBinder.bind(tcx, before_feature_tys, fold_Ty),
        fold_Ty,
      );
      const after_feature_tys_ = tcx.instantiate_and_normalize_erasing_regions(
        closure_instance.args,
        typing_env,
        EarlyBinder.bind(tcx, after_feature_tys, fold_Ty),
        fold_Ty,
      );

      const new_layout = tcx.layout_of(typing_env.as_query_input(after_feature_tys_));
      const new_size = new_layout.$ === "Ok" ? `${new_layout._0.size.bytes()}` : `Failed ${debug_LayoutError(new_layout._0, PLAIN)}`;

      const old_layout = tcx.layout_of(typing_env.as_query_input(before_feature_tys_));
      const old_size = old_layout.$ === "Ok" ? `${old_layout._0.size.bytes()}` : `Failed ${debug_LayoutError(old_layout._0, PLAIN)}`;

      const closure_span = tcx.def_span(closure_def_id);
      const src_file = tcx.sess.source_map().span_to_diagnostic_string(closure_span);
      const lines = tcx.sess.source_map().span_to_lines(closure_span);
      const line_nos =
        lines.$ === "Ok"
          ? `${debug_option(lines._0.lines[0], PLAIN, debug_LineInfo)} ${debug_option(lines._0.lines[lines._0.lines.length - 1], PLAIN, debug_LineInfo)}`
          : debug_SpanLinesError(lines._0, PLAIN);

      try {
        writeSync(file, `${old_size}, ${new_size}, ${src_file}, ${debug_str(line_nos)}\n`);
      } catch (e) {
        console.error(`Error writing to file ${String(e)}`);
      }
    }
  } finally {
    closeSync(file);
  }
}
