// Oracle check of code_stats.ts (`-Zprint-type-sizes`, lane fixers-49) against the committed output of the pinned rustc
// (code_stats_oracle/oracle/*.txt, written by code_stats_oracle/regen.ts): code_stats_oracle/big.rs on aarch64-apple-darwin,
// stdout byte for byte with the exit code, and an empty stderr. Its types of 2^53 bytes or more pin the `bigint` byte counts:
// a `number` would stop (`Size::bytes`) or round.
import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import { args, HERE, ORACLE, test_env } from "./code_stats_oracle/common.ts";

const WORK = join(DATA, "tmp", "code-stats-test", process.env.RUST_TS_AGENT ?? "default");

test("-Zprint-type-sizes of code_stats_oracle/big.rs against the oracle", () => {
  rmSync(WORK, { recursive: true, force: true });
  const main = join(HERE, "..", "..", "rust_ts", "main.ts");
  const r = Bun.spawnSync([process.execPath, main, ...args(WORK)], { cwd: HERE, env: test_env(), stdout: "pipe", stderr: "pipe" });
  expect(r.stderr.toString()).toBe("");
  expect(`${r.exitCode}\n${r.stdout.toString()}`).toBe(readFileSync(join(HERE, "oracle", ORACLE), "utf8"));
});
