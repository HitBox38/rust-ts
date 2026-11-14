// `each_linked_rlib` and `ignored_for_lto` (back/link.rs:495, :1839): `CrateInfo::new` under `-C lto`. Under the Miri
// suites only the success path runs; the error paths are checked here against upstream's match arms.
import { expect, test } from "bun:test";
import { CodegenBackend_provided } from "../../rustc_interface/stand_ins.ts";
import type { CrateNum } from "../../rustc_span/def_id.ts";
import type { Symbol } from "../../rustc_span/symbol.ts";
import { Ok } from "../../std/result.ts";
import type { Linkage } from "../../rustc_middle/middle/dependency_format.ts";
import type { CrateType } from "../../rustc_structures/crate_type.ts";
import type { Session } from "../../rustc_session/session.ts";
import type { CrateInfo } from "../lib.ts";
import { each_linked_rlib, escape_string, ignored_for_lto, link_rlib, link_staticlib, linker_and_flavor, preserve_objects_for_their_debuginfo, print_native_static_libs, xlane } from "./link.ts";
import type { RmetaLinkCache } from "./rmeta_link.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinkerFeatures, LinkerFlavor, LinkerFlavorCli, Target } from "../../rustc_target/spec/mod.ts";
import { TargetTuple } from "../../rustc_target/spec/tuple.ts";
import { LinkerFeaturesCli, OutFileName } from "../../rustc_session/config.ts";
import type { MaybeTempDir } from "../../rustc_metadata/fs.ts";
import type { EncodedMetadata } from "../../rustc_metadata/lib.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Symbol as Sym } from "../../rustc_span/symbol.ts";
import { NativeLibKind } from "../../rustc_structures/native_lib_kind.gen.ts";
import { path_file_name } from "../../std/path.ts";
import type { ArchiveBuilder } from "./archive.ts";
import type { CompiledModules, NativeLib } from "../lib.ts";

const CRATE_A = 1 as CrateNum;
const CRATE_B = 2 as CrateNum;
const NAME = 7 as Symbol;

function info(formats: [CrateType, Linkage[]][], sources: Map<CrateNum, { rlib?: string; rmeta?: string }>, used: CrateNum[] = [CRATE_A, CRATE_B]): CrateInfo {
  return {
    dependency_formats: new Map(formats),
    used_crates: used,
    crate_name: new Map(used.map((c) => [c, NAME])),
    used_crate_source: sources,
    compiler_builtins: CRATE_B,
    is_no_builtins: new Set(),
  } as unknown as CrateInfo;
}
const RLIBS = new Map([
  [CRATE_A, { rlib: "a.rlib" }],
  [CRATE_B, { rlib: "b.rlib" }],
]);

test("each_linked_rlib visits the statically linked crates in used_crates order", () => {
  const seen: [CrateNum, string][] = [];
  const r = each_linked_rlib(info([["Executable", ["NotLinked", "Static", "Static"]]], RLIBS), undefined, (c, p) => seen.push([c, p]));
  expect(r).toEqual(Ok(null));
  expect(seen).toEqual([
    [CRATE_A, "a.rlib"],
    [CRATE_B, "b.rlib"],
  ]);
});

test("each_linked_rlib skips NotLinked, Dynamic and IncludedFromDylib", () => {
  for (const linkage of ["NotLinked", "Dynamic", "IncludedFromDylib"] as const) {
    const seen: CrateNum[] = [];
    each_linked_rlib(info([["Executable", ["NotLinked", linkage, "Static"]]], RLIBS), undefined, (c) => seen.push(c));
    expect(seen).toEqual([CRATE_B]);
  }
});

