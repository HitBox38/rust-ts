// Oracle check of callconv/aarch64.ts (lane abi-vtable, plan-m7 O7) against the committed output of the pinned rustc
// (aarch64_oracle/oracle/*.txt, written by aarch64_oracle/regen.ts): `#[rustc_abi(debug)]` of aarch64_oracle/abi.rs on
// aarch64-apple-darwin and aarch64-unknown-linux-gnu, and of aarch64_oracle/sizes.rs on those, x86_64-unknown-linux-gnu and
// x86_64-pc-windows-msvc, byte for byte, with the exit code. big.rs and big_err.rs (`Size` sites outside `callconv/`) are compared
// the same way; scalable_indirect.rs, where both sides ICE, by its exit code and the panic's message (aarch64_oracle/common.ts).
//
// Darwin and AAPCS differ on integer extension to 32 bits and on adjusted vs unadjusted alignment. The last test keeps those
// differences in the fixture: a port that ignored `kind` would otherwise pass unnoticed.
import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { type Case, CASES, HERE, ice_message, test_env } from "./aarch64_oracle/common.ts";

const WORK = join(DATA, "tmp", "aarch64-abi-test", process.env.RUST_TS_AGENT ?? "default");

function oracle(c: Case): { exit: string; stderr: string } {
  // regen.ts: the exit code, then stderr.
  const text = readFileSync(join(HERE, "oracle", c.oracle), "utf8");
  const nl = text.indexOf("\n");
  return { exit: text.slice(0, nl), stderr: text.slice(nl + 1) };
}

function header(c: Case): string {
  return `== ${c.file} ${c.target}\n`;
}

function expected(c: Case): string {
  // run.ts prints stderr, then the exit code, per case.
  const o = oracle(c);
  return `${header(c)}${o.stderr}exit ${o.exit}\n`;
}

describe("callconv::aarch64 against the oracle (#[rustc_abi(debug)])", () => {
  test(
    CASES.map((c) => `${c.file} ${c.target}`).join(", "),
    () => {
      rmSync(WORK, { recursive: true, force: true });
      const r = Bun.spawnSync([process.execPath, join(HERE, "run.ts"), WORK], { cwd: HERE, env: test_env(), stdout: "pipe", stderr: "pipe" });
      expect(r.stdout.toString()).toBe("");
      const out = r.stderr.toString();
      const ice = CASES.filter((c) => c.ice === true);
      const exact = CASES.filter((c) => c.ice !== true);
      // The ICE cases are last (common.ts).
      expect(CASES.slice(exact.length)).toEqual(ice);
      const at = ice.length === 0 ? out.length : out.indexOf(header(ice[0]!));
      expect(out.slice(0, at)).toBe(exact.map(expected).join(""));
      let rest = out.slice(at);
      for (const [i, c] of ice.entries()) {
        const next = i + 1 < ice.length ? rest.indexOf(header(ice[i + 1]!)) : rest.length;
        const section = rest.slice(0, next);
        rest = rest.slice(next);
        const o = oracle(c);
        expect(o.exit).toBe("101");
        expect(section.startsWith(header(c))).toBe(true);
        expect(section).toContain(`rust-ts: internal compiler error: ${ice_message(o.stderr)}\n`);
        expect(section.endsWith("exit 101\n")).toBe(true);
      }
      expect(r.exitCode).toBe(0);
    },
    { timeout: 120_000 },
  );

  test("the fixture separates the two ABI kinds", () => {
    const [darwin, aapcs] = CASES.filter((c) => c.file === "abi.rs").map(expected);
    expect(darwin!.slice(darwin!.indexOf("\n"))).not.toBe(aapcs!.slice(aapcs!.indexOf("\n")));
  });
});
