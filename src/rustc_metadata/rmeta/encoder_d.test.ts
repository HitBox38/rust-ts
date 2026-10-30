// Lane encoder-d (plan-m5 wave 33): round trips for encoder.rs :2064-end. A small no_core lib crate is compiled in
// process up to a `TyCtxt`; `with_encode_metadata_header` writes a real rmeta file whose body is encoder-d's crate-level
// lists (lang items, traits, impls, mitigations, ...) and a `CrateHeader` as the root, and sets the crate hash the way
// `encode_crate_root` (lane encoder-b) does. The port's decoder (`MetadataBlob`) then reads it back: version string,
// header, root position, crate hash and every list. The SVH check recomputes XXH3-128 over the supplement and the
// flushed bytes independently of the flush strategy. `EncodedMetadata` (from_path / encode / decode) and
// `rendered_const` are checked on their own.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import "../../rustc_session/lib.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { decode_LangItem, type LangItem } from "../../rustc_attr_ir/lang_items.gen.ts";
import { Fingerprint } from "../../rustc_data_structures/fingerprint.ts";
import { StableHasher, stable_hash_Fingerprint, stable_hash_Hash64 } from "../../rustc_data_structures/stable_hash.ts";
import { Svh } from "../../rustc_data_structures/svh.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import { compute_hir_hash } from "../../rustc_middle/hir/map.ts";
import "../../rustc_middle/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { MAGIC_END_BYTES, MemDecoder, MemEncoder } from "../../rustc_serialize/opaque.ts";
import { decode_DeniedPartialMitigation } from "../../rustc_session/options/mitigation_coverage.ts";
import { decode_LocalDefId, LOCAL_CRATE, LocalDefId } from "../../rustc_span/def_id.ts";
import { decode_DefIndex, decode_Symbol } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { decode_tuple } from "../../rustc_serialize/serialize.ts";
import { unwrap_result } from "../../std/result.ts";
import { XxHash3_128 } from "../../vendor/twox_hash/lib.ts";
import { decode_CrateDep, decode_TraitImpls, encode_CrateHeader } from "../decodable.gen.ts";
import { MaybeTempDir } from "../fs.ts";
import "../lib.ts";
import { MetadataBlob } from "./decoder.ts";
import { classify, decode_EncodedMetadata, EncodedMetadata, encode_EncodedMetadata, rendered_const, with_encode_metadata_header } from "./encoder.ts";
import { type CrateHeader, CRATE_HASH_OFFSET, type LazyArray, LazyValue, ROOT_POS_OFFSET } from "./mod.ts";

const WORK = join(DATA, "tmp", "encoder-d-test", process.env.RUST_TS_AGENT ?? "default");

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
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

const SRC = [
  "#![feature(no_core, lang_items, rustc_attrs)]",
  "#![no_core]",
  "#![allow(internal_features, unused_braces)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[lang = "copy"] pub trait Copy {}',
  "pub trait Tr { fn f(&self); }",
  "pub struct S;",
  "impl Tr for S { fn f(&self) {} }",
  "impl Copy for S {}",
  '#[rustc_diagnostic_item = "encoder_d_item"] pub struct D;',
  "pub const LIT: i32 = 0x10;",
  "pub const NEG: i32 = -1;",
  "pub const UNIT: () = ();",
  "pub const BLOCK: i32 = { 5 };",
  "pub const PATH: i32 = LIT;",
  "pub const CPLX: i32 = 1 + 2;",
].join("\n");

/** Compiles `SRC` in process and runs `f` with its `TyCtxt`. */
function with_tcx<R>(f: (tcx: TyCtxt) => R): R {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "encd.rs");
  writeFileSync(file, SRC);
  let r: { v: R } | undefined;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2021", "--emit=metadata", "--out-dir", WORK, file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      r = { v: f(tcx) };
    });
  });
  if (r === undefined) throw new Error("ERROR: no tcx");
  return r.v;
}

/** `u128::to_le_bytes`. */
function u128_le(v: bigint): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return out;
}

