// Port of compiler/rustc_codegen_ssa/src/back/link/raw_dylib.rs (lane ssa-link-b, wave 40r).
//
// PORT:
// - `create_dll_import_lib` is a provided method of `ArchiveBuilderBuilder` (back/archive.ts `ArchiveBuilderBuilder_provided`,
//   receiver first), reached through link.ts's `xlane` table so tests can replace it.
// - `create_elf_raw_dylib_stub` uses `object::write::elf::Writer`'s dynamic-symbol, GNU-version and `.dynamic` writers, which
//   the vendored object (write/elf/writer.ts) does not have yet. The function is ported against `ElfStubWriter` (the methods it
//   calls, as upstream names them) and getting the writer stops by name, so only that stand-in changes when the vendor grows.
//   It is reached only with `#[link(kind = "raw-dylib")]` on an ELF target.
// - `FxIndexMap`s are `Map`s (insertion-ordered); `FxHashMap` is a `Map` that is only looked up.
import { closeSync, openSync, writeSync } from "node:fs";
import { CASE_INSENSITIVE, ToBaseN_u128, to_base_fixed_len } from "../../../rustc_data_structures/base_n.ts";
import { StableHasher } from "../../../rustc_data_structures/stable_hash.ts";
import { Hash128 } from "../../../rustc_hashes/lib.ts";
import type { DllCallingConvention, DllImport } from "../../../rustc_crate_store/cstore.gen.ts";
import "../../../rustc_crate_store/cstore.ts"; // `DllImport::ordinal` / `is_missing_decorations`
import type { Session } from "../../../rustc_session/session.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { Arch } from "../../../rustc_target/spec/mod.ts";
import { assert, panic, unported } from "../../../std/panic.ts";
import { debug_str } from "../../../std/fmt.ts";
import { display_IoError, io_error_from_node } from "../../../std/io.ts";
import { path_join } from "../../../std/path.ts";
import { utf8 } from "../../../std/str.ts";
import { Architecture } from "../../../vendor/object/common.ts";
import * as elf from "../../../vendor/object/elf.ts";
import type { Endianness } from "../../../vendor/object/endian.ts";
import type { StringId } from "../../../vendor/object/write/string.ts";
import type { FileHeader as WriteFileHeader, SectionHeader as WriteSectionHeader, SectionIndex as WriteSectionIndex } from "../../../vendor/object/write/elf/writer.ts";
import { i686_decorated_name, is_using_dlltool } from "../../common.ts";
import { ErrorCreatingImportLibrary_diagnostic, MultipleExternalFuncDecl_diagnostic } from "../../diagnostics.gen.ts";
import type { NativeLib } from "../../lib.ts";
import { type ArchiveBuilderBuilder, ArchiveBuilderBuilder_provided, ImportLibraryItem } from "../archive.ts";
import { elf_e_flags, elf_os_abi } from "../metadata.ts";

const encoder = new TextEncoder();

