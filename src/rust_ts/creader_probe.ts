// Test driver for rustc_metadata creader.rs (lane creader; not a port). Runs the ported driver up to
// `after_crate_root_parsing`, builds the global context with `passes::create_and_enter_global_ctxt` (the real
// `CStore`), and then, by `RUST_TS_CREADER_MODE`:
//   postprocess (default)  `CStore::postprocess` + `report_session_incompatibilities` on the parsed crate, as
//                          `Resolver::resolve_crate` / `configure_and_expand` call them after late resolution.
//   pipeline               `tcx.resolver_for_lowering()`: expansion and resolution (extern crates, extern
//                          prelude), as far as the port gets.
// Every `CStore::resolve_crate` / `maybe_resolve_crate` call prints `resolving crate `<name>`` on stdout (the
// oracle's `RUSTC_LOG=rustc_metadata::creader=info` line of `maybe_resolve_crate`), so
// src/rustc_metadata/creader.oracle.test.ts can compare which crates the injection decisions load. Loading
// itself stops at the locator stub (`rust-ts: unported: ..`, exit 70).
//   RUST_TS_CREADER_MODE=<mode> bun src/rust_ts/creader_probe.ts <rustc arguments...>
import type { Crate } from "../rustc_ast/lib.ts";
import type { Compiler } from "../rustc_interface/interface.ts";
import { EarlyDiagCtxt } from "../rustc_session/session.ts";
import { ErrorOutputType } from "../rustc_session/config.ts";
import { Panic, Unported } from "../std/panic.ts";

async function main(): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../rustc_driver_impl/args.ts");
  const passes = await import("../rustc_interface/passes.ts");
  const { creader } = await import("../rustc_metadata/lib.ts");
  const { Symbol } = await import("../rustc_span/symbol.ts");
  const mode = process.env.RUST_TS_CREADER_MODE ?? "postprocess";

  const CStore = creader.CStore;
  const maybe_resolve_crate = CStore.prototype.maybe_resolve_crate;
  CStore.prototype.maybe_resolve_crate = function (this: InstanceType<typeof CStore>, ...args: Parameters<typeof maybe_resolve_crate>) {
    process.stdout.write(`resolving crate \`${Symbol.as_str(args[1])}\`\n`);
    return maybe_resolve_crate.apply(this, args);
  };

  const callbacks = {
    config(_config: unknown): void {},
    after_crate_root_parsing(compiler: Compiler, krate: Crate): "Stop" {
      passes.create_and_enter_global_ctxt(compiler, krate, (tcx) => {
        if (mode === "pipeline") {
          void tcx.resolver_for_lowering();
        } else {
          tcx.sess.time("resolve_postprocess", () => CStore.from_tcx_mut(tcx).postprocess(tcx, krate));
          CStore.from_tcx(tcx).report_session_incompatibilities(tcx, krate);
        }
      });
      return "Stop";
    },
  };
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = 70;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
