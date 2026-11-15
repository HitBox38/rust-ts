// `-C linker-plugin-lto` against the pinned rustc (lane rg-fix-a): `EmitObj::Bitcode` (back/write.rs `codegen`) hard-links the
// module's bitcode to its object path through rustc_fs_util's `link_or_copy`. ripgrep's `release-lto` profile passes the flag to
// every dependency (cargo's `-C linker-plugin-lto` for crates whose final link does LTO).
//
// `--emit=obj` of a small std lib crate at -O on the host: both sides exit 0 with no stderr and write the same single file, LLVM
// bitcode in Darwin's wrapper (magic `0x0B17C0DE`, bytes `de c0 17 0b`), and no temporary files are left. The bitcode bytes are
// not compared (plan-m7 D2: the port's bitcode comes from `llvm-as`, not from rustc's in-process writer). Before rg-fix-a the
// port stopped here with `unported: rustc_fs_util ... link_or_copy` (exit 70).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const MAIN = join(import.meta.dir, "..", "..", "rust_ts", "main.ts");
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
const WORK = join(DATA, "tmp", "cg-linker-plugin-lto-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

const SRC = "pub fn add(a: u32, b: u32) -> u32 {\n    a.wrapping_add(b)\n}\n\n#[inline(never)]\npub fn twice(x: u32) -> u32 {\n    add(x, x)\n}\n";
const ARGS = ["--crate-type", "lib", "--crate-name", "lpl", "-Copt-level=3", "-Clinker-plugin-lto", "--emit=obj"];

function compile(cmd: string[], side: string): { stderr: string; code: number | null; files: string[]; magic: string[] } {
  const dir = join(WORK, side);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "out"), { recursive: true });
  writeFileSync(join(dir, "lib.rs"), SRC);
  const r = Bun.spawnSync([...cmd, ...ARGS, "--out-dir", "out", "lib.rs"], { cwd: dir, env: { ...process.env, RUSTC_ICE: "0" } });
  const files = readdirSync(join(dir, "out")).sort();
  const magic = files.map((f) => readFileSync(join(dir, "out", f)).subarray(0, 4).toString("latin1"));
  return { stderr: r.stderr.toString(), code: r.exitCode, files, magic };
}

describe.skipIf(!HAVE && !REQUIRE)("-C linker-plugin-lto --emit=obj against the oracle", () => {
  test("the port writes the oracle's single bitcode object", () => {
    const want = compile([join(SYSROOT, "bin", "rustc")], "oracle");
    expect(want).toEqual({ stderr: "", code: 0, files: ["lpl.o"], magic: ["\xde\xc0\x17\x0b"] });
    const got = compile([process.execPath, MAIN, "--sysroot", SYSROOT], "port");
    expect(got).toEqual(want);
  });
});
