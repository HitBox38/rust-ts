// rust-ts: the proof of the IR model against the oracle (review plan-m7 F6; lanes llir-core-a, llir-core-b). For each case
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
/** Raw-text checks (lane llir-folder) for what the N1 normal form cannot see, since the parser restores it: the default alignment
 *  of `atomicrmw`/`cmpxchg`, attributes in LLVM's sorted order, calling conventions by name. Every oracle line matching the
 *  case's `raw` must be a line of the model's printed module, attribute group numbers and `!guid` (which `assign-guid` adds in
 *  the oracle) aside. */
const RAW_ATOMIC = /^ {2}(%\S+ = )?(atomicrmw|cmpxchg) /;
const RAW_SIGNATURES = /^define |^ {2}(%\S+ = )?(tail )?call /;
const rawLine = (l: string): string => l.replace(/ #\d+/g, " #N").replace(/ !guid !\d+/, "");
/** Case -> extra rustc arguments, and the hidden wrappers whose effects its replay must attribute (besides the common ones). */
const BODY = ["--target", "x86_64-unknown-linux-gnu", "-Coverflow-checks=off"];
/** Every function definition's attributes and its `uwtable`. */
const DEFN = ["LLVMRustAddFunctionAttributes", "LLVMRustCreateAttrNoValue", "LLVMRustCreateUWTableAttr"];
const CASES: Record<string, { args: string[]; wrappers: string[]; raw?: RegExp }> = {
  statics: { args: ["--target", "x86_64-unknown-linux-gnu"], wrappers: ["LLVMRustGetOrInsertGlobal"] },
  decls: { args: ["--target", "x86_64-unknown-linux-gnu"], wrappers: ["LLVMRustGetOrInsertGlobal", "LLVMRustAddFunctionAttributes", "LLVMRustCreateAttrNoValue", "LLVMRustCreateUWTableAttr"] },
  host: { args: [], wrappers: ["LLVMRustGetOrInsertGlobal", "LLVMRustAddFunctionAttributes", "LLVMRustCreateAttrNoValue", "LLVMRustCreateUWTableAttr"] },
  pic: {
    args: ["--target", "x86_64-unknown-linux-gnu", "-Crelocation-model=pie", "-Ccode-model=large", "-Zlarge-data-threshold=65536"],
    wrappers: ["LLVMRustGetOrInsertGlobal", "LLVMRustSetModulePIELevel", "LLVMRustSetModuleCodeModel", "LLVMRustSetModuleLargeDataThreshold", "LLVMRustSetDSOLocal"],
  },
  // llir-core-b: function bodies.
  arith: { args: BODY, wrappers: [...DEFN, "LLVMRustGetOrInsertGlobal", "LLVMRustPositionBuilderAtStart", "LLVMRustCreateAlignmentAttr", "LLVMRustAddCallSiteAttributes"] },
  phi: { args: BODY, wrappers: [...DEFN, "LLVMRustCreateAlignmentAttr", "LLVMRustCreateStructRetAttr"] },
  switch: { args: BODY, wrappers: [...DEFN, "LLVMRustPositionBuilderAtStart"] },
  invoke: { args: BODY, wrappers: [...DEFN, "LLVMRustCreateAlignmentAttr", "LLVMRustAddCallSiteAttributes", "LLVMRustPositionBuilderAtStart"] },
  atomic: { args: BODY, wrappers: DEFN, raw: RAW_ATOMIC },
  memcpy: { args: BODY, wrappers: [...DEFN, "LLVMRustCreateAlignmentAttr", "LLVMRustCreateStructRetAttr", "LLVMRustBuildMemCpy"] },
  // llir-apfloat: floating-point constant folds at opt-level 0.
  fpconst: { args: BODY, wrappers: [...DEFN, "LLVMRustCreateAlignmentAttr", "LLVMRustCreateStructRetAttr"] },
  byval: {
    args: BODY,
    wrappers: [...DEFN, "LLVMRustCreateAlignmentAttr", "LLVMRustCreateStructRetAttr", "LLVMRustCreateByValAttr", "LLVMRustPositionBuilderAtStart", "LLVMRustBuildMemSet", "LLVMRustBuildMemCpy"],
  },
  // llir-folder: `range(..)`, `dead_on_return` and `captures(..)` at -Copt-level=1, on definitions and call sites (with the
  // recorder's view of LLVMCreateConstantRangeAttribute), and non-C calling conventions on definitions and calls.
  attrs: {
    args: [...BODY, "-Copt-level=1"],
    wrappers: [...DEFN, "LLVMRustCreateAlignmentAttr", "LLVMRustCreateDereferenceableAttr", "LLVMRustCreateRangeAttribute", "LLVMRustAddCallSiteAttributes"],
    raw: RAW_SIGNATURES,
  },
  callconv: { args: BODY, wrappers: [...DEFN, "LLVMRustAddCallSiteAttributes"], raw: RAW_SIGNATURES },
  // An unnamed global (`@0` in the model's text, `@anon.<md5>.0` in the oracle's): scripts/lib/ir-normal.ts N1 runs name-anon-globals.
  anon: {
    args: BODY,
    wrappers: [...DEFN, "LLVMRustAddCallSiteAttributes", "LLVMRustCreateAlignmentAttr", "LLVMRustCreateAllocKindAttr", "LLVMRustCreateAllocSizeAttr", "LLVMRustCreateStructRetAttr", "LLVMRustGetOrInsertGlobal", "LLVMRustPositionBuilderAtStart"],
  },
};
/** Every compile's module setup: triple, PIC level (every case is PIC or PIE), and `add_module_flag_u32`'s flags. */
const COMMON_WRAPPERS = ["LLVMRustSetNormalizedTarget", "LLVMRustSetModulePICLevel", "LLVMRustAddModuleFlagU32"];
/** Calls another lane implements, which the replay may skip (their results are never used by this half). */
const SKIP_ALLOWED = new Set(["LLVMIsMultithreaded", "LLVMDisposeTargetMachine"]);
/** Hidden wrappers the model leaves to another lane, whose effects replay applies directly. */
const STUBBED_ALLOWED = new Set(["LLVMRustSetDataLayoutFromTargetMachine"]);
const WORK = join(DATA, "tmp", "llir-proof", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);

/** The building thread's lines, as thread 1, with handles renumbered in order of first appearance. */
export function canonicalScript(raw: string): string {
  const calls = buildingThread(parseScript(raw));
  const ids = new Map<string, string>();
  return calls.map((c) => `1\t${c.text.replace(/%\d+/g, (h) => ids.get(h) ?? (ids.set(h, `%${ids.size + 1}`), ids.get(h)!))}\n`).join("");
}

describe.skipIf(!HAVE && !REQUIRE)("IR model proof against the oracle's IR", () => {
  let dylib = "";
  beforeAll(() => {
    mkdirSync(WORK, { recursive: true });
    dylib = recorderDylib(SYSROOT, DATA, UPSTREAM);
  });
  afterAll(() => rmSync(WORK, { recursive: true, force: true }));

  for (const [name, { args: extra, wrappers }] of Object.entries(CASES)) {
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
      expect([...r.skipped.keys()].filter((f) => !SKIP_ALLOWED.has(f))).toEqual([]);
      expect([...r.stubbedEffects.keys()].filter((f) => !STUBBED_ALLOWED.has(f))).toEqual([]);
      expect([...r.inferredBy.keys()].sort()).toEqual([...new Set([...COMMON_WRAPPERS, ...wrappers])].sort());
      const bin = llvmBinDir(SYSROOT, "aarch64-apple-darwin");
      const want = await normalForm(new Uint8Array(oracle), "N1", bin);
      const text = printModule(r.modules[0]!);
      const got = await normalForm(new Uint8Array(Buffer.from(text, "latin1")), "N1", bin);
      expect(got).toEqual(want);
      const raw = CASES[name]!.raw;
      if (raw !== undefined) {
        const ours = new Set(text.split("\n").map(rawLine));
        const lines = oracle.toString("latin1").split("\n").filter((l) => raw.test(l)).map(rawLine);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.filter((l) => !ours.has(l))).toEqual([]);
      }
    });
  }
});

describe.skipIf(!existsSync(UPSTREAM) && !REQUIRE)("committed proof scripts replay", () => {
  for (const [name, { wrappers }] of Object.entries(CASES)) {
    test(name, () => {
      const r = replay(parseScript(readFileSync(join(PROOF, `${name}.script`), "latin1")), UPSTREAM);
      expect(r.modules.length).toBe(1);
      expect([...r.skipped.keys()].filter((f) => !SKIP_ALLOWED.has(f))).toEqual([]);
      // Review llir-core-a R4: the stubbed effects, as the oracle test asserts them.
      expect([...r.stubbedEffects.keys()].filter((f) => !STUBBED_ALLOWED.has(f))).toEqual([]);
      expect([...r.inferredBy.keys()].sort()).toEqual([...new Set([...COMMON_WRAPPERS, ...wrappers])].sort());
      expect(printModule(r.modules[0]!)).toContain("!llvm.module.flags");
    });
  }
});
