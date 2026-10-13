// Oracle tests for decoder.rs 1343..end (lane rmeta-decoder-b): `CrateMetadata`'s answers for the crates a tiny
// `#![no_std] extern crate alloc;` crate loads from the oracle sysroot (x86_64-unknown-linux-gnu: core, alloc,
// compiler_builtins).
//
// The rmetadecode probe (tools/probes/rmetadecode, rustc-dev) runs the oracle compiler itself and prints, through
// the queries cstore_impl.rs answers from `CrateMetadata`, every crate's `DefKey` / `DefPathHash` / `DefPath` /
// `is_item_mir_available` / `IS_DOC_HIDDEN` for each `DefIndex`, its root's module children, lang items, missing
// lang items, diagnostic items and trait count.
//
// - Compared now: `def_key`, `def_path`, `def_path_hash`, `is_item_mir_available`, `get_attr_flags`, `num_def_ids`
//   (they read the blob only). `CrateMetadata::new` cannot finish yet (PENDING below), so the test builds the
//   `CrateMetadata` with its constructor; the fields those methods do not read are placeholders.
// - Compared too (rmeta-decoder-a merged): `get_diagnostic_items`, `get_traits`, and (lane decode-elems) the root's
//   `get_module_children` including the reexports, `get_lang_items` / `get_missing_lang_items` (through a real
//   `TyCtxt`: spans need the session's source map and `CStore`), and `CrateMetadata::new` itself (it finishes for
//   every crate now that `SimplifiedType` decodes).
//
// Without the probe this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import "../lib.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import type { DiagnosticItems } from "../../rustc_attr_ir/diagnostic_items.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { CrateSource } from "../../rustc_crate_store/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { debug_DefKind, debug_Res } from "../../rustc_hir/def.ts";
import { debug_DefKey } from "../../rustc_hir_id/definitions.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import type { ModChild } from "../../rustc_middle/middle/resolve.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { HygieneDecodeContext } from "../../rustc_span/hygiene.ts";
import { CRATE_DEF_INDEX, CrateNum, type DefId, DefIndex, debug_DefPathHash } from "../../rustc_span/def_id.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { PLAIN } from "../../std/fmt.ts";
import { creader } from "../lib.ts";
import { CrateMetadata, MetadataBlob } from "./decoder.ts";
import { AttrFlags, RawDefId_key } from "./mod.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "rmetadecode");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: rmetadecode probe not built (bun scripts/probes.ts build rmetadecode); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const TUPLE = "x86_64-unknown-linux-gnu";
const WORK = join(DATA, "tmp", "rmeta-decoder-b-oracle", process.env.RUST_TS_AGENT ?? "default");

interface OracleCrate {
  name: string;
  cnum: number;
  hash: string;
  dep_kind: string;
  num_def_ids: number;
  /** probe lines by kind (`def`, `child`, `lang`, `missing_lang`, `diag`, `traits`) */
  lines: Map<string, string[]>;
}

let crates: OracleCrate[] = [];
let lib_dir = "";

beforeAll(() => {
  if (SKIP) return;
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const sysroot = oracle.oracleSysroot();
  lib_dir = join(sysroot, "lib", "rustlib", TUPLE, "lib");
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, "t.rs"), "#![no_std]\nextern crate alloc;\n");
  const r = Bun.spawnSync([PROBE, "--target", TUPLE, "--sysroot", sysroot, "--edition", "2021", "--crate-type", "lib", "t.rs"], {
    cwd: WORK,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new globalThis.Error(`ERROR: rmetadecode failed: ${r.stderr.toString().slice(0, 2000)}`);
  for (const l of r.stdout.toString().split("\n")) {
    if (l === "") continue;
    const m = /^crate (\S+) cnum=(\d+) hash=(\S+) dep_kind=(\S+) num_def_ids=(\d+)$/.exec(l);
    if (m) {
      crates.push({ name: m[1]!, cnum: Number(m[2]), hash: m[3]!, dep_kind: m[4]!, num_def_ids: Number(m[5]), lines: new Map() });
      continue;
    }
    const c = crates[crates.length - 1]!;
    const kind = l.slice(0, l.indexOf(" "));
    let a = c.lines.get(kind);
    if (a === undefined) c.lines.set(kind, (a = []));
    a.push(l);
  }
});