/// Extract all symbols defined in raw-dylib libraries, collated by library name.
///
/// If we have multiple extern blocks that specify symbols defined in the same raw-dylib library,
/// then the CodegenResults value contains one NativeLib instance for each block. However, the
/// linker appears to expect only a single import library for each library used, so we need to
/// collate the symbols together by library name before generating the import libraries.
// rustc: compiler/rustc_codegen_ssa/src/back/link/raw_dylib.rs:27 collate_raw_dylibs_windows
function collate_raw_dylibs_windows(sess: Session, used_libraries: Iterable<NativeLib>): [string, DllImport[]][] {
  // Use index maps to preserve original order of imports and libraries.
  const dylib_table = new Map<string, Map<Symbol, DllImport>>();

  for (const lib of used_libraries) {
    if (lib.kind.$ === "RawDylib") {
      const ext = lib.verbatim ? "" : ".dll";
      const name = `${Symbol.as_str(lib.name)}${ext}`;
      let imports = dylib_table.get(name);
      if (imports === undefined) {
        imports = new Map();
        dylib_table.set(name, imports);
      }
      for (const import_ of lib.dll_imports) {
        // `IndexMap::insert` keeps the key's position and returns the old value.
        const old_import = imports.get(import_.name);
        imports.set(import_.name, import_);
        if (old_import !== undefined) {
          // FIXME: when we add support for ordinals, figure out if we need to do anything
          // if we have two DllImport values with the same name but different ordinals.
          if (!DllCallingConvention_eq(import_.calling_convention, old_import.calling_convention)) {
            sess.dcx().emit_err(
              MultipleExternalFuncDecl_diagnostic({
                span: import_.span,
                function: import_.name,
                library_name: name,
              }),
            );
          }
        }
      }
    }
  }
  sess.dcx().abort_if_errors();
  const out: [string, DllImport[]][] = [];
  for (const [name, imports] of dylib_table) {
    // `import.clone()`: a `DllImport` is not written after metadata decoding, so it is shared.
    out.push([name, [...imports.values()]]);
  }
  return out;
}

// rustc: compiler/rustc_codegen_ssa/src/back/link/raw_dylib.rs:63 create_raw_dylib_dll_import_libs
export function create_raw_dylib_dll_import_libs(
  sess: Session,
  archive_builder_builder: ArchiveBuilderBuilder,
  used_libraries: Iterable<NativeLib>,
  tmpdir: string,
  is_direct_dependency: boolean,
): string[] {
  return collate_raw_dylibs_windows(sess, used_libraries).map(([raw_dylib_name, raw_dylib_imports]) => {
    const name_suffix = is_direct_dependency ? "_imports" : "_imports_indirect";
    const output_path = path_join(tmpdir, `${raw_dylib_name}${name_suffix}.lib`);

    const using_dlltool = is_using_dlltool(sess.target);

    const items: ImportLibraryItem[] = raw_dylib_imports.map((import_: DllImport) => {
      if (sess.target.arch.$ === Arch.X86.$) {
        return new ImportLibraryItem(
          i686_decorated_name(import_, using_dlltool, false, false),
          import_.ordinal(),
          import_.is_missing_decorations() ? i686_decorated_name(import_, using_dlltool, false, true) : undefined,
          import_.symbol_type !== "Function",
        );
      } else {
        return new ImportLibraryItem(Symbol.as_str(import_.name), import_.ordinal(), undefined, import_.symbol_type !== "Function");
      }
    });

    ArchiveBuilderBuilder_provided.create_dll_import_lib(archive_builder_builder, sess, raw_dylib_name, items, output_path);

    return output_path;
  });
}

/// Extract all symbols defined in raw-dylib libraries, collated by library name.
///
/// If we have multiple extern blocks that specify symbols defined in the same raw-dylib library,
/// then the CodegenResults value contains one NativeLib instance for each block. However, the
/// linker appears to expect only a single import library for each library used, so we need to
/// collate the symbols together by library name before generating the import libraries.
// rustc: compiler/rustc_codegen_ssa/src/back/link/raw_dylib.rs:119 collate_raw_dylibs_elf
function collate_raw_dylibs_elf(sess: Session, used_libraries: Iterable<NativeLib>): [string, DllImport[], boolean][] {
  // Use index maps to preserve original order of imports and libraries.
  const dylib_table = new Map<string, [Map<Symbol, DllImport>, boolean]>();

  for (const lib of used_libraries) {
    if (lib.kind.$ === "RawDylib") {
      const as_needed = lib.kind.as_needed;
      let filename: string;
      if (lib.verbatim) {
        filename = Symbol.as_str(lib.name);
      } else {
        const ext = sess.target.options.dll_suffix;
        const prefix = sess.target.options.dll_prefix;
        filename = `${prefix}${Symbol.as_str(lib.name)}${ext}`;
      }

      let entry = dylib_table.get(filename);
      if (entry === undefined) {
        entry = [new Map(), true];
        dylib_table.set(filename, entry);
      }
      const stub_imports = entry[0];
      for (const import_ of lib.dll_imports) {
        stub_imports.set(import_.name, import_);
      }
      entry[1] = entry[1] && (as_needed ?? true);
    }
  }
  sess.dcx().abort_if_errors();
  const out: [string, DllImport[], boolean][] = [];
  for (const [name, [imports, as_needed]] of dylib_table) {
    out.push([name, [...imports.values()], as_needed]);
  }
  return out;
}