test("each_linked_rlib errors", () => {
  const nop = () => {};
  expect(each_linked_rlib(info([], RLIBS), undefined, nop)).toEqual({ $: "Err", _0: { $: "MissingFormat" } });
  expect(each_linked_rlib(info([["Executable", []]], RLIBS), "Dylib", nop)).toEqual({ $: "Err", _0: { $: "MissingFormat" } });
  // `fmts.get(cnum)` past the end of the list.
  expect(each_linked_rlib(info([["Executable", ["NotLinked"]]], RLIBS), undefined, nop)).toEqual({ $: "Err", _0: { $: "MissingFormat" } });
  const list = ["NotLinked", "Static", "Static"] as Linkage[];
  expect(each_linked_rlib(info([["Executable", list]], new Map([[CRATE_A, { rmeta: "a.rmeta" }]]), [CRATE_A]), undefined, nop)).toEqual({
    $: "Err",
    _0: { $: "OnlyRmetaFound", crate_name: NAME },
  });
  expect(each_linked_rlib(info([["Executable", list]], new Map([[CRATE_A, {}]]), [CRATE_A]), undefined, nop)).toEqual({
    $: "Err",
    _0: { $: "NotFound", crate_name: NAME },
  });
  expect(each_linked_rlib(info([["Executable", ["Static"]], ["Rlib", ["Dynamic"]]], RLIBS), undefined, nop)).toEqual({
    $: "Err",
    _0: { $: "IncompatibleDependencyFormats", ty1: "Executable", ty2: "Rlib", list1: "[Static]", list2: "[Dynamic]" },
  });
  // A crate type picks its own list, so the other one is not compared.
  expect(each_linked_rlib(info([["Executable", list], ["Rlib", ["Dynamic"]]], RLIBS), "Executable", nop)).toEqual(Ok(null));
});

test("ignored_for_lto", () => {
  const i = { compiler_builtins: CRATE_B, is_no_builtins: new Set([CRATE_A]) } as unknown as CrateInfo;
  const sess = (no_builtins: boolean) => ({ target: { options: { no_builtins } } }) as unknown as Session;
  expect(ignored_for_lto(sess(false), i, CRATE_A)).toBe(true);
  expect(ignored_for_lto(sess(false), i, CRATE_B)).toBe(true);
  expect(ignored_for_lto(sess(false), i, 3 as CrateNum)).toBe(false);
  expect(ignored_for_lto(sess(true), i, CRATE_A)).toBe(false);
});

test("the provided `init` is `CodegenBackendInit::default()` (`thin_lto_supported: bool = true`)", () => {
  const init = CodegenBackend_provided.init(undefined as never, undefined as never);
  expect(init.thin_lto_supported).toBe(true);
});

// ---- lane ssa-link-a: link.rs :1-2104 ------------------------------------------------------------------------------
// `linker_and_flavor` / `infer_from` and `print_native_static_libs` are checked against the pinned rustc's output, kept in
// link_oracle/oracle.json (regenerated by hand with link_oracle/regen.ts); the rest against upstream's code, cited by line.

const ORACLE = JSON.parse(readFileSync(join(import.meta.dir, "link_oracle", "oracle.json"), "utf8")) as {
  native_static_libs: Record<string, string>;
  link_args: { tuple: string; id: string; flags: string[]; program: string; wl: boolean; fuse_lld: boolean }[];
};

function target(tuple: string): Target {
  const r = Target.search(TargetTuple.from_tuple(tuple), "", false);
  if (r.$ === "Err") throw new Error(r._0);
  return r._0[0];
}

/** The `-C` options of a fixture case, as the option parser would set them (rustc_session options.rs). */
function cg_of(flags: readonly string[]): { linker: string | undefined; linker_flavor: LinkerFlavorCli | undefined; linker_features: LinkerFeaturesCli } {
  const cg = { linker: undefined as string | undefined, linker_flavor: undefined as LinkerFlavorCli | undefined, linker_features: LinkerFeaturesCli.default() };
  for (const flag of flags) {
    if (flag.startsWith("-Clinker=")) cg.linker = flag.slice("-Clinker=".length);
    else if (flag.startsWith("-Clinker-flavor=")) {
      const f = LinkerFlavorCli.from_str(flag.slice("-Clinker-flavor=".length));
      if (f.$ === "Err") throw new Error(f._0);
      cg.linker_flavor = f._0;
    } else if (flag === "-Clinker-features=+lld") cg.linker_features = new LinkerFeaturesCli(LinkerFeatures.LLD, LinkerFeatures.empty());
    else if (flag === "-Clinker-features=-lld") cg.linker_features = new LinkerFeaturesCli(LinkerFeatures.empty(), LinkerFeatures.LLD);
    else if (flag !== "-Zunstable-options") throw new Error(`unmapped fixture flag ${flag}`);
  }
  return cg;
}

const fatal_dcx = () => ({
  emit_fatal: () => {
    throw new Error("emit_fatal");
  },
});

