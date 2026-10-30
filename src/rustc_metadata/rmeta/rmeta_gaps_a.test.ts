// Lane rmeta-gaps-a (wave 33 follow-up): the generated derive(Encodable) / derive(Decodable) of rustc_crate_store's
// `NativeLib` / `ForeignModule` (and their field types), rustc_abi's `ExternAbi` and rustc_middle's `ty::ExprKind`
// operands (`mir::BinOp`, `mir::UnOp`, `abstract_const::CastKind`), round-tripped: a small no_core lib crate with
// `#[link]` blocks is compiled in process (`--crate-type lib --emit=metadata`, x86_64-unknown-linux-gnu), its native
// libraries and foreign modules are encoded with encoder.rs's `encode_native_libraries` / `encode_foreign_modules` on an
// `EncodeContext` over a `MemEncoder`, and decoded back with decoder.ts's element decoders over a stand-in
// `CrateMetadata`, as in encoder_c.test.ts. The oracle comparison of real rmeta bytes is the rmeta probe's.
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
import { decode_ExternAbi, encode_ExternAbi } from "../../rustc_abi/decodable.gen.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { debug_CfgEntry } from "../../rustc_ast/attr/data_structures.ts";
import { debug_NativeLibKind } from "../../rustc_structures/lib.ts";
import { decode_ForeignModule, decode_NativeLib, type ForeignModule, type NativeLib } from "../../rustc_crate_store/lib.ts";
import { decode_ExprKind, encode_ExprKind, type ExprKind } from "../../rustc_middle/ty/consts/kind.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { FileEncoder } from "../../rustc_serialize/opaque.ts";
import { MAGIC_END_BYTES, MemEncoder } from "../../rustc_serialize/opaque.ts";
import { decode_u8 } from "../../rustc_serialize/serialize.ts";
import { CrateNum, DefId, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { HygieneDecodeContext, HygieneEncodeContext } from "../../rustc_span/hygiene.ts";
import type { SourceFile } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { PLAIN } from "../../std/fmt.ts";
import { CrateMetadata_tcx_decoder, type CrateMetadata, MetadataBlob } from "./decoder.ts";
import { EncodeContext } from "./encoder.ts";
import { LazyState, TableBuilders_default } from "./mod.ts";

const WORK = join(DATA, "tmp", "rmeta-gaps-a-test", process.env.RUST_TS_AGENT ?? "default");

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
  "#![feature(no_core, lang_items, link_cfg)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[link(name = "a")] unsafe extern "C" { pub fn fa(); }',
  '#[link(name = "b", kind = "static", modifiers = "-bundle,+whole-archive")] unsafe extern "C" { pub fn fb(); pub static SB: u8; }',
  '#[link(name = "c", kind = "dylib", cfg(target_os = "linux"))] unsafe extern "system" { pub fn fc(); }',
  '#[link(name = "d", modifiers = "+verbatim")] unsafe extern "C-unwind" { pub fn fd(); }',
].join("\n");

/** An `EncodeContext` as `encode_metadata` builds it (encoder.rs:2716), over a `MemEncoder` (encoder_c.test.ts). */
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
 *  wrote (encoder_c.test.ts). */
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

/** `ExternAbi`'s variants in declaration order (extern_abi.rs:19-127): the order encoder.ts's hand-expanded
 *  `encode_ExternAbi` used before the derive was generated (lane encoder-c), so the encoded tag is unchanged. */
const EXTERN_ABI_VARIANTS: readonly ExternAbi["$"][] = [
  "C", "System", "Rust", "RustCall", "RustCold", "RustInvalid", "RustPreserveNone", "RustTail", "LlvmIntrinsic", "Custom", "EfiApi",
  "Swift", "Aapcs", "CmseNonSecureCall", "CmseNonSecureEntry", "GpuKernel", "PtxKernel", "AvrInterrupt", "AvrNonBlockingInterrupt",
  "Msp430Interrupt", "RiscvInterruptM", "RiscvInterruptS", "X86Interrupt", "Cdecl", "Stdcall", "Fastcall", "Thiscall", "Vectorcall",
  "SysV64", "Win64",
];

