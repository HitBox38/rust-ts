// `report_ice`'s dump file against the oracle, on a real ICE (`-Ztreat-err-as-bug` on a parse error). Reviews of ice-report-impl F2 and
// its re-check R3, R4: the warning carries the `io::Error` text, and the file is stamped in UTC whatever `TZ` says.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAIN = join(import.meta.dir, "..", "rust_ts", "main.ts");
const TOOLCHAIN = "+nightly-2026-10-11";
const ARGS = ["bad.rs", "-Ztreat-err-as-bug", "-Zparse-crate-root-only"];

function run(cmd: string[], cwd: string, env: Record<string, string>): { code: number | null; err: string } {
  const { RUSTC_ICE: _ice, TZ: _tz, ...base } = process.env;
  const r = Bun.spawnSync(cmd, { cwd, env: { ...base, RUST_BACKTRACE: "0", ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, err: r.stderr.toString() };
}
const warning = (err: string): string => err.split("\n").find((l) => l.includes("couldn't be written")) ?? "";
const masked = (line: string): string => line.replace(/rustc-ice-[0-9T_-]+-\d+\.txt/, "rustc-ice-X.txt");

test("the warning for a dump file that cannot be opened, and its time stamp in UTC under another TZ", () => {
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-ice-path-"));
  try {
    writeFileSync(join(dir, "bad.rs"), "fn main( {\n");
    const sysroot = Bun.spawnSync(["rustc", TOOLCHAIN, "--print", "sysroot"]).stdout.toString().trim();
    const env = { RUSTC_ICE: "/nonexistent/x/y", TZ: "Asia/Tokyo" };
    const oracle = run(["rustc", TOOLCHAIN, ...ARGS], dir, env);
    const port = run([process.execPath, MAIN, ...ARGS, "--sysroot", sysroot], dir, env);
    expect(warning(oracle.err)).toContain("No such file or directory (os error 2)");
    expect(masked(warning(port.err))).toBe(masked(warning(oracle.err)));
    expect(port.code).toBe(oracle.code);
    // Both stamps are this hour in UTC (or the next, if the run crosses one); local time in Tokyo is nine hours away.
    const hour = (s: string): number => Number(/rustc-ice-\d+-\d+-\d+T(\d+)_/.exec(s)?.[1]);
    const utc = new Date().getUTCHours();
    for (const s of [oracle.err, port.err]) expect([utc, (utc + 23) % 24]).toContain(hour(warning(s)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
