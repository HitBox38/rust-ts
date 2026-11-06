// `report_ice`'s dump file against the oracle, on a real ICE (`-Ztreat-err-as-bug` on a parse error). Reviews of ice-report-impl F2 and
// its re-check R3, R4: the warning carries the `io::Error` text, and the file is stamped in UTC whatever `TZ` says.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const MAIN = join(import.meta.dir, "..", "rust_ts", "main.ts");
const ARGS = ["bad.rs", "-Ztreat-err-as-bug", "-Zparse-crate-root-only"];

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

// Same environment for both sides; no inherited jobserver or logging.
const BASE: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP"].includes(k)) BASE[k] = v;
}

function run(cmd: string[], cwd: string, env: Record<string, string>): { code: number | null; err: string } {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...BASE, RUST_BACKTRACE: "0", ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, err: r.stderr.toString() };
}
const warning = (err: string): string => err.split("\n").find((l) => l.includes("couldn't be written")) ?? "";
const masked = (line: string): string => line.replace(/rustc-ice-[0-9T_-]+-\d+\.txt/, "rustc-ice-X.txt");

test.skipIf(SKIP)("the warning for a dump file that cannot be opened, and its time stamp in UTC under another TZ", () => {
  if (!HAVE) throw new Error("ERROR: pinned rustc unavailable and RUST_TS_REQUIRE_PROBES=1");
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-ice-path-"));
  try {
    writeFileSync(join(dir, "bad.rs"), "fn main( {\n");
    const sysroot = Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
    const env = { RUSTC_ICE: "/nonexistent/x/y", TZ: "Asia/Tokyo" };
    const oracle = run([...RUSTC, ...ARGS], dir, env);
    const port = run([process.execPath, MAIN, ...ARGS, "--sysroot", sysroot], dir, env);
    expect(warning(oracle.err)).toContain("No such file or directory (os error 2)");
    expect(masked(warning(port.err))).toBe(masked(warning(oracle.err)));
    expect(port.code).toBe(oracle.code);
    // Both stamps are now in UTC, to the minute or so; local time in Tokyo is nine hours away.
    const stamp = (s: string): number => {
      const m = /rustc-ice-(\d+)-(\d+)-(\d+)T(\d+)_(\d+)_(\d+)-/.exec(s)!;
      return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    };
    for (const s of [oracle.err, port.err]) expect(Math.abs(Date.now() - stamp(warning(s)))).toBeLessThan(300_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