test("linker_and_flavor picks the oracle's linker program and flavor (link.rs:1848)", () => {
  expect(ORACLE.link_args.length).toBe(16);
  for (const c of ORACLE.link_args) {
    const sess = { target: target(c.tuple), opts: { cg: cg_of(c.flags) }, dcx: fatal_dcx } as unknown as Session;
    const [linker, flavor] = linker_and_flavor(sess);
    const at = `${c.tuple} ${c.id}`;
    expect(`${at}: ${linker}`).toBe(`${at}: ${c.program}`);
    // A cc-wrapped linker gets `-Wl,` arguments (linker.rs `link_args`, `is_cc`), and cc driving lld gets `-fuse-ld=lld`
    // (link.rs `add_lld_args`, which ssa-link-b ports).
    expect(flavor.$ === "Gnu" || flavor.$ === "Darwin").toBe(true);
    const f = flavor as { _0: "Yes" | "No"; _1: "Yes" | "No" };
    expect(`${at}: cc=${f._0 === "Yes"}`).toBe(`${at}: cc=${c.wl}`);
    expect(`${at}: cc+lld=${f._0 === "Yes" && f._1 === "Yes"}`).toBe(`${at}: cc+lld=${c.fuse_lld}`);
  }
});

test("infer_from: the default linker of each flavor (link.rs:1858-1893)", () => {
  // Only the flavor is known (`-C linker-flavor`, no `-C linker`, and a target with no `linker`): the match arms in order.
  const cases: [string, string][] = [
    ["gnu-cc", "cc"],
    ["gnu-lld-cc", "cc"],
    ["gnu-lld", "lld"],
    ["gnu", "ld"],
    ["msvc-lld", "lld"],
    ["msvc", "link.exe"],
    ["wasm-lld", "lld"],
    ["wasm-lld-cc", "cc"],
    ["unix", "ld"],
    ["unix-cc", "cc"],
    ["em-cc", "emcc"],
    ["bpf", "bpf-linker"],
    ["llbc", "llvm-bitcode-linker"],
  ];
  for (const [cli, expected] of cases) {
    const f = LinkerFlavorCli.from_str(cli);
    if (f.$ === "Err") throw new Error(f._0);
    // A target whose own flavor has the same principal flavor, so `with_cli_hints` keeps the CLI's (spec/mod.rs:338).
    const target_flavor = f._0.$ === "Llbc" ? LinkerFlavor.Gnu("Yes", "No") : LinkerFlavor.from_cli_json(f._0, "Ld", true);
    const sess = {
      target: { options: { linker: undefined, linker_flavor: target_flavor } },
      opts: { cg: { linker: undefined, linker_flavor: f._0, linker_features: LinkerFeaturesCli.default() } },
      dcx: fatal_dcx,
    } as unknown as Session;
    expect(`${cli}: ${linker_and_flavor(sess)[0]}`).toBe(`${cli}: ${expected}`);
  }
  // Neither the CLI nor the target names a linker or a flavor that is not the target's: the target's `linker` with its
  // flavor (the second `infer_from`, link.rs:1941).
  const sess = {
    target: { options: { linker: "rust-lld", linker_flavor: LinkerFlavor.Gnu("No", "Yes") } },
    opts: { cg: { linker: undefined, linker_flavor: undefined, linker_features: LinkerFeaturesCli.default() } },
    dcx: fatal_dcx,
  } as unknown as Session;
  expect(linker_and_flavor(sess)).toEqual(["rust-lld", LinkerFlavor.Gnu("No", "Yes")]);
});

test("print_native_static_libs matches the oracle's native-static-libs note (link.rs:1987)", () => {
  create_default_session_globals_then(() => {
    // nsl.rs's `#[link]` attributes, in order, as rustc_metadata's native_libs.rs collects them.
    const lib = (name: string, kind: NativeLib["kind"], verbatim = false) => ({ name: Sym.intern(name), kind, verbatim, cfg: undefined }) as unknown as NativeLib;
    const libs = [
      lib("a", NativeLibKind.Unspecified),
      lib("a", NativeLibKind.Unspecified),
      lib("b", { $: "Dylib", as_needed: undefined }),
      lib("c", { $: "Static", bundle: false, whole_archive: undefined, export_symbols: undefined }),
      lib("d.so", { $: "Dylib", as_needed: undefined }, true),
      lib("-Wl,--foo", NativeLibKind.LinkArg),
      lib("a", NativeLibKind.Unspecified),
    ];
    const saved = xlane.relevant_lib;
    xlane.relevant_lib = (_sess, l) => l.cfg === undefined; // link.rs:3773: no `cfg` → relevant
    try {
      for (const [tuple, expected] of Object.entries(ORACLE.native_static_libs)) {
        const notes: string[] = [];
        let emitted = 0;
        const sess = {
          target: target(tuple),
          dcx: () => ({ emit_note: () => emitted++, note: (msg: string) => notes.push(msg) }),
        } as unknown as Session;
        print_native_static_libs(sess, OutFileName.Stdout, libs, []);
        expect(emitted).toBe(1);
        expect(notes).toEqual([`native-static-libs: ${expected}`]);
      }
      // Rust dylibs (link.rs:2031-2066): `-L <dir>` and `-l<stem without lib>`, after the native libraries.
      const notes: string[] = [];
      const sess = { target: target("x86_64-unknown-linux-gnu"), dcx: () => ({ emit_note: () => {}, note: (m: string) => notes.push(m) }) } as unknown as Session;
      print_native_static_libs(sess, OutFileName.Stdout, [libs[0]!], ["/x/libstd-123.so", "/y/foo.so"]);
      expect(notes).toEqual(["native-static-libs: -la -L /x -lstd-123 -L /y -lfoo"]);
    } finally {
      xlane.relevant_lib = saved;
    }
  });
});

