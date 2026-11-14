// The subject of `mono-ui` (harness/suites.ts; plan-m7 §6; lane mono-wire's "Decision for root", taken by root): rustc's command line through the real driver, with a
// backend that stops at the end of mono collection and reports success, as Miri's driver sets its own backend. Not a port and not an entry a user runs.
//
// `src/rust_ts/main.ts` runs codegen (the stand-in forwards it to the ported LLVM backend, lane cg-register), so it cannot stop after collection.
// Here `codegen_crate` runs only the head the backend runs before LLVM (`mono_collection_head`, src/rust_ts/codegen_backend.ts: the offload check, the CPU
// checks, then the collector and partitioner), and reports a check-only result (`CompiledModules`, which `Linker::link` takes without `join_codegen`). A stop in
// that head is still UNPORTED, and difftest needs no new rule. **It compares nothing codegen would do after partitioning:** LLVM warnings, link errors. The
// oracle's run does them.
// Exit codes as main.ts: rustc's own, plus 70 = reached unported code.
import { FatalErrorMarker } from "../src/rustc_span/fatal_error.ts";
import { ensure_stack } from "../src/rust_ts/stack.ts";
import { write_stderr } from "../src/std/io.ts";
import { Panic, Unported } from "../src/std/panic.ts";
import type { Config } from "../src/rustc_interface/interface.ts";
import type { TyCtxt } from "../src/rustc_middle/ty/context.ts";

const EXIT_UNPORTED = 70;

async function main(): Promise<number> {
  ensure_stack();
  // Loaded here, in this order: the driver first, as main.ts (PORTING section 8).
  const { catch_with_exit_code, compiler_entrypoint, init_rustc_env_logger } = await import("../src/rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../src/rustc_driver_impl/args.ts");
  const { EarlyDiagCtxt } = await import("../src/rustc_session/session.ts");
  const { ErrorOutputType } = await import("../src/rustc_session/config.ts");
  const { LlvmCodegenBackend, mono_collection_head } = await import("../src/rust_ts/codegen_backend.ts");
  const { CompiledModules } = await import("../src/rustc_codegen_ssa/lib.ts");

  class MonoOnly extends LlvmCodegenBackend {
    override codegen_crate(tcx: TyCtxt): unknown {
      mono_collection_head(tcx);
      return new CompiledModules([], undefined);
    }
    override link(): void {}
  }
  const callbacks = {
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
      config.make_codegen_backend = () => new MonoOnly();
    },
  };
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  // As rustc_driver_impl::main (and src/rust_ts/mirdump.ts): `RUSTC_LOG` and its companions apply, and with `RUSTC_LOG` unset
  // tracing's default filter prints WARN and ERROR events (lane harness-w45). A bad `RUSTC_LOG_*` value is an `early_fatal`:
  // `FatalErrorMarker` below, exit 101.
  init_rustc_env_logger(early_dcx);
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (e) {
    if (e instanceof Unported) {
      write_stderr(`rust-ts: unported: ${e.what}\n`);
      process.exitCode = EXIT_UNPORTED;
    } else if (e instanceof FatalErrorMarker) {
      process.exitCode = 101;
    } else {
      write_stderr(`rust-ts: internal compiler error: ${e instanceof Panic ? e.message : String(e)}\n${e instanceof Error ? e.stack : ""}\n`);
      process.exitCode = 101;
    }
  }
}
