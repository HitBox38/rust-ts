// Test driver for src/rustc_passes/lang_items.oracle.test.ts (not a port).
//   bun src/rustc_passes/oracle/run.ts <rustc arguments...>
//
// Subject side of tools/probes/langitems (its header documents the output): runs the ported driver and, in
// `after_expansion`, calls `tcx.lang_items()` and prints the same dump, then stops (`Compilation::Stop`).
// The real driver reaches `get_lang_items` only from AST lowering (`lower_to_hir`, lanes lower-*).
//
// Exit codes as src/rust_ts/main.ts: rustc's own, plus 70 = reached unported code, 101 = ICE.
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { ensure_stack } from "../../rust_ts/stack.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../rustc_session/session.ts");
  const { ErrorOutputType, std_print } = await import("../../rustc_session/config.ts");
  const { debug_LangItem } = await import("../../rustc_attr_ir/lang_items.ts");
  const { debug_DefId } = await import("../../rustc_span/def_id.ts");
  const { debug_option, PLAIN } = await import("../../std/fmt.ts");

  const callbacks = {
    config(_config: Config): void {},
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      const items = tcx.lang_items();
      let out = "";
      const all = [...items.iter()];
      out += `== items (${all.length})\n`;
      for (const [item, def_id] of all) out += `${debug_LangItem(item, PLAIN)} ${debug_DefId(def_id, PLAIN)}\n`;
      out += `== missing (${items.missing.length})\n`;
      for (const item of items.missing) out += `${debug_LangItem(item, PLAIN)}\n`;
      out += "== from_def_id\n";
      for (const [, def_id] of all) out += `${debug_DefId(def_id, PLAIN)} ${debug_option(tcx.as_lang_item(def_id), PLAIN, debug_LangItem)}\n`;
      std_print(out);
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
