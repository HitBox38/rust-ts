// Oracle test for lane ssa-linker: linker command lines built through the port's `Linker` (back/linker.ts) and `Command`
// (back/command.ts), compared with the pinned rustc's `--print link-args`, which is `format!("{cmd:?}")` of the same `Command`
// (link.rs:1284). Fixtures: linker_oracle/oracle/<case>.args (and .list, the exported-symbols file), written by hand with
// linker_oracle/regen.ts; cases and normalisation in linker_oracle/common.ts.
//
// `linker_with_args` (link.rs:2870) and `add_order_independent_options` (link.rs:3202) are lane ssa-link-b's, so `drive` below
// stands in for them: it calls the port's `get_linker` and `Linker` methods in their order, with what they decide from the
// session and the target spec read from the port's own `Session`. What only link.rs and its inputs make is taken from the
// fixture: the object files, the libraries (each `.rlib` by `link_staticlib_by_path`, each crate dylib by `link_dylib_by_path`,
// each `-l` by `link_dylib_by_name`, as `add_upstream_rust_crates` / `add_upstream_native_libraries` pass them), the Apple
// `-arch`/`-m*-version-min` pair and `SDKROOT` (apple.rs), the output path, and `link_output_kind` (common.ts). Everything else
// in the line comes from the port: the environment (`PATH` from `get_linker`, `disable_localization`, the target's `link_env`),
// the hint flags (`-Bstatic`/`-Bdynamic`), `-Wl,` wrapping, the export list and its file, `-L`, `-o`, the gc/relro/strip/pie
// flags, and the `Debug` formatting itself.
//
// The exported symbols of the dylib and cdylib cases come from the port's `exported_symbols` (what `CrateInfo::new` stores);
// an executable's are not read by any of these linkers (`export_symbols` returns first), so those cases pass none.
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { SwitchWithOptPath } from "../../rustc_session/config.ts";
import { default_sysroot } from "../../rustc_session/filesearch.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { SymbolExport } from "../lib.ts";
import { type Command, debug_Command } from "./command.ts";
import { disable_localization, exported_symbols, get_linker } from "./linker.ts";
import { CASES, HERE, type LinkCase, type ParsedCommand, case_args, normalise, parse_command } from "./linker_oracle/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "linker-args-port", process.env.RUST_TS_AGENT ?? "default");

function sysroot(): string {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  return oracle.oracleSysroot();
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

// The session's default sysroot is the port's own (rustc_session/filesearch.ts `default_sysroot`: the oracle's, decision
// 2026-11-14), so nothing is injected: the doubled sysroot entry at the head of `PATH` is the port's `Sysroot::all_paths`.
function with_sess(args: string[], f: (sess: Session) => void): void {
  run_compiler(config_from_args(args), (compiler) => f(compiler.sess));
}

function with_tcx(args: string[], f: (tcx: TyCtxt) => void): void {
  run_compiler(config_from_args(args), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      f(tcx);
    });
  });
}

const is_lib = (a: string): boolean => (!a.startsWith("-") && /\.(rlib|dylib|so)$/.test(a)) || /^-l[^,]/.test(a);

