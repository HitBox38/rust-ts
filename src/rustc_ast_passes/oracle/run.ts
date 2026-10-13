// Test driver for src/rustc_ast_passes/oracle.test.ts (not a port).
//   bun src/rustc_ast_passes/oracle/run.ts <rustc arguments...>
//
// Runs the ported driver up to `after_crate_root_parsing` and there runs, on the parsed crate root, what
// rustc runs on the expanded crate: `rustc_expand::config::features` on the pre-configured crate attributes,
// `rustc_ast_passes::ast_validation::check_crate` (configure_and_expand) and
// `rustc_ast_passes::feature_gate::check_crate` (early_lint_checks), then stops (`Compilation::Stop`).
// The real driver cannot reach these passes yet: configure_and_expand stops at
// `rustc_lint::late::unerased_lint_store` (pending lint-early-a). For macro-free, cfg-free sources without
// resolution errors or early lints, the diagnostics are those of `rustc <args> -Zunpretty=expanded`.
//
// The buffered early lints (emitted by rustc's early lint pass, which is not ported) are printed to
// stdout, one line each: `buffered lint: <lint name> <span>`.
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import "../../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import type { Crate } from "../../rustc_ast/ast.ts";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import { EarlyDiagCtxt } from "../../rustc_session/session.ts";
import { ErrorOutputType } from "../../rustc_session/config.ts";
import { Panic, Unported } from "../../std/panic.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { pre_configure_attrs, features } = await import("../../rustc_expand/config.ts");
  const { get_crate_name } = await import("../../rustc_interface/passes.ts");
  const { LintBuffer_default } = await import("../../rustc_errors/lib.ts");
  const { ast_validation, feature_gate } = await import("../lib.ts");
  const { debug_Span } = await import("../../rustc_span/lib.ts");
  const { PLAIN } = await import("../../std/fmt.ts");
  const { Lint } = await import("../../rustc_lint_defs/lib.ts");

  const callbacks = {
    config(_config: Config): void {},
    after_crate_root_parsing(compiler: Compiler, krate: Crate): "Stop" | "Continue" {
      const sess = compiler.sess;
      // As `create_and_enter_global_ctxt` (passes.rs:939) and the `features_query` feed (passes.rs:1036).
      const pre_configured_attrs = pre_configure_attrs(sess, krate.attrs);
      const crate_name = get_crate_name(sess, pre_configured_attrs);
      const feats = features(sess, pre_configured_attrs, crate_name);
      const lints = LintBuffer_default();
      ast_validation.check_crate(sess, feats, krate, sess.opts.unstable_opts.build_sdylib_interface, lints);
      feature_gate.check_crate(krate, sess, feats);
      for (const [, early_lints] of lints.map) {
        for (const l of early_lints) {
          const spans = (l.span?.primary_spans ?? []).map((s) => debug_Span(s, PLAIN));
          process.stdout.write(`buffered lint: ${Lint.name_lower(l.lint_id.lint)} ${spans.join(", ")}\n`);
        }
      }
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
    process.exitCode = EXIT_UNPORTED;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
