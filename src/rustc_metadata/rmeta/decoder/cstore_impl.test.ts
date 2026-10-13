// cstore_impl.rs (lane cstore-impl): the `provide!` table against the pinned sources, and the providers'
// behaviour on a fake `TyCtxt` / `CrateMetadata`.
//
// The table checks read upstream directly: the `provide!` invocation (cstore_impl.rs), `define_tables!`
// (rmeta/mod.rs) and the query signatures (rustc_middle queries.rs), plus `arena_cache` from QUERY_DECLS. From
// those they derive, per entry, the `IntoArgs` impl, the table's `FixedSizeEncoding`, the element type and the
// `ProcessQueryValue` impl Rust's trait selection picks, and compare them with the TS table.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UPSTREAM } from "../../../../scripts/lib/common.ts";
import "../../lib.ts";
import { DefKind } from "../../../rustc_hir/def.ts";
import type { ModChild } from "../../../rustc_middle/middle/resolve.ts";
import { QUERY_DECLS, type ExternProviders, type ExternQuery, type QueryName } from "../../../rustc_middle/queries.gen.ts";
import { ExternProviders_default, Providers_default } from "../../../rustc_middle/query/query_api.ts";
import { Providers_default as HookProviders_default } from "../../../rustc_middle/hooks.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Providers } from "../../../rustc_middle/util/mod.ts";
import { CrateNum, DefId, DefIndex, LOCAL_CRATE, ModId, debug_DefId } from "../../../rustc_span/def_id.ts";
import { create_default_session_globals_then, DUMMY_SP } from "../../../rustc_span/lib.ts";
import { Ident, kw, Symbol } from "../../../rustc_span/symbol.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import { CStore } from "../../creader.ts";
import { provide } from "../../lib.ts";
import type { CrateMetadata } from "../decoder.ts";
import * as table_mod from "../table.ts";
import {
  IntoArgs_CrateNum,
  IntoArgs_CrateNum_DefId,
  IntoArgs_CrateNum_SimplifiedType,
  IntoArgs_DefId,
  IntoArgs_ModId,
  PROVIDE_EXTERN,
  ProcessQueryValue_DecodeIterator_Option_slice,
  ProcessQueryValue_DecodeIterator_slice,
  ProcessQueryValue_Deprecation,
  ProcessQueryValue_EarlyBinder,
  ProcessQueryValue_Option_ref_T,
  ProcessQueryValue_Option_Result,
  ProcessQueryValue_Option_T,
  ProcessQueryValue_T,
  type TableArm,
} from "./cstore_impl.ts";

const read = (p: string) => readFileSync(join(UPSTREAM, p), "utf8");
const CSTORE_IMPL = read("compiler/rustc_metadata/src/rmeta/decoder/cstore_impl.rs");
const RMETA_MOD = read("compiler/rustc_metadata/src/rmeta/mod.rs");
const QUERIES = read("compiler/rustc_middle/src/queries.rs");

// ---- upstream parsing ----------------------------------------------------------------------------------------

