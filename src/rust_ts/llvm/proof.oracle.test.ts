// rust-ts: the proof of llir-core-a's half of the model against the oracle (review plan-m7 F6; lane llir-core-a). For each case
// in proof/: the pinned rustc compiles it with the recorder loaded (record.ts), its IR must equal the IR of an unrecorded run
// (the recorder changes nothing), the recorded calls are replayed through ffi.ts (replay.ts, which checks every answer), and
// the model's printed module must reach the oracle IR's normal form (scripts/lib/ir-normal.ts, N1) byte for byte.
//
// The recorded scripts are committed (proof/<case>.script, handles renumbered in order of appearance) so that llir-core-b and
// reviewers can read the real call sequence; a fresh recording must equal them, and they replay without the toolchain.
// `REGEN=1` rewrites them from a fresh recording.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, UPSTREAM } from "../../../scripts/lib/common.ts";
import { normalForm } from "../../../scripts/lib/ir-normal.ts";
import { llvmBinDir } from "../../../scripts/lib/llvm-tools.ts";
import { printModule } from "./printer.ts";
import { record, recorderDylib } from "./record.ts";
import { buildingThread, parseScript, replay } from "./replay.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const HAVE = SYSROOT !== "" && process.platform === "darwin" && process.arch === "arm64" && existsSync(UPSTREAM);
if (!HAVE && !REQUIRE) console.log("SKIP: the pinned toolchain on aarch64 macOS is unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const PROOF = join(import.meta.dir, "proof");
/** Case -> extra rustc arguments (the target). */
const CASES: Record<string, string[]> = {
  statics: ["--target", "x86_64-unknown-linux-gnu"],
  decls: ["--target", "x86_64-unknown-linux-gnu"],
  host: [],
};
const WORK = join(DATA, "tmp", "llir-proof", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);

/** The building thread's lines, as thread 1, with handles renumbered in order of first appearance. */
export function canonicalScript(raw: string): string {
  const calls = buildingThread(parseScript(raw));
  const ids = new Map<string, string>();
  return calls.map((c) => `1\t${c.text.replace(/%\d+/g, (h) => ids.get(h) ?? (ids.set(h, `%${ids.size + 1}`), ids.get(h)!))}\n`).join("");
}

describe.skipIf(!HAVE && !REQUIRE)("llir-core-a proof against the oracle's IR", () => {
  let dylib = "";
  beforeAll(() => {
    mkdirSync(WORK, { recursive: true });
    dylib = recorderDylib(SYSROOT, DATA, UPSTREAM);
  });
  afterAll(() => rmSync(WORK, { recursive: true, force: true }));

  for (const [name, extra] of Object.entries(CASES)) {
    test(name, async () => {
      writeFileSync(join(WORK, `${name}.rs`), readFileSync(join(PROOF, `${name}.rs`)));
      const argv = (out: string) => [...extra, "--emit=llvm-ir", "-Cno-prepopulate-passes", `${name}.rs`, "-o", out];
      const plain = Bun.spawnSync([join(SYSROOT, "bin", "rustc"), ...argv("plain.ll")], { cwd: WORK, env: { ...process.env, RUSTC_ICE: "0" } });
      expect(plain.exitCode).toBe(0);
      expect(record(SYSROOT, dylib, join(WORK, `${name}.script`), argv("recorded.ll"), WORK)).toBe(0);
      const oracle = readFileSync(join(WORK, "plain.ll"));
      // The recorder does not change what rustc writes.
      expect(Buffer.compare(readFileSync(join(WORK, "recorded.ll")), oracle)).toBe(0);
      const script = canonicalScript(readFileSync(join(WORK, `${name}.script`), "latin1"));
      const committed = join(PROOF, `${name}.script`);
      if (REGEN) writeFileSync(committed, Buffer.from(script, "latin1"));
      expect(script).toBe(readFileSync(committed, "latin1"));
      // Replay, print, and compare normal forms.
      const r = replay(parseScript(script), UPSTREAM);
      expect(r.modules.length).toBe(1);
      const bin = llvmBinDir(SYSROOT, "aarch64-apple-darwin");
      const want = await normalForm(new Uint8Array(oracle), "N1", bin);
      const got = await normalForm(new Uint8Array(Buffer.from(printModule(r.modules[0]!), "latin1")), "N1", bin);
      expect(got).toEqual(want);
    });
  }
});

describe.skipIf(!existsSync(UPSTREAM) && !REQUIRE)("committed proof scripts replay", () => {
  for (const name of Object.keys(CASES)) {
    test(name, () => {
      const r = replay(parseScript(readFileSync(join(PROOF, `${name}.script`), "latin1")), UPSTREAM);
      expect(r.modules.length).toBe(1);
      expect(printModule(r.modules[0]!)).toContain("target triple");
    });
  }
});
