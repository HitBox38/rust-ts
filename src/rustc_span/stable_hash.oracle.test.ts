// rust-ts: rustc_span's stable hashing against the oracle (fixtures from the rustc-dev probe in
// src/rustc_data_structures/stable_hash_probe/main.rs):
//   - stable_crate_id_oracle.json: `StableCrateId::new` for names x crate types x `-C metadata` x
//     version strings (`direct`), and the stable crate id of real rustc sessions (`driver`: the
//     probe runs rustc with `args` and prints `tcx.stable_crate_id(LOCAL_CRATE)`), recomputed here
//     from the crate name, crate type, `-C metadata` values and rust-ts's `CFG_VERSION`.
//   - expn_hash_oracle.json: every local expansion of a small no_core crate (macro_rules, nested and
//     duplicated invocations (a disambiguator), a macro 2.0, a macro defined by a macro, `$crate`,
//     modules) as seen by the pinned rustc after expansion: the ExpnData fields, the spans' lo/hi and
//     the marks of their SyntaxContexts, the DefPathHashes of the macro / module DefIds, and the
//     `ExpnHash`. Here the same source file is put in a rust-ts SourceMap, the expansions are
//     registered in id order through `LocalExpnId::set_expn_data` (`update_disambiguator` ->
//     `ExpnData::hash_expn` -> derived StableHash -> rustc_middle ich `stable_hash_span`) and the
//     resulting disambiguators and `ExpnHash`es are compared.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CFG_VERSION } from "../rustc_interface/util.ts";
import { StableCrateId } from "./def_id.ts";
import { create_default_session_globals_then } from "./lib.ts";
import { Symbol } from "./symbol.ts";
import { CrateNum, DefId, DefIndex, DefPathHash, ModId } from "./def_id.ts";
import { ExpnHash, type ExpnKind, HygieneData, LocalExpnId, ExpnData, SyntaxContext, type Transparency } from "./hygiene.ts";
import { BytePos, RealFileName, Span, StableSourceFileId } from "./lib.ts";
import { FilePathMapping, SourceMap } from "./source_map.ts";
import { create_session_globals_then } from "./lib.ts";
import { Str } from "../std/str.ts";
import { panic } from "../std/panic.ts";
import { Fingerprint } from "../rustc_data_structures/fingerprint.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import { SourceSpanCache, StableHashState } from "../rustc_middle/ich.ts";
import type { Edition } from "./edition.ts";

interface CrateIdCase {
  name: string;
  is_exe: boolean;
  metadata: string[];
  cfg_version: string;
  id: string;
}
interface DriverCase {
  args: string;
  crate_name: string;
  is_exe: boolean;
  metadata: string[];
  cfg_version: string;
  id: string;
}
const CRATE_IDS: { direct: CrateIdCase[]; driver: DriverCase[] } = JSON.parse(readFileSync(join(import.meta.dir, "stable_crate_id_oracle.json"), "utf8"));

test("StableCrateId::new matches the oracle", () => {
  expect(process.env.RUSTC_FORCE_RUSTC_VERSION).toBeUndefined();
  create_default_session_globals_then(() => {
    expect(CRATE_IDS.direct.length).toBeGreaterThan(100);
    const bad: string[] = [];
    for (const c of CRATE_IDS.direct) {
      const id = StableCrateId.new(Symbol.intern(c.name), c.is_exe, c.metadata, c.cfg_version);
      if (String(StableCrateId.as_u64(id)) !== c.id) bad.push(`${JSON.stringify(c)}: got ${StableCrateId.as_u64(id)}`);
    }
    expect(bad).toEqual([]);
  });
});

test("StableCrateId of real rustc sessions (rust-ts CFG_VERSION)", () => {
  create_default_session_globals_then(() => {
    expect(CRATE_IDS.driver.length).toBeGreaterThan(4);
    for (const c of CRATE_IDS.driver) {
      expect(c.cfg_version).toBe(CFG_VERSION);
      const id = StableCrateId.new(Symbol.intern(c.crate_name), c.is_exe, c.metadata, CFG_VERSION);
      expect([c.args, String(StableCrateId.as_u64(id))]).toEqual([c.args, c.id]);
    }
  });
});

interface OSpan {
  lo: number;
  hi: number;
  ctxt: string;
  marks: [number, number, Transparency][];
  parent: number | null;
}
interface ODef {
  krate: number;
  index: number;
  stable_crate_id: string;
  local_hash: string;
}
interface OExpn {
  id: number;
  hash: [string, string];
  data: {
    kind: string;
    parent: [number, number];
    call_site: OSpan;
    disambiguator: number;
    def_site: OSpan;
    allow_internal_unstable: string[] | null;
    edition: Edition;
    macro_def_id: ODef | null;
    parent_module: ODef | null;
    allow_internal_unsafe: boolean;
    local_inner_macros: boolean;
    collapse_debuginfo: boolean;
    diagnostic_opaque: boolean;
  } | null;
}
const EXPN: {
  custom_name: string;
  edition: Edition;
  src: string;
  stable_crate_id: string;
  crate_name: string;
  crate_root: ODef;
  files: { name: string; start_pos: number; len: number; stable_id: string }[];
  expns: OExpn[];
} = JSON.parse(readFileSync(join(import.meta.dir, "expn_hash_oracle.json"), "utf8"));

