// `debug_hygiene_data(true)` (`{:#?}` of `HygieneData`, lane span-decode) end to end: rust-ts with
// `-Zunpretty=expanded,hygiene -Zverbose-internals` on hygiene_verbose/verbose.rs (a no_core crate with nested
// macro_rules expansions and repeated identical ones, so `expn_data_disambiguators` counts past 1 and the
// hash maps grow) must print the oracle's output, committed as hygiene_verbose/expected.txt. With the oracle
// toolchain installed, the fixture must also be current.
import { expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { oracleRustcCmd } from "../../scripts/lib/oracle.ts";

const DIR = join(import.meta.dir, "hygiene_verbose");
const MAIN = join(import.meta.dir, "..", "rust_ts", "main.ts");
// The expansion hashes hash the source file's name, working directory included: remapping the (real)
// working directory makes the output independent of the checkout's location.
const ARGS = ["-Zunpretty=expanded,hygiene", "-Zverbose-internals", `--remap-path-prefix=${realpathSync(DIR)}=/remapped`, "verbose.rs"];
const expected = (): string => readFileSync(join(DIR, "expected.txt"), "utf8");

test("rust-ts prints the oracle's verbose hygiene data", () => {
  const r = Bun.spawnSync(["bun", MAIN, ...ARGS], { cwd: DIR, stdout: "pipe", stderr: "pipe" });
  expect(r.stderr.toString()).toBe("");
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toBe(expected());
});

const oracle = (() => {
  try {
    return Bun.spawnSync(oracleRustcCmd(ARGS), { cwd: DIR, stdout: "pipe", stderr: "pipe" });
  } catch {
    return undefined;
  }
})();
const NO_ORACLE = oracle === undefined || oracle.exitCode !== 0;
if (NO_ORACLE) console.log("SKIP: oracle rustc not runnable; hygiene_verbose fixture freshness not checked");

test.skipIf(NO_ORACLE)("live oracle: the fixture is current", () => {
  expect(oracle!.stdout.toString()).toBe(expected());
});
