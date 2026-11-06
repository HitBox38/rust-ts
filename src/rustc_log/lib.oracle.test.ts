// The logger's settings under values that are not UTF-8, against the oracle (docs/reviews/fixers-41.md F3): `env::var` gives
// `NotUnicode` there, and `RUSTC_LOG` then counts as unset. The port's side is `init_logger` alone, without the driver's load time.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
const rustc_ok = ((): boolean => {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
})();
const SKIP = process.platform === "win32" || (!rustc_ok && !REQUIRE);
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const EXEC_WITH_ENV = join(import.meta.dir, "..", "rust_ts", "exec_with_env.ts");
const LIB = join(import.meta.dir, "lib.ts");
// `init_rustc_env_logger`, and `early_fatal`'s text and status.
const DRIVER = `
import { LoggerConfig, display_Error, init_logger } from ${JSON.stringify(LIB)};
const r = init_logger(LoggerConfig.from_env("RUSTC_LOG"));
if (r.$ === "Err") { process.stderr.write("error: " + display_Error(r._0) + "\\n\\n"); process.exit(101); }
`;

function run(entries: readonly string[], cmd: string[]): { stderr: string; code: number | null } {
  const r = Bun.spawnSync([process.execPath, EXEC_WITH_ENV, JSON.stringify(entries), ...cmd], { stdout: "pipe", stderr: "pipe" });
  return { stderr: r.stderr.toString("latin1" as never), code: r.exitCode };
}

test.skipIf(SKIP)("RUSTC_LOG, RUSTC_LOG_COLOR and the others that are not UTF-8", () => {
  const sysroot = Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
  const rustc = join(sysroot, "bin", "rustc");
  const cases: string[][] = [["RUSTC_LOG=\xff"], ["RUSTC_LOG_COLOR=\xff"], ["RUSTC_LOG_WRAPTREE=\xff"], ["RUSTC_LOG_OUTPUT_TARGET=\xff"], ["RUSTC_LOG_BACKTRACE=\xff"], ["RUSTC_LOG_FORMAT_JSON=\xff"]];
  for (const entries of cases) {
    const oracle = run(entries, [rustc, "-vV"]);
    const port = run(entries, [process.execPath, "-e", DRIVER]);
    expect(port.stderr).toBe(oracle.stderr);
    expect(port.code).toBe(oracle.code);
  }
  // A broken program must not pass by both sides printing nothing.
  expect(run(cases[1]!, [rustc, "-vV"]).stderr).toContain("non-Unicode log color value");
});
