// Tests of lane ssa-base: base.rs's `codegen_crate` (CGU order, the allocator module, the back/write.rs calls) and
// `maybe_create_entry_wrapper` (the C `main` shim), through the real driver on a small crate (base_oracle/driver.ts runs
// `codegen_crate` over a mock backend after `analysis`).
//
// Where the expected values come from (base_oracle/oracle.json, read off the pinned nightly; `REGEN=1 bun test <this
// file>` rewrites it), for base_oracle/cgus.rs on x86_64-unknown-linux-gnu with -Ccodegen-units=4 -Copt-level=0:
// 1. `instances`: the oracle's `RUSTC_LOG=rustc_codegen_ssa::base=info` lines `codegen_instance(..)`, in order. cg_llvm's
//    `compile_codegen_unit` defines a CGU's items in `items_in_deterministic_order`, each `Fn` through
//    `base::codegen_instance` and its `info!`, one CGU after another in `codegen_crate`'s order (no -Zthreads, so no
//    pre-compiled batch). `-Ztrim-diagnostic-paths=no` makes the oracle print full paths, as the port's `Display` does here.
// 2. `mono`: -Zprint-mono-items, each item's CGU(s). With 1, this pins `codegen_crate`'s CGU order: the oracle's sequence
//    is grouped by CGU, and each item's CGU is known.
// 3. `allocator`: the allocator module's name, from the oracle's -Csave-temps file `<crate>.<llmod_id>.rcgu.bc`.
// 4. `main`: the oracle IR's `define ... @main` (attributes and metadata dropped) and its body, `; ` comments dropped.
// The rlib run (`--crate-type=rlib`) checks the same facts where they exist: no allocator file, no `main`.
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";
import type { DriverResult } from "./base_oracle/driver.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";
const DIR = join(import.meta.dir, "base_oracle");
const FIXTURE = join(DIR, "cgus.rs");
const RUSTC = ["rustc", `+${PIN.toolchain}`];
const WORK = join(DATA, "tmp", "ssa-base", process.env.RUST_TS_AGENT ?? "default");
const ENV = { ...process.env, RUSTC_ICE: "0" };

