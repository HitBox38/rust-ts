// Oracle test for lane ssa-link-b: the full linker command line made by the port's `linker_with_args` (link.rs:2870) and
// `link_natively`'s additions before it runs the linker (link.rs:1257-1279: `disable_localization`, `link_env`,
// `link_env_remove`), compared byte for byte with the pinned rustc's `--print link-args` (`format!("{cmd:?}")`, link.rs:1284)
// after the normalisation of linker_oracle/common.ts. The cases and the fixtures are lane ssa-linker's (linker_oracle/: the
// oracle runs, by hand, `regen.ts`); there a driver stood in for `linker_with_args`, here the port's own function builds the line.
//
// What the test gives `linker_with_args`, because only codegen or other lanes' unported code makes it:
// - `CrateInfo` is the port's own `CrateInfo::new` (base.ts) on the case's crate. It decides the exported and linked symbols,
//   the upstream crates and their order, the dependency formats, the crate sources and the native libraries.
// - `CompiledModules`: the object paths are the oracle's (codegen names them): the CGU object(s) and the allocator module's
//   object. When the oracle's line has no allocator object, the module is still given (for crates that link std), with a
//   made-up path, so `linker_with_args` must leave it out (`needs_allocator_shim_for_linking`): the decision is checked both
//   ways (both prefer-dynamic dylibs leave it out; the others pass it).
// - The session's default sysroot is the oracle's (as in linker_args.oracle.test.ts): the port's own default is a stand-in, and
//   `get_linker` puts it in `PATH` (lane default-sysroot fixes that).
// - `xlane.Object_add_symbol` and `xlane.apple_add_data_and_relocation` record what they are given: the vendored `object`
//   writer has no symbols and no relocations yet (they stop by name), so `symbols.o` is written without them. Only its path is
//   in the line. The recorded symbol names are checked against the port's `CrateInfo.linked_symbols`.
// - `xlane.apple_get_sdk_root` returns the fixture's `SDKROOT` (apple.rs `get_sdk_root` runs `xcrun`, not ported). It is
//   reached only when `SDKROOT` is not set in the environment (`get_apple_sdk_root` reads it first, as upstream). A different
//   `SDKROOT` in the environment can only fail this test.
// - `xlane.create_dylib_metadata_wrapper` returns fixed bytes for the dylib cases (`create_compressed_metadata_file` is not
//   ported): `rmeta.o` is only a path in the line.
// - raw_dylib.ts's `vendor_object.new_elf_stub_writer` returns a writer that writes nothing (the vendored ELF writer has no
//   dynamic sections, and stops by name): the stub file is empty, but its hashed name is in the line (linux-raw-dylib).
//
// The cases are ssa-linker's `CASES` plus ssa-link-b's `EXTRA_CASES` (linker_oracle/common.ts, review ssa-link-b N1 and F1).
// A third test adds target-spec arguments no fixture target has (pre-link objects, late link args) to two linux cases, and
// expects them where upstream's `linker_with_args` puts them. A fourth runs `exec_linker`'s `@`-file fallback.
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import type { EncodedMetadata } from "../../rustc_metadata/rmeta/encoder.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { CrateInfo_new } from "../base.ts";
import { type CompiledModule, CompiledModules } from "../lib.ts";
import type { ArchiveBuilderBuilder } from "./archive.ts";
import { debug_Command } from "./command.ts";
import { exec_linker, link_natively, link_output_kind, self_contained_components, xlane } from "./link.ts";
import { disable_localization } from "./linker.ts";
import { CASES, EXTRA_CASES, HERE, type LinkCase, case_args, normalise, parse_command } from "./linker_oracle/common.ts";
import { type ElfStubWriter, vendor_object } from "./link/raw_dylib.ts";
import { Command } from "./command.ts";
import { LinkerFlavor } from "../../rustc_target/spec/mod.ts";
import type { Session } from "../../rustc_session/session.ts";
import { RmetaLinkCache } from "./rmeta_link.ts";

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

const WORK = join(DATA, "tmp", "linker-args-port", `lwa-${process.env.RUST_TS_AGENT ?? "default"}`);

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

function with_tcx(args: string[], sys: string, f: (tcx: TyCtxt) => void): void {
  const config = config_from_args(args);
  // See the header: the oracle's default sysroot.
  config.opts.sysroot.default_ = sys;
  run_compiler(config, (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      f(tcx);
    });
  });
}

const saved = { ...xlane };
const saved_vendor = { ...vendor_object };
afterEach(() => {
  Object.assign(xlane, saved);
  Object.assign(vendor_object, saved_vendor);
});

