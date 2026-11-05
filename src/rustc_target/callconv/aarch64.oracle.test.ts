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
import { abi_args, HERE, TARGETS, test_env } from "./aarch64_oracle/common.ts";

const MAIN = join(HERE, "../../../rust_ts/main.ts");
const WORK = join(DATA, "tmp", "aarch64-abi-test", process.env.RUST_TS_AGENT ?? "default");

describe("callconv::aarch64 against the oracle (#[rustc_abi(debug)])", () => {
  for (const target of TARGETS) {
    test(
      target,
      () => {
        const expected = readFileSync(join(HERE, "oracle", `${target}.txt`), "utf8");
        const out = join(WORK, target);
        rmSync(out, { recursive: true, force: true });
        const r = Bun.spawnSync([process.execPath, MAIN, ...abi_args(target, out)], { cwd: HERE, env: test_env(), stdout: "pipe", stderr: "pipe" });
        expect(r.stdout.toString()).toBe("");
        expect(`${r.exitCode}\n${r.stderr.toString()}`).toBe(expected);
      },
      { timeout: 120_000 },
    );
  }

  test("the fixture separates the two ABI kinds", () => {
    const darwin = readFileSync(join(HERE, "oracle", "aarch64-apple-darwin.txt"), "utf8");
    const aapcs = readFileSync(join(HERE, "oracle", "aarch64-unknown-linux-gnu.txt"), "utf8");
    expect(darwin).not.toBe(aapcs);
  });
});
