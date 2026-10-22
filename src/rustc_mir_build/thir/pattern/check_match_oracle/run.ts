// Subject side of check_match.oracle.test.ts (our own code, not a port): runs the ported driver on `<rustc args..>` up
// to the global ctxt, then the `check_match` query on every free `fn` item in item order, and prints one stdout line per
// fn: `check_match(<name>) = Ok | Err | UNPORTED <what>`. Diagnostics go to stderr as rustc's.
//   bun src/rustc_mir_build/thir/pattern/check_match_oracle/run.ts <rustc arguments...>
import type { Crate } from "../../../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../../../rustc_driver_impl/lib.ts";
import "../../../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../../../rustc_interface/passes.ts";
import "../../../../rustc_middle/lib.ts";
import { Symbol } from "../../../../rustc_span/symbol.ts";
import { Unported } from "../../../../std/panic.ts";
import "../../../lib.ts";

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
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
        for (const id of tcx.hir_free_items()) {
          const item = tcx.hir_item(id);
          if (item.kind.$ !== "Fn") continue;
          const name = Symbol.as_str(item.kind.ident.name);
          try {
            const r = tcx.check_match(item.owner_id.def_id);
            lines.push(`check_match(${name}) = ${r.$}`);
          } catch (e) {
            if (!(e instanceof Unported)) throw e;
            lines.push(`check_match(${name}) = UNPORTED ${e.what}`);
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
