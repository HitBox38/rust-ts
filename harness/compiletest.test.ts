// Unit tests of harness/compiletest.ts's aux crates and blessed-output normalization (lanes harness-w20, harness-w20b).
// The aux tests build a few small aux crates with the oracle on first use (cached under $RUST_TS_DATA/aux/ui).
//
// compiletest.ts is loaded in a child process: scripts/lib/deps.test.ts points RUST_TS_DATA at a temp dir before
// it first imports scripts/lib/common.ts, and `bun test scripts harness` shares one module cache, so importing
// common.ts here would break that test (or this one, depending on the order). The child runs without that
// override (RUST_TS_DATA then comes from .env.local, as for every tool) and prints what the tests check as JSON.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
// The oracle's `#[rustc_dump_layout(debug)]` stderr for `core::ops::Range<[u8; 1]>` and `rl_aux::Range<[u8; 1]>` (compiled
// with -Zrandomize-layout: reordered), from the check in `oracleStdLayoutsRandomized`.
const LAYOUT_STDERR = "error: layout_of(std::ops::Range<[u8; 1]>) = Layout {\n           size: Size(2 bytes),\n           align: AbiAlign {\n               abi: Align(1 bytes),\n           },\n           backend_repr: Memory {\n               sized: true,\n           },\n           fields: Arbitrary {\n               offsets: [\n                   Size(0 bytes),\n                   Size(1 bytes),\n               ],\n               in_memory_order: [\n                   0,\n                   1,\n               ],\n           },\n           largest_niche: None,\n           uninhabited: false,\n           variants: Single {\n               index: 0,\n           },\n           max_repr_align: None,\n           unadjusted_abi_align: Align(1 bytes),\n           repr_c: false,\n           randomization_seed: 7505337128903775511,\n       }\n --> main.rs:3:29\n  |\n3 | #[rustc_dump_layout(debug)] type S1 = core::ops::Range<[u8; 1]>;\n  |                             ^^^^^^^\n\nerror: layout_of(rl_aux::Range<[u8; 1]>) = Layout {\n           size: Size(2 bytes),\n           align: AbiAlign {\n               abi: Align(1 bytes),\n           },\n           backend_repr: Memory {\n               sized: true,\n           },\n           fields: Arbitrary {\n               offsets: [\n                   Size(1 bytes),\n                   Size(0 bytes),\n               ],\n               in_memory_order: [\n                   1,\n                   0,\n               ],\n           },\n           largest_niche: None,\n           uninhabited: false,\n           variants: Single {\n               index: 0,\n           },\n           max_repr_align: None,\n           unadjusted_abi_align: Align(1 bytes),\n           repr_c: false,\n           randomization_seed: 11594332325826662558,\n       }\n --> main.rs:4:29\n  |\n4 | #[rustc_dump_layout(debug)] type A1 = rl_aux::Range<[u8; 1]>;\n  |                             ^^^^^^^\n\n";
const CHILD = `
const LAYOUT_STDERR = ${JSON.stringify(LAYOUT_STDERR)};
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
  // lane harness-w37: needs decided from the oracle.
  zstd: c.needCondition("needs-llvm-zstd"),
  zstdPrint: Bun.spawnSync(["rustc", "+" + PIN.toolchain, "-Zunstable-options", "--print=backend-has-zstd"]).stdout.toString().trim(),
  layouts: c.oracleStdLayoutsRandomized(),
  miriSysroot: (await import("node:fs")).existsSync((await import(${JSON.stringify(join(REPO, "scripts/lib/miri.ts"))})).miriTargetLibDir()),
  deterministic: c.needCondition("needs-deterministic-layouts"),
  typeSizes: json(c.uiFileCases(["tests/ui/structs-enums/type-sizes.rs"], "human", { run: true, needs: true })),
  typeSizesOld: json(c.uiFileCases(["tests/ui/structs-enums/type-sizes.rs"], "human", { run: true })),
  orders: c.layoutOrders(LAYOUT_STDERR),
  ordersBad: (() => { try { c.layoutOrders("error: layout_of(T) = Layout {\\n  size: Size(2 bytes),\\n}\\n"); return "NO ERROR"; } catch (e) { return String(e); } })(),
  layoutUndecided: (() => {
    const check = (...outs) => { let i = 0; return c.stdLayoutsRandomized(() => outs[Math.min(i++, outs.length - 1)], () => {}, "/d", "lib", []); };
    const ok = { exitCode: 0, stderr: "" };
    return {
      auxFails: check({ exitCode: 1, stderr: "error: nope" }),
      mainFails: check(ok, { exitCode: 1, stderr: "error: nope" }),
      unparsable: check(ok, { exitCode: 1, stderr: "error: layout_of(T) = Layout {\\n}\\n" }),
    };
  })(),
  combined: [[false, false], [false, undefined], [true, undefined], [undefined, undefined]].map((rs) => c.combineLayouts(rs.map((randomized, i) => ({ randomized, why: "w" + i })))),
  layoutTmpLeft: (await import("node:fs")).existsSync(c.oracleStdLayoutsRandomized().dir),
}));
`;
// Failing aux builds, independent of timing and of the shared cache (review: cache poisoning, history 2026-11-04). The child
// gets a private $RUST_TS_DATA holding a small upstream tree of its own, so nothing it builds, or finds already built, is
// in the shared `$RUST_TS_DATA/aux/ui`. Neither aux crate can build: `hangs.rs` never finishes (its const evaluation is an
// endless loop), so the limit fires however late its timer is, and `rejected.rs` is an error whatever the limit.
const FAIL_AUX: Record<string, string> = {
  "hangs.rs": "#![allow(long_running_const_eval)]\nconst _: () = loop {};\n",
  "rejected.rs": "this is not Rust\n",
};
const FAIL_TESTS: Record<string, { aux: string; timeoutMs: number }> = {
  "tests/ui/failed-aux/timeout.rs": { aux: "hangs.rs", timeoutMs: 1 },
  "tests/ui/failed-aux/error.rs": { aux: "rejected.rs", timeoutMs: 300000 },
};
const FAIL_CHILD = `
const c = await import(${JSON.stringify(join(REPO, "harness/compiletest.ts"))});
const { DATA } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
console.log("DATA " + DATA);
for (const [file, { timeoutMs }] of Object.entries(${JSON.stringify(FAIL_TESTS)})) {
  try {
    c.uiFileCases([file], "human", { aux: true, auxTimeoutMs: timeoutMs });
    console.log("NO ERROR " + file);
  } catch (e) {
    console.log("THROWN " + (e instanceof Error ? e.message : String(e)));
  }
}
`;
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "RUST_TS_DATA") env[k] = v;
const child = Bun.spawnSync([process.execPath, "-e", CHILD], { cwd: REPO, env });
if (child.exitCode !== 0) throw new Error(`ERROR: compiletest.test.ts child failed: ${child.stderr.toString().slice(0, 2000)}`);
const R = JSON.parse(child.stdout.toString());
const AUX_ROOT = join(R.DATA, "aux", "ui");
const failData = mkdtempSync(join(tmpdir(), "rust-ts-failed-aux-"));
mkdirSync(join(failData, "rust/tests/ui/failed-aux/auxiliary"), { recursive: true });
for (const [aux, text] of Object.entries(FAIL_AUX)) writeFileSync(join(failData, "rust/tests/ui/failed-aux/auxiliary", aux), text);
for (const [file, { aux }] of Object.entries(FAIL_TESTS)) writeFileSync(join(failData, "rust", file), `//@ aux-build:${aux}\nfn main() {}\n`);
const failChild = Bun.spawnSync([process.execPath, "-e", FAIL_CHILD], { cwd: REPO, env: { ...env, RUST_TS_DATA: failData } });
const failOut = failChild.stdout.toString();
const failStderr = failChild.stderr.toString();
// What the child left in its aux root (it creates the root before any build).
const failAuxRoot = join(failData, "aux", "ui");
const failLeft = existsSync(failAuxRoot) ? readdirSync(failAuxRoot) : ["no aux root"];
rmSync(failData, { recursive: true, force: true });

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

