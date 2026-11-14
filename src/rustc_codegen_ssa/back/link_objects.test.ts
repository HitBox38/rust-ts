// The objects rustc writes through the vendored `object` writer (not LLVM) at link time, against the oracle's (lane
// vendor-object-write): `symbols.o` (link.rs `add_linked_symbol_object`, with apple.rs `add_data_and_relocation`'s
// relocations on Mach-O) and a dylib's `rmeta.o` (metadata.rs `create_compressed_metadata_file`), for aarch64-apple-darwin
// (Mach-O) and x86_64-unknown-linux-gnu (ELF). The fixtures in link_objects_oracle/ are the pinned rustc's own files for
// hello.rs (a bin) and dl.rs (a `-Cprefer-dynamic` dylib), copied by the hand-run link_objects_oracle/regen.ts; no test runs
// the oracle (hence no `.oracle.` in the name). Whole links are compared in docs/handoff/vendor-object-write.md.
//
// `add_linked_symbol_object` is link.ts's (lane ssa-link-b); `symbols_object` below is its non-COFF path, step for step, so
// that this test checks the writer and apple.ts on their own. The linked symbols are the oracle's, in the order rustc added
// them: the order of an ELF symbol table, and on Mach-O the order of the relocations' addresses (each points at its symbol).
// A symbol's kind changes no byte here except `Tls` (none is): undefined Text and Data symbols are both `STT_NOTYPE` on ELF
// and plain `N_UNDF | N_EXT` on Mach-O.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SymbolExportKind } from "../../rustc_middle/middle/exported_symbols.ts";
import type { EncodedMetadata } from "../../rustc_metadata/rmeta/encoder.ts";
import type { Session } from "../../rustc_session/session.ts";
import { OSVersion } from "../../rustc_target/spec/base/apple/mod.ts";
import type { Target } from "../../rustc_target/spec/mod.ts";
import { type Architecture, SectionKind } from "../../vendor/object/common.ts";
import { Symbol as WriteSymbol } from "../../vendor/object/write/mod.ts";
import { add_data_and_relocation } from "./apple.ts";
import { create_compressed_metadata_file, create_object_file } from "./metadata.ts";

const DIR = join(import.meta.dir, "link_objects_oracle");
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(DIR, name)));
const utf8 = new TextEncoder();

/** What `create_object_file` and `add_data_and_relocation` ask of the session for one of the two targets. */
function sess(macho: boolean): Session {
  const target = macho
    ? {
        llvm_target: "arm64-apple-macosx",
        pointer_width: 64,
        os: { $: "MacOs" },
        env: { $: "Unspecified" },
        arch: { $: "AArch64" },
        options: { endian: "Little", binary_format: "MachO", is_like_darwin: true, is_like_wasm: false, os: { $: "MacOs" } },
        object_architecture: (): [Architecture, undefined] => ["Aarch64", undefined],
      }
    : {
        llvm_target: "x86_64-unknown-linux-gnu",
        pointer_width: 64,
        os: { $: "Linux" },
        env: { $: "Gnu" },
        arch: { $: "X86_64" },
        options: { endian: "Little", binary_format: "Elf", is_like_darwin: false, is_like_wasm: false, os: { $: "Linux" } },
        object_architecture: (): [Architecture, undefined] => ["X86_64", undefined],
      };
  return {
    target: target as unknown as Target,
    internal_target_features: new Set(),
    apple_deployment_target: () => OSVersion.minimum_deployment_target(target as unknown as Target),
  } as unknown as Session;
}

/** link.rs `add_linked_symbol_object`'s non-COFF path (`should_export_symbols` is false off MSVC). */
function symbols_object(s: Session, linked_symbols: readonly [string, SymbolExportKind][]): Uint8Array {
  const file = create_object_file(s);
  if (file === undefined) throw new Error("no object file");
  if (file.format() === "MachO") {
    file.set_subsections_via_symbols();
  }
  const ld64_section_helper =
    file.format() === "MachO" ? file.add_section(file.segment_name("Data").slice(), utf8.encode("__data"), SectionKind.Data) : undefined;
  for (const [sym, kind] of linked_symbols) {
    const symbol = file.add_symbol(
      new WriteSymbol(utf8.encode(sym), 0, 0, kind === "Text" ? "Text" : kind === "Data" ? "Data" : "Tls", "Unknown", false, { $: "Undefined" }, { $: "None" }),
    );
    if (ld64_section_helper !== undefined) {
      const r = add_data_and_relocation(file, ld64_section_helper, symbol, s.target, kind);
      if (r.$ === "Err") throw new Error(`failed adding relocation: ${r._0._0}`);
    }
  }
  const out = file.write();
  if (out.$ === "Err") throw new Error(out._0._0);
  return out._0;
}

const STD = "_RNvCsgd1yFkIsQtl_7___rustc";
const T = (s: string): [string, SymbolExportKind] => [s, "Text"];
const D = (s: string): [string, SymbolExportKind] => [s, "Data"];

