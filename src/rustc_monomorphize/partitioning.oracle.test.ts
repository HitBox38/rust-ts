// Oracle checks of rustc_monomorphize's partitioning and of rustc_middle/mono.ts (lane mono-partition). The subject is
// partitioning_oracle/run.ts; the expected output is committed under partitioning_oracle/oracle/ (regen.ts writes it from
// the pinned rustc), next to its sources: partitioning_oracle/upstream/ is tests/codegen-units/partitioning at the pin,
// unedited; partitioning_oracle/programs/ are this lane's.
//
// Skips (visibly) if rustc is unavailable: aux crates are built by the oracle and the sysroot is the oracle's. Fails
// instead under RUST_TS_REQUIRE_PROBES=1.
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PIN } from "../../scripts/lib/common.ts";
import { CodegenUnit } from "../rustc_middle/mono.ts";
import { all_cases, build_aux, type Case, common_args, fresh_dir, HERE as ORACLE_HERE, normalize, parse, port_env, RUSTC, type Output } from "./partitioning_oracle/common.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
function rustc_available(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustc_available();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const DRIVER = join(ORACLE_HERE, "run.ts");
const CASES = all_cases();
const expected_of = (name: string): Output => parse(readFileSync(join(ORACLE_HERE, "oracle", `${name}.txt`), "utf8"));

/** `item -> cgu names` of `MONO_ITEM <item> @@ <cgu>[linkage] <cgu>[linkage]...` lines, in file order. */
function cgus_by_item(stdout: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("MONO_ITEM ")) continue;
    const at = line.indexOf(" @@");
    const cgus = line.slice(at + 3).trim().split(" ").filter((c) => c !== "");
    out.set(line.slice("MONO_ITEM ".length, at), cgus.map((c) => c.slice(0, c.lastIndexOf("["))));
  }
  return out;
}

/** The pairs (human-readable name, its mangled form) of two runs that differ only in `-Zhuman-readable-cgu-names`. */
function name_pairs(human: string, mangled: string): [string, string][] {
  const h = cgus_by_item(expected_of(human).stdout);
  const m = cgus_by_item(expected_of(mangled).stdout);
  const pairs = new Map<string, string>();
  expect(h.size).toBeGreaterThan(0);
  for (const [item, names] of h) {
    const others = m.get(item)!;
    // Both runs order an item's CGUs by interning order, which is the same in both.
    expect(others.length).toBe(names.length);
    names.forEach((n, i) => pairs.set(n, others[i]!));
  }
  return [...pairs];
}

