// Lane encoder-c (plan-m5 wave 33): encoder.rs:1482-2030 (`encode_def_ids` .. `encode_foreign_modules`).
// A small no_core lib crate is compiled in process (as `--crate-type lib --emit=metadata`, with
// `-Zforce-unstable-if-unmarked` so the stability encoders write), then the ported fns run on an `EncodeContext` over a
// `MemEncoder` with the real `TyCtxt`, as `encode_crate_root` (encoder.rs:651, lane encoder-b) calls them. The tables
// they fill are read back from the `TableBuilder`s and their lazy values decoded with the port's own decoders
// (decoder.ts `MetadataDecodeContext` over a stand-in `CrateMetadata`, as in encoder_span_hygiene.test.ts).
// The oracle comparison of real rmeta bytes is the rmeta probe's (lane probe-rmetadump), not this test's.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import "../../rustc_session/lib.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import "../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import "../../rustc_middle/lib.ts";
import "../../rustc_mir_build/lib.ts";
import "../lib.ts";
import { type CodegenFnAttrs, debug_CodegenFnAttrs, decode_CodegenFnAttrs, encode_CodegenFnAttrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import { decode_ModChild } from "../../rustc_middle/decodable.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { decode_ReprOptions } from "../../rustc_abi/decodable.gen.ts";
import { debug_ReprOptions } from "../../rustc_abi/lib.ts";
import type { FileEncoder } from "../../rustc_serialize/opaque.ts";
import { MAGIC_END_BYTES, MemEncoder } from "../../rustc_serialize/opaque.ts";
import { decode_bool, decode_u8, decode_usize } from "../../rustc_serialize/serialize.ts";
import { CRATE_DEF_ID, CrateNum, DefId, DefIndex, LOCAL_CRATE, LocalDefId } from "../../rustc_span/def_id.ts";
import { HygieneDecodeContext, HygieneEncodeContext } from "../../rustc_span/hygiene.ts";
import type { SourceFile } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { decode_VariantData } from "../decodable.gen.ts";
import { CrateMetadata_tcx_decoder, type CrateMetadata, MetadataBlob, type MetadataDecodeContext } from "./decoder.ts";
import { EncodeContext } from "./encoder.ts";
import { type LazyArray, LazyState, TableBuilders_default } from "./mod.ts";
import type { TableBuilder } from "./table.ts";

const WORK = join(DATA, "tmp", "encoder-c-test", process.env.RUST_TS_AGENT ?? "default");

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
  "#![feature(no_core, lang_items, decl_macro)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[lang = "copy"] pub trait Copy {}',
  "impl Copy for u8 {}",
  "impl Copy for i32 {}",
  '#[lang = "legacy_receiver"] pub trait LegacyReceiver {}',
  "impl<T: PointeeSized> LegacyReceiver for &T {}",
  "pub struct S { pub a: u8, b: i32 }",
  "pub struct T(pub u8);",
  "pub struct U;",
  "#[repr(u8)] pub enum E { A, B(u8) = 5, C { x: u8 } }",
  "#[repr(C)] pub union Un { pub a: u8, b: i32 }",
  "pub trait Tr { type A; const C: u8; fn f(&self) -> u8 { 0 } }",
  "impl Tr for S { type A = u8; const C: u8 = 1; }",
  "pub mod m { pub fn g() {} }",
  "pub use m::g as h;",
  "#[macro_export] macro_rules! mac { () => {} }",
  'unsafe extern "C" { pub fn ext(x: u8); }',
  '#[deprecated(since = "1.0.0", note = "old")] pub fn old() {}',
  "#[inline] pub fn inl() {}",
  "pub const K: u8 = 3;",
].join("\n");

/** An `EncodeContext` as `encode_metadata` builds it (encoder.rs:2716), over a `MemEncoder`. */
function ecx(tcx: TyCtxt): EncodeContext {
  const files = tcx.sess.source_map().files().deref();
  const e = new EncodeContext(
    MemEncoder.new() as unknown as FileEncoder,
    undefined as never,
    tcx,
    tcx.features(),
    TableBuilders_default(),
    LazyState.NoNode,
    new Map(),
    new Map(),
    new Map(),
    new Map(),
    [files[0] as SourceFile, 0],
    new Map(),
    false,
    HygieneEncodeContext.default(),
    new Map(),
  );
  // positions start at 1 (`NonZero`); the real encoder starts with the header
  e.emit_u8(0xee);
  return e;
}