test("Mach-O symbols.o of a bin (aarch64-apple-darwin): undefined symbols, ld64 relocations", () => {
  const linked: [string, SymbolExportKind][] = [
    T("main"),
    T(`${STD}10rust_panic`),
    T(`${STD}11___rdl_alloc`),
    T(`${STD}12___rust_abort`),
    T(`${STD}13___rdl_dealloc`),
    T(`${STD}13___rdl_realloc`),
    T(`${STD}17___rust_drop_panic`),
    T(`${STD}17rust_begin_unwind`),
    T(`${STD}18___rdl_alloc_zeroed`),
    T(`${STD}24___rust_foreign_exception`),
    T(`${STD}26___rust_alloc_error_handler`),
    D("_RNvNtCsiVXGuGOhadL_3std9panicking11EMPTY_PANIC"),
    T("__isOSVersionAtLeast"),
    T("__isPlatformVersionAtLeast"),
    T("rust_eh_personality"),
    T(`${STD}25___rdl_alloc_error_handler`),
    T(`${STD}18___rust_start_panic`),
    T(`${STD}20___rust_panic_cleanup`),
    T(`${STD}17rust_begin_unwind`),
    T("rust_eh_personality"),
  ];
  expect(symbols_object(sess(true), linked)).toEqual(fixture("macho-bin.symbols.o"));
});

test("Mach-O symbols.o of a dylib (aarch64-apple-darwin)", () => {
  const linked: [string, SymbolExportKind][] = [
    D("_RNvCs67Axe8jMuVp_2dl5TABLE"),
    T("_RNvCs67Axe8jMuVp_2dl6answer"),
    T(`${STD}17rust_begin_unwind`),
    T("rust_eh_personality"),
  ];
  expect(symbols_object(sess(true), linked)).toEqual(fixture("macho-dylib.symbols.o"));
});

test("ELF symbols.o of a bin (x86_64-unknown-linux-gnu): undefined symbols, no relocations", () => {
  const linked: [string, SymbolExportKind][] = [
    T("main"),
    T(`${STD}10rust_panic`),
    T(`${STD}11___rdl_alloc`),
    T(`${STD}12___rust_abort`),
    T(`${STD}13___rdl_dealloc`),
    T(`${STD}13___rdl_realloc`),
    T(`${STD}17___rust_drop_panic`),
    T(`${STD}17rust_begin_unwind`),
    T(`${STD}18___rdl_alloc_zeroed`),
    T(`${STD}24___rust_foreign_exception`),
    T(`${STD}26___rust_alloc_error_handler`),
    D("_RNvNtCs7uvcShySr4P_3std9panicking11EMPTY_PANIC"),
    D("_RNvNtNtNtNtCs7uvcShySr4P_3std3sys4args4unix3imp15ARGV_INIT_ARRAY"),
    T("rust_eh_personality"),
    T(`${STD}25___rdl_alloc_error_handler`),
    T(`${STD}17___rust_probestack`),
    T(`${STD}18___rust_start_panic`),
    T(`${STD}20___rust_panic_cleanup`),
    T(`${STD}17rust_begin_unwind`),
    T("rust_eh_personality"),
  ];
  expect(symbols_object(sess(false), linked)).toEqual(fixture("elf-bin.symbols.o"));
});

test("ELF symbols.o of a dylib (x86_64-unknown-linux-gnu)", () => {
  const linked: [string, SymbolExportKind][] = [
    D("_RNvCs67Axe8jMuVp_2dl5TABLE"),
    T("_RNvCs67Axe8jMuVp_2dl6answer"),
    T(`${STD}17rust_begin_unwind`),
    T("rust_eh_personality"),
  ];
  expect(symbols_object(sess(false), linked)).toEqual(fixture("elf-dylib.symbols.o"));
});

/** The `stub_or_full()` bytes a fixture's `.rustc` section packs: after `METADATA_HEADER` (8 bytes), a `u64` LE length. */
function packed_stub(obj: Uint8Array): Uint8Array {
  const header = [0x72, 0x75, 0x73, 0x74, 0, 0, 0];
  for (let i = 0; i + 16 <= obj.length; i++) {
    if (header.every((x, j) => obj[i + j] === x)) {
      const len = Number(new DataView(obj.buffer, obj.byteOffset).getBigUint64(i + 8, true));
      return obj.slice(i + 16, i + 16 + len);
    }
  }
  throw new Error("no packed metadata in the fixture");
}

for (const [name, macho] of [
  ["macho-dylib.rmeta.o", true],
  ["elf-dylib.rmeta.o", false],
] as const) {
  test(`create_compressed_metadata_file: ${name}`, () => {
    const expected = fixture(name);
    const stub = packed_stub(expected);
    const metadata = { stub_or_full: () => stub } as unknown as EncodedMetadata;
    expect(create_compressed_metadata_file(sess(macho), metadata, "rust_metadata_dl_474fbc9804069811")).toEqual(expected);
  });
}