describe("CodegenUnit names, against the oracle's", () => {
  test("mangle_name: u128 stable hash in base 36, fixed length", () => {
    const pairs = name_pairs("regular-modules", "regular-modules-mangled");
    expect(pairs.length).toBe(7);
    for (const [human, mangled] of pairs) expect(CodegenUnit.mangle_name(human).as_str()).toBe(mangled);
  });

  test("shorten_name: names over the limit, cut at a byte and inside a two-byte character", () => {
    const human = name_pairs("long_names-human", "long_names-mangled");
    const prefix = human.find(([h]) => h.endsWith("-short"))![0].slice(0, -"-short".length);
    const ascii = `${prefix}-m${"x".repeat(230)}`;
    const nonascii = `${prefix}-yz${"é".repeat(110)}`;
    for (const full of [ascii, nonascii]) {
      const shortened = CodegenUnit.shorten_name(full);
      const pair = human.find(([h]) => h === shortened);
      expect(pair).toBeDefined();
      expect(shortened).toContain("-trunc-");
      expect(CodegenUnit.mangle_name(full).as_str()).toBe(pair![1]);
    }
    // 168 bytes are kept of a name, plus `-trunc-` and a hash of 25: 200 bytes. The character straddling byte 168 goes whole.
    const bytes = (s: string): number => new TextEncoder().encode(s).length;
    expect(bytes(CodegenUnit.shorten_name(ascii))).toBe(200);
    expect(bytes(CodegenUnit.shorten_name(nonascii))).toBe(199);
  });

  test("a merged name: the `--` join of its CGUs' names, sorted, then shortened or mangled", () => {
    // Every module of long_names.rs merges into one CGU, whichever order merging took.
    const human = name_pairs("long_names-human", "long_names-mangled");
    const merged_human = cgus_by_item(expected_of("long_names-merged-human").stdout).values().next().value![0]!;
    const merged_mangled = cgus_by_item(expected_of("long_names-merged-mangled").stdout).values().next().value![0]!;
    const prefix = human.find(([h]) => h.endsWith("-short"))![0].slice(0, -"-short".length);
    const full = [`${prefix}-m${"x".repeat(230)}`, `${prefix}-short`, `${prefix}-yz${"é".repeat(110)}`];
    // The parts are each CGU's own name, already shortened.
    const shortened = full.map((n) => CodegenUnit.shorten_name(n)).sort();
    expect(CodegenUnit.shorten_name(shortened.join("--"))).toBe(merged_human);
    const mangled = full.map((n) => CodegenUnit.mangle_name(n).as_str()).sort();
    expect(CodegenUnit.mangle_name(mangled.join("--")).as_str()).toBe(merged_mangled);
  });

  test.skipIf(SKIP)("CodegenUnitNameBuilder on a real TyCtxt: crate prefix, stable crate id, `-in-` for another crate", () => {
    const c = CASES.find((c) => c.name === "extern-generic")!;
    build_aux([c]);
    const out = fresh_dir("names");
    const sysroot = Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
    const r = Bun.spawnSync(["bun", DRIVER, "--sysroot", sysroot, ...common_args(c, out, "port")], { env: { ...port_env(c), RUST_TS_PARTITION_NAMES: "1" }, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    const lines = r.stdout.toString().split("\n").filter((l) => l.startsWith("CGU_NAME "));
    const oracle = expected_of("extern-generic").stdout;
    const local_id = /extern_generic\.([0-9a-f]+)/.exec(oracle)![1]!;
    // The case has `-Zhuman-readable-cgu-names`, and the name is short: `build_cgu_name` leaves it.
    expect(lines[0]).toBe(`CGU_NAME extern_generic.${local_id}-a-b.suffix extern_generic.${local_id}-a-b`);
    // The human-readable name of an upstream CGU in the oracle's output has this exact prefix.
    const upstream = /cgu_generic_function\.[0-9a-f]+-in-extern_generic\.[0-9a-f]+/.exec(oracle)![0];
    expect(lines.some((l) => l.startsWith(`CGU_NAME ${upstream}-a-b.suffix `))).toBe(true);
  });
});

describe("the mono items' CGUs and linkage, against -Zprint-mono-items", () => {
  /** Stops outside this lane's files, each with the program's whole output pinned to it (exit 70). */
  const STOPS: Record<string, string> = {};
  const results = new Map<string, Output>();

  async function run_case(c: Case, sysroot: string): Promise<Output> {
    const out = fresh_dir(`port-${c.name}`);
    const p = Bun.spawn(["bun", DRIVER, "--sysroot", sysroot, ...common_args(c, out, "port")], { env: port_env(c), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    const dump_path = c.dump === undefined ? undefined : join(out, "dump", c.dump);
    const dump = dump_path !== undefined && existsSync(dump_path) ? readFileSync(dump_path, "utf8") : undefined;
    return { code, stdout: normalize(stdout, c), stderr: normalize(stderr, c), dump };
  }

  beforeAll(async () => {
    if (SKIP) return;
    build_aux(CASES);
    const sysroot = Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < CASES.length) {
        const c = CASES[next++]!;
        results.set(c.name, await run_case(c, sysroot));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }, 900_000);

  test.skipIf(SKIP).each(CASES.map((c) => c.name))("%s", (name) => {
    const got = results.get(name)!;
    const stop = STOPS[name];
    if (stop !== undefined) {
      expect(got.code).toBe(70);
      expect(got.stderr).toEndWith(`rust-ts: reached unported code: ${stop}\n`);
      return;
    }
    const want = expected_of(name);
    expect(got.stdout).toBe(want.stdout);
    expect(got.stderr).toBe(want.stderr);
    expect(got.code).toBe(want.code);
    expect(got.dump).toBe(want.dump);
  });
});