/** The decoding side: a stand-in `CrateMetadata` (crate 1; the encoded `LOCAL_CRATE` maps to it) over the bytes `e`
 *  wrote; its imported source files are the session's own (so decoded spans equal the encoded ones). */
function meta(e: EncodeContext, tcx: TyCtxt): [CrateMetadata, TyCtxt] {
  const bytes = (e.opaque as unknown as MemEncoder).finish();
  const files = tcx.sess.source_map().files().deref();
  const by_disk_index = new Map<number, SourceFile>();
  for (const [file_index, on_disk_index] of e.required_source_files ?? []) by_disk_index.set(on_disk_index, files[file_index]!);
  const blob = new MetadataBlob(new Uint8Array([...bytes, ...MAGIC_END_BYTES]));
  const cnum = CrateNum.from_u32(1);
  const cdata = {
    cnum,
    blob: () => blob,
    alloc_decoding_state: { new_decoding_session: () => undefined },
    map_encoded_cnum_to_current: (c: CrateNum) => (c === LOCAL_CRATE ? cnum : c),
    hygiene_context: HygieneDecodeContext.default(),
    root: { name: () => Symbol.intern("enc"), is_proc_macro_crate: () => false },
    imported_source_file: (_tcx: TyCtxt, index: number) => {
      const f = by_disk_index.get(index)!;
      return { original_start_pos: f.start_pos, original_end_pos: f.end_position(), translated_source_file: f };
    },
  };
  return [cdata as unknown as CrateMetadata, {} as TyCtxt];
}

/** The value a `TableBuilder` holds at `i` (`T::from_bytes` of its block). */
function entry<T>(tb: TableBuilder<LocalDefId, DefIndex, T>, i: LocalDefId): T {
  const block = tb.blocks[i as number];
  return tb.fse.from_bytes(block ?? new Uint8Array(tb.fse.BYTE_LEN));
}

/** Runs `f`; the lane named by the `unported(..)` it stops at, or "returned". */
function stop(f: () => void): string {
  try {
    f();
  } catch (err) {
    if (err instanceof Unported) return /\(lane ([^)]+)\)/.exec(err.message)?.[1] ?? err.message;
    throw err;
  }
  return "returned";
}