/** A `write::elf::Writer` that writes nothing: every reservation and write succeeds (see the header). */
function null_elf_writer(): ElfStubWriter {
  let ids = 0;
  const ok = (): { $: "Ok" } => ({ $: "Ok" });
  return new Proxy({} as ElfStubWriter, {
    get: (_t, name) => (String(name).startsWith("add_") || String(name).startsWith("reserve_") ? () => ids++ : ok),
  });
}

/** The parts of a case that come from the fixture (see the header). */
function inputs(c: LinkCase, want: string) {
  const oracle = parse_command(want);
  // The fixture's paths are normalised: `$WORK` back to this run's work directory (the port's line is normalised again).
  const real = (a: string): string => a.replace("$WORK", WORK);
  const out_dir = join(WORK, "out", c.name);
  const objects = oracle.args.map(real).filter((a) => a.endsWith(".rcgu.o") && a.startsWith(out_dir));
  const cgus = objects.filter((o) => o.includes("-cgu."));
  const others = objects.filter((o) => !o.includes("-cgu."));
  if (others.length > 1) throw new globalThis.Error(`ERROR: ${c.name}: more than one non-CGU object`);
  // An allocator module whenever the crate links std: where the oracle links none, a path that must not appear (see the
  // header). That is what `--crate-type bin,dylib` gives the dylib's link: the module exists for the bin, and the dylib's
  // `needs_allocator_shim_for_linking` leaves it out. A `#![no_std]` crate without `alloc` gets no module from codegen.
  const allocator = others[0] ?? (c.src === "nostd.rs" ? undefined : join(out_dir, "not-linked-allocator.rcgu.o"));
  const compiled_modules = new CompiledModules(
    cgus.map((o, i) => module(`cgu${i}`, o)),
    allocator === undefined ? undefined : { ...module("allocator", allocator), kind: "Allocator" },
  );
  const out = real(oracle.args[oracle.args.indexOf("-o") + 1]!);
  const sdkroot = oracle.env.find(([k]) => k === "SDKROOT")?.[1];
  return { oracle, compiled_modules, out, sdkroot };
}

function module(name: string, object: string): CompiledModule {
  return { name, kind: "Regular", object, global_asm_object: undefined, dwarf_object: undefined, bytecode: undefined, assembly: undefined, llvm_ir: undefined };
}

/** The port's line for one case, and the symbol names `add_linked_symbol_object` was given. */
function port_line(
  c: LinkCase,
  want: string,
  sys: string,
  tmpdir: string,
  adjust?: (sess: Session) => () => void,
): { line: string; added: string[]; linked: string[]; relocs: number } {
  const { compiled_modules, out, sdkroot } = inputs(c, want);

  const added: string[] = [];
  let relocs = 0;
  xlane.Object_add_symbol = (_file, symbol) => {
    added.push(new TextDecoder().decode(symbol.name));
    return (added.length - 1) as ReturnType<typeof xlane.Object_add_symbol>;
  };
  xlane.apple_add_data_and_relocation = () => {
    relocs++;
    return { $: "Ok", _0: null };
  };
  xlane.apple_get_sdk_root = () => sdkroot;
  xlane.create_dylib_metadata_wrapper = () => new Uint8Array([0x72, 0x6d, 0x65, 0x74, 0x61]);
  vendor_object.new_elf_stub_writer = null_elf_writer;
  const abb: ArchiveBuilderBuilder = {
    new_archive_builder: () => {
      throw new globalThis.Error("ERROR: no archive is built without LTO");
    },
  };

  let line: string | undefined;
  let linked: string[] = [];
  with_tcx(case_args(c, WORK, sys), sys, (tcx) => {
    const sess = tcx.sess;
    const crate_info = CrateInfo_new(tcx, sess.opts.cg.target_cpu ?? sess.target.cpu);
    linked = (crate_info.linked_symbols.get(c.crate_type) ?? []).map(([s]) => s);
    // link_natively (link.rs:1232): the linker, flavor and self-contained components it passes in.
    const linker = sess.opts.cg.linker;
    if (linker === undefined) throw new globalThis.Error("ERROR: the case has no -C linker");
    const flavor = sess.target.linker_flavor;
    // The case's own expectation of `link_output_kind` (ssa-linker's common.ts) is checked against the port's function.
    expect(`${c.name}: ${link_output_kind(sess, c.crate_type)}`).toBe(`${c.name}: ${c.output_kind}`);
    const components = self_contained_components(sess, c.crate_type, linker);
    const restore = adjust?.(sess);
    let built: ReturnType<typeof xlane.linker_with_args>;
    try {
      built = xlane.linker_with_args(
      linker,
      flavor,
      sess,
      abb,
      new RmetaLinkCache(),
      c.crate_type,
      tmpdir,
      out,
      compiled_modules,
      crate_info,
      {} as EncodedMetadata,
      components,
      "llvm",
    );
    } finally {
      restore?.();
    }
    const [cmd, tokens] = built;
    expect(tokens).toEqual([]);
    // link_natively (link.rs:1257-1279)
    disable_localization(cmd);
    for (const [k, v] of sess.target.link_env) cmd.env(k, v);
    for (const k of sess.target.link_env_remove) cmd.env_remove(k);
    line = normalise(debug_Command(cmd), WORK, sys);
  });
  if (line === undefined) throw new globalThis.Error(`ERROR: ${c.name}: no line`);
  return { line, added, linked, relocs };
}