test("needs-llvm-zstd and needs-deterministic-layouts are decided by the oracle (lane harness-w37)", () => {
  // needs.rs `llvm_has_zstd`: the oracle's `--print=backend-has-zstd`.
  expect(["true", "false"]).toContain(R.zstdPrint);
  expect(R.zstd).toEqual({ condition: R.zstdPrint === "true", why: undefined });
  // The dist nightly's std is not compiled with -Zrandomize-layout: core::ops::Range keeps its declaration order for
  // every k, while the -Zrandomize-layout control is reordered for some (the check can see randomization).
  expect(R.layouts.randomized).toBe(false);
  // Both standard libraries when the Miri sysroot is built: the oracle's, then the Miri sysroot's (lane harness-w38).
  const parts = [...R.layouts.why.matchAll(/(oracle std|Miri sysroot std): .*? reordered (\d+)\/64, the -Zrandomize-layout control (\d+)\/64/g)];
  expect(parts[0]![1]).toBe("oracle std");
  expect(parts.length).toBe(R.miriSysroot ? 2 : 1);
  if (R.miriSysroot) expect(parts[1]![1]).toBe("Miri sysroot std");
  for (const m of parts) {
    expect(Number(m[2])).toBe(0);
    expect(Number(m[3])).toBeGreaterThan(0);
  }
  expect(R.deterministic.condition).toBe(true);
  // type-sizes.rs (`needs-deterministic-layouts`, run-pass) is a case with `needs`, still rejected without.
  expect(R.typeSizes.skipped).toEqual([]);
  expect(R.typeSizes.cases.map((c: { id: string }) => c.id)).toEqual(["tests/ui/structs-enums/type-sizes.rs"]);
  expect(R.typeSizesOld.cases).toEqual([]);
  expect(R.typeSizesOld.skipped.length).toBe(1);
  // The parser reads each layout's type and in_memory_order; a layout without one is an error, not a guess.
  expect(R.orders).toEqual([
    { ty: "std::ops::Range<[u8; 1]>", order: [0, 1] },
    { ty: "rl_aux::Range<[u8; 1]>", order: [1, 0] },
  ]);
  expect(R.ordersBad).toContain("unexpected #[rustc_dump_layout(debug)] output");
  // A check that cannot run or read its own compiles is undecided (the test is skipped with the reason), never a throw.
  expect(R.layoutUndecided.auxFails.randomized ?? null).toBe(null);
  expect(R.layoutUndecided.auxFails.why).toBe("lib: oracle rustc failed on the layout check's aux crate: error: nope");
  expect(R.layoutUndecided.mainFails.randomized ?? null).toBe(null);
  expect(R.layoutUndecided.mainFails.why).toContain("lib: the layout check expected 64 + 64 layouts from the oracle, got 0 + 0");
  expect(R.layoutUndecided.unparsable.randomized ?? null).toBe(null);
  expect(R.layoutUndecided.unparsable.why).toContain("lib: unexpected #[rustc_dump_layout(debug)] output");
  // Any randomized library decides; else any undecided one leaves the need undecided.
  expect(R.combined.map((x: { randomized?: boolean }) => x.randomized ?? null)).toEqual([false, null, true, null]);
  // The check's own scratch directory is removed (others in the shared tmp belong to other processes: review harness-w38 L4).
  expect(R.layouts.dir.startsWith(join(R.DATA, "tmp", "needs-layouts-"))).toBe(true);
  expect(R.layoutTmpLeft).toBe(false);
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

test("a failed aux build is an ERROR that stops the case list, never a skip, and leaves nothing behind", () => {
  expect(failChild.exitCode, failStderr).toBe(0);
  const lines = failOut.split("\n");
  // The child's aux root is private, so the shared cache can neither answer for these builds nor receive them.
  expect(lines[0]).toBe(`DATA ${failData}`);
  const failed = (id: string) => lines.filter((l) => l.startsWith(`ERROR: ${id}: the oracle's build of an auxiliary crate failed:`));
  expect(failed("tests/ui/failed-aux/timeout.rs").length).toBe(1);
  expect(failed("tests/ui/failed-aux/timeout.rs")[0]).toContain("`tests/ui/failed-aux/auxiliary/hangs.rs` timed out (1 ms, then 4 ms)");
  expect(failed("tests/ui/failed-aux/error.rs").length).toBe(1);
  expect(failed("tests/ui/failed-aux/error.rs")[0]).toContain("`tests/ui/failed-aux/auxiliary/rejected.rs` (exit 1): error");
  expect(lines.filter((l) => l.startsWith("THROWN ERROR:")).length).toBe(2);
  expect(lines.filter((l) => l.startsWith("NO ERROR")).length).toBe(0);
  // Neither a temp dir nor a cached entry: no failed build is ever cached.
  expect(failLeft).toEqual([]);
});
