// Subject side of check.oracle.test.ts (our own code, not a port): runs the ported driver on `<rustc args..>` up to the
// global ctxt, then, for every `mir_keys` body that is a const context (`hir_body_const_context`), what
// rustc_mir_transform's `mir_const_qualif` does: build the MIR, `Checker::new(&ConstCx::new(..))`, `check_body`,
// `qualifs_in_return_place`. One stdout line per body: `const_qualif(<def path>) = <ConstQualifs Debug> | UNPORTED <what>`.
// Diagnostics go to stderr as rustc's.
// PORT (test driver): the body is `build_mir_inner_impl`'s (MIR as built), not `mir_built`'s: the `mir_built` pass list
// (LintAndRemoveUninhabited, ..., SimplifyCfg::Initial) is lane mt-built-lints' and stops UNPORTED before it.
//   bun src/rustc_const_eval/check_consts/check_oracle/run.ts <rustc arguments...>
import type { Crate } from "../../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../../rustc_driver_impl/lib.ts";
import "../../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../../rustc_interface/passes.ts";
import "../../../rustc_middle/lib.ts";
import type { Body } from "../../../rustc_middle/mir/mod.ts";
import { debug_ConstQualifs } from "../../../rustc_middle/mir/query.gen.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Unported } from "../../../std/panic.ts";
import { Checker } from "../check.ts";
import { ConstCx } from "../mod.ts";

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

function main(): void {
  const lines: string[] = [];
  try {
    run_compiler(config_from_args(process.argv.slice(2)), (compiler) => {
      const krate: Crate = parse(compiler.sess);
      create_and_enter_global_ctxt(compiler, krate, (tcx) => {
        void tcx.resolver_for_lowering();
        for (const def of tcx.mir_keys(null)) {
          if (tcx.is_constructor(LocalDefId.to_def_id(def))) continue;
          if (tcx.hir_body_const_context(def) === undefined) continue;
          const name = tcx.def_path_str(LocalDefId.to_def_id(def));
          try {
            const body = tcx.build_mir_inner_impl(def) as Body;
            const ccx = ConstCx.new(tcx, body);
            const validator = Checker.new(ccx);
            validator.check_body();
            lines.push(`const_qualif(${name}) = ${debug_ConstQualifs(validator.qualifs_in_return_place(), PLAIN)}`);
          } catch (e) {
            if (!(e instanceof Unported)) throw e;
            lines.push(`const_qualif(${name}) = UNPORTED ${e.what}`);
          }
        }
      });
    });
  } catch (e) {
    // the session's own abort (errors emitted) after the closure ran
    if (lines.length === 0) throw e;
  }
  process.stdout.write(lines.map((l) => `${l}\n`).join(""));
}

main();
