// Oracle tests for the crate-metadata header path (lane rmeta-contract), on every `.rlib` / `.rmeta` of the oracle
// sysroot's x86_64-unknown-linux-gnu `lib` dir:
//   - rmetaroot (rustc-dev probe, tools/probes/rmetaroot): the header (version, root / unhashed positions, crate
//     hash), the `CrateHeader`, every `CrateRoot` scalar and every lazy array / value / table layout, and the
//     `CrateRootUnhashed`; the port prints the same lines from `MetadataBlob::{get_header, get_root, ..}`.
//   - `rustc -Zls=root <file>`: the oracle's `list_file_metadata`; the port runs locator.ts's
//     `list_file_metadata` (through object-read's `DefaultMetadataLoader`). The sysroot rlibs hold metadata stubs
//     (`-Zembed-metadata=no`): both panic with "MemDecoder exhausted" decoding their root.
//
// Without the probe the rmetaroot test is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { DefaultMetadataLoader } from "../../rustc_codegen_ssa/back/metadata.ts";
import { CFG_VERSION } from "../../rustc_interface/util.ts";
import { decode_String } from "../../rustc_serialize/serialize.ts";
import { debug_StableCrateId } from "../../rustc_span/def_id.ts";
import { display_Edition } from "../../rustc_span/edition.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { spec } from "../../rustc_target/lib.ts";
import { debug_option, debug_str, debug_vec, PLAIN } from "../../std/fmt.ts";
import { locator } from "../lib.ts";
import { MetadataBlob } from "./decoder.ts";
import { type LazyArray, type LazyTable, LazyValue, VERSION_OFFSET } from "./mod.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RMETAROOT = join(DATA, "target", "probes", "release", "rmetaroot");
const SKIP = !existsSync(RMETAROOT) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: rmetaroot probe not built (bun scripts/probes.ts build rmetaroot); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const TUPLE = "x86_64-unknown-linux-gnu";

let setup_: { sysroot: string; files: string[] } | undefined;
function setup(): { sysroot: string; files: string[] } {
  if (setup_ !== undefined) return setup_;
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const sysroot = oracle.oracleSysroot();
  const dir = join(sysroot, "lib", "rustlib", TUPLE, "lib");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".rlib") || f.endsWith(".rmeta"))
    .sort()
    .map((f) => join(dir, f));
  return (setup_ = { sysroot, files });
}

function target(sysroot: string): spec.Target {
  const r = spec.Target.search(spec.TargetTuple.from_tuple(TUPLE), sysroot, false);
  if (r.$ === "Err") throw new globalThis.Error(r._0);
  return r._0[0];
}

/** The raw `u64` at `off` (a stub's unhashed position is 0, which `unhashed_pos()` would reject). */
function raw_u64(b: Uint8Array, off: number): bigint {
  return new DataView(b.buffer, b.byteOffset + off, 8).getBigUint64(0, true);
}