// rustc: compiler/rustc_codegen_ssa/src/back/link/raw_dylib.rs:153 create_raw_dylib_elf_stub_shared_objects
export function create_raw_dylib_elf_stub_shared_objects(sess: Session, used_libraries: Iterable<NativeLib>, raw_dylib_so_dir: string): [string, boolean][] {
  return collate_raw_dylibs_elf(sess, used_libraries).map(([load_filename, raw_dylib_imports, as_needed]) => {
    // `load_filename` is the *target/loader* filename that will end up in NEEDED.
    // Usually this will be something like `libc.so` or `libc.so.6` but with
    // verbatim it might also be an absolute path.
    // To be able to support this properly, we always put this load filename
    // into the SONAME of the library and link it via a temporary file with a random name.
    // This also avoids naming conflicts with non-raw-dylib linkage of the same library.

    const shared_object = create_elf_raw_dylib_stub(sess, load_filename, raw_dylib_imports);

    const file_name_hasher = StableHasher.new();
    // `load_filename.hash(&mut file_name_hasher)`: `impl Hash for str` is `state.write_str(self)`.
    file_name_hasher.write_str(utf8(load_filename));
    for (const raw_dylib of raw_dylib_imports) {
      file_name_hasher.write_str(utf8(Symbol.as_str(raw_dylib.name)));
    }

    const library_filename: Hash128 = file_name_hasher.finish(Hash128);
    const temporary_lib_name = `${sess.target.options.dll_prefix}${to_base_fixed_len(Hash128.as_u128(library_filename), CASE_INSENSITIVE, ToBaseN_u128)}${sess.target.options.dll_suffix}`;
    const link_path = path_join(raw_dylib_so_dir, temporary_lib_name);

    // let file = match fs::File::create_new(&link_path) { .. };
    let fd: number;
    try {
      fd = openSync(link_path, "wx");
    } catch (e) {
      return sess.dcx().emit_fatal(ErrorCreatingImportLibrary_diagnostic({ lib_name: load_filename, error: display_IoError(io_error_from_node(e)) }));
    }
    // if let Err(error) = BufWriter::new(file).write_all(&shared_object) { .. }
    try {
      let off = 0;
      while (off < shared_object.length) off += writeSync(fd, shared_object, off);
    } catch (e) {
      sess.dcx().emit_fatal(ErrorCreatingImportLibrary_diagnostic({ lib_name: load_filename, error: display_IoError(io_error_from_node(e)) }));
    } finally {
      closeSync(fd);
    }

    return [temporary_lib_name, as_needed] as [string, boolean];
  });
}

