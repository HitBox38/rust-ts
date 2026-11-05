// Oracle check of callconv/aarch64.ts (lane abi-vtable, plan-m7 O7) against the committed output of the pinned rustc
// (aarch64_oracle/oracle/*.txt, written by aarch64_oracle/regen.ts): `#[rustc_abi(debug)]` of aarch64_oracle/abi.rs on
// aarch64-apple-darwin and aarch64-unknown-linux-gnu, byte for byte, with its exit code.
//
// Darwin and AAPCS differ on integer extension to 32 bits and on adjusted vs unadjusted alignment. The last test keeps those
// differences in the fixture: a port that ignored `kind` would otherwise pass unnoticed.
import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { HERE, TARGETS, test_env } from "./aarch64_oracle/common.ts";

const WORK = join(DATA, "tmp", "aarch64-abi-test", process.env.RUST_TS_AGENT ?? "default");

function expected(target: string): string {
  // regen.ts: the exit code, then stderr; run.ts prints them the other way round, per target.
  const text = readFileSync(join(HERE, "oracle", `${target}.txt`), "utf8");
  const nl = text.indexOf("\n");
  return `== ${target}\n${text.slice(nl + 1)}exit ${text.slice(0, nl)}\n`;
}

describe("callconv::aarch64 against the oracle (#[rustc_abi(debug)])", () => {
  test(
    TARGETS.join(", "),
    () => {
      rmSync(WORK, { recursive: true, force: true });
      const r = Bun.spawnSync([process.execPath, join(HERE, "run.ts"), WORK], { cwd: HERE, env: test_env(), stdout: "pipe", stderr: "pipe" });
      expect(r.stdout.toString()).toBe("");
      expect(r.stderr.toString()).toBe(TARGETS.map(expected).join(""));
      expect(r.exitCode).toBe(0);
    },
    { timeout: 120_000 },
  );

  test("the fixture separates the two ABI kinds", () => {
    const [darwin, aapcs] = TARGETS.map(expected);
    expect(darwin!.slice(darwin!.indexOf("\n"))).not.toBe(aapcs!.slice(aapcs!.indexOf("\n")));
  });
});