/** The sysroot `.rmeta` of a crate, found by its crate hash. */
function blob_of(c: OracleCrate): MetadataBlob {
  for (const f of readdirSync(lib_dir).sort()) {
    if (!f.startsWith(`lib${c.name}-`) || !f.endsWith(".rmeta")) continue;
    const r = MetadataBlob.new(new Uint8Array(readFileSync(join(lib_dir, f))));
    if (r.$ === "Ok" && r._0.get_crate_hash() === c.hash) return r._0;
  }
  throw new globalThis.Error(`ERROR: no .rmeta for ${c.name} with hash ${c.hash}`);
}

/**
 * A `CrateMetadata` of the crate as `CrateMetadata::new` would build it, through the constructor: `new` stops on
 * `Decodable for SimplifiedType` (PENDING). `def_path_hash_map`, `alloc_decoding_state` and the dep-graph fields are placeholders no
 * compared method reads.
 */
function cdata_of(c: OracleCrate, blob: MetadataBlob): CrateMetadata {
  return new CrateMetadata(
    blob,
    blob.get_root(),
    blob.get_root_unhashed(),
    new KeyedMap(RawDefId_key),
    new Map(),
    undefined,
    [],
    undefined as never, // def_path_hash_map (no compared method reads it)
    undefined,
    undefined, // alloc_decoding_state
    new Map(),
    CrateNum.from_u32(c.cnum),
    [],
    "Unconditional",
    new CrateSource(undefined, undefined, undefined, undefined),
    false,
    undefined,
    false,
    HygieneDecodeContext.default(),
    undefined,
  );
}

/** Lines that differ: the count and the first one. */
function diff(ours: string[], oracle: string[]): string {
  let n = 0;
  let first = "";
  for (let i = 0; i < Math.max(ours.length, oracle.length); i++) {
    if (ours[i] !== oracle[i]) {
      if (n++ === 0) first = `first difference at line ${i}:\n  oracle: ${oracle[i]}\n  ours:   ${ours[i]}`;
    }
  }
  return n === 0 ? "" : `${n} lines differ; ${first}`;
}

test.skipIf(SKIP)("rmetadecode: the probe loads core, alloc and compiler_builtins", () => {
  expect(crates.map((c) => c.name)).toEqual(["core", "alloc", "compiler_builtins"]);
  for (const c of crates) expect(c.lines.get("def")?.length).toBe(c.num_def_ids);
});

test.skipIf(SKIP)("rmetadecode: def_key / def_path / def_path_hash / is_item_mir_available / get_attr_flags / num_def_ids", () => {
  create_default_session_globals_then(() => {
    for (const c of crates) {
      const cdata = cdata_of(c, blob_of(c));
      expect(cdata.num_def_ids()).toBe(c.num_def_ids);
      const ours: string[] = [];
      for (let i = 0; i < cdata.num_def_ids(); i++) {
        const index = DefIndex.from_u32(i);
        const key = debug_DefKey(cdata.def_key(index), PLAIN);
        const hash = debug_DefPathHash(cdata.def_path_hash(index), PLAIN);
        const path = cdata.def_path(index).to_string_no_crate_verbose();
        const mir = cdata.is_item_mir_available(index);
        const hidden = AttrFlags.contains(cdata.get_attr_flags(index), AttrFlags.IS_DOC_HIDDEN);
        ours.push(`def ${i} key=${key} hash=${hash} path=${path} mir=${mir} hidden=${hidden}`);
      }
      expect(`${c.name}: ${diff(ours, c.lines.get("def")!)}`).toBe(`${c.name}: `);
    }
  });
});