/// Create an ELF .so stub file for raw-dylib.
/// It exports all the provided symbols, but is otherwise empty.
// rustc: compiler/rustc_codegen_ssa/src/back/link/raw_dylib.rs:208 create_elf_raw_dylib_stub
function create_elf_raw_dylib_stub(sess: Session, soname: string, symbols: readonly DllImport[]): Uint8Array {
  const stub_buf: number[] = [];

  // Build the stub ELF using the object crate.
  // The high-level portable API does not allow for the fine-grained control we need,
  // so this uses the low-level object::write::elf API.
  // The low-level API consists of two stages: reservation and writing.
  // We first reserve space for all the things in the binary and then write them.
  // It is important that the order of reservation matches the order of writing.
  // The object crate contains many debug asserts that fire if you get this wrong.

  const arch_ = sess.target.object_architecture(sess.internal_target_features);
  if (arch_ === undefined) {
    return sess.dcx().fatal(`raw-dylib is not supported for the architecture \`${Arch.desc(sess.target.arch)}\``);
  }
  const [arch, sub_arch] = arch_;

  const endianness: Endianness = sess.target.options.endian === "Little" ? "Little" : "Big";

  let is_64: boolean;
  const size = Architecture.address_size(arch);
  if (size === "U8" || size === "U16" || size === "U32") {
    is_64 = false;
  } else if (size === "U64") {
    is_64 = true;
  } else {
    return sess.dcx().fatal(`raw-dylib is not supported for the architecture \`${Arch.desc(sess.target.arch)}\``);
  }

  const stub = new_elf_stub_writer(endianness, is_64, stub_buf);

  const vers: [string, StringId][] = [];
  const vers_map = new Map<string, number>();
  const syms: [string, StringId, number | undefined, DllImport["symbol_type"], DllImport["size"]][] = [];

  for (const symbol of symbols) {
    const symbol_name = Symbol.as_str(symbol.name);
    const at = symbol_name.indexOf("@");
    if (at >= 0) {
      const name = symbol_name.slice(0, at);
      const version_name = symbol_name.slice(at + 1);
      assert(!version_name.includes("@"), "assertion failed: !version_name.contains('@')");
      const dynstr = stub.add_dynamic_string(encoder.encode(name));
      let ver: number;
      const ver_id = vers_map.get(version_name);
      if (ver_id !== undefined) {
        ver = ver_id;
      } else {
        const id = vers.length;
        vers_map.set(version_name, id);
        const dynstr = stub.add_dynamic_string(encoder.encode(version_name));
        vers.push([version_name, dynstr]);
        ver = id;
      }
      syms.push([name, dynstr, ver, symbol.symbol_type, symbol.size]);
    } else {
      const dynstr = stub.add_dynamic_string(encoder.encode(symbol_name));
      syms.push([symbol_name, dynstr, undefined, symbol.symbol_type, symbol.size]);
    }
  }

  const soname_ = stub.add_dynamic_string(encoder.encode(soname));

  // These initial reservations don't reserve any bytes in the binary yet,
  // they just allocate in the internal data structures.

  // First, we create the dynamic symbol table. It starts with a null symbol
  // and then all the symbols and their dynamic strings.
  stub.reserve_null_dynamic_symbol_index();

  for (const _ of syms) {
    stub.reserve_dynamic_symbol_index();
  }

  // Reserve the sections.
  // We have the minimal sections for a dynamic SO and .text where we point our dummy symbols to.
  stub.reserve_shstrtab_section_index();
  const text_section_name = stub.add_section_name(encoder.encode(".text"));
  const text_section = stub.reserve_section_index();
  const data_section_name = stub.add_section_name(encoder.encode(".data"));
  const data_section = stub.reserve_section_index();
  stub.reserve_dynsym_section_index();
  stub.reserve_dynstr_section_index();
  if (vers.length !== 0) {
    stub.reserve_gnu_versym_section_index();
    stub.reserve_gnu_verdef_section_index();
  }
  stub.reserve_dynamic_section_index();

  // These reservations now determine the actual layout order of the object file.
  stub.reserve_file_header();
  stub.reserve_shstrtab();
  stub.reserve_section_headers();
  stub.reserve_dynsym();
  stub.reserve_dynstr();
  const verdef_count = 1 + vers.length;
  let dynamic_entries = 2; // DT_SONAME, DT_NULL
  if (vers.length !== 0) {
    stub.reserve_gnu_versym();
    stub.reserve_gnu_verdef(verdef_count, verdef_count);
    dynamic_entries += 1; // DT_VERDEFNUM
  }
  stub.reserve_dynamic(dynamic_entries);

  // First write the ELF header with the arch information.
  let e_machine: number;
  const fatal_arch = (): never => sess.dcx().fatal(`raw-dylib is not supported for the architecture \`${Arch.desc(sess.target.arch)}\``);
  if (sub_arch !== undefined) {
    e_machine = fatal_arch();
  } else {
    switch (arch) {
      case "Aarch64":
        e_machine = elf.EM_AARCH64;
        break;
      case "Aarch64_Ilp32":
        e_machine = elf.EM_AARCH64;
        break;
      case "Arm":
        e_machine = elf.EM_ARM;
        break;
      case "Avr":
        e_machine = elf.EM_AVR;
        break;
      case "Bpf":
        e_machine = elf.EM_BPF;
        break;
      case "Csky":
        e_machine = elf.EM_CSKY;
        break;
      case "E2K32":
        e_machine = elf.EM_MCST_ELBRUS;
        break;
      case "E2K64":
        e_machine = elf.EM_MCST_ELBRUS;
        break;
      case "I386":
        e_machine = elf.EM_386;
        break;
      case "X86_64":
        e_machine = elf.EM_X86_64;
        break;
      case "X86_64_X32":
        e_machine = elf.EM_X86_64;
        break;
      case "Hexagon":
        e_machine = elf.EM_HEXAGON;
        break;
      case "LoongArch32":
        e_machine = elf.EM_LOONGARCH;
        break;
      case "LoongArch64":
        e_machine = elf.EM_LOONGARCH;
        break;
      case "M68k":
        e_machine = elf.EM_68K;
        break;
      case "Mips":
        e_machine = elf.EM_MIPS;
        break;
      case "Mips64":
        e_machine = elf.EM_MIPS;
        break;
      case "Mips64_N32":
        e_machine = elf.EM_MIPS;
        break;
      case "Msp430":
        e_machine = elf.EM_MSP430;
        break;
      case "PowerPc":
        e_machine = elf.EM_PPC;
        break;
      case "PowerPc64":
        e_machine = elf.EM_PPC64;
        break;
      case "Riscv32":
        e_machine = elf.EM_RISCV;
        break;
      case "Riscv64":
        e_machine = elf.EM_RISCV;
        break;
      case "S390x":
        e_machine = elf.EM_S390;
        break;
      case "Sbf":
        e_machine = elf.EM_SBF;
        break;
      case "Sharc":
        e_machine = elf.EM_SHARC;
        break;
      case "Sparc":
        e_machine = elf.EM_SPARC;
        break;
      case "Sparc32Plus":
        e_machine = elf.EM_SPARC32PLUS;
        break;
      case "Sparc64":
        e_machine = elf.EM_SPARCV9;
        break;
      case "Xtensa":
        e_machine = elf.EM_XTENSA;
        break;
      default:
        e_machine = fatal_arch();
    }
  }

  unwrap_write(
    stub.write_file_header({
      os_abi: elf_os_abi(sess),
      abi_version: 0,
      e_type: elf.ET_DYN,
      e_machine,
      e_entry: 0,
      e_flags: elf_e_flags(arch, sess),
    }),
  );

  // .shstrtab
  stub.write_shstrtab();

  // Section headers
  stub.write_null_section_header();
  stub.write_shstrtab_section_header();
  // Create a dummy .text section for our dummy non-data symbols.
  stub.write_section_header({
    name: text_section_name,
    sh_type: elf.SHT_PROGBITS,
    sh_flags: 0,
    sh_addr: 0,
    sh_offset: 0,
    sh_size: 0,
    sh_link: 0,
    sh_info: 0,
    sh_addralign: 16,
    sh_entsize: 0,
  });
  // And also a dummy .data section for our dummy data symbols.
  stub.write_section_header({
    name: data_section_name,
    sh_type: elf.SHT_PROGBITS,
    sh_flags: elf.SHF_WRITE | elf.SHF_ALLOC,
    sh_addr: 0,
    sh_offset: 0,
    sh_size: 0,
    sh_link: 0,
    sh_info: 0,
    sh_addralign: 16,
    sh_entsize: 0,
  });
  stub.write_dynsym_section_header(0, 1);
  stub.write_dynstr_section_header(0);
  if (vers.length !== 0) {
    stub.write_gnu_versym_section_header(0);
    stub.write_gnu_verdef_section_header(0);
  }
  stub.write_dynamic_section_header(0);

  // .dynsym
  stub.write_null_dynamic_symbol();
  // Linkers like LLD require at least somewhat reasonable symbol values rather than zero,
  // otherwise all the symbols might get put at the same address. Thus we increment the value
  // every time we write a symbol.
  let st_value = 0;
  for (const [_name, dynstr, _ver, symbol_type, size] of syms) {
    const sym_type = symbol_type === "Function" ? elf.STT_FUNC : symbol_type === "Static" ? elf.STT_OBJECT : elf.STT_TLS;
    const section = symbol_type === "Static" ? data_section : text_section;
    stub.write_dynamic_symbol({
      name: dynstr,
      st_info: (elf.STB_GLOBAL << 4) | sym_type,
      st_other: STV_DEFAULT,
      section,
      st_shndx: 0, // ignored by object in favor of the `section` field
      st_value,
      st_size: size.bytes(),
    });
    st_value += 8;
  }

  // .dynstr
  stub.write_dynstr();

  // ld.bfd is unhappy if these sections exist without any symbols, so we only generate them when necessary.
  if (vers.length !== 0) {
    // .gnu_version
    stub.write_null_gnu_versym();
    for (const [_name, _dynstr, ver, _symbol_type, _size] of syms) {
      if (ver !== undefined) {
        assert(((2 + ver) & 0xffff) < VERSYM_HIDDEN, "assertion failed: (2 + ver as u16) < elf::VERSYM_HIDDEN");
        stub.write_gnu_versym(VERSYM_HIDDEN | ((2 + ver) & 0xffff));
      } else {
        stub.write_gnu_versym(1);
      }
    }

    // .gnu_version_d
    stub.write_align_gnu_verdef();
    stub.write_gnu_verdef({
      version: VER_DEF_CURRENT,
      flags: VER_FLG_BASE,
      index: 1,
      aux_count: 1,
      name: soname_,
    });
    vers.forEach(([_name, dynstr], ver) => {
      stub.write_gnu_verdef({
        version: VER_DEF_CURRENT,
        flags: 0,
        index: (2 + ver) & 0xffff,
        aux_count: 1,
        name: dynstr,
      });
    });
  }

  // .dynamic
  // the DT_SONAME will be used by the linker to populate DT_NEEDED
  // which the loader uses to find the library.
  stub.write_align_dynamic();
  unwrap_write(stub.write_dynamic_string(DT_SONAME, soname_));
  // LSB section "2.7. Symbol Versioning" requires `DT_VERDEFNUM` to be reliable.
  if (verdef_count > 1) {
    unwrap_write(stub.write_dynamic(DT_VERDEFNUM, verdef_count));
  }
  // DT_NULL terminates the .dynamic table.
  unwrap_write(stub.write_dynamic(DT_NULL, 0));

  return new Uint8Array(stub_buf);
}