test("with_encode_metadata_header + encoder-d's lists round-trip through the port's MetadataBlob", () => {
  const path = join(WORK, "encd.rmeta");
  with_tcx((tcx) => {
    const local = (d: LocalDefId): number => LocalDefId.local_def_index(d) as number;
    const lang_items_expect = [...tcx.lang_items().iter()].filter(([, d]) => d.krate === LOCAL_CRATE).map(([li, d]) => `${local(d.expect_local())} ${li}`);
    const missing_expect = [...tcx.lang_items().missing];
    const traits_expect = tcx.traits(LOCAL_CRATE).map((d) => local(d.expect_local()));
    let lists!: Lists;
    let hashed_upto = 0;
    let header_pos = 0;
    with_encode_metadata_header(tcx, path, (ecx) => {
      expect(ecx.encode_proc_macros()).toBeUndefined();
      lists = {
        crate_deps: ecx.encode_crate_deps(),
        dylib: ecx.encode_dylib_dependency_formats(),
        lib_features: ecx.encode_lib_features(),
        stability_implications: ecx.encode_stability_implications(),
        lang_items: ecx.encode_lang_items(),
        diagnostic_items: ecx.encode_diagnostic_items(),
        // `encode_fake_doc_items`: the `fake_doc_items` provider is not ported (rustc_passes; see the handoff).
        lang_items_missing: ecx.encode_lang_items_missing(),
        target_modifiers: ecx.encode_target_modifiers(),
        denied: ecx.encode_enabled_denied_partial_mitigations(),
        traits: ecx.encode_traits(),
        impls: ecx.encode_impls(),
        incoherent_impls: ecx.encode_incoherent_impls(),
        exportable_items: ecx.encode_exportable_items(),
      };
      // What `encode_crate_root` (lane encoder-b) does before the unhashed root.
      ecx.opaque.flush();
      hashed_upto = ecx.opaque.position();
      const hash = Svh.new(Fingerprint.from_le_bytes(u128_le(ecx.metadata_hasher.finish_128())));
      tcx.untracked().local_crate_hash = hash;
      const header: LazyValue<CrateHeader> = ecx.lazy<CrateHeader>(
        { name: tcx.crate_name(LOCAL_CRATE), triple: tcx.sess.opts.target_triple, is_proc_macro_crate: false, is_stub: true },
        encode_CrateHeader,
      );
      header_pos = header.position;
      return [header.position, 0];
    });
    const supplement: Fingerprint = tcx.with_stable_hashing_context((hcx) => {
      const hasher = StableHasher.new();
      stable_hash_Hash64(tcx.sess.opts.dep_tracking_hash(true), hcx, hasher);
      stable_hash_Fingerprint(compute_hir_hash(tcx), hcx, hasher);
      return hasher.finish(Fingerprint);
    });
    // Decoded inside the session (symbols need its globals).
    verify(path, {
      lists,
      lang_items_expect,
      missing_expect,
      traits_expect,
      hashed_upto,
      header_pos,
      supplement,
      cfg_version: tcx.sess.cfg_version,
      crate_name: tcx.crate_name(LOCAL_CRATE),
      local_crate_hash: tcx.untracked().local_crate_hash,
    });
  });
});

type Lists = {
  lang_items: LazyArray<unknown>;
  lang_items_missing: LazyArray<unknown>;
  traits: LazyArray<unknown>;
  impls: LazyArray<unknown>;
  incoherent_impls: LazyArray<unknown>;
  diagnostic_items: LazyArray<unknown>;
  crate_deps: LazyArray<unknown>;
  denied: LazyArray<unknown>;
  target_modifiers: LazyArray<unknown>;
  dylib: LazyArray<unknown>;
  stability_implications: LazyArray<unknown>;
  lib_features: LazyArray<unknown>;
  exportable_items: LazyArray<unknown>;
};
interface Out {
  lists: Lists;
  lang_items_expect: string[];
  missing_expect: LangItem[];
  traits_expect: number[];
  hashed_upto: number;
  header_pos: number;
  supplement: Fingerprint;
  cfg_version: string;
  crate_name: Symbol;
  local_crate_hash: Svh | undefined;
}

function verify(path: string, out: Out): void {
  const bytes = new Uint8Array(readFileSync(path));
  const blob = unwrap_result(MetadataBlob.new(bytes));
  expect(blob.check_compatibility(out.cfg_version).$).toBe("Ok");
  expect(blob.root_pos()).toBe(out.header_pos);
  const header = blob.get_header();
  expect([Symbol.as_str(header.name), header.is_proc_macro_crate, header.is_stub]).toEqual([Symbol.as_str(out.crate_name), false, true]);
  expect(blob.get_crate_hash()).toBe(out.local_crate_hash!);

  // The SVH: XXH3-128 over the supplement fingerprint and every byte flushed before `finish_128`, with the header's
  // position / hash fields still zero.
  const flushed = bytes.slice(0, out.hashed_upto);
  flushed.fill(0, ROOT_POS_OFFSET, CRATE_HASH_OFFSET + 16);
  const input = new Uint8Array(16 + flushed.length);
  input.set(Fingerprint.to_le_bytes(out.supplement), 0);
  input.set(flushed, 16);
  expect(out.local_crate_hash).toBe(Svh.new(Fingerprint.from_le_bytes(u128_le(XxHash3_128.oneshot(input)))));

  const l = out.lists;
  const dec = <T>(a: LazyArray<unknown>, d: (x: never) => T): T[] => [...(a as LazyArray<T>).decode(blob, d as never)];
  expect(dec(l.lang_items, (d) => decode_tuple(d, decode_DefIndex, decode_LangItem)).map(([i, li]) => `${i} ${li}`)).toEqual(out.lang_items_expect);
  expect(out.lang_items_expect.length).toBe(4);
  expect(dec(l.lang_items_missing, decode_LangItem)).toEqual(out.missing_expect);
  expect(dec(l.traits, decode_LocalDefId).map((d) => LocalDefId.local_def_index(d) as number)).toEqual(out.traits_expect);
  expect(out.traits_expect.length).toBe(5);
  const impls = dec(l.impls, decode_TraitImpls);
  expect(impls.map((ti) => [ti.trait_id.krate, ti.impls.num_elems])).toEqual([
    [0, 1],
    [0, 1],
  ]);
  expect(l.incoherent_impls.num_elems).toBe(0);
  const di = dec(l.diagnostic_items, (d) => decode_tuple(d, decode_Symbol, decode_DefIndex));
  expect(di.map(([s]) => Symbol.as_str(s))).toEqual(["encoder_d_item"]);
  expect(dec(l.denied, decode_DeniedPartialMitigation)).toEqual([
    { kind: "StackProtector", level: { $: "StackProtector", _0: "None" } },
    { kind: "ControlFlowGuard", level: { $: "Enabled", _0: false } },
  ]);
  expect(dec(l.crate_deps, decode_CrateDep)).toEqual([]);
  for (const k of ["target_modifiers", "dylib", "stability_implications", "lib_features", "exportable_items"] as const) {
    expect(`${k}: ${l[k].num_elems}`).toBe(`${k}: 0`);
  }
}