test("ExpnHash of a crate's expansions matches the oracle", () => {
  create_session_globals_then(EXPN.edition, [], undefined, () => {
    // the crate's StableCrateId (a lib, no -C metadata) and the source file's StableSourceFileId
    const crate_id = StableCrateId.new(Symbol.intern(EXPN.crate_name), false, [], CFG_VERSION);
    expect(String(StableCrateId.as_u64(crate_id))).toBe(EXPN.stable_crate_id);
    const sm = SourceMap.new(FilePathMapping.empty());
    const sf = sm.new_source_file({ $: "Custom", _0: EXPN.custom_name }, Str.from(EXPN.src));
    expect([sf.start_pos, EXPN.files.length]).toEqual([BytePos(EXPN.files[0]!.start_pos), 1]);
    expect(`StableSourceFileId(${sf.stable_id.hash()})`).toBe(EXPN.files[0]!.stable_id);

    // `Untracked`: the DefPathHashes the oracle reported for the DefIds the expansions name
    const defs = new Map<number, DefPathHash>();
    const add = (d: ODef | null) => {
      if (d === null) return;
      expect(d.krate).toBe(0);
      defs.set(d.index, DefPathHash.new(StableCrateId.of(Hash64.new(BigInt(d.stable_crate_id))), Hash64.new(BigInt(d.local_hash))));
    };
    add(EXPN.crate_root);
    for (const e of EXPN.expns) if (e.data) [e.data.macro_def_id, e.data.parent_module].forEach(add);
    const hcx = new StableHashState(
      {
        definitions: { def_path_hash: (id) => defs.get(id) ?? panic(`no DefPathHash for ${id}`) },
        cstore: { def_path_hash: () => panic("cstore") },
        source_span: [],
      },
      false,
      { $: "Unused", _0: sm },
      { hash_spans: true },
      SourceSpanCache.default(),
    );

    const expn_id = (local: number) => LocalExpnId.to_expn_id(LocalExpnId.from_u32(local));
    const span = (s: OSpan): Span => {
      expect(s.parent).toBeNull();
      const ctxt = s.marks.reduce(
        (c, [krate, local, t]) => (expect(krate).toBe(0), HygieneData.with((d) => d.alloc_ctxt(c, expn_id(local), t))),
        SyntaxContext.root(),
      );
      return Span.new(BytePos(s.lo), BytePos(s.hi), ctxt, undefined);
    };
    const def = (d: ODef | null) => (d === null ? undefined : new DefId(DefIndex.from_u32(d.index), CrateNum.from_u32(d.krate)));
    const kind = (k: string): ExpnKind => {
      const m = /^Macro\((Bang|Attr|Derive), "(.*)"\)$/.exec(k);
      if (m) return { $: "Macro", _0: m[1] as "Bang", _1: Symbol.intern(m[2]!) };
      const a = /^AstPass\((\w+)\)$/.exec(k);
      if (a) return { $: "AstPass", _0: a[1] as "StdImports" };
      throw new Error(`ERROR: expansion kind ${k} not handled`);
    };

    expect(EXPN.expns[0]!.hash).toEqual(["0", "0"]);
    const n = EXPN.expns.length;
    expect(n).toBeGreaterThan(10);
    // ids are allocated at collection (`fresh_empty`), data is set at resolution (`set_expn_data`)
    for (let i = 1; i < n; i++) expect(LocalExpnId.fresh_empty()).toBe(LocalExpnId.from_u32(i));
    let disambiguated = 0;
    for (const e of EXPN.expns.slice(1)) {
      const d = e.data!;
      const data = ExpnData.new(
        kind(d.kind),
        expn_id(d.parent[1]),
        span(d.call_site),
        span(d.def_site),
        d.allow_internal_unstable?.map((s) => Symbol.intern(s)),
        d.edition,
        def(d.macro_def_id),
        d.parent_module === null ? undefined : ModId.new_unchecked(def(d.parent_module)!),
        d.allow_internal_unsafe,
        d.local_inner_macros,
        d.collapse_debuginfo,
        d.diagnostic_opaque,
      );
      LocalExpnId.set_expn_data(LocalExpnId.from_u32(e.id), data, hcx);
      const got = HygieneData.with((h) => [h.local_expn_data[e.id]!.disambiguator, Fingerprint.split(ExpnHash._0(h.local_expn_hashes[e.id]!)).map(String)]);
      expect([e.id, d.kind, ...got]).toEqual([e.id, d.kind, d.disambiguator, e.hash]);
      if (d.disambiguator !== 0) disambiguated++;
    }
    expect(disambiguated).toBe(1);
  });
});

// `hashprobe compile src/lib.rs --crate-type lib` run in /tmp/shp (macOS: cwd /private/tmp/shp): the
// crate root's `SourceFile::stable_id` (`FileName::Real`, not remapped; std `impl Hash for Path`).
test("StableSourceFileId of a real local file matches the oracle", () => {
  const inner = { name: "src/lib.rs", working_directory: "/private/tmp/shp", embeddable_name: "/private/tmp/shp/src/lib.rs" };
  const name = new RealFileName({ ...inner }, { ...inner }, 0);
  const id = StableSourceFileId.from_filename_in_current_crate({ $: "Real", _0: name });
  expect(String(id.hash())).toBe("90151381352722025332948564866034863379");
});