test("rmeta-gaps-a: NativeLib / ForeignModule / ExternAbi / ExprKind encoded and decoded back with the generated derives", () => {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "gaps.rs");
  writeFileSync(file, SRC);
  const args = ["--crate-type", "lib", "--edition", "2024", "--target", "x86_64-unknown-linux-gnu", "--emit=metadata", "--out-dir", WORK, file];
  const out: string[] = [];
  run_compiler(config_from_args(args), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      tcx.analysis(null);
      const e = ecx(tcx);
      const native = e.encode_native_libraries();
      const foreign = e.encode_foreign_modules();
      // every `ExternAbi` variant (`unwind: true` where it has the field), then `ExprKind`s of each operand kind
      const abis = ExternAbi.ALL_VARIANTS.map((abi) => [abi, e.lazy(abi, encode_ExternAbi)] as const);
      const exprs: ExprKind[] = [{ $: "Binop", _0: "Sub" }, { $: "UnOp", _0: "Neg" }, ExprKind_FunctionCall, { $: "Cast", _0: "Use" }];
      const expr_lazies = exprs.map((x) => e.lazy(x, encode_ExprKind));
      const m = meta(e, tcx);

      // `DefId`s decode in crate 1 (the stand-in's cnum); print the index, which is the local one
      const def = (d: DefId | undefined): string => (d === undefined ? "-" : tcx.def_path_str(new DefId(d.index, LOCAL_CRATE)));
      const lib_str = (l: NativeLib): string =>
        `${debug_NativeLibKind(l.kind, PLAIN)} ${Symbol.as_str(l.name)} cfg ${l.cfg === undefined ? "-" : debug_CfgEntry(l.cfg, PLAIN).replace(/, span: [^}]*/g, " ")} module ${def(l.foreign_module)} verbatim ${l.verbatim} dll_imports ${l.dll_imports.length}`;
      const fm_str = (f: ForeignModule): string => `${def(f.def_id)} [${f.foreign_items.map(def).join(", ")}] ${ExternAbi.as_str(f.abi)}`;
      const libs = tcx.native_libraries(LOCAL_CRATE) as NativeLib[];
      const back = [...native.decode(m, decode_NativeLib)];
      expect(back.map(lib_str)).toEqual(libs.map(lib_str));
      for (const l of back) out.push(lib_str(l));
      const fms = [...(tcx.foreign_modules(LOCAL_CRATE) as Map<DefId, ForeignModule>).values()];
      const fms_back = [...foreign.decode(m, decode_ForeignModule)];
      expect(fms_back.map(fm_str)).toEqual(fms.map(fm_str));
      for (const f of fms_back) out.push(fm_str(f));

      for (const [abi, lazy] of abis) {
        const d = CrateMetadata_tcx_decoder(m, lazy.position);
        const tag = decode_u8(d);
        const decoded = lazy.decode(m, decode_ExternAbi);
        expect([tag, ExternAbi.as_str(decoded)]).toEqual([EXTERN_ABI_VARIANTS.indexOf(abi.$), ExternAbi.as_str(abi)]);
      }
      out.push(`extern abis: ${abis.length} round trips`);
      for (const [i, lazy] of expr_lazies.entries()) {
        const d = CrateMetadata_tcx_decoder(m, lazy.position);
        const bytes = [decode_u8(d), exprs[i]!.$ === "FunctionCall" ? "-" : decode_u8(d)];
        out.push(`${JSON.stringify(lazy.decode(m, decode_ExprKind))}: ${bytes.join(" ")}`);
      }
    });
  });
  expect(out).toEqual([
    // (an `extern` block's def path is empty, as in encoder_c.test.ts)
    "Unspecified a cfg - module  verbatim undefined dll_imports 0",
    "Static { bundle: Some(false), whole_archive: Some(true), export_symbols: None } b cfg - module  verbatim undefined dll_imports 0",
    'Dylib { as_needed: None } c cfg NameValue { name: "target_os", value: Some("linux") } module  verbatim undefined dll_imports 0',
    "Unspecified d cfg - module  verbatim true dll_imports 0",
    " [fa] C",
    " [fb, SB] C",
    " [fc] system",
    " [fd] C-unwind",
    // `ALL_VARIANTS`: the 30 variants, the 10 with `unwind` twice
    "extern abis: 40 round trips",
    // `ExprKind` (consts/kind.rs:13): the variant index, then the operand's (mir::BinOp `Sub` = 3, UnOp `Neg` = 1,
    // abstract_const::CastKind `Use` = 1)
    '{"$":"Binop","_0":"Sub"}: 0 3',
    '{"$":"UnOp","_0":"Neg"}: 1 1',
    '{"$":"FunctionCall"}: 2 -',
    '{"$":"Cast","_0":"Use"}: 3 1',
  ]);
}, 240_000);

const ExprKind_FunctionCall: ExprKind = { $: "FunctionCall" };