test("rendered_const / classify (encoder.rs:2841)", () => {
  const out = with_tcx((tcx) => {
    const r: Record<string, string> = {};
    for (const id of tcx.hir_free_items()) {
      const def_id = id.owner_id.def_id;
      if (tcx.def_kind(def_id).$ !== "Const") continue;
      const body = tcx.hir_body_owned_by(def_id);
      r[Symbol.as_str(tcx.item_name(LocalDefId.to_def_id(def_id)))] = `${classify(body.value)} ${rendered_const(tcx, body, def_id)}`;
    }
    return r;
  });
  expect(out).toEqual({
    LIT: "Literal 0x10",
    NEG: "Literal -1",
    UNIT: "Simple ()",
    BLOCK: "Simple { 5 }",
    PATH: "Simple LIT",
    CPLX: "Complex _",
  });
});

test("EncodedMetadata: from_path drops the temp dir on an empty file and on its own errors; encode/decode", () => {
  const mk = (name: string): [string, MaybeTempDir] => {
    const dir = join(WORK, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    // `MaybeTempDir::new(TempDir, keep_on_drop = false)`; the stand-in `TempDir` only needs `path`/`keep`/`drop`.
    const td = { path: () => dir, keep: () => dir, drop: () => rmSync(dir, { recursive: true, force: true }) };
    return [dir, MaybeTempDir.new(td as never, false)];
  };
  // empty file: `Ok` with nothing, the dir is gone
  {
    const [dir, td] = mk("empty");
    writeFileSync(join(dir, "full.rmeta"), "");
    const r = EncodedMetadata.from_path(join(dir, "full.rmeta"), undefined, td);
    expect(r.$).toBe("Ok");
    const m = (r as { _0: EncodedMetadata })._0;
    expect([m.full().length, m.stub_or_full().length, m.path()]).toEqual([0, 0, undefined]);
    expect(existsSync(dir)).toBe(false);
  }
  // a missing stub: `Err`, the dir is gone
  {
    const [dir, td] = mk("err");
    writeFileSync(join(dir, "full.rmeta"), "abc");
    const r = EncodedMetadata.from_path(join(dir, "full.rmeta"), join(dir, "nope.rmeta"), td);
    expect(r.$).toBe("Err");
    expect(existsSync(dir)).toBe(false);
  }
  // success: the bytes, the stub, the path; the dir lives until `drop()`
  {
    const [dir, td] = mk("ok");
    writeFileSync(join(dir, "full.rmeta"), "abc");
    writeFileSync(join(dir, "stub.rmeta"), "z");
    const r = EncodedMetadata.from_path(join(dir, "full.rmeta"), join(dir, "stub.rmeta"), td);
    expect(r.$).toBe("Ok");
    const m = (r as { _0: EncodedMetadata })._0;
    expect([[...m.full()], [...m.stub_or_full()], m.path()]).toEqual([[0x61, 0x62, 0x63], [0x7a], join(dir, "full.rmeta")]);
    expect(existsSync(dir)).toBe(true);
    // `Option<Vec<u8>>` then `[u8]`: [1, len, b..] [len, b..]
    const e = MemEncoder.new();
    encode_EncodedMetadata(m, e);
    const enc = e.finish();
    expect([...enc]).toEqual([1, 1, 0x7a, 3, 0x61, 0x62, 0x63]);
    const back = decode_EncodedMetadata(unwrap_result(MemDecoder.new(Uint8Array.from([...enc, ...MAGIC_END_BYTES]), 0)));
    expect([[...back.full()], [...back.stub_or_full()], back.path()]).toEqual([[0x61, 0x62, 0x63], [0x7a], undefined]);
    m.drop();
    expect(existsSync(dir)).toBe(false);
  }
});
