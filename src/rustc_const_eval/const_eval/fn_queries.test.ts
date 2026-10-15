// Lane small-gaps-17: the `constness` / `is_promotable_const_fn` providers (const_eval/fn_queries.rs) on small
// `#![no_core]` crates through the ported driver (fn_queries_test/run.ts): const / non-const fns, inherent and trait impls
// (`const impl`), trait methods (`#[rustc_non_const_trait_method]`), tuple ctors, foreign fns, closures (and the
// "cannot use `const` closures outside of const contexts" error), `#[rustc_promotable]` under `staged_api`.
//
// The expected stdout / stderr / exit were produced by the pinned rustc_driver running the same loop over the same
// crates (docs/handoff/small-gaps-17.md, "Oracle check"); ours must equal them byte for byte.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "fn_queries_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

for (const [file, exit] of [
  ["constness.rs", 0],
  ["const_closure_err.rs", 1],
  ["promotable.rs", 0],
] as const) {
  test(`fn_queries_test/${file}: constness / is_promotable_const_fn equal the pinned rustc's`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const r = Bun.spawnSync(["bun", join(DIR, "run.ts"), "--sysroot", s, "--edition=2021", file], { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
    const base = join(DIR, file.replace(/\.rs$/, ""));
    expect({ exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() }).toEqual({
      exit,
      stdout: readFileSync(`${base}.stdout`, "utf8"),
      stderr: readFileSync(`${base}.stderr`, "utf8"),
    });
  }, 120_000);
}