test.skipIf(SKIP)("linker_with_args builds the oracle's --print link-args line for each case", () => {
  const sys = sysroot();
  rmSync(WORK, { recursive: true, force: true });
  const results: string[] = [];
  for (const c of [...CASES, ...EXTRA_CASES]) {
    const want = readFileSync(join(HERE, "oracle", `${c.name}.args`), "utf8").trim();
    if (want === "") {
      // A staticlib is archived, not linked (link_staticlib): the oracle prints no line.
      expect(c.crate_type).toBe("StaticLib");
      continue;
    }
    const tmpdir = join(WORK, "out", c.name, "rustcPORT00");
    mkdirSync(tmpdir, { recursive: true });
    const { line, added, linked, relocs } = port_line(c, want, sys, tmpdir);
    expect(`${c.name}: ${line}`).toBe(`${c.name}: ${want}`);
    // `symbols.o` gets one undefined symbol per linked symbol, and on Mach-O one relocation each (ld64).
    expect(added).toEqual(linked);
    expect(linked.length).toBeGreaterThan(0);
    expect(relocs).toBe(c.target === "aarch64-apple-darwin" ? linked.length : 0);
    // The exported-symbols list the port's linker wrote is ssa-linker's test's subject; here only that the line names it.
    results.push(c.name);
  }
  expect(results.length).toBe(CASES.length + EXTRA_CASES.length - 1);
}, 120_000);

// `link_natively` (link.rs:1232) end to end, on one case per target: `linker_and_flavor`, `self_contained_components`,
// `linker_with_args`, the environment, `--print link-args` to a file (link.rs:1281) and `exec_linker` (link.rs:2105) running
// the linker. The linker is a script named `cc` that writes the arguments it got, one per line, and exits 0. The printed line
// must be the oracle's, and the arguments the linker got must be the oracle's arguments.
test.skipIf(SKIP)("link_natively prints the oracle's link-args and runs the linker with its arguments", () => {
  const sys = sysroot();
  rmSync(WORK, { recursive: true, force: true });
  const argv_file = join(WORK, "argv");
  mkdirSync(join(WORK, "fake"), { recursive: true });
  writeFileSync(join(WORK, "fake", "cc"), `#!/bin/sh\nprintf '%s\\n' "$@" > '${argv_file}'\nexit 0\n`);
  chmodSync(join(WORK, "fake", "cc"), 0o755);
  for (const name of ["host-bin", "linux-bin"]) {
    const c = CASES.find((x) => x.name === name)!;
    const want = readFileSync(join(HERE, "oracle", `${c.name}.args`), "utf8").trim();
    const { oracle, compiled_modules, out, sdkroot } = inputs(c, want);
    const tmpdir = join(WORK, "out", c.name, "rustcPORT00");
    mkdirSync(tmpdir, { recursive: true });
    xlane.Object_add_symbol = (_file, _symbol) => 0 as ReturnType<typeof xlane.Object_add_symbol>;
    xlane.apple_add_data_and_relocation = () => ({ $: "Ok", _0: null });
    xlane.apple_get_sdk_root = () => sdkroot;
    const printed = join(WORK, `${c.name}.link-args`);
    rmSync(argv_file, { force: true });
    with_tcx(["--print", `link-args=${printed}`, ...case_args(c, WORK, sys)], sys, (tcx) => {
      const crate_info = CrateInfo_new(tcx, tcx.sess.opts.cg.target_cpu ?? tcx.sess.target.cpu);
      const abb: ArchiveBuilderBuilder = {
        new_archive_builder: () => {
          throw new globalThis.Error("ERROR: no archive is built without LTO");
        },
      };
      link_natively(tcx.sess, abb, new RmetaLinkCache(), c.crate_type, out, compiled_modules, crate_info, {} as EncodedMetadata, tmpdir, "llvm");
    });
    expect(`${c.name}: ${normalise(readFileSync(printed, "utf8").trim(), WORK, sys)}`).toBe(`${c.name}: ${want}`);
    expect(existsSync(argv_file)).toBe(true);
    const got = readFileSync(argv_file, "utf8").split("\n").slice(0, -1).map((a) => normalise(a, WORK, sys));
    expect(got).toEqual(oracle.args);
  }
}, 120_000);

