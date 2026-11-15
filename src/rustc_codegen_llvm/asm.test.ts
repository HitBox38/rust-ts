// Tests of lane cg-asm's port of asm.rs (`codegen_inline_asm`, the register-class and modifier tables, `llvm_fixup_*`;
// asm.ts) against the pinned rustc, through the port's whole driver and the IR model, as va_arg.test.ts tests va_arg.rs.
//
// The oracle crates are asm_oracle/a64.rs (aarch64-apple-darwin) and asm_oracle/x64.rs (x86_64-unknown-linux-gnu): inline asm
// with each register class the two targets use, explicit registers, in/out/inout/lateout and discarded outputs, `const`, `sym`,
// the options that change the IR, clobber_abi, `may_unwind` with a cleanup (an `invoke`) and template escaping (`$`, several
// lines). The fixtures are the pinned rustc's output for `--sysroot <its sysroot> --crate-type lib --edition 2024 --target <t>
// --emit=llvm-ir`; with the pinned toolchain present they are re-made and must be unchanged. The crates use std's `asm!`, so the
// test needs the pinned toolchain's sysroot and is skipped without it, unless RUST_TS_REQUIRE_PROBES=1 makes that a failure.
// `global_asm!` is not here: module-level asm needs the IR model's wiring of inline_asm.ts (docs/handoff/cg-asm.md).
//
// The IR is compared without comment lines, `; preds` tails and attribute-group numbers and lines (va_arg.test.ts).
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ORACLE = join(import.meta.dir, "asm_oracle");
const MAIN = join(import.meta.dir, "..", "rust_ts", "main.ts");
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const HAVE = SYSROOT !== "";
if (!HAVE && !REQUIRE) console.log("SKIP: the pinned toolchain's sysroot is unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
const WORK = join(DATA, "tmp", "cg-asm-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

const CASES: readonly { crate: string; target: string; expect: readonly string[] }[] = [
  {
    crate: "a64.rs",
    target: "aarch64-apple-darwin",
    // vreg / vreg_low16 / explicit x and v registers, `~{cc}`, the memory-effect attributes, an `invoke`.
    expect: ["=&w,w,~{cc},~{memory}", "{x2}", "x30", "{d3}", "!srcloc", "invoke void asm sideeffect alignstack unwind", "memory(none)"],
  },
  {
    crate: "x64.rs",
    target: "x86_64-unknown-linux-gnu",
    // Intel dialect, the x87/mmx clobber set, reg_abcd's `Q`, `^Yk` clobbers, `${n:c}` symbols, ymm modifiers.
    expect: ["inteldialect", "~{st(7)}", "=&Q,Q", "~{k1}", "${1:c}", "invoke void asm sideeffect alignstack inteldialect unwind", "${0:t}, ${1:t}"],
  },
];

function args(target: string): string[] {
  return ["--sysroot", SYSROOT, "--crate-type", "lib", "--edition", "2024", "--target", target, "--emit=llvm-ir"];
}

/** Runs `cmd` on `crate` in WORK; its stderr, exit code and written IR (if any). */
function compile(cmd: string[], crate: string, target: string, out: string): { stderr: string; code: number | null; ir: string | undefined } {
  mkdirSync(WORK, { recursive: true });
  copyFileSync(join(ORACLE, crate), join(WORK, crate));
  rmSync(join(WORK, out), { force: true });
  const r = Bun.spawnSync([...cmd, ...args(target), crate, "-o", out], { cwd: WORK, env: { ...process.env, RUSTC_ICE: "0" } });
  let ir: string | undefined;
  try {
    ir = readFileSync(join(WORK, out), "utf8");
  } catch {
    ir = undefined;
  }
  return { stderr: r.stderr.toString(), code: r.exitCode, ir };
}

/** The IR without comment lines, `; preds` tails and attribute-group numbers and lines (header). */
function comparable(ir: string): string[] {
  return ir
    .split("\n")
    .filter((l) => !l.trimStart().startsWith(";") && !l.startsWith("attributes #"))
    .map((l) => l.replace(/\s+; preds = .*$/, "").replace(/ #\d+( \{)?$/, "$1"));
}

describe.skipIf(!HAVE && !REQUIRE)("codegen_inline_asm against the oracle", () => {
  for (const c of CASES) {
    test(`${c.crate} (${c.target}): the port's IR is the oracle's`, () => {
      const r = compile([process.execPath, MAIN], c.crate, c.target, `${c.target}.port.ll`);
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      const want = readFileSync(join(ORACLE, `${c.target}.ll`), "utf8");
      for (const s of c.expect) expect(want).toContain(s);
      expect(comparable(r.ir ?? "")).toEqual(comparable(want));
    });

    test(`${c.crate} (${c.target}): the oracle fixture is current`, () => {
      const r = compile([join(SYSROOT, "bin", "rustc")], c.crate, c.target, `${c.target}.oracle.ll`);
      expect(r.code).toBe(0);
      expect(r.ir).toBe(readFileSync(join(ORACLE, `${c.target}.ll`), "utf8"));
    });
  }
});