// ---- Helpers (not upstream) ------------------------------------------------------------------------------------------

/** `elf::STV_DEFAULT` (object 0.39.1 elf.rs:1045); not in the vendored `elf.ts` yet. */
const STV_DEFAULT = 0;
/** `elf::VERSYM_HIDDEN` (elf.rs:1746). */
const VERSYM_HIDDEN = 0x8000;
/** `elf::VER_DEF_CURRENT` (elf.rs:1774). */
const VER_DEF_CURRENT = 1;
/** `elf::VER_FLG_BASE` (elf.rs:1778). */
const VER_FLG_BASE = 0x1;
/** `elf::DT_SONAME` (elf.rs:1536). */
const DT_SONAME = 14;
/** `elf::DT_VERDEFNUM` (elf.rs:1665). */
const DT_VERDEFNUM = 0x6fff_fffd;
/** `elf::DT_NULL` (elf.rs:1508). */
const DT_NULL = 0;

/** `object::write::elf::Sym`. */
interface WriteSym {
  name: StringId | undefined;
  section: WriteSectionIndex | undefined;
  st_info: number;
  st_other: number;
  st_shndx: number;
  st_value: number;
  st_size: number;
}

/** `object::write::elf::Verdef`. */
interface WriteVerdef {
  version: number;
  flags: number;
  index: number;
  aux_count: number;
  name: StringId;
}

