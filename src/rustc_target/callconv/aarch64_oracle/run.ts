// Test driver for ../aarch64.oracle.test.ts (lane abi-vtable; not a port).
//   bun src/rustc_target/callconv/aarch64_oracle/run.ts <out dir>
//
// `compiler_entrypoint` on abi.rs once per target, in one process, each exit code on stderr as `exit <n>` after its
// output. One process because of the unit budget (docs/reviews/plan-m7.md F5): starting one costs more than the fixture's
// work. The oracle's output comes from one process per target (regen.ts), and rustc never runs two sessions in a process. Darwin
// runs first, in a fresh process, as rustc does; a bug only a fresh process shows on linux-gnu would not show here.
//
// Exit codes as src/rust_ts/main.ts for a stop: 70 = reached unported code, 101 = ICE. Otherwise 0.
import { ensure_stack } from "../../../rust_ts/stack.ts";
import { write_stderr } from "../../../std/io.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import { abi_args, TARGETS } from "./common.ts";

async function main(out: string): Promise<number> {
  ensure_stack();
  const { catch_with_exit_code, compiler_entrypoint, TimePassesCallbacks } = await import("../../../rustc_driver_impl/lib.ts");
  for (const target of TARGETS) {
    write_stderr(`== ${target}\n`);
    const code = catch_with_exit_code(() => compiler_entrypoint(["rustc", ...abi_args(target, out)], TimePassesCallbacks.default()));
    write_stderr(`exit ${code}\n`);
  }
  return 0;
}

try {
  process.exitCode = await main(process.argv[2]!);
} catch (e) {
  if (e instanceof Unported) {
    console.error(`rust-ts: reached unported code: ${e.what}`);
    process.exitCode = 70;
  } else if (e instanceof Panic) {
    console.error(`rust-ts: internal compiler error: ${e.message}`);
    process.exitCode = 101;
  } else {
    throw e;
  }
}
