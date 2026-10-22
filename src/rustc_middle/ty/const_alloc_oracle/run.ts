// Subject side of mk_const_alloc.oracle.test.ts (our own code, not a port): runs the ported driver on
// `<rustc args..>` (with `-Zdump-mir=built -Zdump-mir-dir=<dir>`) up to the global ctxt, then for every `mir_keys` body
// that is not a constructor the real `mir_built` query (`build_mir_inner_impl`, `dump_mir_for_phase_change`: the
// `<crate>.<item>.built.after.mir` files, with their `allocN` blocks; then its pass list).
//   bun src/rustc_middle/ty/const_alloc_oracle/run.ts <rustc arguments...>
import type { Crate } from "../../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../../rustc_driver_impl/lib.ts";
import "../../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../../rustc_interface/passes.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import "../../lib.ts";

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        // as rustc_driver_impl's default `TimePassesCallbacks::config`
        c.opts.trimmed_def_paths = true;
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

run_compiler(config_from_args(process.argv.slice(2)), (compiler) => {
  const krate: Crate = parse(compiler.sess);
  create_and_enter_global_ctxt(compiler, krate, (tcx) => {
    void tcx.resolver_for_lowering();
    for (const def of tcx.mir_keys(null)) {
      if (tcx.is_constructor(LocalDefId.to_def_id(def))) continue;
      tcx.ensure_ok().mir_built(def);
    }
  });
});