test("encoder-c fns on a real lib crate: tables written and decoded back with the port's decoders", () => {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "encc.rs");
  writeFileSync(file, SRC);
  const args = ["--crate-type", "lib", "--edition", "2024", "--emit=metadata", "-Zforce-unstable-if-unmarked", "--out-dir", WORK, file];
  const out: string[] = [];
  const stops: string[] = [];
  run_compiler(config_from_args(args), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      tcx.analysis(null);
      const e = ecx(tcx);
      const by_name = new Map<string, LocalDefId>();
      // (a ctor shares its struct's / variant's path; the map keeps the item)
      for (const id of tcx.iter_local_def_id()) if (tcx.def_kind(id).$ !== "Ctor") by_name.set(tcx.def_path_str(LocalDefId.to_def_id(id)), id);
      const id = (n: string): LocalDefId => {
        const d = by_name.get(n);
        if (d === undefined) throw new Error(`ERROR: no def ${n} in ${[...by_name.keys()].join(", ")}`);
        return d;
      };

      // `encode_def_ids` / `encode_mir` whole: they run until their first stub of another lane (at this lane's base:
      // encoder-b's `should_encode_*` predicates), never one of this lane's
      stops.push(`encode_def_ids: ${stop(() => ecx(tcx).encode_def_ids())}`, `encode_mir: ${stop(() => ecx(tcx).encode_mir())}`);

      // `encode_info_for_mod` (the crate root and `m`) and the ADTs, assoc items, macros, stability, deprecation
      e.encode_info_for_mod(CRATE_DEF_ID);
      e.encode_info_for_mod(id("m"));
      for (const n of ["S", "T", "U", "E", "Un"]) e.encode_info_for_adt(id(n));
      for (const n of ["Tr::A", "Tr::C", "Tr::f", "<S as Tr>::A", "<S as Tr>::C"]) e.encode_info_for_assoc_item(id(n));
      e.encode_info_for_macro(id("mac"));
      for (const n of ["S", "old", "K"]) {
        e.encode_stability(id(n));
        e.encode_const_stability(id(n));
        e.encode_default_body_stability(id(n));
        e.encode_deprecation(id(n));
      }
      const native = e.encode_native_libraries();
      const foreign = e.encode_foreign_modules();
      const eiis = e.encode_externally_implementable_items();
      // a `CodegenFnAttrs` (`#[inline]`), encoded as `encode_def_ids` does
      const attrs = tcx.codegen_fn_attrs(LocalDefId.to_def_id(id("inl"))) as CodegenFnAttrs;
      const attrs_lazy = e.lazy(attrs, encode_CodegenFnAttrs);

      const m = meta(e, tcx);
      const t = e.tables;
      const local_ids = (l: LazyArray<LocalDefId> | undefined): string =>
        l === undefined ? "-" : [...l.decode(m, (d: MetadataDecodeContext) => d.decode_local_def_id())].map((x) => tcx.def_path_str(LocalDefId.to_def_id(x))).join(", ");

      out.push(`crate root children: ${local_ids(entry(t.module_children_non_reexports, CRATE_DEF_ID))}`);
      const reexports = entry(t.module_children_reexports, CRATE_DEF_ID);
      out.push(`crate root reexports: ${[...reexports.decode(m, decode_ModChild)].map((c) => `${Symbol.as_str(c.ident.name)} (chain ${c.reexport_chain.length}, res ${c.res.$} index ${c.res.$ === "Def" ? DefIndex.as_u32(c.res._1.index) : "-"})`).join(", ")}`);
      out.push(`m children: ${local_ids(entry(t.module_children_non_reexports, id("m")))}`);
      for (const n of ["S", "T", "U", "E", "Un"]) {
        const repr = entry(t.repr_options, id(n));
        out.push(`${n}: repr ${repr === undefined ? "-" : debug_ReprOptions(repr.decode(m, decode_ReprOptions), PLAIN)}; children ${local_ids(entry(t.module_children_non_reexports, id(n)))}`);
      }
      for (const n of ["S", "T", "U", "E::A", "E::B", "E::C", "Un"]) {
        const vd = entry(t.variant_data, id(n))?.decode(m, decode_VariantData);
        const fields = local_ids(entry(t.associated_item_or_field_def_ids, id(n)));
        const fn_sig = entry(t.fn_sig, id(n)) !== undefined;
        out.push(
          `${n}: idx ${vd?.idx} discr ${vd?.discr.$} ctor ${vd?.ctor === undefined ? "-" : `${vd.ctor[0]} ${tcx.def_path_str(LocalDefId.to_def_id(vd.ctor[1]))}`} non_exhaustive ${vd?.is_non_exhaustive}; fields ${fields}; fn_sig ${fn_sig}`,
        );
      }
      out.push(`S.b safety: ${JSON.stringify(entry(t.safety, id("S::b")))}; mut_restriction set: ${entry(t.mut_restriction, id("S::b")) !== undefined}`);
      for (const n of ["Tr::A", "Tr::C", "Tr::f", "<S as Tr>::A", "<S as Tr>::C"]) {
        const d = id(n);
        out.push(
          `${n}: defaultness ${JSON.stringify(entry(t.defaultness, d))}; container ${entry(t.assoc_container, d) !== undefined}; item bounds ${entry(t.explicit_item_bounds, d).num_elems}/${entry(t.explicit_item_self_bounds, d).num_elems}`,
        );
      }
      out.push(`mac: macro_rules ${entry(t.is_macro_rules, id("mac"))}; definition ${entry(t.macro_definition, id("mac")) !== undefined}`);
      for (const n of ["S", "old", "K"]) {
        const d = id(n);
        out.push(
          `${n}: stability ${entry(t.lookup_stability, d) !== undefined} const ${entry(t.lookup_const_stability, d) !== undefined} body ${entry(t.lookup_default_body_stability, d) !== undefined} deprecation ${entry(t.lookup_deprecation_entry, d) !== undefined}`,
        );
      }
      out.push(`native libraries: ${native.num_elems}; eiis: ${eiis.num_elems}; foreign modules: ${foreign.num_elems}`);
      // `ForeignModule`: foreign_items (len, then DefIds), def_id, abi (variant `C` = 0, `unwind: false`)
      const d = CrateMetadata_tcx_decoder(m, foreign.position);
      const n_items = decode_usize(d);
      const items = Array.from({ length: n_items }, () => tcx.def_path_str(new DefId(d.decode_def_id().index, LOCAL_CRATE)));
      const fm = tcx.def_path_str(new DefId(d.decode_def_id().index, LOCAL_CRATE));
      out.push(`foreign module: ${fm} [${items.join(", ")}] abi ${decode_u8(d)} unwind ${decode_bool(d)}`);
      const back = attrs_lazy.decode(m, decode_CodegenFnAttrs);
      out.push(`codegen_fn_attrs round trip: ${debug_CodegenFnAttrs(back, PLAIN) === debug_CodegenFnAttrs(attrs, PLAIN)} (${back.inline.$})`);
    });
  });
  expect(out).toEqual([
    "crate root children: PointeeSized, MetaSized, Sized, Copy, LegacyReceiver, S, T, T, U, U, E, Un, Tr, m, ext, old, inl, K",
    "crate root reexports: h (chain 1, res Def index 38), mac (chain 1, res Def index 40)",
    "m children: m::g",
    "S: repr ReprOptions { int: None, align: None, pack: None, flags: , scalable: None, field_shuffle_seed: 11539551434680059190 }; children -",
    "T: repr ReprOptions { int: None, align: None, pack: None, flags: , scalable: None, field_shuffle_seed: 4072793198091613681 }; children -",
    "U: repr ReprOptions { int: None, align: None, pack: None, flags: , scalable: None, field_shuffle_seed: 8384503747072387521 }; children -",
    "E: repr ReprOptions { int: Some(Fixed(I8, false)), align: None, pack: None, flags: , scalable: None, field_shuffle_seed: 7848025050345092875 }; children E::A, E::A, E::B, E::B, E::C",
    "Un: repr ReprOptions { int: None, align: None, pack: None, flags: IS_C, scalable: None, field_shuffle_seed: 15925507585810380830 }; children -",
    "S: idx 0 discr Relative ctor - non_exhaustive false; fields S::a, S::b; fn_sig false",
    "T: idx 0 discr Relative ctor Fn T non_exhaustive false; fields T::0; fn_sig true",
    "U: idx 0 discr Relative ctor Const U non_exhaustive false; fields ; fn_sig false",
    "E::A: idx 0 discr Relative ctor Const E::A non_exhaustive false; fields ; fn_sig false",
    "E::B: idx 1 discr Explicit ctor Fn E::B non_exhaustive false; fields E::B::0; fn_sig true",
    "E::C: idx 2 discr Relative ctor - non_exhaustive false; fields E::C::x; fn_sig false",
    "Un: idx 0 discr Relative ctor - non_exhaustive false; fields Un::a, Un::b; fn_sig false",
    "S.b safety: \"Safe\"; mut_restriction set: true",
    "Tr::A: defaultness {\"$\":\"Default\",\"has_value\":false}; container true; item bounds 1/1",
    "Tr::C: defaultness {\"$\":\"Default\",\"has_value\":false}; container true; item bounds 0/0",
    "Tr::f: defaultness {\"$\":\"Default\",\"has_value\":true}; container true; item bounds 0/0",
    "<S as Tr>::A: defaultness {\"$\":\"Final\"}; container true; item bounds 0/0",
    "<S as Tr>::C: defaultness {\"$\":\"Final\"}; container true; item bounds 0/0",
    "mac: macro_rules true; definition true",
    "S: stability true const false body false deprecation false",
    "old: stability true const false body false deprecation true",
    "K: stability true const false body false deprecation false",
    "native libraries: 0; eiis: 0; foreign modules: 1",
    "foreign module:  [ext] abi 0 unwind false",
    "codegen_fn_attrs round trip: true (Hint)",
  ]);
  console.log(`encoder-c: ${stops.join("; ")}`);
  for (const s of stops) expect(s).not.toContain("encoder-c");
}, 240_000);

