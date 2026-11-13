// Test driver for mir/analyze.test.ts (lane ssa-mir-core; test helper, not a port).
//   bun src/rustc_codegen_ssa/mir/analyze_oracle/driver.ts --ssa-out=<file> <rustc arguments...>
//
// `--ssa-out=<file>` must come first; it is removed from `process.argv` before the driver reads the rustc arguments
// (as base_oracle/driver.ts does). Without it, the lines go to stderr.
//
// Runs the real driver up to `analysis` (as rustc_mir_transform alias_check_oracle/driver.ts does). Then, for every
// `#[no_mangle]` fn of the local crate (no generics), it runs `codegen_mir` over a mock backend and writes one JSON line:
// - `locals`: the `LocalRef` kind each local got (`Place`, `UnsizedPlace`, `Operand`, `PendingOperand`), read from
//   `fx.locals` after `initialize_locals`.
// - `non_ssa`: `analyze::non_ssa_locals(fx, traversal_order)`, run again with the order `codegen_mir` passed to
//   `codegen_block`.
// - `cleanup_kinds`: `fx.cleanup_kinds` (`undefined` unless the target wants the new EH instructions).
// - `calls`: the backend calls in order: `append_block`, `build`, `get_param`, `alloca` (with the local's layout size),
//   `set_personality_fn`, `codegen_block`, `codegen_block_as_unreachable`.
// - `succs`: each block's terminator successors (for the order checks).
// - `names`: per local, the name upstream's `debug_introduce_local` gives its value when names are kept (mir/debuginfo.rs:
//   the whole-local `VarDebugInfo`'s name, else `format!("{local:?}")`); the test maps oracle IR names back to locals.
//
// The mock implements what `codegen_mir` and `non_ssa_locals` call on the context: queries through `tcx`, in
// `TypingEnv::fully_monomorphized()` (cg_llvm's `typing_env()`), and `intrinsic_call_expects_place_always` as cg_llvm's
// (`matches!(name, sym::black_box)`, context.rs:1081). The `xlane` stubs of other fill lanes are replaced by recorders,
// and `monomorphized_place_ty` by upstream's body (place.rs:424). `wants_new_eh_instructions` is upstream's (base.rs:392).
import { appendFileSync } from "node:fs";
import type { Compiler, Config } from "../../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { ensure_stack } from "../../../rust_ts/stack.ts";
import { write_stderr } from "../../../std/io.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import { FatalErrorMarker } from "../../../rustc_span/fatal_error.ts";

const EXIT_UNPORTED = 70;
const OUT_FLAG = "--ssa-out=";
const OUT: string | undefined = process.argv[2]?.startsWith(OUT_FLAG) ? process.argv[2].slice(OUT_FLAG.length) : undefined;
if (OUT !== undefined) process.argv.splice(2, 1);

function line(o: unknown): void {
  if (OUT !== undefined) appendFileSync(OUT, `${JSON.stringify(o)}\n`);
  else write_stderr(`${JSON.stringify(o)}\n`);
}

async function main(): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../../../rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../../../rustc_session/session.ts");
  const { ErrorOutputType } = await import("../../../rustc_session/config.ts");
  const { run_codegen_mir_mock } = await import("./mock.ts");

  const callbacks = {
    config(_config: Config): void {},
    after_analysis(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      for (const r of run_codegen_mir_mock(tcx)) line(r);
      line({ kind: "DONE" });
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
    write_stderr(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = EXIT_UNPORTED;
  } else if (e instanceof FatalErrorMarker) {
    process.exitCode = 101;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    write_stderr(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
