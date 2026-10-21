// Unit tests of harness/compiletest.ts's aux crates and blessed-output normalization (lane harness-w20).
// The aux tests build two small aux crates with the oracle on first use (cached under $RUST_TS_DATA/aux/ui).
//
// compiletest.ts is loaded in a child process: scripts/lib/deps.test.ts points RUST_TS_DATA at a temp dir before
// it first imports scripts/lib/common.ts, and `bun test scripts harness` shares one module cache, so importing
// common.ts here would break that test (or this one, depending on the order). The child runs without that
// override (RUST_TS_DATA then comes from .env.local, as for every tool) and prints what the tests check as JSON.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const CHILD = `
const c = await import(${JSON.stringify(join(REPO, "harness/compiletest.ts"))});
const { DATA, PIN } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const raw = [
  "error[E0277]: x",
  "  --> tests/ui/traits/alias/cross-crate.rs:14:5",
  "  --> /rustc/" + PIN.commit + "/library/core/src/option.rs:606:4",
  "  --> /rustc/FAKE_PREFIX/library/alloc/src/string.rs:12:3",
  "LL |     a\\tb //~ ERROR x",
  "",
].join("\\n");
const blessed = (id) => {
  const b = c.uiBlessed(id, []);
  return "na" in b ? b : { path: b.path, normalized: b.normalize(raw) };
};
console.log(JSON.stringify({
  DATA,
  crossNoAux: c.uiFileCases(["tests/ui/traits/alias/cross-crate.rs"], "human", {}),
  cross: c.uiFileCases(["tests/ui/traits/alias/cross-crate.rs"], "human", { aux: true }),
  privDep: c.uiFileCases(["tests/ui/typeck/dont-suggest-private-dependencies.rs"], "human", { aux: true }),
  procMacro: c.uiFileCases(["tests/ui/typeck/invalid-sugg-for-derive-macro-issue-136343.rs"], "human", { aux: true }),
  blessed: blessed("tests/ui/traits/alias/cross-crate.rs"),
  blessedRev: blessed("tests/ui/traits/const-traits/cross-crate.rs#stock"),
}));
`;
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "RUST_TS_DATA") env[k] = v;
const child = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, env });
if (child.exitCode !== 0) throw new Error(`ERROR: compiletest.test.ts child failed: ${child.stderr.toString().slice(0, 2000)}`);
const R = JSON.parse(child.stdout.toString());
const AUX_ROOT = join(R.DATA, "aux", "ui");

test("aux-build: built by the oracle as rmeta, the main compile gets -L <aux dir> before the test's compile-flags", () => {
  expect(R.crossNoAux.skipped.map((k: { reason: string }) => k.reason)).toEqual(["needs an auxiliary crate (`aux-build:send_sync.rs`), which this harness does not build"]);
  expect(R.cross.skipped).toEqual([]);
  const a: string[] = R.cross.cases[0].args;
  const l = a.indexOf("-L");
  const dir = a[l + 1]!;
  expect(dir.startsWith(AUX_ROOT)).toBe(true);
  expect(a[l + 2]).toBe("--edition=2015");
  expect(a.at(-1)).toBe("-Zparse-crate-root-only");
  expect(existsSync(join(dir, "libsend_sync.rmeta"))).toBe(true);
});

test("aux-crate: nested aux crates with extern modifiers, --extern after the compile-flags", () => {
  expect(R.privDep.skipped).toEqual([]);
  const a: string[] = R.privDep.cases[0].args;
  const dir = a[a.indexOf("-L") + 1]!;
  const e = a.indexOf("--extern");
  expect(a.slice(e - 1, e + 2)).toEqual(["-Zunstable-options", "--extern", `public_dep=${dir}/libpublic_dep.rmeta`]);
  // public-dep.rs's own `aux-crate:priv:private_dep=private-dep.rs` was built first, into the same directory.
  expect(existsSync(join(dir, "libprivate_dep.rmeta"))).toBe(true);
  expect(existsSync(join(dir, "libpublic_dep.rmeta"))).toBe(true);
});

test("proc-macro aux crates are skipped (M6)", () => {
  expect(R.procMacro.cases).toEqual([]);
  expect(R.procMacro.skipped[0].reason).toContain("deferred to M6");
});

test("uiBlessed: expected file per revision and compiletest's normalization", () => {
  expect(R.blessed.path).toBe("tests/ui/traits/alias/cross-crate.stderr");
  expect(R.blessed.normalized).toBe(
    ["error[E0277]: x", "  --> $DIR/cross-crate.rs:14:5", "  --> $SRC_DIR/core/src/option.rs:LL:COL", "  --> $SRC_DIR/alloc/src/string.rs:LL:COL", "LL |     a\\tb", ""].join("\n"),
  );
  expect(R.blessedRev.path).toBe("tests/ui/traits/const-traits/cross-crate.stock.stderr");
});
