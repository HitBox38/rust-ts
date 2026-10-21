// Unit tests of harness/compiletest.ts's aux crates and blessed-output normalization (lane harness-w20).
// The aux tests build two small aux crates with the oracle on first use (cached under $RUST_TS_DATA/aux/ui).
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../scripts/lib/common.ts";
import { uiBlessed, uiFileCases } from "./compiletest.ts";

const AUX_ROOT = join(DATA, "aux", "ui");

test("aux-build: built by the oracle as rmeta, the main compile gets -L <aux dir> before the test's compile-flags", () => {
  const f = "tests/ui/traits/alias/cross-crate.rs";
  expect(uiFileCases([f], "human", {}).skipped.map((k) => k.reason)).toEqual(["needs an auxiliary crate (`aux-build:send_sync.rs`), which this harness does not build"]);
  const { cases, skipped } = uiFileCases([f], "human", { aux: true });
  expect(skipped).toEqual([]);
  const a = cases[0]!.args;
  const l = a.indexOf("-L");
  const dir = a[l + 1]!;
  expect(dir.startsWith(AUX_ROOT)).toBe(true);
  expect(a[l + 2]).toBe("--edition=2015");
  expect(a.at(-1)).toBe("-Zparse-crate-root-only");
  expect(existsSync(join(dir, "libsend_sync.rmeta"))).toBe(true);
});

test("aux-crate: nested aux crates with extern modifiers, --extern after the compile-flags", () => {
  const { cases, skipped } = uiFileCases(["tests/ui/typeck/dont-suggest-private-dependencies.rs"], "human", { aux: true });
  expect(skipped).toEqual([]);
  const a = cases[0]!.args;
  const dir = a[a.indexOf("-L") + 1]!;
  const e = a.indexOf("--extern");
  expect(a.slice(e - 1, e + 2)).toEqual(["-Zunstable-options", "--extern", `public_dep=${dir}/libpublic_dep.rmeta`]);
  // public-dep.rs's own `aux-crate:priv:private_dep=private-dep.rs` was built first, into the same directory.
  expect(existsSync(join(dir, "libprivate_dep.rmeta"))).toBe(true);
  expect(existsSync(join(dir, "libpublic_dep.rmeta"))).toBe(true);
});

test("proc-macro aux crates are skipped (M6)", () => {
  const { cases, skipped } = uiFileCases(["tests/ui/typeck/invalid-sugg-for-derive-macro-issue-136343.rs"], "human", { aux: true });
  expect(cases).toEqual([]);
  expect(skipped[0]!.reason).toContain("deferred to M6");
});

test("uiBlessed: expected file per revision and compiletest's normalization", () => {
  const b = uiBlessed("tests/ui/traits/alias/cross-crate.rs", []);
  if ("na" in b) throw new Error(b.na);
  expect(b.path).toBe("tests/ui/traits/alias/cross-crate.stderr");
  const raw = [
    "error[E0277]: x",
    "  --> tests/ui/traits/alias/cross-crate.rs:14:5",
    `  --> /rustc/${PIN.commit}/library/core/src/option.rs:606:4`,
    "  --> /rustc/FAKE_PREFIX/library/alloc/src/string.rs:12:3",
    "LL |     a\tb //~ ERROR x",
    "",
  ].join("\n");
  expect(b.normalize(raw)).toBe(
    ["error[E0277]: x", "  --> $DIR/cross-crate.rs:14:5", "  --> $SRC_DIR/core/src/option.rs:LL:COL", "  --> $SRC_DIR/alloc/src/string.rs:LL:COL", "LL |     a\\tb", ""].join("\n"),
  );
  const r = uiBlessed("tests/ui/traits/const-traits/cross-crate.rs#stock", []);
  if ("na" in r) throw new Error(r.na);
  expect(r.path).toBe("tests/ui/traits/const-traits/cross-crate.stock.stderr");
});