/** The methods of `object::write::elf::Writer` that `create_elf_raw_dylib_stub` calls (see the header). */
interface ElfStubWriter {
  add_dynamic_string(name: Uint8Array): StringId;
  reserve_null_dynamic_symbol_index(): void;
  reserve_dynamic_symbol_index(): void;
  reserve_shstrtab_section_index(): WriteSectionIndex;
  add_section_name(name: Uint8Array): StringId;
  reserve_section_index(): WriteSectionIndex;
  reserve_dynsym_section_index(): WriteSectionIndex;
  reserve_dynstr_section_index(): WriteSectionIndex;
  reserve_gnu_versym_section_index(): WriteSectionIndex;
  reserve_gnu_verdef_section_index(): WriteSectionIndex;
  reserve_dynamic_section_index(): WriteSectionIndex;
  reserve_file_header(): void;
  reserve_shstrtab(): void;
  reserve_section_headers(): void;
  reserve_dynsym(): void;
  reserve_dynstr(): void;
  reserve_gnu_versym(): void;
  reserve_gnu_verdef(verdef_count: number, verdaux_count: number): void;
  reserve_dynamic(dynamic_num: number): void;
  write_file_header(header: WriteFileHeader): { $: "Ok" } | { $: "Err"; _0: string };
  write_shstrtab(): void;
  write_null_section_header(): void;
  write_shstrtab_section_header(): void;
  write_section_header(section: WriteSectionHeader): void;
  write_dynsym_section_header(sh_addr: number, num_local: number): void;
  write_dynstr_section_header(sh_addr: number): void;
  write_gnu_versym_section_header(sh_addr: number): void;
  write_gnu_verdef_section_header(sh_addr: number): void;
  write_dynamic_section_header(sh_addr: number): void;
  write_null_dynamic_symbol(): void;
  write_dynamic_symbol(sym: WriteSym): void;
  write_dynstr(): void;
  write_null_gnu_versym(): void;
  write_gnu_versym(versym: number): void;
  write_align_gnu_verdef(): void;
  write_gnu_verdef(verdef: WriteVerdef): void;
  write_align_dynamic(): void;
  write_dynamic_string(tag: number, id: StringId): { $: "Ok" } | { $: "Err"; _0: string };
  write_dynamic(tag: number, val: number): { $: "Ok" } | { $: "Err"; _0: string };
}

/** `write::Writer::new(endianness, is_64, &mut stub_buf)`: see the header. */
function new_elf_stub_writer(_endian: Endianness, _is_64: boolean, _buffer: number[]): ElfStubWriter {
  return unported("object::write::elf::Writer (dynamic symbols, GNU versions and .dynamic: vendor object; raw-dylib on ELF)");
}

/** `.unwrap()` of the writer's `Result<()>` (`object::write::Error(String)`, derived `Debug`). */
function unwrap_write(r: { $: "Ok" } | { $: "Err"; _0: string }): void {
  if (r.$ === "Err") panic(`called \`Result::unwrap()\` on an \`Err\` value: Error(${debug_str(r._0)})`);
}

/** `DllCallingConvention`'s derived `PartialEq`. */
function DllCallingConvention_eq(a: DllCallingConvention, b: DllCallingConvention): boolean {
  if (a.$ !== b.$) return false;
  return a.$ === "C" || a._0 === (b as { _0: number })._0;
}
