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
// - PENDING (exact stop texts): `CrateMetadata::new` (its `incoherent_impls` decode), and everything decoded through
//   `(&CrateMetadata, TyCtxt)` (lane rmeta-decoder-a's `MetaDecoder::decoder`) or -a's own methods. When a stop
//   moves, update its text here; when it is gone, compare the section with the probe's lines.
//
// Without the probe this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import "../lib.ts";
import { CrateSource } from "../../rustc_crate_store/lib.ts";
import { debug_DefKey } from "../../rustc_hir_id/definitions.ts";
import { HygieneDecodeContext } from "../../rustc_span/hygiene.ts";
import { CRATE_DEF_INDEX, CrateNum, DefIndex, debug_DefPathHash } from "../../rustc_span/def_id.ts";
import { create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { PLAIN } from "../../std/fmt.ts";
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
 * -a's `MetaDecoder::decoder` (PENDING). `def_path_hash_map`, `alloc_decoding_state` and the dep-graph fields are placeholders no
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

/** The `MetaDecoder::decoder` stop of `(&CrateMetadata, TyCtxt)` (decoder.rs:297, lane rmeta-decoder-a). */
const TCX_DECODER = "rustc_metadata::rmeta::decoder::MetaDecoder::decoder for (&CrateMetadata, TyCtxt) (AllocDecodingState::new_decoding_session)";

const PENDING: { name: string; oracle: string; run: (c: OracleCrate, cdata: CrateMetadata, blob: MetadataBlob) => unknown; stop: string }[] = [
  {
    name: "CrateMetadata::new (dependencies, crate_dep_kind through creader)",
    oracle: "crate",
    run: (c, _cdata, blob) =>
      CrateMetadata.new(
        undefined as never,
        blob,
        blob.get_root(),
        blob.get_root_unhashed(),
        undefined,
        CrateNum.from_u32(c.cnum),
        [],
        "Unconditional",
        new CrateSource(undefined, undefined, undefined, undefined),
        false,
        undefined,
      ),
    stop: TCX_DECODER,
  },
  { name: "get_module_children(CRATE_DEF_INDEX)", oracle: "child", run: (_c, cdata) => [...cdata.get_module_children(undefined as never, CRATE_DEF_INDEX)], stop: TCX_DECODER },
  { name: "get_lang_items", oracle: "lang", run: (_c, cdata) => cdata.get_lang_items(undefined as never), stop: "rustc_metadata::rmeta::decoder::CrateMetadata::get_lang_items" },
  { name: "get_missing_lang_items", oracle: "missing_lang", run: (_c, cdata) => cdata.get_missing_lang_items(undefined as never), stop: TCX_DECODER },
  { name: "get_diagnostic_items", oracle: "diag", run: (_c, cdata) => cdata.get_diagnostic_items(undefined as never), stop: "rustc_metadata::rmeta::decoder::CrateMetadata::get_diagnostic_items" },
  { name: "get_traits", oracle: "traits", run: (_c, cdata) => [...cdata.get_traits(undefined as never)], stop: TCX_DECODER },
];

for (const p of PENDING) {
  test.skipIf(SKIP)(`rmetadecode PENDING: ${p.name}`, () => {
    // the oracle has the section for some crate (guards against a case that tests nothing)
    if (p.oracle !== "crate" && p.oracle !== "missing_lang") expect(crates.reduce((n, c) => n + (c.lines.get(p.oracle)?.length ?? 0), 0)).toBeGreaterThan(0);
    create_default_session_globals_then(() => {
      for (const c of crates) {
        const blob = blob_of(c);
        expect(() => p.run(c, cdata_of(c, blob), blob)).toThrow(p.stop);
      }
    });
  });
}
