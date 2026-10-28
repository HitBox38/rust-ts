// Oracle test for lane mt-opt2-b: the `deduced_param_attrs` table of crate metadata (cstore_impl.rs's extern provider,
// through the generated `derive(Decodable)` of `DeducedParamAttrs` / `UsageSummary` in rustc_middle/decodable.gen.ts).
//
// The pinned rustc builds an aux crate with `-O --emit=metadata,link` (the encoder writes the table only when
// optimizing, doing codegen and not incremental: encoder.rs). The port loads its `.rmeta` and reads `tcx.deduced_param_attrs`
// of every aux fn, which decodes the table. Expected values follow deduce_param_attrs.rs on the oracle's optimized MIR of
// these fns (checked with `-Zunpretty=mir -O`, kept in the test as comments): the return place always carries `MUTATE`;
// trailing defaults (`MUTATE | CAPTURE`) are trimmed; fns whose parameters are all passed directly have no entry. The
// core / alloc tables are decoded too (structural: every element is a valid `UsageSummary`, no trailing default).
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import { DeducedParamAttrs } from "../../rustc_middle/middle/deduced_param_attrs.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type CrateNum, DefId, DefIndex } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { creader } from "../lib.ts";
import { fse_Option_LazyArray } from "./table.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "deduced-param-attrs-oracle", process.env.RUST_TS_AGENT ?? "default");
const TUPLE = "x86_64-unknown-linux-gnu";
const AUX_NAME = "dpa_aux";
const AUX = `
pub struct Big { pub a: [u64; 8] }
#[inline(never)] pub fn read(x: Big) -> u64 { x.a[0] }
#[inline(never)] pub fn write(mut x: Big, i: usize) -> u64 { x.a[i & 7] = 3; x.a[1] }
#[inline(never)] pub fn escape(x: Big) -> usize { std::hint::black_box(&raw const x) as usize }
#[inline(never)] pub fn direct(x: u32, y: &u8) -> u32 { x + *y as u32 }
`;

/** `UsageSummary` bits: DROP 1, SHARED_BORROW 2, MUTATE 4, CAPTURE 8. */
const EXPECTED: Record<string, number[]> = {
  // _0 = copy (_1.0: [u64; 8])[0 of 1]: _0 MUTATE, _1 only read
  read: [4, 0],
  // (_1.0)[_3] = const 3_u64 (a Store through a projection): _1 MUTATE; _2 (usize) is never mutated
  write: [4, 4, 0],
  // &raw const _1 (a `NonMutatingUse(RawBorrow)`): _1 MUTATE | CAPTURE, the default, trimmed with nothing after it
  escape: [4],
  // every parameter is passed directly: no entry
  direct: [],
};

function sysroot(): string {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  return oracle.oracleSysroot();
}
function common_args(): string[] {
  return ["--target", TUPLE, "--sysroot", sysroot(), "--edition", "2024"];
}

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new globalThis.Error("ERROR: no config");
  return config;
}

function with_tcx(main_src: string, f: (tcx: TyCtxt) => void): void {
  const main = join(WORK, "main.rs");
  writeFileSync(main, main_src);
  run_compiler(config_from_args([...common_args(), "--crate-type", "lib", "-L", WORK, main]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      f(tcx);
    });
  });
}

function crate_named(tcx: TyCtxt, name: string): CrateNum {
  const cnum = (tcx.crates(null) as readonly CrateNum[]).find((c) => Symbol.as_str(tcx.crate_name(c)) === name);
  if (cnum === undefined) throw new globalThis.Error(`ERROR: crate ${name} is not loaded`);
  return cnum;
}

test.skipIf(SKIP)("deduced_param_attrs: the extern provider decodes the oracle's table", () => {
  mkdirSync(WORK, { recursive: true });
  const aux = join(WORK, `${AUX_NAME}.rs`);
  writeFileSync(aux, AUX);
  const build = Bun.spawnSync(
    [...RUSTC, ...common_args(), "--crate-type", "rlib", "--crate-name", AUX_NAME, "-O", "--emit=metadata,link", "--out-dir", WORK, aux],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (build.exitCode !== 0) throw new globalThis.Error(`ERROR: oracle aux build failed: ${build.stderr.toString().slice(0, 2000)}`);

  const got: Record<string, number[]> = {};
  with_tcx(`#![no_std]\nextern crate ${AUX_NAME};\n`, (tcx) => {
    const cnum = crate_named(tcx, AUX_NAME);
    const n = creader.CStore.from_tcx(tcx).num_def_ids_untracked(cnum);
    for (let i = 0; i < n; i++) {
      const def_id = new DefId(DefIndex.from_usize(i), cnum);
      if (tcx.def_kind(def_id).$ !== "Fn") continue;
      const name = Symbol.as_str(tcx.item_name(def_id));
      got[name] = (tcx.deduced_param_attrs(def_id) as readonly DeducedParamAttrs[]).map((a) => a.usage);
    }
  });
  expect(got).toEqual(EXPECTED);
});

test.skipIf(SKIP)("deduced_param_attrs: every entry of core and alloc decodes", () => {
  mkdirSync(WORK, { recursive: true });
  const counts: Record<string, number> = {};
  with_tcx("#![no_std]\nextern crate alloc;\n", (tcx) => {
    const cstore = creader.CStore.from_tcx(tcx);
    for (const want of ["core", "alloc"]) {
      const cnum = crate_named(tcx, want);
      const cdata = cstore.get_crate_data(cnum);
      const n = cstore.num_def_ids_untracked(cnum);
      let entries = 0;
      for (let i = 0; i < n; i++) {
        const index = DefIndex.from_usize(i);
        if (cdata.root.tables.deduced_param_attrs.get(fse_Option_LazyArray, cdata, index) === undefined) continue;
        const attrs = tcx.deduced_param_attrs(new DefId(index, cnum)) as readonly DeducedParamAttrs[];
        for (const a of attrs) expect(a.usage >= 0 && a.usage <= 15).toBe(true);
        if (attrs.length > 0) expect(DeducedParamAttrs.is_default(attrs[attrs.length - 1]!)).toBe(false);
        entries++;
      }
      counts[want] = entries;
    }
  });
  writeFileSync(join(WORK, "core-alloc-counts.txt"), `${JSON.stringify(counts)}\n`);
  expect(counts.core ?? 0).toBeGreaterThan(1000);
  expect(counts.alloc ?? 0).toBeGreaterThan(100);
}, 300_000);
