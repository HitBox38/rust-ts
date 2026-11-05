// `rustc_monomorphize`'s providers in `DEFAULT_QUERY_PROVIDERS` (lane mono-wire), through the real driver, src/rust_ts/main.ts.
//
// Skips (visibly) if rustc is unavailable, as partitioning.oracle.test.ts does: the sysroot is the oracle's. Fails instead
// under RUST_TS_REQUIRE_PROBES=1.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO } from "../../scripts/lib/common.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import { all_cases, clean_env, common_args, fresh_dir, HERE as ORACLE_HERE, normalize, parse, RUSTC } from "./partitioning_oracle/common.ts";

const MAIN = join(REPO, "src/rust_ts/main.ts");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
function rustc_available(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const SKIP = !rustc_available() && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

describe("the lazy providers", () => {
  test("are exactly what `rustc_monomorphize::provide` sets", async () => {
    // The driver first, as passes.ts's `require` runs after it (docs/reviews/mono-lanes.md section 2).
    const { RUSTC_MONOMORPHIZE_HOOKS, RUSTC_MONOMORPHIZE_QUERIES } = await import("../rustc_interface/passes.ts");
    const { provide } = await import("./lib.ts");
    const providers = { queries: {}, extern_queries: {}, hooks: {} } as Providers;
    provide(providers);
    expect(Object.keys(providers.queries).sort()).toEqual([...RUSTC_MONOMORPHIZE_QUERIES].sort());
    expect(Object.keys(providers.hooks).sort()).toEqual([...RUSTC_MONOMORPHIZE_HOOKS].sort());
    expect(Object.keys(providers.extern_queries)).toEqual([]);
  });
});

describe.skipIf(SKIP)("the real driver", () => {
  const sysroot = (): string => Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();

  test("prints -Zprint-mono-items and writes -Zdump-mono-stats, then stops before LLVM, never reporting success", () => {
    const c = all_cases().find((c) => c.name === "stats-json")!;
    const out = fresh_dir("wire-stats-json");
    const r = Bun.spawnSync(["bun", MAIN, "--sysroot", sysroot(), ...common_args(c, out, "port")], { env: clean_env(), stdout: "pipe", stderr: "pipe" });
    const want = parse(readFileSync(join(ORACLE_HERE, "oracle", "stats-json.txt"), "utf8"));
    expect(normalize(r.stdout.toString(), c)).toBe(want.stdout);
    expect(want.stdout).toContain("MONO_ITEM ");
    expect(readFileSync(join(out, "dump", c.dump!), "utf8")).toBe(want.dump!);
    expect(r.exitCode).toBe(70);
    expect(want.stderr + r.stderr.toString()).toBe(`${want.stderr}rust-ts: unported: rustc_codegen_llvm::LlvmCodegenBackend::codegen_crate (after collect_and_partition_mono_items; codegen; M7)\n`);
  });

  test("does not evaluate the crate on a run with no codegen", () => {
    const out = fresh_dir("wire-metadata");
    const preload = join(out, "preload.ts");
    const list = join(out, "modules.txt");
    writeFileSync(preload, `process.on("exit", () => require("node:fs").writeFileSync(${JSON.stringify(list)}, Object.keys(require.cache).join("\\n")));\n`);
    const source = join(out, "hello.rs");
    writeFileSync(source, 'fn main() { println!("hello"); }\n');
    const r = Bun.spawnSync(["bun", "--preload", preload, MAIN, "--sysroot", sysroot(), "--target=x86_64-unknown-linux-gnu", "--emit=metadata", source, "--out-dir", out], { env: clean_env(), stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    const modules = readFileSync(list, "utf8").split("\n");
    expect(modules.some((m) => m.endsWith("/src/rustc_interface/passes.ts"))).toBe(true);
    expect(modules.filter((m) => m.includes("/src/rustc_monomorphize/"))).toEqual([]);
  });
});