/** `linker_with_args` + `add_order_independent_options` for these cases (see the header). */
function drive(sess: Session, c: LinkCase, oracle: ParsedCommand, symbols: readonly SymbolExport[], tmpdir: string): Command {
  const flavor = sess.target.linker_flavor;
  const linker = sess.opts.cg.linker;
  if (linker === undefined) throw new globalThis.Error("ERROR: the case has no -C linker");
  const cmd = get_linker(sess, linker, flavor, false, sess.opts.cg.target_cpu ?? sess.target.cpu, "llvm");

  cmd.export_symbols(tmpdir, c.crate_type, symbols);

  // add_pre_link_args (link.rs:2399)
  const pre = sess.target.pre_link_args.get(flavor);
  if (pre !== undefined) cmd.verbatim_args(pre);
  cmd.verbatim_args(sess.opts.unstable_opts.pre_link_args);

  // add_linked_symbol_object, add_local_crate_regular_objects, _metadata_objects, _allocator_objects
  for (const o of oracle.args.filter((a) => a.endsWith(".o"))) cmd.add_object(o);

  cmd.add_as_needed();

  // add_upstream_rust_crates, add_upstream_native_libraries
  const out_index = oracle.args.indexOf("-o") + 1;
  for (const a of oracle.args.filter((a, i) => i !== out_index && is_lib(a))) {
    if (a.endsWith(".rlib")) cmd.link_staticlib_by_path(a, false);
    else if (a.startsWith("-l")) cmd.link_dylib_by_name(a.slice(2), false, true);
    else cmd.link_dylib_by_path(a, true);
  }

  if (sess.target.binary_format === "Elf") {
    cmd.include_path(join(tmpdir, "raw-dylibs"));
  }

  cmd.reset_per_library_state();

  // add_order_independent_options: add_apple_link_args, add_apple_sdk
  if (sess.target.is_like_darwin) {
    const i = oracle.args.indexOf("-arch");
    cmd.cc_args(oracle.args.slice(i, i + 3));
    const sdkroot = oracle.env.find(([k]) => k === "SDKROOT");
    if (sdkroot !== undefined) cmd.cmd().env("SDKROOT", sdkroot[1]);
  }
  if (sess.target.eh_frame_header) cmd.add_eh_frame_header();
  cmd.add_no_exec();
  cmd.linker_plugin_lto();
  // add_library_search_dirs
  cmd.include_path(sess.target_tlib_path.dir);
  const out = oracle.args[out_index]!;
  cmd.output_filename(out);
  if (!sess.link_dead_code()) {
    const keep_metadata = c.crate_type === "Dylib" || SwitchWithOptPath.enabled(sess.opts.cg.profile_generate);
    cmd.gc_sections(keep_metadata);
  }
  cmd.set_output_kind(c.output_kind, c.crate_type, out);
  // add_relro_args
  switch (sess.opts.cg.relro_level ?? sess.target.relro_level) {
    case "Full":
      cmd.full_relro();
      break;
    case "Partial":
      cmd.partial_relro();
      break;
    case "Off":
      cmd.no_relro();
      break;
    case "None":
      break;
  }
  cmd.optimize();
  cmd.debuginfo(sess.opts.cg.strip, []);
  if (!sess.opts.cg.default_linker_libraries && sess.target.no_default_libraries) cmd.no_default_libraries();

  // link_natively (link.rs:1257-1279)
  const taken = cmd.take_cmd();
  disable_localization(taken);
  for (const [k, v] of sess.target.link_env) taken.env(k, v);
  for (const k of sess.target.link_env_remove) taken.env_remove(k);
  return taken;
}

test.skipIf(SKIP)("linker command lines and export lists match the oracle's --print link-args", () => {
  const sys = sysroot();
  // The port's default sysroot is the exact string the oracle prints (`normalise` below then maps both sides' copies to `$SYSROOT`).
  expect(default_sysroot()).toBe(sys);
  rmSync(WORK, { recursive: true, force: true });
  const results: string[] = [];
  for (const c of CASES) {
    const want = readFileSync(join(HERE, "oracle", `${c.name}.args`), "utf8").trim();
    if (want === "") {
      // A staticlib is archived, not linked: the oracle prints no line, and nothing here builds one.
      expect(c.crate_type).toBe("StaticLib");
      results.push(`${c.name}: no link`);
      continue;
    }
    const oracle = parse_command(want);
    const tmpdir = join(WORK, "out", c.name, "rustcPORT00");
    mkdirSync(tmpdir, { recursive: true });
    const args = case_args(c, WORK, sys);
    let got: string | undefined;
    const build = (sess: Session, symbols: readonly SymbolExport[]): void => {
      got = normalise(debug_Command(drive(sess, c, oracle, symbols, tmpdir)), WORK, sys);
    };
    if (c.crate_type === "Executable") with_sess(args, (sess) => build(sess, []));
    else with_tcx(args, (tcx) => build(tcx.sess, exported_symbols(tcx, c.crate_type)));
    expect(`${c.name}: ${got}`).toBe(`${c.name}: ${want}`);

    const list_want = join(HERE, "oracle", `${c.name}.list`);
    const list_got = join(tmpdir, "list");
    expect(`${c.name} list: ${existsSync(list_got)}`).toBe(`${c.name} list: ${existsSync(list_want)}`);
    if (existsSync(list_want)) expect(`${c.name} list:\n${readFileSync(list_got, "utf8")}`).toBe(`${c.name} list:\n${readFileSync(list_want, "utf8")}`);
    results.push(`${c.name}: same`);
  }
  expect(results.length).toBe(CASES.length);
}, 120_000);