// Target-spec arguments no fixture target has (review ssa-link-b N1): pre-link objects (link.rs:2357, after the pre-link args,
// :2928-2933) and late link args (link.rs:2436, after `reset_per_library_state`, before the order-independent options,
// :3120-3125). They are put on the session's target for the call, then restored. The expected line is the oracle's with
// them inserted where upstream's code puts them: the object after `-m64` (the target's pre-link arg), and the late args after
// the raw-dylibs `-L` pair, `_static` for a bin (no dynamic crate) and `_dynamic` for a dylib, each before the plain ones.
test.skipIf(SKIP)("linker_with_args puts pre-link objects and late link args where upstream does", () => {
  const sys = sysroot();
  rmSync(WORK, { recursive: true, force: true });
  for (const [name, late] of [
    ["linux-bin", "LATE-STATIC"],
    ["linux-dylib", "LATE-DYNAMIC"],
  ] as const) {
    const c = CASES.find((x) => x.name === name)!;
    const want = readFileSync(join(HERE, "oracle", `${c.name}.args`), "utf8").trim();
    const tmpdir = join(WORK, "out", c.name, "rustcPORT00");
    mkdirSync(tmpdir, { recursive: true });
    const adjust = (sess: Session): (() => void) => {
      const o = sess.target.options;
      const f = o.linker_flavor;
      const before = [o.pre_link_objects, o.late_link_args, o.late_link_args_static, o.late_link_args_dynamic] as const;
      o.pre_link_objects = new Map([[c.output_kind, ["crt-ssa-link-b.o"]]]);
      o.late_link_args = new Map([[f, ["LATE"]]]);
      o.late_link_args_static = new Map([[f, ["LATE-STATIC"]]]);
      o.late_link_args_dynamic = new Map([[f, ["LATE-DYNAMIC"]]]);
      return () => {
        [o.pre_link_objects, o.late_link_args, o.late_link_args_static, o.late_link_args_dynamic] = before;
      };
    };
    const { line } = port_line(c, want, sys, tmpdir, adjust);
    const expected = want.replace('"-m64" ', '"-m64" "crt-ssa-link-b.o" ').replace('"-Wl,--eh-frame-hdr"', `"${late}" "LATE" "-Wl,--eh-frame-hdr"`);
    expect(expected).not.toBe(want);
    expect(`${c.name}: ${line}`).toBe(`${c.name}: ${expected}`);
  }
}, 120_000);

// `exec_linker`'s `@`-file fallback (link.rs:2105-2170, review ssa-link-b N5), both ways in: a command the estimate lets
// through that the OS refuses with E2BIG (the estimate counts no inherited environment), and one over the estimate, which
// skips the first spawn. The linker is a script that copies its `@`-file, or records that it got the arguments directly. The
// file must hold each argument with POSIX escaping (`\` and space get a backslash, link.rs:2244-2258) and a newline.
test("exec_linker falls back to an @-file, on E2BIG and over the estimate", () => {
  const dir = join(WORK, "atfile");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    const capture = join(dir, "capture");
    const cc = join(dir, "cc");
    writeFileSync(cc, `#!/bin/sh\ncase "$1" in @*) cp "\${1#@}" '${capture}'; echo "$#" > '${capture}.argc';; *) echo DIRECT > '${capture}';; esac\nexit 0\n`);
    chmodSync(cc, 0o755);
    const sess = { target: { options: { is_like_msvc: false } } } as unknown as Session;
    const flavor = LinkerFlavor.Gnu("Yes", "No");
    const make = (n: number): Command => Command.new(cc).args(["a b\\c", "x".repeat(n)]);
    // The largest filler the estimate lets through (command.rs:139).
    let lo = 0;
    let hi = 4 << 20;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (make(mid).very_likely_to_exceed_some_spawn_limit()) hi = mid - 1;
      else lo = mid;
    }
    for (const [label, n, over] of [
      ["E2BIG", lo, false],
      ["over the estimate", lo + 4096, true],
    ] as const) {
      rmSync(capture, { force: true });
      const cmd = make(n);
      expect(`${label}: ${cmd.very_likely_to_exceed_some_spawn_limit()}`).toBe(`${label}: ${over}`);
      const r = exec_linker(sess, cmd, join(dir, "out"), flavor, dir);
      expect(r.$).toBe("Ok");
      expect(readFileSync(join(dir, "linker-arguments"), "utf8")).toBe(`a\\ b\\\\c\n${"x".repeat(n)}\n`);
      expect(`${label}: ${readFileSync(capture, "utf8").length}`).toBe(`${label}: ${n + 9}`);
      expect(`${label}: ${readFileSync(`${capture}.argc`, "utf8").trim()}`).toBe(`${label}: 1`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