function sysrootOrUndefined(): string | undefined {
  try {
    if (!Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`)) return undefined;
    return Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
  } catch {
    return undefined;
  }
}
const SYSROOT = sysrootOrUndefined();
const SKIP = SYSROOT === undefined && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const CONFIGS = {
  bin: ["--target", "x86_64-unknown-linux-gnu", "--edition=2021", "-Ccodegen-units=4", "-Copt-level=0", "-Awarnings"],
  rlib: ["--target", "x86_64-unknown-linux-gnu", "--edition=2021", "--crate-type=rlib", "-Ccodegen-units=4", "-Copt-level=0", "-Awarnings"],
} as const;
type ConfigName = keyof typeof CONFIGS;

interface OracleFacts {
  instances: string[];
  mono: Record<string, string[]>;
  allocator: string | null;
  main: string[] | null;
}

function oracle_facts(name: ConfigName): OracleFacts {
  const dir = join(WORK, `oracle-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // `--out-dir`, never `-o`: a single `-o` file for `--emit=llvm-ir` makes rustc use one CGU.
  const args = [...RUSTC, FIXTURE, ...CONFIGS[name]];
  // 1. The codegen_instance log (full paths).
  const log = Bun.spawnSync([...args, "--emit=llvm-ir", "-Ztrim-diagnostic-paths=no", "--out-dir", join(dir, "log")], {
    cwd: dir,
    env: { ...ENV, RUSTC_LOG: "rustc_codegen_ssa::base=info" },
    stderr: "pipe",
  });
  if (log.exitCode !== 0) throw new Error(`ERROR: oracle log run exit ${log.exitCode}: ${log.stderr.toString()}`);
  const instances: string[] = [];
  for (const l of log.stderr.toString().split("\n")) {
    const m = /^ INFO rustc_codegen_ssa::base codegen_instance\((.*)\)$/.exec(l);
    if (m !== null) instances.push(m[1]!);
  }
  // 2. -Zprint-mono-items.
  const pm = Bun.spawnSync([...args, "--emit=llvm-ir", "-Zprint-mono-items", "--out-dir", join(dir, "pm")], { cwd: dir, env: ENV, stdout: "pipe", stderr: "pipe" });
  if (pm.exitCode !== 0) throw new Error(`ERROR: oracle print-mono-items exit ${pm.exitCode}: ${pm.stderr.toString()}`);
  const mono: Record<string, string[]> = {};
  for (const l of pm.stdout.toString().split("\n")) {
    const m = /^MONO_ITEM (.*) @@ (.*)$/.exec(l);
    if (m !== null) mono[m[1]!] = m[2]!.split(" ").map((c) => c.split("[")[0]!);
  }
  // 3. and 4. -Csave-temps: the allocator module's file, and `main`.
  const st_dir = join(dir, "st");
  mkdirSync(st_dir, { recursive: true });
  const st = Bun.spawnSync([...args, "--emit=llvm-ir", "-Csave-temps", "--out-dir", st_dir], { cwd: st_dir, env: ENV, stderr: "pipe" });
  if (st.exitCode !== 0) throw new Error(`ERROR: oracle save-temps exit ${st.exitCode}: ${st.stderr.toString()}`);
  let allocator: string | null = null;
  let main: string[] | null = null;
  for (const f of readdirSync(st_dir).sort()) {
    const a = /^cgus\.(.*)\.rcgu\.bc$/.exec(f);
    if (a !== null && !a[1]!.startsWith("cgus.") && !a[1]!.endsWith(".no-opt")) allocator = a[1]!;
    if (f.endsWith(".rcgu.ll")) {
      const lines = readFileSync(join(st_dir, f), "utf8").split("\n");
      const i = lines.findIndex((l) => /^define .*@main\(/.test(l));
      if (i !== -1) {
        const out = [lines[i]!.replace(/\) .*\{$/, ") {").replace(/^define (?:[a-z_]+ )*?(i\d+) @main/, "define $1 @main")];
        for (let j = i + 1; lines[j] !== "}"; j++) if (!lines[j]!.startsWith("; ")) out.push(lines[j]!);
        main = out;
      }
    }
  }
  rmSync(dir, { recursive: true, force: true });
  return { instances, mono, allocator, main };
}

if (REGEN) {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(DIR, "oracle.json"), `${JSON.stringify({ bin: oracle_facts("bin"), rlib: oracle_facts("rlib") }, null, 1)}\n`);
}
const ORACLE = JSON.parse(readFileSync(join(DIR, "oracle.json"), "utf8")) as Record<ConfigName, OracleFacts>;

function run_driver(name: ConfigName): DriverResult {
  mkdirSync(WORK, { recursive: true });
  const out = join(WORK, `driver-${process.pid}-${name}.jsonl`);
  rmSync(out, { force: true });
  const r = Bun.spawnSync([process.execPath, join(DIR, "driver.ts"), FIXTURE, ...CONFIGS[name], "--sysroot", SYSROOT ?? ""], {
    cwd: WORK,
    env: { ...ENV, RUST_TS_SSA_OUT: out },
    stdout: "pipe",
    stderr: "pipe",
  });
  let lines: string[] = [];
  try {
    lines = readFileSync(out, "utf8").split("\n").filter((l) => l !== "");
  } catch {}
  rmSync(out, { force: true });
  if (r.exitCode !== 0 || !lines.some((l) => l === '{"kind":"DONE"}')) {
    throw new Error(`ERROR: driver ${name} exit ${r.exitCode}: ${r.stderr.toString().slice(0, 2000)}`);
  }
  return JSON.parse(lines[0]!) as DriverResult;
}

for (const name of Object.keys(CONFIGS) as ConfigName[]) {
  describe.skipIf(SKIP)(`codegen_crate over a mock backend (cgus.rs, ${name}, x86_64-unknown-linux-gnu, 4 CGUs)`, () => {
    const r = SKIP ? undefined : run_driver(name);
    const o = ORACLE[name];

    test("the oracle facts are non-trivial", () => {
      expect(o.instances.length).toBeGreaterThan(20);
      expect(new Set(Object.values(o.mono).flat()).size).toBeGreaterThan(1);
    });

    test("codegen_instance order: the CGUs in codegen_crate's order, each in items_in_deterministic_order", () => {
      expect(r!.cgus.flatMap((c) => c.items.map((i) => i[0]))).toEqual(o.instances);
    });

    test("every CGU the mock compiled holds its items in the oracle's partitioning, and all 4 were compiled once", () => {
      const names = r!.cgus.map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
      expect([...names].sort()).toEqual([...new Set(Object.values(o.mono).flat())].sort());
      // With the previous test, this pins the CGU order: the oracle's sequence, cut where the CGU changes.
      for (const c of r!.cgus) for (const [, mono] of c.items) expect(o.mono[mono] ?? []).toContain(c.name);
    });

    test("the allocator module (codegen_allocator's name, ModuleCodegen::new_allocator into start_async_codegen)", () => {
      if (o.allocator === null) {
        expect(r!.allocator).toBeUndefined();
        expect(r!.write_calls).toContain("start_async_codegen(Regular, Allocator, None)");
      } else {
        expect(r!.allocator).toEqual({ name: o.allocator, methods: ["alloc", "dealloc", "realloc", "alloc_zeroed"] });
        expect(r!.write_calls).toContain(`start_async_codegen(Regular, Allocator, Some(${o.allocator}, Allocator))`);
      }
    });

    test("the back/write.rs calls follow codegen_crate's body (hand-derived from base.rs:716)", () => {
      const alloc = o.allocator === null ? "None" : `Some(${o.allocator}, Allocator)`;
      const expected = [
        "ModuleConfig::new(Regular, no_builtins=false)",
        "bitcode_needed(Regular)",
        "ModuleConfig::new(Allocator, no_builtins=false)",
        `start_async_codegen(Regular, Allocator, ${alloc})`,
        // CguReuse::No for every CGU (the dep graph is disabled): wait, check, compile, submit.
        ...r!.cgus.flatMap((c) => ["wait_for_signal_to_codegen_item", "check_for_errors", `submit_codegened_module_to_llvm(${c.name}, Regular, cost=${c.items.length})`]),
        "codegen_finished",
        "check_for_errors",
      ];
      expect(r!.write_calls).toEqual(expected);
    });

    test("maybe_create_entry_wrapper: the C main shim (oracle IR) in the CGU holding the Rust main", () => {
      if (o.main === null) {
        expect(r!.entry).toBeUndefined();
        expect(r!.entry_calls).toEqual([]);
        return;
      }
      expect(r!.entry).toEqual(o.main);
      // The Rust main is local, so the wrapper goes in the CGU that contains `MonoItem::Fn(main)`.
      const holder = r!.cgus.find((c) => c.items.some(([, m]) => m === "fn main"));
      expect(r!.entry_cgu).toBe(holder?.name);
      expect(r!.entry_calls).toEqual([
        "declare_c_main(i32 (i32, ptr))",
        "set_frame_pointer_type(main)",
        "apply_target_cpu_attr(main)",
        "append_block(main, top)",
        "build(top)",
        "insert_reference_to_gdb_debug_scripts_section_global",
        "call(slot=Direct, funclet=None, instance=std::rt::lang_start::<()>)",
      ]);
    });
  });
}
