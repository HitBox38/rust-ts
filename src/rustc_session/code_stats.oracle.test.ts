// Oracle check of code_stats.ts (`-Zprint-type-sizes`, lane fixers-49) against the committed output of the pinned rustc
// (code_stats_oracle/oracle/*.txt, written by code_stats_oracle/regen.ts): code_stats_oracle/big.rs on aarch64-apple-darwin,
// stdout byte for byte with the exit code, and an empty stderr. Its types of 2^53 bytes or more pin the `bigint` byte counts:
// a `number` would stop (`Size::bytes`) or round.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";
import { args, HERE, ORACLE, test_env } from "./code_stats_oracle/common.ts";

const WORK = join(DATA, "tmp", "code-stats-test", process.env.RUST_TS_AGENT ?? "default");

test("-Zprint-type-sizes of code_stats_oracle/big.rs against the oracle", () => {
  rmSync(WORK, { recursive: true, force: true });
  const main = join(HERE, "..", "..", "rust_ts", "main.ts");
  const r = Bun.spawnSync([process.execPath, main, ...args(WORK)], { cwd: HERE, env: test_env(), stdout: "pipe", stderr: "pipe" });
  expect(r.stderr.toString()).toBe("");
  expect(`${r.exitCode}\n${r.stdout.toString()}`).toBe(readFileSync(join(HERE, "oracle", ORACLE), "utf8"));
});

// fixers-50 (fixers-49 review N1, N3): infos with the same size and description print in upstream's `FxHashSet<TypeSizeInfo>`
// iteration order, which `print_type_sizes`' stable sort keeps. Each case in code_stats_oracle/ties/ has such ties (`closures.rs`'s
// also print the same in insertion order, so only `upvars.rs` and `locals.rs` pin FxHashSet order; root-w46-check N3); the
// pinned rustc runs live on the same file (host target, its own sysroot, `-Zcodegen-backend=dummy` on both sides), and
// stdout, stderr and the exit code must be equal. `upvars.rs` and `locals.rs` tie async blocks whose hashes hold upvar,
// local and variant-name `Symbol`s, so they also pin the port's Symbol indices to upstream's (hashing each Symbol as
// index + 1 makes both fail). Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
const RUSTC = ["rustc", `+${PIN.toolchain}`];
const HAVE_RUSTC = ((): boolean => {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"], { env: test_env() }).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
})();
const SKIP_TIES = !HAVE_RUSTC && process.env.RUST_TS_REQUIRE_PROBES !== "1";
if (SKIP_TIES) console.log(`SKIP: pinned rustc (${PIN.toolchain}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
const TIES = join(HERE, "ties");

/** The `type:` lines that share their size and description with another one. */
function tied(stdout: string): string[] {
  const heads = stdout.split("\n").filter((l) => l.startsWith("print-type-size type:")).map((l) => l.replace(/, alignment: .*$/, ""));
  return heads.filter((h) => heads.indexOf(h) !== heads.lastIndexOf(h));
}

for (const file of readdirSync(TIES).filter((f) => f.endsWith(".rs")).sort()) {
  test.skipIf(SKIP_TIES)(`-Zprint-type-sizes ties as the oracle prints them: ties/${file}`, () => {
    const out = join(WORK, "ties", file);
    rmSync(out, { recursive: true, force: true });
    const sysroot = Bun.spawnSync([...RUSTC, "--print", "sysroot"], { env: test_env() }).stdout.toString().trim();
    const a = [file, "--sysroot", sysroot, "--edition", "2021", "--crate-type", "lib", "-Zprint-type-sizes", "-Zcodegen-backend=dummy", "--out-dir", out];
    const o = Bun.spawnSync([...RUSTC, ...a], { cwd: TIES, env: test_env(), stdout: "pipe", stderr: "pipe" });
    const main = join(HERE, "..", "..", "rust_ts", "main.ts");
    const p = Bun.spawnSync([process.execPath, main, ...a], { cwd: TIES, env: test_env(), stdout: "pipe", stderr: "pipe" });
    expect(o.exitCode).toBe(0);
    expect(tied(o.stdout.toString()).length).toBeGreaterThan(1);
    if (file !== "closures.rs") expect(tied(o.stdout.toString()).some((h) => h.includes("{async block@"))).toBe(true);
    expect(`${p.exitCode}\n${p.stderr.toString()}\n${p.stdout.toString()}`).toBe(`${o.exitCode}\n${o.stderr.toString()}\n${o.stdout.toString()}`);
  });
}
