// Regenerates the miri-x86-b oracle fixtures: runs each program of src/miri/intrinsics/x86/fixtures on the isolated Miri
// (plan-m6 D1) and writes <name>.oracle.txt beside it. Run from anywhere: `bun docs/handoff/miri-x86-b-probe/gen.ts [name..]`.
//
// Format of <name>.oracle.txt: the exit code line, then stdout, then the normalised stderr (see `normalise_stderr`).
// A program's first line `//@ flags: ..` holds its extra Miri flags.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { run } from "../../../scripts/lib/common.ts";
import { caseEnv } from "../../../scripts/lib/env.ts";
import { MIRI_CASE_ENV, MIRI_SYSROOT, miriBinary, miriPin, verifyMiriOracle } from "../../../scripts/lib/miri.ts";

const DIR = join(import.meta.dir, "../../../src/miri/intrinsics/x86/fixtures");

/** The extra Miri flags of a program (its `//@ flags:` line). */
export function flags_of(rs: string): string[] {
  const m = /^\/\/@ flags:(.*)$/m.exec(rs);
  return m === null ? [] : m[1]!.split(" ").filter((x) => x !== "");
}

/**
 * Stderr, keeping what the port must match: everything for a normal error, and for an interpreter panic (an ICE, which
 * prints the host's paths, a backtrace and a query stack) only the panic's message. `RUSTC_ICE=0` keeps the ICE report
 * file out of the fixtures directory.
 */
export function normalise_stderr(stderr: string): string {
  const lines = stderr.split("\n");
  const at = lines.findIndex((l) => l.startsWith("thread ") && l.includes(" panicked at "));
  if (at >= 0) return `panicked: ${lines[at + 1]}\n`;
  // The port's report of the same panic (its ICE format is lane ice-report's).
  const port = lines.find((l) => l.startsWith("rust-ts: internal compiler error: "));
  if (port !== undefined) return `panicked: ${port.slice("rust-ts: internal compiler error: ".length)}\n`;
  return stderr;
}

/** The program files, without the shared prelude. */
export function programs(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith(".rs") && f !== "prelude.rs").sort();
}

if (import.meta.main) {
  verifyMiriOracle();
  const names = process.argv.slice(2);
  for (const f of programs()) {
    if (names.length > 0 && !names.includes(basename(f, ".rs"))) continue;
    const argv = [miriBinary(), f, "--sysroot", MIRI_SYSROOT, "--target", miriPin().target, ...flags_of(readFileSync(join(DIR, f), "utf8"))];
    const p = await run(argv, { cwd: DIR, env: caseEnv({ ...MIRI_CASE_ENV, RUSTC_ICE: "0" }), timeoutMs: 600_000 });
    const stderr = normalise_stderr(p.stderr);
    writeFileSync(join(DIR, `${basename(f, ".rs")}.oracle.txt`), `exit: ${p.code}\n--- stdout\n${p.stdout}--- stderr\n${stderr}`);
    console.log(`${f}: exit ${p.code}, ${p.stdout.split("\n").length - 1} lines, stderr ${stderr.length} bytes, ${(p.ms / 1000).toFixed(1)} s`);
  }
}