test.skipIf(SKIP)("rmetadecode: get_diagnostic_items / get_traits", () => {
  // the oracle has diagnostic items for some crate (guards against a case that tests nothing)
  expect(crates.reduce((n, c) => n + (c.lines.get("diag")?.length ?? 0), 0)).toBeGreaterThan(0);
  create_default_session_globals_then(() => {
    for (const c of crates) {
      const cdata = cdata_of(c, blob_of(c));
      // the contract declares `get_diagnostic_items` `unknown`; the port returns rustc_attr_ir's `DiagnosticItems`
      const diag = [...(cdata.get_diagnostic_items(undefined as never) as DiagnosticItems).name_to_id].map(([name, d]) => `diag ${Symbol.as_str(name)} ${DefIndex.as_u32(d.index)}`);
      expect(`${c.name}: ${diff(diag, c.lines.get("diag") ?? [])}`).toBe(`${c.name}: `);
      expect([`traits ${[...cdata.get_traits(undefined as never)].length}`]).toEqual(c.lines.get("traits")!);
    }
  });
});

class CaptureConfig extends globalThis.Error {}
/** The `interface::Config` rustc's driver builds from `args`. */
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

/**
 * A real `TyCtxt` (the driver's config for a `#![no_core]` crate, `passes::parse`, `create_and_enter_global_ctxt`)
 * with the probe's crates registered in its `CStore` as `CStore::register_crate` would, minus `CrateMetadata::new`
 * (PENDING): dependencies first, `cnum_map` from the crate deps.
 */
function with_registered_crates(f: (tcx: TyCtxt, cdatas: Map<string, CrateMetadata>) => void): void {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const file = join(WORK, "tcx.rs");
  writeFileSync(file, "#![feature(no_core)]\n#![no_core]\n");
  const config = config_from_args(["--target", TUPLE, "--sysroot", oracle.oracleSysroot(), "--crate-type", "lib", "--edition", "2021", file]);
  run_compiler(config, (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      const cstore = creader.CStore.from_tcx_mut(tcx);
      const cnums = new Map<string, CrateNum>();
      const cdatas = new Map<string, CrateMetadata>();
      for (const name of ["core", "compiler_builtins", "alloc"]) {
        const c = crates.find((c) => c.name === name)!;
        const blob = blob_of(c);
        const root = blob.get_root();
        const feed = cstore.intern_stable_crate_id(tcx, root);
        if (feed.$ === "Err") throw new globalThis.Error(`ERROR: intern_stable_crate_id failed for ${name}`);
        const cnum = feed._0.key();
        const cnum_map: CrateNum[] = [cnum];
        for (const dep of root.decode_crate_deps(blob)) cnum_map.push(cnums.get(Symbol.as_str(dep.name))!);
        const cdata = new CrateMetadata(
          blob,
          root,
          blob.get_root_unhashed(),
          new KeyedMap(RawDefId_key),
          new Map(),
          undefined,
          [],
          undefined as never, // def_path_hash_map (no compared method reads it)
          undefined,
          undefined, // alloc_decoding_state
          new Map(),
          cnum,
          cnum_map,
          "Unconditional",
          new CrateSource(undefined, undefined, undefined, undefined),
          false,
          undefined,
          true,
          HygieneDecodeContext.default(),
          undefined,
        );
        cstore.set_crate_data(cnum, cdata);
        cnums.set(name, cnum);
        cdatas.set(name, cdata);
      }
      f(tcx, cdatas);
    });
  });
}

/** The probe's `did(cnum, d)`: the index for the crate's own `DefId`s, else `<oracle cnum>:<index>`. */
function did_of(cnum: CrateNum, d: DefId, oracle_cnum: Map<CrateNum, number>): string {
  return d.krate === cnum ? `${DefIndex.as_u32(d.index)}` : `${oracle_cnum.get(d.krate)}:${DefIndex.as_u32(d.index)}`;
}

/** The probe's `child` line of a module child of the crate root. */
function child_line(cnum: CrateNum, child: ModChild, oracle_cnum: Map<CrateNum, number>): string {
  const res = child.res.$ === "Def" ? `Def(${debug_DefKind(child.res._0, PLAIN)}, ${did_of(cnum, child.res._1, oracle_cnum)})` : debug_Res(child.res, PLAIN, (x: never) => x);
  const vis = child.vis.$ === "Public" ? "pub" : `restricted(${did_of(cnum, child.vis._0.to_def_id(), oracle_cnum)})`;
  return `child ${Symbol.as_str(child.ident.name)} ${res} ${vis}`;
}

