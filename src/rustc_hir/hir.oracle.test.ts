// Oracle tests of lane hir-types: the generated derive(Debug) / derive(StableHash) of compiler/rustc_hir/src/hir.rs
// and the hand-written `Debug for OwnerNodes` / `FnDeclFlags` / `DotDotPos`.
//
// Each case `hir_oracle/<case>.rs` is a `#![no_core]` lib crate. The subject (hir_oracle/run.ts) runs the ported
// driver to the end of name resolution, builds the case's HIR by hand (what lowering will produce; transcribed from
// the oracle) and prints `-Zunpretty=hir-tree`'s `"{owner:#?} => {owner_nodes:#?}\n"` per owner, with `opt_hash`
// computed as `TyCtxt::hash_owner_nodes` computes it (lib crates print `Some(Fingerprint(..))`, plan-m3 D13). So the
// fixture comparison checks the Debug output byte for byte and the StableHash of every value in the case (spans,
// `DefPathHash`es, symbols, `ExternAbi`, `Pu128`, `ast::MacroDef` token streams, ...).
//
// Fixtures `hir_oracle/<case>.hir-tree.stdout` are the pinned rustc's `-Zunpretty=hir-tree` stdout on the same
// arguments; `REGEN=1 bun test src/rustc_hir/hir.oracle.test.ts` rewrites them (needs the pinned toolchain; with it
// present they are re-checked on every run).
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "hir_oracle");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

const CASES = ["fn_item", "items"] as const;

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

const args = (sysroot: string, c: string): string[] => ["--target", "x86_64-unknown-linux-gnu", "--sysroot", sysroot, "--crate-type", "lib", "--edition=2021", `${c}.rs`];

function run(cmd: string[]): { exit: number; stdout: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString() };
}

const fixture_path = (c: string): string => join(DIR, `${c}.hir-tree.stdout`);

if (REGEN) {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) throw new Error("ERROR: REGEN needs the pinned toolchain");
  for (const c of CASES) {
    const r = run(["rustc", `+${PIN.toolchain}`, "-Zunpretty=hir-tree", ...args(s, c)]);
    if (r.exit !== 0) throw new Error(`ERROR: oracle exit ${r.exit} on ${c}.rs`);
    writeFileSync(fixture_path(c), r.stdout);
  }
}

test("hir_oracle fixtures are the current oracle output", () => {
  const s = sysroot();
  if (s === undefined || !rustc_at_pin()) {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  for (const c of CASES) {
    const r = run(["rustc", `+${PIN.toolchain}`, "-Zunpretty=hir-tree", ...args(s, c)]);
    expect({ c, exit: r.exit, stdout: r.stdout }).toEqual({ c, exit: 0, stdout: readFileSync(fixture_path(c), "utf8") });
  }
}, 120_000);

test("the hir_oracle fixtures exercise what they are named for", () => {
  // Guards against a fixture silently losing its point when it is regenerated.
  const f = readFileSync(fixture_path("fn_item"), "utf8");
  expect(f).toContain("opt_hash: Some(");
  expect(f).toContain('fn_decl_kind: FnDeclFlags(\n                                "ImplicitSelfKind(None)",');
  expect(f).toContain("bodies: {\n        6: Body {");
  const i = readFileSync(fixture_path("items"), "utf8");
  expect(i).toContain("kind: Macro(");
  expect(i).toContain("tokens: TokenStream(");
  expect(i).toContain("abi: C {");
  expect(i).toContain("Pu128(");
  expect(i).toContain("source: Reference,");
  expect(i.match(/opt_hash: Some\(/g)?.length).toBe(4);
});

for (const c of CASES) {
  test(`hir_oracle/${c}.rs: hand-built HIR prints and hashes as the oracle's hir-tree`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = run(["bun", join(DIR, "run.ts"), c, ...args(s, c)]);
    expect({ c, exit: r.exit, stdout: r.stdout }).toEqual({ c, exit: 0, stdout: readFileSync(fixture_path(c), "utf8") });
  }, 120_000);
}
