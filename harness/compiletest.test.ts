// Unit tests of harness/compiletest.ts's aux crates and blessed-output normalization (lanes harness-w20, harness-w20b).
// The aux tests build a few small aux crates with the oracle on first use (cached under $RUST_TS_DATA/aux/ui).
//
// compiletest.ts is loaded in a child process: scripts/lib/deps.test.ts points RUST_TS_DATA at a temp dir before
// it first imports scripts/lib/common.ts, and `bun test scripts harness` shares one module cache, so importing
// common.ts here would break that test (or this one, depending on the order). The child runs without that
// override (RUST_TS_DATA then comes from .env.local, as for every tool) and prints what the tests check as JSON.
import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
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
const aux = { aux: true, auxTimeoutMs: 300000 };
const json = (r) => ({ cases: r.cases, skipped: r.skipped, auxFiles: [...r.auxFiles] });
const blessed = (id) => {
  const b = c.uiBlessed(id, []);
  return "na" in b ? b : { path: b.path, normalized: b.normalize(raw) };
};
console.log(JSON.stringify({
  DATA,
  crossNoAux: json(c.uiFileCases(["tests/ui/traits/alias/cross-crate.rs"], "human", {})),
  cross: json(c.uiFileCases(["tests/ui/traits/alias/cross-crate.rs"], "human", aux)),
  privDep: json(c.uiFileCases(["tests/ui/typeck/dont-suggest-private-dependencies.rs"], "human", aux)),
  procMacro: json(c.uiFileCases(["tests/ui/typeck/invalid-sugg-for-derive-macro-issue-136343.rs"], "human", aux)),
  auxBin: json(c.uiFileCases(["tests/ui/compiletest-self-test/test-aux-bin.rs"], "human", aux)),
  noPreferDynamic: json(c.uiFileCases(["tests/ui/compiletest-self-test/no-prefer-dynamic-means-no-so.rs"], "human", aux)),
  blessed: blessed("tests/ui/traits/alias/cross-crate.rs"),
  blessedRev: blessed("tests/ui/traits/const-traits/cross-crate.rs#stock"),
}));
`;
// A failing aux build: a 1 ms timeout (and 4 ms for the retry) that no rustc meets. `CARGO_HOME` is inherited into
// the aux builds' environment and so into their key: spelling the same directory differently gives this child
// keys no other run has built, so the build really runs (and fails) instead of reusing a cached directory.
const FAIL_CHILD = `
const c = await import(${JSON.stringify(join(REPO, "harness/compiletest.ts"))});
try {
  c.uiFileCases(["tests/ui/traits/alias/cross-crate.rs"], "human", { aux: true, auxTimeoutMs: 1 });
  console.log("NO ERROR");
} catch (e) {
  console.log("THROWN " + (e instanceof Error ? e.message : String(e)));
}
`;
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "RUST_TS_DATA") env[k] = v;
const child = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, env });
if (child.exitCode !== 0) throw new Error(`ERROR: compiletest.test.ts child failed: ${child.stderr.toString().slice(0, 2000)}`);
const R = JSON.parse(child.stdout.toString());
const AUX_ROOT = join(R.DATA, "aux", "ui");
const cargoHome = process.env.CARGO_HOME || join(homedir(), ".cargo");
const failChild = Bun.spawnSync([process.execPath, "-e", FAIL_CHILD], { cwd: REPO, env: { ...env, CARGO_HOME: `${cargoHome}/./` } });
const failOut = failChild.stdout.toString();

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

test("aux-bin: built into <aux dir>/bin; aux bins alone give the main compile no -L", () => {
  expect(R.auxBin.skipped).toEqual([]);
  const a: string[] = R.auxBin.cases[0].args;
  expect(a.includes("-L")).toBe(false);
  expect(a.includes("--extern")).toBe(false);
  expect(R.auxBin.auxFiles).toEqual([["tests/ui/compiletest-self-test/test-aux-bin.rs", ["tests/ui/compiletest-self-test/auxiliary/print-it-works.rs"]]]);
});

test("no-prefer-dynamic aux crate: no --crate-type, rmeta named in --extern", () => {
  expect(R.noPreferDynamic.skipped).toEqual([]);
  const a: string[] = R.noPreferDynamic.cases[0].args;
  const ext = a[a.indexOf("--extern") + 1]!;
  expect(ext.startsWith("no_prefer_dynamic_lib=")).toBe(true);
  expect(existsSync(ext.slice("no_prefer_dynamic_lib=".length))).toBe(true);
});

test("a failed aux build is an ERROR that stops the case list, never a skip, and leaves no temp dir", () => {
  expect(failChild.exitCode).toBe(0);
  const lines = failOut.split("\n");
  expect(lines.some((l) => l.startsWith("ERROR: tests/ui/traits/alias/cross-crate.rs: the oracle's build of an auxiliary crate failed:") && l.includes("timed out"))).toBe(true);
  expect(lines.some((l) => l.startsWith("THROWN ERROR:"))).toBe(true);
  expect(readdirSync(AUX_ROOT).filter((n) => n.endsWith(`.tmp-${failChild.pid}`))).toEqual([]);
});