/** Our `CrateNum` (registration order) -> the probe's, by crate name. */
function oracle_cnums(cdatas: Map<string, CrateMetadata>): Map<CrateNum, number> {
  const m = new Map<CrateNum, number>();
  for (const c of crates) m.set(cdatas.get(c.name)!.cnum, c.cnum);
  return m;
}

test.skipIf(SKIP)("rmetadecode: get_module_children(CRATE_DEF_INDEX) (proper items and reexports)", () => {
  expect(crates.reduce((n, c) => n + (c.lines.get("child")?.length ?? 0), 0)).toBeGreaterThan(0);
  with_registered_crates((tcx, cdatas) => {
    const oc = oracle_cnums(cdatas);
    for (const c of crates) {
      const cdata = cdatas.get(c.name)!;
      const ours = [...cdata.get_module_children(tcx, CRATE_DEF_INDEX)].map((child) => child_line(cdata.cnum, child, oc));
      expect(`${c.name}: ${diff(ours, c.lines.get("child") ?? [])}`).toBe(`${c.name}: `);
    }
  });
}, 300_000);

test.skipIf(SKIP)("rmetadecode: get_lang_items / get_missing_lang_items", () => {
  // the oracle has lang items for some crate (guards against a case that tests nothing)
  expect(crates.reduce((n, c) => n + (c.lines.get("lang")?.length ?? 0), 0)).toBeGreaterThan(0);
  with_registered_crates((tcx, cdatas) => {
    const oc = oracle_cnums(cdatas);
    for (const c of crates) {
      const cdata = cdatas.get(c.name)!;
      const lang = cdata.get_lang_items(tcx).map(([d, item]) => `lang ${Symbol.as_str(LangItem.name(item))} ${did_of(cdata.cnum, d, oc)}`);
      expect(`${c.name}: ${diff(lang, c.lines.get("lang") ?? [])}`).toBe(`${c.name}: `);
      const missing = cdata.get_missing_lang_items(tcx).map((item) => `missing_lang ${Symbol.as_str(LangItem.name(item))}`);
      expect(`${c.name}: ${diff(missing, c.lines.get("missing_lang") ?? [])}`).toBe(`${c.name}: `);
    }
  });
}, 300_000);

test.skipIf(SKIP)("rmetadecode: CrateMetadata::new builds every crate (incoherent impls decoded)", () => {
  create_default_session_globals_then(() => {
    let incoherent = 0;
    for (const c of crates) {
      const blob = blob_of(c);
      // `cnum_map` as `CrateLoader::resolve_crate_deps` builds it: the crate itself, then its deps (the probe's cnums)
      const cnum_map: CrateNum[] = [CrateNum.from_u32(c.cnum)];
      for (const dep of blob.get_root().decode_crate_deps(blob)) cnum_map.push(CrateNum.from_u32(crates.find((o) => o.name === Symbol.as_str(dep.name))!.cnum));
      const cdata = CrateMetadata.new(
        undefined as never,
        blob,
        blob.get_root(),
        blob.get_root_unhashed(),
        undefined,
        CrateNum.from_u32(c.cnum),
        cnum_map,
        "Unconditional",
        new CrateSource(undefined, undefined, undefined, undefined),
        false,
        undefined,
      );
      expect(cdata).toBeInstanceOf(CrateMetadata);
      expect(`${c.name}: ${cdata.num_def_ids()} ${CrateNum.as_u32(cdata.cnum)}`).toBe(`${c.name}: ${c.num_def_ids} ${c.cnum}`);
      incoherent += cdata.incoherent_impls.size;
    }
    // core has incoherent impls (`#![rustc_coherence_is_core]`): the `SimplifiedType` keys were decoded
    expect(incoherent).toBeGreaterThan(0);
  });
});