test("preserve_objects_for_their_debuginfo (link.rs:1958)", () => {
  const sess = (debuginfo: string, split: string, can_split_dwarf: boolean, kind: string) =>
    ({
      opts: { debuginfo, unstable_opts: { split_dwarf_kind: kind } },
      split_debuginfo: () => split,
      target_can_use_split_dwarf: () => can_split_dwarf,
    }) as unknown as Session;
  expect(preserve_objects_for_their_debuginfo(sess("None", "Unpacked", true, "Split"))).toEqual([false, false]);
  expect(preserve_objects_for_their_debuginfo(sess("Full", "Off", true, "Split"))).toEqual([false, false]);
  expect(preserve_objects_for_their_debuginfo(sess("Full", "Packed", true, "Single"))).toEqual([false, false]);
  expect(preserve_objects_for_their_debuginfo(sess("Full", "Unpacked", false, "Split"))).toEqual([true, false]);
  expect(preserve_objects_for_their_debuginfo(sess("Full", "Unpacked", true, "Single"))).toEqual([true, false]);
  expect(preserve_objects_for_their_debuginfo(sess("Full", "Unpacked", true, "Split"))).toEqual([false, true]);
});

test("link_rlib's members, in order (link.rs:545)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rust-ts-link-rlib-"));
  try {
    for (const flavor of ["Normal", "StaticlibBase"] as const) {
      const added: [string, string][] = [];
      const ab: ArchiveBuilder = {
        add_file: (path, kind) => void added.push([path_file_name(path)!, kind]),
        add_archive: () => {
          throw new Error("add_archive");
        },
        build: () => true,
      };
      const sess = {
        target: target("x86_64-unknown-linux-gnu"),
        internal_target_features: new Set(),
        unstable_target_features: new Set(),
        opts: { unstable_opts: { packed_bundled_libs: false } },
        dcx: fatal_dcx,
      } as unknown as Session;
      const module = (name: string, dwarf = false) => ({ name, object: `/o/${name}.o`, global_asm_object: undefined, dwarf_object: dwarf ? `/o/${name}.dwo` : undefined });
      const compiled_modules = {
        modules: [module("a"), { ...module("b", true), global_asm_object: "/o/b.asm.o" }],
        allocator_module: module("alloc"),
      } as unknown as CompiledModules;
      const crate_info = { used_libraries: [], crate_types: ["Rlib"] } as unknown as CrateInfo;
      const metadata = { stub_or_full: () => new Uint8Array([1, 2, 3]) } as unknown as EncodedMetadata;
      const tmp = { as_ref: () => dir } as unknown as MaybeTempDir;
      link_rlib(sess, { new_archive_builder: () => ab }, compiled_modules, crate_info, metadata, flavor, tmp);
      if (flavor === "Normal") {
        // ELF wraps the metadata in an object (`MetadataPosition::First`): metadata, then the rmeta-link member (:584-597),
        // then each module's object, global asm object and dwarf object (:606-618).
        expect(added).toEqual([
          ["lib.rmeta", "Other"],
          ["lib.rmeta-link", "Other"],
          ["a.o", "RustObj"],
          ["b.o", "RustObj"],
          ["b.asm.o", "RustObj"],
          ["b.dwo", "Other"],
        ]);
      } else {
        // A staticlib's base: no metadata, the allocator module's objects after the modules' (:620-633).
        expect(added).toEqual([
          ["a.o", "RustObj"],
          ["b.o", "RustObj"],
          ["b.asm.o", "RustObj"],
          ["b.dwo", "Other"],
          ["alloc.o", "RustObj"],
        ]);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("escape_string (link.rs:1629)", () => {
  expect(escape_string(new TextEncoder().encode("ok\n"))).toBe("ok\n");
  expect(escape_string(new Uint8Array([0x61, 0xff, 0x0a, 0x22]))).toBe('Non-UTF-8 output: a\\xff\\n\\"');
});

// ---- lane ssa-link-b: review ssa-link-a N2 ------------------------------------------------------------------------------

test("link_staticlib: the base archive, the upstream rlib's member filter, the build and the native-static-libs note (link.rs:754)", () => {
  create_default_session_globals_then(() => {
    const dir = mkdtempSync(join(tmpdir(), "rust-ts-link-staticlib-"));
    const saved = { ...xlane };
    try {
      const added: [string, string][] = [];
      const archives: [string, string, boolean[]][] = [];
      const built: [string, unknown][] = [];
      const ab: ArchiveBuilder = {
        add_file: (path, kind) => void added.push([path_file_name(path)!, kind]),
        add_archive: (path, kind) => {
          // The skip filter on each kind of member an rlib holds: metadata, the rmeta-link member, a Rust object, another file.
          const filter = kind.$ === "Rlib" ? ([["lib.rmeta", "Other"], ["lib.rmeta-link", "Other"], ["a.a-cgu.0.rcgu.o", "RustObj"], ["x.o", "Other"]] as const).map(([n, k]) => kind._1(n, k)) : [];
          archives.push([path, kind.$, filter]);
          return Ok(null);
        },
        build: (output, symbols) => {
          built.push([output, symbols]);
          return true;
        },
      };
      const notes: string[] = [];
      const sess = {
        target: target("x86_64-unknown-linux-gnu"),
        internal_target_features: new Set(),
        unstable_target_features: new Set(),
        lto: () => "No",
        opts: {
          unstable_opts: { packed_bundled_libs: false, staticlib_hide_internal_symbols: false, staticlib_rename_internal_symbols: false },
          prints: [{ kind: "NativeStaticLibs", out: OutFileName.Stdout }],
        },
        dcx: () => ({ ...fatal_dcx(), emit_note: () => {}, note: (m: string) => notes.push(m) }),
      } as unknown as Session;
      const lib = { name: Sym.intern("x"), kind: { $: "Dylib", as_needed: undefined }, verbatim: false, cfg: undefined } as unknown as NativeLib;
      const crate_info = {
        used_libraries: [],
        crate_types: ["StaticLib"],
        dependency_formats: new Map([["StaticLib", ["NotLinked", "Static"]]]),
        used_crates: [CRATE_A],
        crate_name: new Map([[CRATE_A, NAME]]),
        used_crate_source: new Map([[CRATE_A, { rlib: "/r/liba.rlib" }]]),
        native_libraries: new Map([[CRATE_A, [lib]]]),
        compiler_builtins: undefined,
        is_no_builtins: new Set(),
        exported_symbols: new Map(),
      } as unknown as CrateInfo;
      const compiled_modules = { modules: [{ name: "a", object: "/o/a.o", global_asm_object: undefined, dwarf_object: undefined }], allocator_module: undefined } as unknown as CompiledModules;
      const cache = { native_lib_filenames: () => [undefined] } as unknown as RmetaLinkCache;
      xlane.extract_bundled_libs = () => Ok(null);
      xlane.relevant_lib = () => true;
      link_staticlib(sess, { new_archive_builder: () => ab }, cache, compiled_modules, crate_info, {} as EncodedMetadata, join(dir, "liba.a"), { as_ref: () => dir } as unknown as MaybeTempDir);
      // `RlibFlavor::StaticlibBase` (:771): the modules' objects, no metadata and no rmeta-link member.
      expect(added).toEqual([["a.o", "RustObj"]]);
      // The upstream rlib, filtered (:799-819): metadata and rmeta-link are skipped, objects kept (no LTO, nothing bundled).
      expect(archives).toEqual([["/r/liba.rlib", "Rlib", [true, true, false, false]]]);
      // `ab.build(out_filename, None)` without hiding or renaming (:878).
      expect(built).toEqual([[join(dir, "liba.a"), undefined]]);
      // `--print native-static-libs` (:905-909): the upstream crate's dylib.
      expect(notes).toEqual(["native-static-libs: -lx"]);
    } finally {
      Object.assign(xlane, saved);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
