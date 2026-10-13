// Test driver for the lint level machinery (lane lint-early-a; not a port): runs the ported driver up to
// `after_crate_root_parsing`, then runs `rustc_lint::check_ast_node` on the crate root the way
// `configure_and_expand` (pre-expansion, `lint_added_lints = false`) and `early_lint_checks` (early,
// `lint_added_lints = true`) do, and stops. The early passes' `check_*` methods are stubs until lane
// lint-early-b, so the run normally ends with `rust-ts: unported: ..` after the lint level diagnostics of the
// command line and of the crate attributes (`#![allow(..)]`, ...), which are emitted before the first callback
// that needs a pass. src/rustc_lint/levels.oracle.test.ts compares them with rustc's.
//   bun src/rust_ts/lintlevels.ts <rustc arguments...>
// Exit codes as src/rust_ts/main.ts (70 = reached unported code).
import type { Crate } from "../rustc_ast/lib.ts";
import type { Compiler } from "../rustc_interface/interface.ts";
import { EarlyDiagCtxt } from "../rustc_session/session.ts";
import { ErrorOutputType } from "../rustc_session/config.ts";
import { Panic, Unported } from "../std/panic.ts";

async function main(): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../rustc_driver_impl/args.ts");
  const rustc_lint = await import("../rustc_lint/lib.ts");
  const { features } = await import("../rustc_expand/config.ts");
  const { registered_lint_tools_ast } = await import("../rustc_resolve/lib.ts");
  const { Symbol } = await import("../rustc_span/symbol.ts");
  const callbacks = {
    config(_config: unknown): void {},
    after_crate_root_parsing(compiler: Compiler, krate: Crate): "Stop" {
      const sess = compiler.sess;
      const feats = features(sess, krate.attrs, Symbol.intern("lintlevels"));
      const tools = registered_lint_tools_ast(sess, krate.attrs);
      const store = rustc_lint.unerased_lint_store(sess);
      rustc_lint.check_ast_node(sess, feats, true, store, tools, undefined, { $: "CrateRoot", _0: krate, _1: krate.attrs });
      rustc_lint.check_ast_node(sess, feats, false, store, tools, undefined, { $: "CrateRoot", _0: krate, _1: krate.attrs });
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
