// Tests for compiler/rustc_resolve/src/imports.rs (and check_unused.rs end to end).
//
// 1. End-to-end oracle cases (imports_oracle/<case>.rs, `#![no_core]` crates with the resdump-nocore /
//    expanded-nocore arguments): `use` forms, glob conflicts, unresolved imports with suggestions,
//    `pub use` re-export errors, unused imports. Fixtures per case:
//      <case>.resdump.stdout / .resdump.stderr  tools/probes/resdump (import_res, glob_map,
//                                                module_children, lint_buffer, ...; diagnostics up to
//                                                name resolution)
//      <case>.expanded.stderr                    rustc -Zunpretty=expanded (adds the early lints:
//                                                unused_imports messages, ambiguous/hidden glob
//                                                re-exports, redundant imports, ...)
//      exit_codes.json                           the oracle's exit codes
//    made by `REGEN=1 bun test src/rustc_resolve/imports.test.ts` (needs the resdump probe and the pinned
//    toolchain; with them present the fixtures are re-checked on every run). The subject is
//    src/rust_ts/resdump.ts / src/rust_ts/main.ts on the same arguments.
//    PENDING: every case, until the pipeline reaches name resolution (see PENDING below); a pending
//    case must still stop at unported code (exit 70), so it has to leave PENDING once it runs through.
// 2. Unit checks of the pieces that do not need the rest of the resolver (expectations follow the
//    upstream code they test, cited per case).
import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "./lib.ts";
import { create_default_session_globals_then, DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { BytePos } from "../rustc_span/lib.ts";
import { Ident, kw, Symbol } from "../rustc_span/symbol.ts";
import { Visibility } from "../rustc_middle/ty/mod.ts";
import { LocalExpnId } from "../rustc_span/hygiene.ts";
import { PIN } from "../../scripts/lib/common.ts";
import {
  ActiveResolutionGuard_drop,
  enter_cycle_detector,
  type ImportData,
  type ImportKind,
  import_kind_to_string,
  import_path_to_string,
  index_set_swap_remove,
  NameResolution,
  PendingDecl,
  remove_same_import,
} from "./imports.ts";
import { BindingKey, CmCell, type Decl, DeclData, IdentKey, type LocalModule, Resolver, SpeculativeFlag } from "./lib.ts";

const DIR = join(import.meta.dir, "imports_oracle");
const ROOT = join(import.meta.dir, "..", "..");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";

// ---- 1. end-to-end oracle cases ---------------------------------------------------------------

const CASES = ["use_forms", "glob_conflict", "unresolved", "reexport", "unused"] as const;
type Case = (typeof CASES)[number];

/** Cases whose subject run stops at unported code; the reason is the first missing piece. */
const PENDING: Partial<Record<Case, string>> = {
  use_forms: "driver stops before resolution (rustc_lint::late::unerased_lint_store, lane lint-early-a); then build_reduced_graph (res-graph), ident.rs (res-ident), macros.rs (res-macros), late.rs, diagnostics, CStore (wave 11)",
  glob_conflict: "as use_forms",
  unresolved: "as use_forms",
  reexport: "as use_forms",
  unused: "as use_forms",
};

const nocore_args = (sysroot: string, file: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot,
  "--edition=2021",
  "-Zcrate-attr=feature(no_core)",
  "-Zcrate-attr=no_core",
  file,
];
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

interface Run {
  exit: number;
  stdout: string;
  stderr: string;
}
function run(cmd: string[]): Run {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

function oracle_tools(): { sysroot: string; probe: string } | undefined {
  const data = process.env.RUST_TS_DATA;
  const probe = data === undefined ? undefined : join(data, "target", "probes", "release", "resdump");
  if (probe === undefined || !existsSync(probe) || !rustc_at_pin()) return undefined;
  const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
  return { sysroot: oracleSysroot(), probe };
}

function oracle_runs(tools: { sysroot: string; probe: string }, c: Case): { resdump: Run; expanded: Run } {
  const args = nocore_args(tools.sysroot, `${c}.rs`);
  return {
    resdump: run([tools.probe, ...args]),
    expanded: run(["rustc", `+${PIN.toolchain}`, ...args, "-Zunpretty=expanded"]),
  };
}

const fixture = (name: string): string => readFileSync(join(DIR, name), "utf8");
const exit_codes = (): Record<string, { resdump: number; expanded: number }> => JSON.parse(fixture("exit_codes.json"));

if (REGEN) {
  const tools = oracle_tools();
  if (tools === undefined) throw new Error("ERROR: REGEN needs the resdump probe and the pinned toolchain");
  const codes: Record<string, { resdump: number; expanded: number }> = {};
  for (const c of CASES) {
    const { resdump, expanded } = oracle_runs(tools, c);
    writeFileSync(join(DIR, `${c}.resdump.stdout`), resdump.stdout);
    writeFileSync(join(DIR, `${c}.resdump.stderr`), resdump.stderr);
    writeFileSync(join(DIR, `${c}.expanded.stderr`), expanded.stderr);
    codes[c] = { resdump: resdump.exit, expanded: expanded.exit };
  }
  writeFileSync(join(DIR, "exit_codes.json"), JSON.stringify(codes, null, 2) + "\n");
}

test("imports_oracle fixtures are the current oracle output", () => {
  const tools = oracle_tools();
  if (tools === undefined) {
    if (REQUIRE) throw new Error("ERROR: resdump probe or pinned toolchain missing (bun scripts/probes.ts build resdump)");
    return;
  }
  const codes = exit_codes();
  for (const c of CASES) {
    const { resdump, expanded } = oracle_runs(tools, c);
    expect({ c, exit: resdump.exit, stdout: resdump.stdout, stderr: resdump.stderr }).toEqual({
      c,
      exit: codes[c]!.resdump,
      stdout: fixture(`${c}.resdump.stdout`),
      stderr: fixture(`${c}.resdump.stderr`),
    });
    expect({ c, exit: expanded.exit, stderr: expanded.stderr }).toEqual({ c, exit: codes[c]!.expanded, stderr: fixture(`${c}.expanded.stderr`) });
  }
}, 120_000);

test("the fixtures exercise what they are named for", () => {
  // Guards against a fixture silently losing its point when it is regenerated.
  expect(fixture("glob_conflict.resdump.stderr")).toContain("error[E0659]: `X` is ambiguous");
  expect(fixture("glob_conflict.resdump.stdout")).toContain("AMBIGUOUS_GLOB_REEXPORTS");
  expect(fixture("glob_conflict.resdump.stdout")).toContain("HIDDEN_GLOB_REEXPORTS");
  expect(fixture("unresolved.resdump.stderr")).toContain("help: a similar name exists in the module");
  expect(fixture("unresolved.resdump.stderr")).toContain("unresolved imports `crate::a::Missing`, `crate::a::Another`");
  expect(fixture("reexport.resdump.stderr")).toContain("error[E0364]");
  expect(fixture("reexport.resdump.stderr")).toContain("error[E0365]");
  expect(fixture("reexport.expanded.stderr")).toContain("glob import doesn't reexport anything with visibility `pub`");
  expect(fixture("unused.expanded.stderr")).toContain("if this is a test module, consider adding a `#[cfg(test)]`");
  expect(fixture("use_forms.resdump.stdout")).toContain("REDUNDANT_IMPORTS");
  expect(fixture("use_forms.resdump.stdout")).toContain("== glob_map (1)");
});

for (const c of CASES) {
  test(`imports_oracle/${c}.rs: resdump + expanded diagnostics match the oracle${PENDING[c] ? " (PENDING)" : ""}`, () => {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    let sysroot: string;
    try {
      sysroot = oracleSysroot();
    } catch (e) {
      if (REQUIRE) throw e;
      return;
    }
    const args = nocore_args(sysroot, `${c}.rs`);
    const resdump = run(["bun", join(ROOT, "src/rust_ts/resdump.ts"), ...args]);
    const expanded = run(["bun", join(ROOT, "src/rust_ts/main.ts"), ...args, "-Zunpretty=expanded"]);
    if (PENDING[c] !== undefined) {
      // Still stops at unported code (UNPORTED, exit 70); once it does not, take it off PENDING.
      expect({ c, resdump: resdump.exit, expanded: expanded.exit }).toEqual({ c, resdump: 70, expanded: 70 });
      return;
    }
    const codes = exit_codes();
    expect({ c, exit: resdump.exit, stdout: resdump.stdout, stderr: resdump.stderr }).toEqual({
      c,
      exit: codes[c]!.resdump,
      stdout: fixture(`${c}.resdump.stdout`),
      stderr: fixture(`${c}.resdump.stderr`),
    });
    expect({ c, exit: expanded.exit, stderr: expanded.stderr }).toEqual({ c, exit: codes[c]!.expanded, stderr: fixture(`${c}.expanded.stderr`) });
  }, 120_000);
}

// ---- 2. unit checks -----------------------------------------------------------------------------

const sp = (lo: number, hi: number): Span => Span.with_root_ctxt(BytePos(lo), BytePos(hi));

test("import_path_to_string / import_kind_to_string (imports.rs:1929, 1953)", () => {
  create_default_session_globals_then(() => {
    const id = (s: string, span: Span = DUMMY_SP) => Ident.new(Symbol.intern(s), span);
    const root = Ident.new(kw.PathRoot, DUMMY_SP);
    const single = { $: "Single", source: id("c") } as unknown as ImportKind;
    const glob = { $: "Glob" } as unknown as ImportKind;
    // No segment carries the import's span: the whole path plus the kind; a leading `{{root}}` is dropped.
    expect(import_path_to_string([id("a"), id("b")], single, sp(1, 2))).toBe("a::b::c");
    expect(import_path_to_string([root, id("a")], glob, sp(1, 2))).toBe("a::*");
    expect(import_path_to_string([root], single, sp(1, 2))).toBe("c");
    expect(import_path_to_string([], glob, sp(1, 2))).toBe("*");
    // A segment with the import's span ends the path there (the failing segment).
    expect(import_path_to_string([id("a"), id("b", sp(5, 6)), id("x")], single, sp(5, 6))).toBe("a::b");
    expect(import_path_to_string([root, id("a", sp(5, 6)), id("x")], single, sp(5, 6))).toBe("a");
    expect(import_kind_to_string({ $: "ExternCrate" } as unknown as ImportKind)).toBe("<extern crate>");
    expect(import_kind_to_string({ $: "MacroUse", warn_private: false })).toBe("#[macro_use]");
    expect(import_kind_to_string({ $: "MacroExport" })).toBe("#[macro_export]");
  });
});

test("cycle_detection::enter_cycle_detector and the guard's drop (imports.rs:338, 351)", () => {
  create_default_session_globals_then(() => {
    const m1 = {} as LocalModule;
    const m2 = {} as LocalModule;
    const key = (s: string) => BindingKey.new(IdentKey.with_root_ctxt(Symbol.intern(s)), "TypeNS");
    const g1 = enter_cycle_detector(m1, key("x"));
    expect(g1.$).toBe("Ok");
    // Same module and an equal (not identical) key: a cycle.
    expect(enter_cycle_detector(m1, key("x")).$).toBe("Err");
    // Another module or another key: no cycle.
    const g2 = enter_cycle_detector(m2, key("x"));
    const g3 = enter_cycle_detector(m1, BindingKey.new(IdentKey.with_root_ctxt(Symbol.intern("x")), "ValueNS"));
    expect([g2.$, g3.$]).toEqual(["Ok", "Ok"]);
    // Guards drop in stack order; dropping out of order is the upstream assertion failure.
    if (g1.$ !== "Ok" || g2.$ !== "Ok" || g3.$ !== "Ok") throw new Error("unreachable");
    expect(() => ActiveResolutionGuard_drop(g2._0)).toThrow("This guard should be the only one removing this key");
    // (the failed drop popped g3's key, as `ar.pop()` does before the assertion)
    ActiveResolutionGuard_drop(g2._0);
    ActiveResolutionGuard_drop(g1._0);
    const g4 = enter_cycle_detector(m1, key("x"));
    if (g4.$ !== "Ok") throw new Error("expected Ok");
    ActiveResolutionGuard_drop(g4._0);
  });
});

test("index_set_swap_remove is IndexSet::swap_remove", () => {
  const s = new Set(["a", "b", "c", "d"]);
  expect(index_set_swap_remove(s, "b")).toBe(true);
  expect([...s]).toEqual(["a", "d", "c"]);
  expect(index_set_swap_remove(s, "c")).toBe(true);
  expect([...s]).toEqual(["a", "d"]);
  expect(index_set_swap_remove(s, "x")).toBe(false);
  expect([...s]).toEqual(["a", "d"]);
});

/** A `Decl` for the unit checks: a `Def` of `res` or an import of `source` through `import_`. */
function def_decl(res: DeclData["kind"] extends infer K ? (K extends { $: "Def"; _0: infer R } ? R : never) : never, vis = Visibility.Public as DeclData["initial_vis"]): Decl {
  return new DeclData({ $: "Def", _0: res, _1: [] }, CmCell.new(undefined), LocalExpnId.ROOT, DUMMY_SP, vis, CmCell.new(undefined), CmCell.new(undefined), undefined);
}
function import_decl(source: Decl, import_: ImportData, vis = Visibility.Public as DeclData["initial_vis"]): Decl {
  return new DeclData({ $: "Import", source_decl: source, import: import_ }, CmCell.new(undefined), LocalExpnId.ROOT, DUMMY_SP, vis, CmCell.new(undefined), CmCell.new(undefined), undefined);
}
/** Only `kind` (and identity) matter to the code under test. */
const glob_import = (): ImportData => ({ kind: { $: "Glob" }, module_path: [], is_glob: () => true }) as unknown as ImportData;
/** A `Resolver` with only the state the checked code reads (`speculative_flag`); its methods are the real ones. */
const fake_resolver = (): Resolver => Object.assign(Object.create(Resolver.prototype) as Resolver, { speculative_flag: new SpeculativeFlag(false) });

test("NameResolution::determined_decl / best_decl, PendingDecl::decl (imports.rs:63, 298, 308)", () => {
  const d1 = def_decl({ $: "Err" });
  const d2 = def_decl({ $: "Err" });
  const r = NameResolution.new(DUMMY_SP);
  expect([r.determined_decl(), r.best_decl()]).toEqual([undefined, undefined]);
  r.glob_decl = d1;
  expect(r.determined_decl()).toBe(d1);
  r.single_imports.add(glob_import());
  expect(r.determined_decl()).toBe(undefined); // a single import may still shadow the glob
  expect(r.best_decl()).toBe(d1);
  r.non_glob_decl = d2;
  expect([r.determined_decl(), r.best_decl()]).toEqual([d2, d2]);
  expect(PendingDecl.decl(PendingDecl.Pending)).toBe(undefined);
  expect(PendingDecl.decl({ $: "Ready", _0: d1 })).toBe(d1);
});

test("remove_same_import / select_glob_decl (imports.rs:401, 564)", () => {
  create_default_session_globals_then(() => {
    const r = fake_resolver();
    const select = (old: Decl, new_: Decl): Decl => Resolver.prototype.select_glob_decl.call(r, old, new_);
    const i1 = glob_import();
    const i2 = glob_import();
    const err = def_decl({ $: "Err" });
    const tool = def_decl({ $: "ToolMod" });

    // The same glob import re-fetching the same declaration: identical layers are peeled off.
    const a = import_decl(err, i1);
    const b = import_decl(err, i1);
    expect(remove_same_import(a, b)).toEqual([err, err]);
    // The re-fetched declaration wins (a re-fetch of an overwritten declaration).
    expect(select(a, b)).toBe(b);
    // ... and keeps the old glob ambiguity.
    const c = import_decl(err, i1);
    const d = import_decl(err, i1);
    c.ambiguity.set_checked([tool, false], r);
    expect(select(c, d)).toBe(d);
    expect(d.ambiguity.get()).toEqual([tool, true]);

    // Two globs with different resolutions: the old one stays, ambiguous with the new one.
    const e = import_decl(err, i1);
    const f = import_decl(tool, i2);
    expect(remove_same_import(e, f)).toEqual([e, f]);
    expect(select(e, f)).toBe(e);
    expect(e.ambiguity.get()).toEqual([f, false]);

    // Same resolution, same visibility, the new one ambiguous: the old one takes the ambiguity.
    const g = import_decl(err, i1);
    const h = import_decl(err, i2);
    h.ambiguity.set_checked([tool, false], r);
    expect(select(g, h)).toBe(g);
    expect(g.ambiguity.get()).toEqual([h, true]);

    // Same everything: the old one, untouched.
    const k = import_decl(err, i1);
    const l = import_decl(err, i2);
    expect(select(k, l)).toBe(k);
    expect(k.ambiguity.get()).toBe(undefined);
  });
});
