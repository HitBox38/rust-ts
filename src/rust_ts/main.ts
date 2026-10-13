// rustc-ts entry point. Accepts rustc's command line.
//
// RUST_TS_IMPL selects the implementation (used to validate the harness itself):
//   port (default)  the TypeScript port
//   shim            forward to the oracle rustc   -> every difftest suite must score 100%
//   stub            report everything unported    -> every difftest suite must score 0%
//
// Exit codes: rustc's own (0 ok, 1 errors, 101 ICE), plus 70 = reached unported code.
// 70 must never be interpreted as a rustc status.
import { Panic, Unported } from "../std/panic.ts";

export const EXIT_UNPORTED = 70;

async function main(args: string[]): Promise<number> {
  const impl = process.env.RUST_TS_IMPL ?? "port";
  if (impl === "shim") {
    const { PIN } = await import("../../scripts/lib/common.ts");
    const proc = Bun.spawn(["rustc", `+${PIN.toolchain}`, ...args], { stdio: ["inherit", "inherit", "inherit"] });
    return await proc.exited;
  }
  if (impl === "stub") throw new Unported("stub implementation");
  // `fn main() -> ExitCode { rustc_driver::main() }` (compiler/rustc/src/main.rs). `env::args_os()`:
  // argv[0] is the program name; here the script path stands for it.
  const { main: rustc_driver_main } = await import("../rustc_driver_impl/lib.ts");
  return rustc_driver_main([process.argv[1] ?? "rustc", ...args]);
}

try {
  process.exitCode = await main(process.argv.slice(2));
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
