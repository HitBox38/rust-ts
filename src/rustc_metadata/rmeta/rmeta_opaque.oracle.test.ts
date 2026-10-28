// Oracle-built metadata test for lane misc-blockers: the `opaque_ty_origin` (`hir::OpaqueTyOrigin<DefId>`) and
// `rendered_precise_capturing_args` (`[PreciseCapturingArgKind<Symbol, Symbol>]`) tables of an extern crate, decoded
// by cstore_impl.ts's providers through the generated rustc_hir decoders.
//
// The pinned rustc writes the aux crate's metadata; the port loads it as an extern crate and prints every `OpaqueTy`
// item's origin and rendered `use<..>` list. rustc has no dump of these two queries, so the expected lines follow from
// the aux source: each `impl Trait` is an RPIT (`FnReturn`) or an `async fn` (`AsyncFn`) of the named fn, in a trait /
// trait impl or neither, and the `use<..>` lists are written out in the source.
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import type { DefKind } from "../../rustc_hir/def.ts";
import { debug_OpaqueTyOrigin, debug_PreciseCapturingArgKind, type OpaqueTyOrigin, type PreciseCapturingArgKind } from "../../rustc_hir/hir.gen.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import { type CrateNum, DefId, DefIndex } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { debug_vec, PLAIN } from "../../std/fmt.ts";
import { creader } from "../lib.ts";

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

const WORK = join(DATA, "tmp", "rmeta-opaque-oracle", process.env.RUST_TS_AGENT ?? "default");
const TUPLE = "x86_64-unknown-linux-gnu";
const AUX_NAME = "op_aux";

const AUX = `#![no_std]
pub fn ret() -> impl Sized {}
pub async fn fut() {}
pub trait Tr { fn m(&self) -> impl Sized; }
impl Tr for () { fn m(&self) -> impl Sized {} }
pub fn cap<'x, X>(x: &'x X) -> impl Sized + use<'x, X> { x }
pub fn cap_none<'y>(_x: &'y u8) -> impl Sized + use<> {}
`;

/** One line per `OpaqueTy` item: its origin (the parent as its name), then its `use<..>` list, if any. */
const EXPECTED = [
  "AsyncFn { parent: fut, in_trait_or_impl: None } use: -",
  "FnReturn { parent: cap, in_trait_or_impl: None } use: [Lifetime('x), Param(X)]",
  "FnReturn { parent: cap_none, in_trait_or_impl: None } use: []",
  "FnReturn { parent: m, in_trait_or_impl: Some(Trait) } use: -",
  "FnReturn { parent: m, in_trait_or_impl: Some(TraitImpl) } use: -",
  "FnReturn { parent: ret, in_trait_or_impl: None } use: -",
];

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

test.skipIf(SKIP)("rmeta-opaque: opaque_ty_origin / rendered_precise_capturing_args of an extern crate", () => {
  mkdirSync(WORK, { recursive: true });
  const aux = join(WORK, `${AUX_NAME}.rs`);
  writeFileSync(aux, AUX);
  const aux_args = [...common_args(), "--crate-type", "lib", "--crate-name", AUX_NAME, aux];
  const meta = Bun.spawnSync([...RUSTC, ...aux_args, "--emit=metadata", "--out-dir", WORK], { stdout: "pipe", stderr: "pipe" });
  if (meta.exitCode !== 0) throw new globalThis.Error(`ERROR: oracle aux build failed: ${meta.stderr.toString().slice(0, 2000)}`);

  const main = join(WORK, "main.rs");
  writeFileSync(main, `#![no_std]\nextern crate ${AUX_NAME};\n`);
  const ours: string[] = [];
  run_compiler(config_from_args([...common_args(), "--crate-type", "lib", "-L", WORK, main]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      const cnum = (tcx.crates(null) as readonly CrateNum[]).find((c) => Symbol.as_str(tcx.crate_name(c)) === AUX_NAME);
      if (cnum === undefined) throw new globalThis.Error(`ERROR: crate ${AUX_NAME} is not loaded`);
      const n = creader.CStore.from_tcx(tcx).num_def_ids_untracked(cnum);
      const name = (d: DefId, f: unknown) => (void f, Symbol.as_str(tcx.item_name(d)));
      const sym = (s: Symbol, f: unknown) => (void f, Symbol.as_str(s));
      for (let i = 0; i < n; i++) {
        const def_id = new DefId(DefIndex.from_usize(i), cnum);
        if ((tcx.def_kind(def_id) as DefKind).$ !== "OpaqueTy") continue;
        const origin = tcx.opaque_ty_origin(def_id) as OpaqueTyOrigin<DefId>;
        const args = tcx.rendered_precise_capturing_args(def_id) as readonly PreciseCapturingArgKind<Symbol, Symbol>[] | undefined;
        const use_ = args === undefined ? "-" : debug_vec(args, PLAIN, (a, f) => debug_PreciseCapturingArgKind(a, f, sym, sym));
        ours.push(`${debug_OpaqueTyOrigin(origin, PLAIN, name)} use: ${use_}`);
      }
    });
  });
  ours.sort();
  writeFileSync(join(WORK, "ours.txt"), ours.join("\n") + "\n");
  expect(ours).toEqual(EXPECTED);
});