/** The port's version of the rmetaroot probe output. */
function port_rmetaroot(sysroot: string, files: readonly string[]): string {
  const t = target(sysroot);
  const lines: string[] = [];
  const p = (s: string) => lines.push(`  ${s}`);
  create_default_session_globals_then(() => {
    for (const f of files) {
      lines.push(`file ${basename(f)}`);
      let bytes: Uint8Array;
      if (f.endsWith(".rmeta")) {
        bytes = new Uint8Array(readFileSync(f));
      } else {
        const r = DefaultMetadataLoader.get_rlib_metadata(t, f);
        if (r.$ === "Err") {
          p(`err ${r._0}`);
          continue;
        }
        bytes = r._0;
      }
      const nb = MetadataBlob.new(bytes);
      if (nb.$ === "Err") throw new globalThis.Error(`MetadataBlob::new failed for ${f}`);
      const blob = nb._0;
      const version = LazyValue.from_position<string>(VERSION_OFFSET).decode(blob, decode_String);
      p(`header version=${debug_str(version)} root_pos=${blob.root_pos()} unhashed_pos=${raw_u64(bytes, 16)} hash=${blob.get_crate_hash()}`);
      const h = blob.get_header();
      p(`crate_header triple=${spec.TargetTuple.tuple(h.triple)} name=${Symbol.as_str(h.name)} is_proc_macro_crate=${h.is_proc_macro_crate} is_stub=${h.is_stub}`);
      if (h.is_stub) continue;
      const root = blob.get_root();
      const array = (n: string, a: LazyArray<unknown>) => p(`array ${n} pos=${a.position} len=${a.num_elems}`);
      const table = (n: string, a: LazyTable<unknown, unknown, unknown>) => p(`table ${n} pos=${a.position} width=${a.width} len=${a.len}`);
      p(`stable_crate_id ${debug_StableCrateId(root.stable_crate_id(), PLAIN)}`);
      p(`required_panic_strategy ${debug_option(root.required_panic_strategy, PLAIN, (v) => v)}`);
      p(`panic_in_drop_strategy ${root.panic_in_drop_strategy}`);
      p(`edition ${display_Edition(root.edition)}`);
      p(`has_global_allocator ${root.has_global_allocator}`);
      p(`has_alloc_error_handler ${root.has_alloc_error_handler}`);
      p(`has_panic_handler ${root.has_panic_handler}`);
      p(`has_default_lib_allocator ${root.has_default_lib_allocator}`);
      for (const n of [
        "externally_implementable_items",
        "crate_deps",
        "dylib_dependency_formats",
        "lib_features",
        "stability_implications",
        "lang_items",
        "lang_items_missing",
        "stripped_cfg_items",
        "diagnostic_items",
        "canonical_symbols",
        "fake_doc_items",
        "native_libraries",
        "foreign_modules",
        "traits",
        "impls",
        "incoherent_impls",
        "interpret_alloc_index",
      ] as const) {
        array(n, root[n] as LazyArray<unknown>);
      }
      if (root.proc_macro_data !== undefined) {
        p("proc_macro_data Some");
        continue;
      }
      p("proc_macro_data None");
      for (const [n, tb] of Object.entries(root.tables)) table(n, tb as LazyTable<unknown, unknown, unknown>);
      array("debugger_visualizers", root.debugger_visualizers);
      array("exportable_items", root.exportable_items);
      array("stable_order_of_exportable_impls", root.stable_order_of_exportable_impls);
      array("exported_non_generic_symbols", root.exported_non_generic_symbols);
      array("exported_generic_symbols", root.exported_generic_symbols);
      table("syntax_contexts", root.syntax_contexts);
      table("expn_data", root.expn_data);
      table("expn_hashes", root.expn_hashes);
      p(`value def_path_hash_map pos=${root.def_path_hash_map.position}`);
      table("source_map", root.source_map);
      array("target_modifiers", root.target_modifiers);
      array("denied_partial_mitigations", root.denied_partial_mitigations);
      for (const n of ["compiler_builtins", "needs_allocator", "needs_panic_runtime", "no_builtins", "panic_runtime", "profiler_runtime"] as const) {
        p(`${n} ${root[n]}`);
      }
      p(`symbol_mangling_version ${root.symbol_mangling_version}`);
      p(`specialization_enabled_in ${root.specialization_enabled_in}`);
      const u = blob.get_root_unhashed();
      p(`unhashed extra_filename=${debug_str(u.extra_filename)} dep_extra_filenames=${debug_vec(u.dep_extra_filenames, PLAIN, (s) => debug_str(s))}`);
    }
  });
  return `${lines.join("\n")}\n`;
}

test.skipIf(SKIP)("rmetaroot: header, CrateRoot scalars and lazy layouts match the oracle", () => {
  const { sysroot, files } = setup();
  const r = Bun.spawnSync([RMETAROOT, TUPLE, sysroot, ...files], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new globalThis.Error(`rmetaroot failed: ${r.stderr.toString()}`);
  const want = r.stdout.toString();
  const got = port_rmetaroot(sysroot, files);
  expect(want.length).toBeGreaterThan(0);
  expect(got).toBe(want);
}, 300_000);

test("-Zls=root: list_file_metadata matches `rustc -Zls=root`", () => {
  const { sysroot, files } = setup();
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const t = target(sysroot);
  let matched = 0;
  create_default_session_globals_then(() => {
    for (const f of files) {
      let got = "";
      const out = {
        write: (b: Uint8Array) => ({ $: "Ok" as const, _0: b.length }),
        write_all: () => ({ $: "Ok" as const, _0: undefined }),
        write_fmt: (a: readonly string[]) => {
          got += a.join("");
          return { $: "Ok" as const, _0: undefined };
        },
        flush: () => ({ $: "Ok" as const, _0: undefined }),
      };
      try {
        const r = locator.list_file_metadata(t, f, DefaultMetadataLoader, out, ["root"], CFG_VERSION);
        if (r.$ === "Err") got += `ERR ${JSON.stringify(r._0)}`;
      } catch (e) {
        got = `PANIC ${(e as Error).message}`;
      }
      const o = Bun.spawnSync(oracle.oracleRustcCmd(["--target", TUPLE, "-Zls=root", f]), { cwd: DATA, env: { ...process.env, RUST_BACKTRACE: "0" }, stdout: "pipe", stderr: "pipe" });
      let want: string;
      if (o.exitCode === 101) {
        // an ICE: the panic message line
        want = `PANIC ${/panicked at [^\n]*\n([^\n]*)/.exec(o.stderr.toString())?.[1]}`;
      } else {
        expect(o.exitCode).toBe(0);
        // `list_metadata` prints the buffer with `safe_println!`
        want = o.stdout.toString();
        got += "\n";
      }
      expect(`${basename(f)}\n${got}`).toBe(`${basename(f)}\n${want}`);
      matched++;
    }
  });
  // the panicking oracle runs leave ICE dumps in the cwd
  for (const e of readdirSync(DATA)) if (e.startsWith("rustc-ice-")) require("node:fs").rmSync(join(DATA, e));
  expect(matched).toBe(files.length);
}, 300_000);