/** The `provide! { tcx, def_id, other, cdata, $($name => { $compute })* }` entries, in order. */
function upstreamProvide(): [string, string][] {
  const start = CSTORE_IMPL.indexOf("provide! { tcx, def_id, other, cdata,");
  expect(start).toBeGreaterThan(0);
  let i = CSTORE_IMPL.indexOf("\n", start);
  const out: [string, string][] = [];
  for (;;) {
    const m = /^\s*(?:\/\/[^\n]*\n\s*)*(\w+) => \{/.exec(CSTORE_IMPL.slice(i));
    if (!m) break;
    let j = i + m[0].length;
    let depth = 1;
    const bodyStart = j;
    while (depth > 0) {
      const c = CSTORE_IMPL[j++];
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    out.push([m[1]!, CSTORE_IMPL.slice(bodyStart, j - 1).trim()]);
    i = j;
  }
  expect(CSTORE_IMPL.slice(i).trimStart().startsWith("}")).toBe(true);
  return out;
}

/** `define_tables!`: table name -> [section, `Table<T>`'s `T`]. */
function upstreamTables(): Map<string, ["defaulted" | "optional", string]> {
  const body = RMETA_MOD.slice(RMETA_MOD.indexOf("define_tables! {\n"));
  const out = new Map<string, ["defaulted" | "optional", string]>();
  let section: "defaulted" | "optional" | undefined;
  for (const line of body.split("\n").slice(1)) {
    if (line.startsWith("}")) break;
    if (line.trim() === "- defaulted:") section = "defaulted";
    else if (line.trim() === "- optional:") section = "optional";
    const m = /^\s+(\w+): Table<(.*)>,\s*$/.exec(line);
    if (m) out.set(m[1]!, [section!, m[2]!]);
  }
  return out;
}

/** `query $name($key: K) -> R` of queries.rs: [K, R]. */
function upstreamQuery(name: string): [string, string] {
  const i = QUERIES.indexOf(`query ${name}(`);
  expect(i).toBeGreaterThan(0);
  const sig = QUERIES.slice(i + `query ${name}`.length, QUERIES.indexOf("{", i)).replace(/\s+/g, " ").trim();
  const m = /^\((.*)\) -> (.*)$/.exec(sig)!;
  return [m[1]!.slice(m[1]!.indexOf(":") + 1).trim(), m[2]!.trim()];
}

/** Drops lifetimes, paths and whitespace: `ty::EarlyBinder<'tcx, Ty<'tcx>>` -> `EarlyBinder<Ty>`. */
function norm(t: string): string {
  return t
    .replace(/'\w+\s*,\s*/g, "")
    .replace(/'\w+\s*/g, "")
    .replace(/<>/g, "")
    .replace(/(?:\w+::)+/g, "")
    .replace(/\s+/g, "");
}

/** `<V as ArenaCached>::Provided` for `arena_cache` queries: `&'tcx T` -> `T`, `Option<&'tcx T>` -> `Option<T>`. */
function provided(name: string, ret: string): string {
  if (!QUERY_DECLS[name as QueryName].arena_cache) return ret;
  if (ret.startsWith("&")) return ret.replace(/^&'tcx\s*/, "");
  const m = /^Option<&'tcx\s*(.*)>$/.exec(ret);
  if (m) return `Option<${m[1]}>`;
  throw new Error(`arena_cache query ${name}: unexpected type ${ret}`);
}

const inner = (t: string, ctor: string): string | undefined => {
  const m = new RegExp(`^${ctor}<(.*)>$`).exec(t);
  return m ? m[1] : undefined;
};

/** The `ProcessQueryValue` impl trait selection picks for (decoded `D`, target `R`), both normalized. */
function selectImpl(d: string, r: string): string {
  if (d === r) return "ProcessQueryValue_T";
  if (r === `EarlyBinder<${d}>`) return "ProcessQueryValue_EarlyBinder";
  const opt = inner(d, "Option");
  if (opt !== undefined) {
    if (opt === r) return "ProcessQueryValue_Option_T";
    if (r === `&${opt}`) return "ProcessQueryValue_Option_ref_T";
    if (r === `Result<Option<${opt}>,ErrorGuaranteed>`) return "ProcessQueryValue_Option_Result";
    const it = inner(opt, "DecodeIterator");
    if (it !== undefined && r === `&[${it}]`) return "ProcessQueryValue_DecodeIterator_slice";
    if (it !== undefined && r === `Option<&[${it}]>`) return "ProcessQueryValue_DecodeIterator_Option_slice";
    if (opt === "Deprecation" && r === "Option<DeprecationEntry>") return "ProcessQueryValue_Deprecation";
  }
  throw new Error(`no ProcessQueryValue impl for ${d} -> ${r}`);
}

const IMPLS: Record<string, unknown> = {
  ProcessQueryValue_T,
  ProcessQueryValue_EarlyBinder,
  ProcessQueryValue_Option_T,
  ProcessQueryValue_Option_ref_T,
  ProcessQueryValue_Option_Result,
  ProcessQueryValue_DecodeIterator_slice,
  ProcessQueryValue_DecodeIterator_Option_slice,
  ProcessQueryValue_Deprecation,
};
const implName = (v: unknown) => Object.entries(IMPLS).find(([, x]) => x === v)?.[0];
const fseName = (v: unknown) => Object.entries(table_mod).find(([k, x]) => k.startsWith("fse_") && x === v)?.[0];

const ENTRIES = upstreamProvide();
const TABLES = upstreamTables();
const TS = PROVIDE_EXTERN as Record<string, readonly [unknown, TableArm | ((...a: unknown[]) => unknown)]>;

// ---- the table -----------------------------------------------------------------------------------------------

describe("provide! table vs cstore_impl.rs:230", () => {
  test("same queries, same order; each is a separate_provide_extern query", () => {
    expect(ENTRIES.length).toBe(116);
    expect(Object.keys(PROVIDE_EXTERN)).toEqual(ENTRIES.map(([n]) => n));
    for (const [n] of ENTRIES) expect(QUERY_DECLS[n as QueryName]?.separate_provide_extern).toBe(true);
  });

  test("each entry's IntoArgs impl is the one for the query's key type", () => {
    const BY_KEY: Record<string, unknown> = {
      DefId: IntoArgs_DefId,
      ModId: IntoArgs_ModId,
      CrateNum: IntoArgs_CrateNum,
      "(CrateNum, DefId)": IntoArgs_CrateNum_DefId,
      "(CrateNum, SimplifiedType)": IntoArgs_CrateNum_SimplifiedType,
    };
    for (const [n] of ENTRIES) {
      const [key] = upstreamQuery(n);
      expect([n, TS[n]![0] === BY_KEY[key]]).toEqual([n, true]);
    }
  });

  test("table arms: arm kind, FixedSizeEncoding, element type and ProcessQueryValue impl", () => {
    let checked = 0;
    for (const [n, body] of ENTRIES) {
      const arm = TS[n]![1];
      if (!["table", "table_defaulted_array", "table_direct"].includes(body)) {
        expect([n, typeof arm]).toEqual([n, "function"]);
        continue;
      }
      checked++;
      const a = arm as TableArm;
      expect([n, a.$]).toEqual([n, body]);
      const [section, t] = TABLES.get(n)!;
      const tn = norm(t);
      // `define_tables!` wraps `- optional:` tables in `Option<..>`
      const lazyKind = /^(LazyValue|LazyArray)<(.*)>$/.exec(tn);
      const head = lazyKind ? lazyKind[1]! : tn;
      const expectFse =
        section === "defaulted"
          ? { LazyArray: "fse_LazyArray", bool: "fse_bool", Asyncness: "fse_Asyncness", Constness: "fse_Constness", Defaultness: "fse_Defaultness" }[head]
          : { LazyValue: "fse_Option_LazyValue", LazyArray: "fse_Option_LazyArray", RawDefId: "fse_Option_RawDefId", CoroutineKind: "fse_Option_CoroutineKind", DefKind: "fse_Option_DefKind" }[head];
      expect([n, fseName(a.fse)]).toEqual([n, expectFse]);

      // the decoded value `D` (before `process_decoded`)
      let d: string;
      if (body === "table_direct") {
        expect(a.decode).toBeUndefined();
        d = section === "optional" ? `Option<${tn}>` : tn;
      } else if (lazyKind) {
        expect([n, a.decode!.lazy, norm(a.decode!.what)]).toEqual([n, lazyKind[1], norm(lazyKind[2]!)]);
        if (body === "table_defaulted_array") d = `&[${lazyKind[2]}]`;
        else d = lazyKind[1] === "LazyValue" ? `Option<${lazyKind[2]}>` : `Option<DecodeIterator<${lazyKind[2]}>>`;
      } else {
        expect([n, tn, a.decode!.lazy]).toEqual([n, "RawDefId", "RawDefId"]);
        d = "Option<DefId>";
      }
      const r = norm(provided(n, upstreamQuery(n)[1]));
      expect([n, implName(a.process)]).toEqual([n, selectImpl(d, r)]);
    }
    expect(checked).toBe(53);
  });

  test("block arms use the same CrateMetadata members and queries as upstream's $compute", () => {
    const STD_ADAPTORS = new Set(["map", "iter", "copied", "collect", "into_iter", "contains"]);
    const RENAMED_FIELDS: Record<string, string> = { dep_kind: "dep_kind_", source: "source_" };
    for (const [n, body] of ENTRIES) {
      const arm = TS[n]![1];
      if (typeof arm !== "function") continue;
      const src = arm.toString().replace(/\s+/g, "");
      const up = body.replace(/\s*\n\s*\./g, ".");
      // `cdata.a.b(..)` member chains (fields renamed in decoder.ts get their `_`)
      for (const m of up.matchAll(/\bcdata((?:\.\w+)+)(\()?/g)) {
        const segs = m[1]!.split(".").slice(1);
        // `Option` / iterator adaptors on the member are not CrateMetadata members
        while (segs.length > 1 && STD_ADAPTORS.has(segs[segs.length - 1]!)) segs.pop();
        if (!m[2] && RENAMED_FIELDS[segs[segs.length - 1]!]) segs[segs.length - 1] = RENAMED_FIELDS[segs[segs.length - 1]!]!;
        expect([n, src.includes(`cdata.${segs.join(".")}`)]).toEqual([n, true]);
      }
      // `tcx.<query>(..)` calls
      for (const m of up.matchAll(/\btcx\.(\w+)\(/g)) {
        if (m[1]! in QUERY_DECLS) expect([n, src.includes(`tcx.${m[1]}(`)]).toEqual([n, true]);
      }
    }
  });
});

// ---- behaviour on fakes --------------------------------------------------------------------------------------

const K1 = CrateNum.from_u32(1);
const did = (krate: number, index: number) => new DefId(DefIndex.from_u32(index), CrateNum.from_u32(krate));

interface Fake {
  tcx: TyCtxt;
  cstore: CStore;
  calls: string[];
  frozen: { n: number };
}

/** A `TyCtxt` with just what `provide_one!` and the local providers touch, over a `CStore` holding `metas`. */
function fake(metas: Record<number, Partial<CrateMetadata>>, extra: Record<string, unknown> = {}, fully_enabled = false): Fake {
  const calls: string[] = [];
  const frozen = { n: 0 };
  const cstore = Object.create(CStore.prototype) as CStore;
  cstore.metas = [];
  for (const [k, v] of Object.entries(metas)) cstore.metas[Number(k)] = v as CrateMetadata;
  const tcx = {
    prof: { generic_activity: (e: string) => calls.push(`prof ${e}`) },
    dep_graph: { is_fully_enabled: () => fully_enabled },
    ensure_ok: () => ({ crate_hash: (c: CrateNum) => calls.push(`ensure_ok.crate_hash ${c}`) }),
    untracked: () => ({ cstore, freeze_cstore: () => frozen.n++ }),
    ...extra,
  } as unknown as TyCtxt;
  return { tcx, cstore, calls, frozen };
}

function installed(): Providers {
  const providers: Providers = { queries: Providers_default(), extern_queries: ExternProviders_default(), hooks: HookProviders_default() };
  provide(providers);
  return providers;
}

describe("provide_extern", () => {
  const p = installed();
  const ext = p.extern_queries as unknown as Record<string, (tcx: TyCtxt, key: unknown) => unknown>;

  test("installs exactly the provide! queries; the other extern providers keep their default", () => {
    const def = ExternProviders_default() as unknown as Record<string, unknown>;
    const fresh = Object.keys(def).filter((k) => ext[k] !== undefined && ext[k]!.toString() !== (def[k] as () => void).toString());
    expect(fresh.sort()).toEqual(Object.keys(PROVIDE_EXTERN).sort());
    // e.g. `is_reachable_non_generic` comes from rustc_codegen_ssa, not from here
    expect(() => ext["is_reachable_non_generic" satisfies ExternQuery]!({} as TyCtxt, did(1, 0))).toThrow(Panic);
  });

  test("a block arm calls the decoder method upstream calls, with the DefIndex", () => {
    const f = fake({ 1: { def_kind: (i: DefIndex) => (f.calls.push(`def_kind ${i}`), DefKind.Fn) } });
    expect(ext.def_kind!(f.tcx, did(1, 7))).toBe(DefKind.Fn);
    expect(f.calls).toEqual(["prof metadata_decode_entry_def_kind", "def_kind 7"]);
  });

  test("CrateNum / ModId / (CrateNum, DefId) keys go through their IntoArgs impl", () =>
    create_default_session_globals_then(() => {
      const trait = did(2, 9);
      const f = fake({
        1: {
          root: { header: { name: Symbol.intern("foo") } } as CrateMetadata["root"],
          dep_kind_: "Explicit" as CrateMetadata["dep_kind_"],
          get_doc_link_traits_in_scope: (_tcx: TyCtxt, i: DefIndex) => [did(1, i + 100)],
          get_implementations_of_trait: (_tcx: TyCtxt, t: DefId) => [[t, undefined]],
        },
      });
      expect(ext.crate_name!(f.tcx, K1)).toBe(Symbol.intern("foo"));
      expect(ext.crate_dep_kind!(f.tcx, K1)).toBe("Explicit");
      expect(ext.doc_link_traits_in_scope!(f.tcx, new ModId(did(1, 3)))).toEqual([did(1, 103)]);
      expect(ext.implementations_of_trait!(f.tcx, [K1, trait])).toEqual([[trait, undefined]]);
  }));

  test("local DefIds are rejected; crate_hash is ensured only with a fully enabled dep graph", () => {
    const f = fake({ 1: { def_kind: () => DefKind.Fn, hash: () => "h" as never } }, {}, true);
    expect(() => ext.def_kind!(f.tcx, did(0, 1))).toThrow("assertion failed: !def_id.is_local()");
    f.calls.length = 0;
    ext.def_kind!(f.tcx, did(1, 1));
    expect(f.calls).toEqual(["prof metadata_decode_entry_def_kind", "ensure_ok.crate_hash 1"]);
    f.calls.length = 0;
    ext.crate_hash!(f.tcx, K1);
    expect(f.calls).toEqual(["prof metadata_decode_entry_crate_hash"]);
  });

  /** `cdata.root.tables.<name>` returning `v` for every index. */
  const tables = (t: Record<string, unknown>) => ({ root: { tables: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { get: () => v }])) } }) as unknown as Partial<CrateMetadata>;

  test("table_direct: the table value itself", () => {
    const f = fake({ 1: tables({ type_alias_is_checked: true, coroutine_kind: undefined }) });
    expect(ext.type_alias_is_checked!(f.tcx, did(1, 2))).toBe(true);
    expect(ext.coroutine_kind!(f.tcx, did(1, 2))).toBeUndefined();
  });

  test("table: a missing entry panics with upstream's message (Option<T> -> T) or is None (T -> T)", () => {
    const f = fake({ 1: tables({ def_span: undefined, def_ident_span: undefined, impl_parent: undefined }) });
    const d = did(1, 4);
    expect(() => ext.def_span!(f.tcx, d)).toThrow(`${debug_DefId(d, PLAIN)} does not have a "def_span"`);
    expect(ext.def_ident_span!(f.tcx, d)).toBeUndefined();
    expect(ext.impl_parent!(f.tcx, d)).toBeUndefined();
  });

  test("table: RawDefId entries decode through RawDefId::decode (cnum mapping)", () => {
    const raw = { decode: ([cdata]: [CrateMetadata]) => did(cdata.cnum as number, 42) };
    const f = fake({ 1: { ...tables({ coroutine_for_closure: raw }), cnum: CrateNum.from_u32(5) } });
    expect(ext.coroutine_for_closure!(f.tcx, did(1, 1))).toEqual(did(5, 42));
  });

  test("table_defaulted_array: a default (empty) LazyArray is `&[]` without decoding", () => {
    const f = fake({ 1: tables({ inferred_outlives_of: table_mod.fse_LazyArray.default() }) });
    expect(ext.inferred_outlives_of!(f.tcx, did(1, 1))).toEqual([]);
  });

  test("unported element types stop at unported(..) naming the type", () => {
    const lazy = { decode: (_m: unknown, decode_T: (d: unknown) => unknown) => decode_T({}) };
    const f = fake({ 1: tables({ generics_of: lazy }) });
    expect(() => ext.generics_of!(f.tcx, did(1, 1))).toThrow(Unported);
    expect(() => ext.generics_of!(f.tcx, did(1, 1))).toThrow("Decodable for ty::Generics");
  });
});

describe("provide (local providers) and provide_cstore_hooks", () => {
  const p = installed();
  const q = p.queries as unknown as Record<string, (tcx: TyCtxt, key: unknown) => unknown>;

  test("crates / used_crates freeze the cstore and list the loaded crates", () => {
    const f = fake({ 1: { used: () => true }, 3: { used: () => false } });
    expect(q.crates!(f.tcx, null)).toEqual([CrateNum.from_u32(1), CrateNum.from_u32(3)]);
    expect(q.used_crates!(f.tcx, null)).toEqual([CrateNum.from_u32(1)]);
    expect(f.frozen.n).toBe(2);
  });

  test("is_private_dep is false for the local crate; duplicate_crate_names compares names", () =>
    create_default_session_globals_then(() => {
      expect(q.is_private_dep!({} as TyCtxt, "LocalCrate")).toBe(false);
      const names = ["a", "b", "a"].map((s) => Symbol.intern(s));
      const f = fake({}, { crates: () => [1, 2, 3].map((n) => CrateNum.from_u32(n)), crate_name: (c: number) => names[c - 1] });
      expect(q.duplicate_crate_names!(f.tcx, CrateNum.from_u32(1))).toEqual([CrateNum.from_u32(3)]);
  }));

  test("visible_parent_map: BFS, `_` re-exports only as fallback", () =>
    create_default_session_globals_then(() => {
      const root = did(1, 0);
      const a = did(1, 1);
      const f2 = did(1, 2);
      const f3 = did(1, 3);
      const child = (name: Symbol, kind: { $: string }, def_id: DefId): ModChild =>
        ({ ident: Ident.new(name, DUMMY_SP), res: { $: "Def", _0: kind, _1: def_id }, vis: { $: "Public" }, reexport_chain: [] }) as unknown as ModChild;
      const children = new Map<number, ModChild[]>([
        [0, [child(Symbol.intern("a"), DefKind.Mod, a), child(kw.Underscore, DefKind.Fn, f3), child(Symbol.intern("f2"), DefKind.Fn, f2)]],
        [1, [child(Symbol.intern("f3"), DefKind.Fn, f3)]],
      ]);
      const f = fake(
        {},
        {
          crates: () => [K1],
          missing_extern_crate_item: () => false,
          is_doc_hidden: () => false,
          module_children: (d: DefId) => children.get(d.index as number) ?? [],
        },
      );
      const m = q.visible_parent_map!(f.tcx, null) as Map<DefId, DefId>;
      expect([...m].map(([k, v]) => [k.index, v.index])).toEqual([
        [1, 0],
        [2, 0],
        [3, 1],
      ]);
      void root;
  }));

  test("unported local providers stop at unported(..)", () => {
    expect(() => q.dependency_formats!({} as TyCtxt, null)).toThrow("rustc_metadata::dependency_format::calculate");
    expect(() => q.native_libraries!({} as TyCtxt, "LocalCrate")).toThrow("rustc_metadata::native_libs::collect");
  });

  test("hooks: def_path_hash_to_def_id_extern maps through the crate's DefPathHash table", () => {
    const f = fake({ 1: { def_path_hash_to_def_index: (h: unknown) => (h === "known" ? DefIndex.from_u32(8) : undefined) } });
    const stable_crate_ids = new Map([[77n, K1], [0n, LOCAL_CRATE]]);
    const tcx = { ...(f.tcx as object), untracked: () => ({ cstore: f.cstore, stable_crate_ids }) } as unknown as TyCtxt;
    const hook = p.hooks.def_path_hash_to_def_id_extern;
    expect(hook(tcx, "known" as never, 77n as never)).toEqual(did(1, 8));
    expect(hook(tcx, "other" as never, 77n as never)).toBeUndefined();
    expect(() => hook(tcx, "known" as never, 5n as never)).toThrow("uninterned StableCrateId");
    expect(() => hook(tcx, "known" as never, 0n as never)).toThrow("assertion `left != right` failed");
  });

  test("the local providers upstream lists are all installed", () => {
    const def = Providers_default() as unknown as Record<string, () => void>;
    const block = CSTORE_IMPL.slice(CSTORE_IMPL.indexOf("providers.queries = rustc_middle::query::Providers {"), CSTORE_IMPL.indexOf("..providers.queries"));
    const names = [...block.matchAll(/^ {8}(\w+): /gm)].map((m) => m[1]!);
    expect(names.length).toBe(15);
    for (const n of names) expect([n, q[n]!.toString() !== def[n]!.toString()]).toEqual([n, true]);
  });
});

void (null as unknown as ExternProviders);
