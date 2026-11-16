// Unit tests of src/clippy_lints/lib.ts (lane clippy-contract-a; review clippy-contract-a N4): `register_lint_passes` and `explain`.
// lib.ts imports src/clippy_lints/lib.gen.ts and src/clippy_config/lib.ts, which this branch cannot have: lib.gen.ts is written by
// `bun tools/codegen/clippy.ts` once clippy_config/lib.ts (clippy-contract-b) exists (root decision "codegen-clippy-macros (D5)").
// Until both exist these tests SKIP, saying so; root checks at integration that they run. The `explain` case with a configured lint
// compared with the oracle also waits for `Conf::get_metadata` (codegen-clippy-conf) and skips while it stops unported.
//
// Mutations they catch (review N4): renamed lints registered as removed (M3), the two pre-expansion passes swapped (M4), `explain`
// looking up the name in another case (M9); the group order (M2) is in src/declare_clippy_lint/lib.test.ts.
import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LintStore } from "../rustc_lint/context.ts";
import { LintId, type LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { set_output_capture } from "../std/io.ts";
import { Unported } from "../std/panic.ts";
import { SUB_PASSES } from "./lint_tables.gen.ts";

const SRC = join(import.meta.dir, "..");
const MISSING = ["clippy_lints/lib.gen.ts", "clippy_config/lib.ts"].filter((f) => !existsSync(join(SRC, f)));
const WAITING = MISSING.length === 0 ? "" : ` [SKIPPED until src/${MISSING.join(" and src/")} exist (clippy-contract-b, then lib.gen.ts at integration)]`;

type Lib = typeof import("./lib.ts");
type Config = typeof import("../clippy_config/lib.ts");
const load = async (): Promise<[Lib, Config]> => [await import("./lib.ts"), await import("../clippy_config/lib.ts")];

/** What `register_lint_passes` asks of the store, in order. */
type Call = [string, ...unknown[]];
function capturing_store(calls: Call[]): LintStore {
  return {
    register_renamed: (old_name: string, new_name: string) => calls.push(["register_renamed", old_name, new_name]),
    register_removed: (name: string, reason: string) => calls.push(["register_removed", name, reason]),
    register_pre_expansion_lint_pass: (f: unknown) => calls.push(["register_pre_expansion_lint_pass", f]),
    register_early_lint_pass: (f: unknown) => calls.push(["register_early_lint_pass", f]),
    register_late_lint_pass: (f: unknown) => calls.push(["register_late_lint_pass", f]),
  } as unknown as LintStore;
}

test.skipIf(MISSING.length > 0)(`register_lint_passes: renamed, removed, pre-expansion, early, late, in order${WAITING}`, async () => {
  const [lib, clippy_config] = await load();
  const attrs = await import("./attrs/mod.ts");
  const braces = await import("./nonstandard_macro_braces.ts");
  const gen = await import("./lib.gen.ts");
  const { FormatArgsStorage } = await import("../clippy_utils/macros.ts");
  const { AttrStorage } = await import("./utils/attr_collector.ts");
  const conf = {} as unknown as import("../clippy_config/lib.ts").Conf;
  void clippy_config;

  const calls: Call[] = [];
  lib.register_lint_passes(capturing_store(calls), conf);
  const renamed = lib.deprecated_lints.RENAMED.map(([a, b]): Call => ["register_renamed", a, b]);
  const removed = lib.deprecated_lints.DEPRECATED.map(([a, b]): Call => ["register_removed", a, b]);
  expect(calls.slice(0, renamed.length + removed.length)).toEqual([...renamed, ...removed]);
  expect(calls.slice(renamed.length + removed.length).map((c) => c[0])).toEqual([
    "register_pre_expansion_lint_pass",
    "register_pre_expansion_lint_pass",
    "register_early_lint_pass",
    "register_late_lint_pass",
  ]);
  const [pre1, pre2, early, late] = calls.slice(renamed.length + removed.length).map((c) => c[1]) as [
    () => unknown,
    () => unknown,
    () => unknown,
    (tcx: TyCtxt) => unknown,
  ];

  // the pre-expansion factories: `attrs::EarlyAttributes::new(conf)`, then `nonstandard_macro_braces::MacroBraces::new(conf)`
  const s1 = spyOn(attrs.EarlyAttributes, "new").mockImplementation((c) => ({ pass: "EarlyAttributes", c }) as never);
  const s2 = spyOn(braces.MacroBraces, "new").mockImplementation((c) => ({ pass: "MacroBraces", c }) as never);
  try {
    expect(pre1()).toEqual({ pass: "EarlyAttributes", c: conf });
    expect(pre2()).toEqual({ pass: "MacroBraces", c: conf });
  } finally {
    s1.mockRestore();
    s2.mockRestore();
  }

  // the early factory: `CombinedEarlyLintPass::new(conf, format_args, attrs)` with the two storages
  const e = spyOn(gen.CombinedEarlyLintPass, "new").mockImplementation(((...a: unknown[]) => ({ args: a })) as never);
  let early_args: unknown[];
  try {
    early_args = (early() as { args: unknown[] }).args;
  } finally {
    e.mockRestore();
  }
  expect(early_args.length).toBe(3);
  expect(early_args[0]).toBe(conf);
  expect(early_args[1]).toBeInstanceOf(FormatArgsStorage);
  expect(early_args[2]).toBeInstanceOf(AttrStorage);

  // the late factory: `skippable_lints(())` -> `is_active` -> `CombinedLateLintPass::new(tcx, conf, the same storages, is_active)`
  const all = (await import("./declared_lints.ts")).LINTS.map((info) => LintId.of(info.lint));
  const keep = new Set(["clippy::NEEDLESS_RETURN", "clippy::MANUAL_FILTER"]); // two lints that nothing allows
  const skippable = new Set(all.filter((id) => !keep.has(id.lint.name)));
  const keys: unknown[] = [];
  const tcx = { skippable_lints: (k: unknown) => (keys.push(k), skippable) } as unknown as TyCtxt;
  const l = spyOn(gen.CombinedLateLintPass, "new").mockImplementation(((...a: unknown[]) => ({ args: a })) as never);
  let late_args: unknown[];
  try {
    late_args = (late(tcx) as { args: unknown[] }).args;
  } finally {
    l.mockRestore();
  }
  expect(keys).toEqual([null]);
  expect(late_args.slice(0, 4)).toEqual([tcx, conf, early_args[1], early_args[2]]);
  expect(late_args[2]).toBe(early_args[1]);
  expect(late_args[3]).toBe(early_args[2]);
  const is_active = late_args[4] as (lints: LintVec) => boolean;
  for (const row of SUB_PASSES.filter((r) => r.kind === "late")) {
    const want = row.lints.length === 0 || row.lints.some((n) => keep.has(`clippy::${n.slice("clippy::".length).toUpperCase()}`));
    expect([row.field, is_active(all.filter((id) => row.lints.includes(id.lint.name.toLowerCase())).map((id) => id.lint))]).toEqual([row.field, want]);
  }

  // the generated selection itself: with every clippy lint skippable only the lint-less `DumpHir` and `Author` are built
  // (they are unit structs, so no stub constructor runs)
  const none = { skippable_lints: () => new Set(all) } as unknown as TyCtxt;
  const pass = late(none) as Record<string, unknown>;
  for (const row of SUB_PASSES.filter((r) => r.kind === "late")) {
    expect([row.field, pass[row.field] !== undefined]).toEqual([row.field, row.field === "DumpHir" || row.field === "Author"]);
  }
});

/** `explain(name)`'s stdout and return value. */
function explain(lib: Lib, name: string): [string, number] {
  const out: Uint8Array[] = [];
  const previous = set_output_capture(out);
  let code: number;
  try {
    code = lib.explain(name);
  } finally {
    set_output_capture(previous);
  }
  return [Buffer.concat(out).toString(), code];
}

/** The pinned `cargo-clippy clippy --explain <name>` (clippy_lints::explain upstream): [stdout, exit status]. */
async function oracle_explain(name: string): Promise<[string, number]> {
  const { DATA } = await import("../../scripts/lib/common.ts");
  const { toolPinsOrDie, toolOracleEnv, verifyToolOracles } = await import("../../scripts/lib/oracle.ts");
  const { toolBinary } = await import("../../scripts/lib/tool-oracles.ts");
  verifyToolOracles();
  const bin = toolBinary(DATA, toolPinsOrDie().clippy, "clippy", "cargo-clippy");
  const r = Bun.spawnSync([bin, "clippy", "--explain", name], { env: { ...process.env, ...toolOracleEnv() }, stdout: "pipe", stderr: "pipe" });
  return [r.stdout.toString(), r.exitCode];
}

test.skipIf(MISSING.length > 0)(`explain: a lint without configuration and an unknown lint, against the oracle${WAITING}`, async () => {
  const [lib, clippy_config] = await load();
  // `double_parens` and `needless_return` have no configuration (the oracle prints no "### Configuration" section), so
  // `Conf::get_metadata` (codegen-clippy-conf) is replaced by an empty list here.
  const s = spyOn(clippy_config.Conf, "get_metadata").mockImplementation(() => []);
  try {
    for (const name of ["double_parens", "needless_return", "NEEDLESS_RETURN", "nope"]) {
      const want = await oracle_explain(name);
      expect(want[0]).not.toContain("### Configuration");
      expect([name, ...explain(lib, name)]).toEqual([name, ...want]);
    }
  } finally {
    s.mockRestore();
  }
});

test.skipIf(MISSING.length > 0)(`explain: only the configuration that names the lint is printed${WAITING}`, async () => {
  const [lib, clippy_config] = await load();
  const mine = { name: "cognitive-complexity-threshold", default: "25", lints: ["cognitive_complexity"], doc: "a", renamed_to: undefined };
  const other = { name: "too-many-lines-threshold", default: "100", lints: ["too_many_lines"], doc: "b", renamed_to: undefined };
  const s = spyOn(clippy_config.Conf, "get_metadata").mockImplementation(() => [other, mine] as never);
  try {
    const [out, code] = explain(lib, "Cognitive_Complexity");
    expect(code).toBe(0);
    const header = "### Configuration for clippy::cognitive_complexity:\n\n";
    expect(out.endsWith(`${header}${clippy_config.display_ConfMetadata(mine as never)}\n`)).toBe(true);
    expect(out).not.toContain("too-many-lines-threshold");
  } finally {
    s.mockRestore();
  }
});

// `Conf::get_metadata` is generated by codegen-clippy-conf; until then it stops unported.
let METADATA_PORTED = false;
if (MISSING.length === 0) {
  try {
    (await import("../clippy_config/lib.ts")).Conf.get_metadata();
    METADATA_PORTED = true;
  } catch (e) {
    if (!(e instanceof Unported)) throw e;
  }
}

test.skipIf(!METADATA_PORTED)(
  `explain: a configured lint against the oracle${METADATA_PORTED ? "" : " [SKIPPED until Conf::get_metadata is ported (codegen-clippy-conf)]"}`,
  async () => {
    const [lib] = await load();
    for (const name of ["cognitive_complexity", "too_many_lines"]) {
      const want = await oracle_explain(name);
      expect(want[0]).toContain("### Configuration for clippy::");
      expect([name, ...explain(lib, name)]).toEqual([name, ...want]);
    }
  },
);
