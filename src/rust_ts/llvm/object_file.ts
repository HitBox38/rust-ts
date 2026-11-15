// rust-ts: the part of LLVM's Object library that rustc's SymbolWrapper.cpp reaches (lane llir-callbr-mangler, root's addition
// for pm-self F2): `identify_magic` (llvm/lib/BinaryFormat/Magic.cpp), `SymbolicFile::isSymbolicFile` / `createSymbolicFile`
// (llvm/lib/Object/SymbolicFile.cpp), `ObjectFile::createObjectFile` / `printSymbolName` (ObjectFile.cpp), and the symbol table
// readers of `MachOObjectFile` (MachOObjectFile.cpp) and `ELFObjectFile<ELFT>` (llvm/include/llvm/Object/ELFObjectFile.h, ELF.h,
// ELFTypes.h). Not ported rustc code: each function copied from LLVM carries `// llvm:`.
//
// PORT decisions (docs/handoff/llir-callbr-mangler.md):
// - Buffers are `Uint8Array`s; names are byte arrays (C strings without their NUL). A `DataRefImpl` is a symbol's index.
// - What a symbol table needs is modelled: Mach-O's header, load commands and LC_SYMTAB (with `checkSymtabCommand`'s checks), and
//   ELF's header, section headers, the first SHT_SYMTAB / SHT_DYNSYM / SHT_SYMTAB_SHNDX and string tables (with the checks of the
//   ELF.h functions on that path). `MachOObjectFile`'s constructor also validates every other load command (segments, sections,
//   overlaps, ...); those checks are not modelled. Every object rustc archives was written by LLVM's MC layer or by a C compiler,
//   so they pass. A check that is modelled and fails, where LLVM would return an `Error` (and rustc print `LLVM error: ...`),
//   stops with `unported` naming the check: the message texts are not modelled.
// - Bitcode (`IRObjectFile`, which needs a bitcode reader and `ModuleSymbolTable`) and the COFF, XCOFF, GOFF, Wasm and DXContainer
//   readers stop. rustc reaches bitcode members only with `-Clinker-plugin-lto` and COFF only on Windows targets.
// - Offsets and sizes are `number`: ELF64's 64-bit fields are read as `bigint` and converted, as no file the model reads is
//   2^53 bytes long.
// - `createELFObjectFile`'s "Insufficient alignment" check reads the buffer's address, which is always aligned for rustc's
//   in-memory buffers; it is left out.
import { unported } from "../../std/panic.ts";

/** `llvm::file_magic::Impl` (llvm/include/llvm/BinaryFormat/Magic.h). */
export type file_magic =
  | "unknown"
  | "bitcode"
  | "clang_ast"
  | "archive"
  | "elf"
  | "elf_relocatable"
  | "elf_executable"
  | "elf_shared_object"
  | "elf_core"
  | "goff_object"
  | "macho_object"
  | "macho_executable"
  | "macho_fixed_virtual_memory_shared_lib"
  | "macho_core"
  | "macho_preload_executable"
  | "macho_dynamically_linked_shared_lib"
  | "macho_dynamic_linker"
  | "macho_bundle"
  | "macho_dynamically_linked_shared_lib_stub"
  | "macho_dsym_companion"
  | "macho_kext_bundle"
  | "macho_universal_binary"
  | "macho_file_set"
  | "minidump"
  | "coff_cl_gl_object"
  | "coff_object"
  | "coff_import_library"
  | "pecoff_executable"
  | "windows_resource"
  | "xcoff_object_32"
  | "xcoff_object_64"
  | "wasm_object"
  | "pdb"
  | "tapi_file"
  | "cuda_fatbinary"
  | "offload_binary"
  | "dxcontainer_object"
  | "offload_bundle"
  | "offload_bundle_compressed"
  | "spirv_object";

// ---- llvm/include/llvm/BinaryFormat/COFF.h ------------------------------------------------------------------------------

const PEMagic = [0x50, 0x45, 0x00, 0x00];
const BigObjMagic = [0xc7, 0xa1, 0xba, 0xd1, 0xee, 0xba, 0xa9, 0x4b, 0xaf, 0x20, 0xfa, 0xf6, 0x6a, 0xa4, 0xdc, 0xb8];
const ClGlObjMagic = [0x38, 0xfe, 0xb3, 0x0c, 0xa5, 0xd9, 0xab, 0x4d, 0xac, 0x9b, 0xd6, 0xb6, 0x22, 0x26, 0x53, 0xc2];
const WinResMagic = [0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00];
/** `offsetof(COFF::BigObjHeader, UUID)`: Sig1, Sig2, Version, Machine (u16 each), TimeDateStamp (u32). */
const BigObjHeader_UUID = 12;

// ---- byte helpers ---------------------------------------------------------------------------------------------------------

/** `startswith(Magic, S)` (Magic.cpp:28) over bytes. */
function startswith(Magic: Uint8Array, S: readonly number[], at = 0): boolean {
  if (Magic.length - at < S.length) return false;
  for (let i = 0; i < S.length; i++) if (Magic[at + i] !== S[i]) return false;
  return true;
}
const bytes = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
function read32(b: Uint8Array, at: number, le: boolean): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, le);
}
function read16(b: Uint8Array, at: number, le: boolean): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(at, le);
}
function read64(b: Uint8Array, at: number, le: boolean): number {
  // PORT: see the header; a value past 2^53 cannot be an offset or size in a file the model reads.
  return Number(new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(at, le));
}
/** `StringRef(const char *)` at `at`: the bytes up to the NUL. Reading past the buffer is undefined behaviour in LLVM; it stops. */
function cString(b: Uint8Array, at: number, what: string): Uint8Array {
  const end = b.indexOf(0, at);
  if (end === -1) return unported(`llir: ${what}: a name without a NUL before the end of the buffer`);
  return b.subarray(at, end);
}

// ---- Magic.cpp ------------------------------------------------------------------------------------------------------------

/// Identify the magic in magic.
// llvm: llvm/lib/BinaryFormat/Magic.cpp:33 identify_magic
export function identify_magic(Magic: Uint8Array): file_magic {
  if (Magic.length < 4) return "unknown";
  switch (Magic[0]!) {
    case 0x00: {
      // COFF bigobj, CL.exe's LTO object file, or short import library file
      if (startswith(Magic, [0x00, 0x00, 0xff, 0xff])) {
        const MinSize = BigObjHeader_UUID + BigObjMagic.length;
        if (Magic.length < MinSize) return "coff_import_library";

        if (startswith(Magic, BigObjMagic, BigObjHeader_UUID)) return "coff_object";
        if (startswith(Magic, ClGlObjMagic, BigObjHeader_UUID)) return "coff_cl_gl_object";
        return "coff_import_library";
      }
      // Windows resource file
      if (Magic.length >= WinResMagic.length && startswith(Magic, WinResMagic)) return "windows_resource";
      // 0x0000 = COFF unknown machine type
      if (Magic[1] === 0) return "coff_object";
      if (startswith(Magic, bytes("\0asm"))) return "wasm_object";
      break;
    }

    case 0x01:
      // XCOFF format
      if (startswith(Magic, [0x01, 0xdf])) return "xcoff_object_32";
      if (startswith(Magic, [0x01, 0xf7])) return "xcoff_object_64";
      break;

    case 0x03:
      if (startswith(Magic, [0x03, 0xf0, 0x00])) return "goff_object";
      // SPIR-V format in little-endian mode.
      if (startswith(Magic, [0x03, 0x02, 0x23, 0x07])) return "spirv_object";
      break;

    case 0x07: // SPIR-V format in big-endian mode.
      if (startswith(Magic, [0x07, 0x23, 0x02, 0x03])) return "spirv_object";
      break;

    case 0x10:
      if (startswith(Magic, [0x10, 0xff, 0x10, 0xad])) return "offload_binary";
      break;

    case 0xde: // 0x0B17C0DE = BC wraper
      if (startswith(Magic, [0xde, 0xc0, 0x17, 0x0b])) return "bitcode";
      break;
    case 0x42: // 'B'
      if (startswith(Magic, [0x42, 0x43, 0xc0, 0xde])) return "bitcode";
      break;
    case 0x43: // 'C'
      if (startswith(Magic, bytes("CCOB"))) return "offload_bundle_compressed";
      if (startswith(Magic, bytes("CPCH"))) return "clang_ast";
      break;
    case 0x5a:
      if (startswith(Magic, [0x5a, 0x4c, 0x81, 0x99, 0x83, 0x88, 0x6e, 0x15]))
        // "!<arch>\n" in EBCDIC
        return "archive";
      break;
    case 0x21: // '!'
      if (startswith(Magic, bytes("!<arch>\n")) || startswith(Magic, bytes("!<thin>\n"))) return "archive";
      break;
    case 0x3c: // '<'
      if (startswith(Magic, bytes("<bigaf>\n"))) return "archive";
      break;
    case 0x7f: // '\177'
      if (startswith(Magic, bytes("\x7fELF")) && Magic.length >= 18) {
        const Data2MSB = Magic[5] === 2;
        const high = Data2MSB ? 16 : 17;
        const low = Data2MSB ? 17 : 16;
        if (Magic[high] === 0) {
          switch (Magic[low]) {
            default:
              return "elf";
            case 1:
              return "elf_relocatable";
            case 2:
              return "elf_executable";
            case 3:
              return "elf_shared_object";
            case 4:
              return "elf_core";
          }
        }
        // It's still some type of ELF file.
        return "elf";
      }
      break;

    case 0xca:
      if (startswith(Magic, [0xca, 0xfe, 0xba, 0xbe]) || startswith(Magic, [0xca, 0xfe, 0xba, 0xbf])) {
        // This is complicated by an overlap with Java class files.
        // See the Mach-O section in /usr/share/file/magic for details.
        // (`Magic[7] < 43` compares a `char`, signed on the oracle's hosts: bytes 0x80-0xff are negative.)
        if (Magic.length >= 8 && (Magic[7]! < 43 || Magic[7]! >= 0x80)) return "macho_universal_binary";
      }
      break;

    // The two magic numbers for mach-o are:
    // 0xfeedface - 32-bit mach-o
    // 0xfeedfacf - 64-bit mach-o
    case 0xfe:
    case 0xce:
    case 0xcf: {
      let type = 0;
      if (startswith(Magic, [0xfe, 0xed, 0xfa, 0xce]) || startswith(Magic, [0xfe, 0xed, 0xfa, 0xcf])) {
        /* Native endian */
        const MinSize = Magic[3] === 0xce ? MACH_HEADER_SIZE : MACH_HEADER_64_SIZE;
        if (Magic.length >= MinSize) type = read32(Magic, 12, false);
      } else if (startswith(Magic, [0xce, 0xfa, 0xed, 0xfe]) || startswith(Magic, [0xcf, 0xfa, 0xed, 0xfe])) {
        /* Reverse endian */
        const MinSize = Magic[0] === 0xce ? MACH_HEADER_SIZE : MACH_HEADER_64_SIZE;
        if (Magic.length >= MinSize) type = read32(Magic, 12, true);
      }
      // `uint16_t type`: the 32-bit read is truncated.
      switch (type & 0xffff) {
        default:
          break;
        case 1:
          return "macho_object";
        case 2:
          return "macho_executable";
        case 3:
          return "macho_fixed_virtual_memory_shared_lib";
        case 4:
          return "macho_core";
        case 5:
          return "macho_preload_executable";
        case 6:
          return "macho_dynamically_linked_shared_lib";
        case 7:
          return "macho_dynamic_linker";
        case 8:
          return "macho_bundle";
        case 9:
          return "macho_dynamically_linked_shared_lib_stub";
        case 10:
          return "macho_dsym_companion";
        case 11:
          return "macho_kext_bundle";
        case 12:
          return "macho_file_set";
      }
      break;
    }
    case 0xf0: // PowerPC Windows
    case 0x83: // Alpha 32-bit
    case 0x84: // Alpha 64-bit
    case 0x66: // MPS R4000 Windows
    case 0x50: // mc68K
    case 0x4c: // 80386 Windows
    case 0xc4: // ARMNT Windows
    case 0x90: // PA-RISC Windows
    case 0x68: {
      // mc68K Windows
      // PORT: the `[[fallthrough]]` chain of Magic.cpp:207-221, written out (noFallthroughCasesInSwitch).
      const m0 = Magic[0]!;
      if (m0 === 0xf0 || m0 === 0x83 || m0 === 0x84 || m0 === 0x66 || m0 === 0x50) {
        if (startswith(Magic, [0x50, 0xed, 0x55, 0xba])) return "cuda_fatbinary";
      }
      if (m0 !== 0x90 && m0 !== 0x68) {
        if (Magic[1] === 0x01) return "coff_object";
      }
      if (Magic[1] === 0x02) return "coff_object";
      break;
    }

    case 0x4d: // 'M': Possible MS-DOS stub on Windows PE file, MSF/PDB file or a Minidump file.
      if (startswith(Magic, bytes("MZ")) && Magic.length >= 0x3c + 4) {
        const off = read32(Magic, 0x3c, true);
        // PE/COFF file, either EXE or DLL.
        if (off <= Magic.length && startswith(Magic, PEMagic, off)) return "pecoff_executable";
      }
      if (startswith(Magic, bytes("Microsoft C/C++ MSF 7.00\r\n"))) return "pdb";
      if (startswith(Magic, bytes("MDMP"))) return "minidump";
      break;

    case 0x64: // x86-64 or ARM64 Windows.
      if (Magic[1] === 0x86 || Magic[1] === 0xaa) return "coff_object";
      break;

    case 0x2d: // YAML '-' MachO TBD.
      if (startswith(Magic, bytes("--- !tapi")) || startswith(Magic, bytes("---\narchs:"))) return "tapi_file";
      break;
    case 0x7b: // JSON '{' MachO TBD.
      return "tapi_file";

    case 0x44: // 'D': DirectX container file - DXBC
      if (startswith(Magic, bytes("DXBC"))) return "dxcontainer_object";
      break;

    case 0x41: // ARM64EC windows
      if (Magic[1] === 0xa6) return "coff_object";
      break;

    case 0x4e: // ARM64X windows
      if (Magic[1] === 0xa6) return "coff_object";
      break;

    case 0x5f: {
      // '_'
      const OBMagic = bytes("__CLANG_OFFLOAD_BUNDLE__");
      // `sizeof(OBMagic)` counts the array's NUL.
      if (Magic.length >= OBMagic.length + 1 && startswith(Magic, OBMagic)) return "offload_bundle";
      break;
    }

    default:
      break;
  }
  return "unknown";
}

// ---- SymbolicFile.h / ObjectFile.h ----------------------------------------------------------------------------------------

/** `SymbolRef::Flags` (llvm/include/llvm/Object/SymbolicFile.h:110). */
export const SF = {
  None: 0,
  Undefined: 1 << 0, // Symbol is defined in another object file
  Global: 1 << 1, // Global symbol
  Weak: 1 << 2, // Weak symbol
  Absolute: 1 << 3, // Absolute symbol
  Common: 1 << 4, // Symbol has common linkage
  Indirect: 1 << 5, // Symbol is an alias to another symbol
  Exported: 1 << 6, // Symbol is visible to other DSOs
  FormatSpecific: 1 << 7, // Specific to the object file format
  Thumb: 1 << 8, // Thumb symbol in a 32-bit ARM binary
  Hidden: 1 << 9, // Symbol has hidden visibility
  Const: 1 << 10, // Symbol value is constant
  Executable: 1 << 11, // Symbol points to an executable section
} as const;

/** `object::SymbolicFile`: the symbols (as indices, `DataRefImpl`), their flags and names. */
export abstract class SymbolicFile {
  constructor(readonly Data: Uint8Array) {}
  /** `symbol_begin()` .. `symbol_end()`, as the `DataRefImpl`s `moveSymbolNext` steps through. */
  abstract symbols(): number[];
  abstract getSymbolFlags(Symb: number): number;
  abstract printSymbolName(Symb: number): Uint8Array;
  abstract is64Bit(): boolean;
  isCOFF(): boolean {
    return false;
  }
  isCOFFImportFile(): boolean {
    return false;
  }
  isIR(): boolean {
    return false;
  }
}

/** `object::ObjectFile`. */
abstract class ObjectFile extends SymbolicFile {
  abstract getSymbolName(Symb: number): Uint8Array;

  // llvm: llvm/lib/Object/ObjectFile.cpp:70 ObjectFile::printSymbolName
  printSymbolName(Symb: number): Uint8Array {
    // `Expected<StringRef> Name = getSymbolName(Symb)`: its errors stop inside (see the header).
    return this.getSymbolName(Symb);
  }
}

// ---- MachOObjectFile.cpp --------------------------------------------------------------------------------------------------

/** `sizeof(MachO::mach_header)`, `sizeof(MachO::mach_header_64)` (llvm/include/llvm/BinaryFormat/MachO.h). */
const MACH_HEADER_SIZE = 28;
const MACH_HEADER_64_SIZE = 32;
/** `MachO::LC_SYMTAB`, `sizeof(MachO::symtab_command)`, `sizeof(MachO::nlist)`, `sizeof(MachO::nlist_64)`. */
const LC_SYMTAB = 0x2;
const SYMTAB_COMMAND_SIZE = 24;
const NLIST_SIZE = 12;
const NLIST_64_SIZE = 16;
/** `MachO::NListType` and `MachO::NListDesc` values (MachO.h). */
const N_STAB = 0xe0;
const N_PEXT = 0x10;
const N_TYPE = 0x0e;
const N_EXT = 0x01;
const N_UNDF = 0x0;
const N_ABS = 0x2;
const N_INDR = 0xa;
const N_ARM_THUMB_DEF = 0x0008;
const N_WEAK_REF = 0x0040;
const N_WEAK_DEF = 0x0080;

/** `MachO::symtab_command`. */
interface symtab_command {
  symoff: number;
  nsyms: number;
  stroff: number;
  strsize: number;
}

/** `MachOObjectFile`: the header, the load commands and LC_SYMTAB (see the header for what its constructor checks). */
class MachOObjectFile extends ObjectFile {
  private readonly Symtab: symtab_command | undefined;

  constructor(
    Data: Uint8Array,
    readonly IsLittleEndian: boolean,
    readonly Is64Bits: boolean,
  ) {
    super(Data);
    const le = IsLittleEndian;
    // `parseHeader`: the header must fit.
    const HeaderSize = Is64Bits ? MACH_HEADER_64_SIZE : MACH_HEADER_SIZE;
    if (Data.length < HeaderSize) unported("llir: MachOObjectFile: truncated or malformed object (mach header)");
    const ncmds = read32(Data, 16, le);
    const sizeofcmds = read32(Data, 20, le);
    if (HeaderSize + sizeofcmds > Data.length) unported("llir: MachOObjectFile: load commands extend past the end of the file");
    // The load commands follow the header; each is `{ cmd, cmdsize }` and then its body (`getNextLoadCommandInfo`).
    let Ptr = HeaderSize;
    let Symtab: symtab_command | undefined;
    for (let I = 0; I < ncmds; I++) {
      if (Ptr + 8 > Data.length) unported(`llir: MachOObjectFile: load command ${I} extends past the end of the file`);
      const cmd = read32(Data, Ptr, le);
      const cmdsize = read32(Data, Ptr + 4, le);
      if (cmdsize < 8) unported(`llir: MachOObjectFile: load command ${I} with size less than 8 bytes`);
      if (cmd === LC_SYMTAB) {
        // `checkSymtabCommand` (MachOObjectFile.cpp:410).
        if (cmdsize < SYMTAB_COMMAND_SIZE) unported(`llir: MachOObjectFile: load command ${I} LC_SYMTAB cmdsize too small`);
        if (Symtab !== undefined) unported("llir: MachOObjectFile: more than one LC_SYMTAB command");
        if (cmdsize !== SYMTAB_COMMAND_SIZE) unported(`llir: MachOObjectFile: LC_SYMTAB command ${I} has incorrect cmdsize`);
        const s: symtab_command = { symoff: read32(Data, Ptr + 8, le), nsyms: read32(Data, Ptr + 12, le), stroff: read32(Data, Ptr + 16, le), strsize: read32(Data, Ptr + 20, le) };
        const FileSize = Data.length;
        if (s.symoff > FileSize) unported(`llir: MachOObjectFile: symoff field of LC_SYMTAB command ${I} extends past the end of the file`);
        if (s.symoff + s.nsyms * (Is64Bits ? NLIST_64_SIZE : NLIST_SIZE) > FileSize) unported(`llir: MachOObjectFile: the symbols of LC_SYMTAB command ${I} extend past the end of the file`);
        if (s.stroff > FileSize) unported(`llir: MachOObjectFile: stroff field of LC_SYMTAB command ${I} extends past the end of the file`);
        if (s.stroff + s.strsize > FileSize) unported(`llir: MachOObjectFile: stroff field plus strsize field of LC_SYMTAB command ${I} extends past the end of the file`);
        Symtab = s;
      }
      Ptr += cmdsize;
    }
    this.Symtab = Symtab;
  }

  // llvm: llvm/lib/Object/MachOObjectFile.cpp:5362 MachOObjectFile::is64Bit
  is64Bit(): boolean {
    return this.Is64Bits;
  }

  /** `symbol_begin()` (MachOObjectFile.cpp:2642) to `symbol_end()` (:2651): every nlist entry of LC_SYMTAB, in order. */
  // llvm: llvm/lib/Object/MachOObjectFile.cpp:2642 MachOObjectFile::symbol_begin
  symbols(): number[] {
    const Symtab = this.Symtab;
    if (Symtab === undefined || Symtab.nsyms === 0) return [];
    return Array.from({ length: Symtab.nsyms }, (_, i) => i);
  }

  /** The offset of symbol `Symb`'s nlist entry (`getSymbolByIndex`, `moveSymbolNext`'s step of `sizeof(nlist[_64])`). */
  private entry(Symb: number): number {
    return this.Symtab!.symoff + Symb * (this.Is64Bits ? NLIST_64_SIZE : NLIST_SIZE);
  }

  // llvm: llvm/lib/Object/MachOObjectFile.cpp:1775 MachOObjectFile::getSymbolName
  getSymbolName(Symb: number): Uint8Array {
    const StringTable = this.Symtab!.stroff;
    const n_strx = read32(this.Data, this.entry(Symb), this.IsLittleEndian);
    if (n_strx === 0)
      // A n_strx value of 0 indicates that no name is associated with a
      // particular symbol table entry.
      return new Uint8Array(0);
    const Start = StringTable + n_strx;
    if (Start >= this.Data.length) return unported(`llir: MachOObjectFile::getSymbolName: bad string index: ${n_strx} for symbol at index ${Symb}`);
    return cString(this.Data, Start, "MachOObjectFile::getSymbolName");
  }

  // llvm: llvm/lib/Object/MachOObjectFile.cpp:1796 MachOObjectFile::getNValue
  getNValue(Sym: number): number {
    const at = this.entry(Sym) + 8;
    if (this.Is64Bits) return read64(this.Data, at, this.IsLittleEndian);
    return read32(this.Data, at, this.IsLittleEndian);
  }

  // llvm: llvm/lib/Object/MachOObjectFile.cpp:1868 MachOObjectFile::getSymbolFlags
  getSymbolFlags(DRI: number): number {
    const at = this.entry(DRI);
    const MachOType = this.Data[at + 4]!;
    const MachOFlags = read16(this.Data, at + 6, this.IsLittleEndian);

    let Result: number = SF.None;

    if ((MachOType & N_TYPE) === N_INDR) Result |= SF.Indirect;

    if (MachOType & N_STAB) Result |= SF.FormatSpecific;

    if (MachOType & N_EXT) {
      Result |= SF.Global;
      if ((MachOType & N_TYPE) === N_UNDF) {
        if (this.getNValue(DRI)) Result |= SF.Common;
        else Result |= SF.Undefined;
      }

      if (MachOType & N_PEXT) Result |= SF.Hidden;
      else Result |= SF.Exported;
    } else if (MachOType & N_PEXT) Result |= SF.Hidden;

    if (MachOFlags & (N_WEAK_REF | N_WEAK_DEF)) Result |= SF.Weak;

    if (MachOFlags & N_ARM_THUMB_DEF) Result |= SF.Thumb;

    if ((MachOType & N_TYPE) === N_ABS) Result |= SF.Absolute;

    return Result;
  }
}

/// Create a MachOObjectFile instance from a given buffer.
// llvm: llvm/lib/Object/MachOObjectFile.cpp:5390 ObjectFile::createMachOObjectFile
function createMachOObjectFile(Buffer: Uint8Array): MachOObjectFile {
  if (startswith(Buffer, [0xfe, 0xed, 0xfa, 0xce])) return new MachOObjectFile(Buffer, false, false);
  if (startswith(Buffer, [0xce, 0xfa, 0xed, 0xfe])) return new MachOObjectFile(Buffer, true, false);
  if (startswith(Buffer, [0xfe, 0xed, 0xfa, 0xcf])) return new MachOObjectFile(Buffer, false, true);
  if (startswith(Buffer, [0xcf, 0xfa, 0xed, 0xfe])) return new MachOObjectFile(Buffer, true, true);
  return unported("llir: ObjectFile::createMachOObjectFile: Unrecognized MachO magic number");
}

// ---- ELFObjectFile.h / ELF.h ----------------------------------------------------------------------------------------------

/** llvm/include/llvm/BinaryFormat/ELF.h. */
const EI_CLASS = 4;
const EI_DATA = 5;
const EI_NIDENT = 16;
const ELFCLASS32 = 1;
const ELFCLASS64 = 2;
const ELFDATA2LSB = 1;
const ELFDATA2MSB = 2;
const SHT_SYMTAB = 2;
const SHT_STRTAB = 3;
const SHT_DYNSYM = 11;
const SHT_SYMTAB_SHNDX = 18;
const SHN_UNDEF = 0;
const SHN_LORESERVE = 0xff00;
const SHN_ABS = 0xfff1;
const SHN_COMMON = 0xfff2;
const SHN_XINDEX = 0xffff;
const STB_LOCAL = 0;
const STB_GLOBAL = 1;
const STB_WEAK = 2;
const STB_GNU_UNIQUE = 10;
const STT_FUNC = 2;
const STT_SECTION = 3;
const STT_FILE = 4;
const STT_COMMON = 5;
const STT_GNU_IFUNC = 10;
const STV_DEFAULT = 0;
const STV_HIDDEN = 2;
const STV_PROTECTED = 3;
const EM_ARM = 40;
const EM_AARCH64 = 183;
const EM_RISCV = 243;
const EM_CSKY = 252;

/** `Elf_Shdr`, the fields this file reads. */
interface Elf_Shdr {
  index: number;
  sh_name: number;
  sh_type: number;
  sh_offset: number;
  sh_size: number;
  sh_link: number;
  sh_entsize: number;
}
/** `Elf_Sym`. */
interface Elf_Sym {
  st_name: number;
  st_info: number;
  st_other: number;
  st_shndx: number;
  st_value: number;
}

/** `ELFObjectFile<ELFT>` with `ELFFile<ELFT>` (`EF`): `ELFT` is `Is64Bits` and the endianness. */
class ELFObjectFile extends ObjectFile {
  private readonly Sections: Elf_Shdr[];
  private DotDynSymSec: Elf_Shdr | undefined;
  private DotSymtabSec: Elf_Shdr | undefined;
  private DotSymtabShndxSec: Elf_Shdr | undefined;
  private readonly e_machine: number;
  private readonly e_shstrndx: number;

  constructor(
    Data: Uint8Array,
    readonly Is64Bits: boolean,
    readonly IsLittleEndian: boolean,
    InitContent: boolean,
  ) {
    super(Data);
    // `ELFFile<ELFT>::create` (ELF.h:1000): the buffer must hold an `Elf_Ehdr`.
    const EhdrSize = Is64Bits ? 64 : 52;
    if (EhdrSize > Data.length) unported(`llir: ELFFile::create: invalid buffer: the size (${Data.length}) is smaller than an ELF header (${EhdrSize})`);
    const le = IsLittleEndian;
    this.e_machine = read16(Data, 18, le);
    this.e_shstrndx = read16(Data, Is64Bits ? 62 : 50, le);
    this.Sections = this.sections();
    if (InitContent) this.initContent();
  }

  private sym_size(): number {
    return this.Is64Bits ? 24 : 16;
  }

  // llvm: llvm/include/llvm/Object/ELF.h:1037 ELFFile<ELFT>::sections
  private sections(): Elf_Shdr[] {
    const b = this.Data;
    const le = this.IsLittleEndian;
    const SectionTableOffset = this.Is64Bits ? read64(b, 40, le) : read32(b, 32, le);
    // PORT: no fake sections (`createFakeSections` is llvm-objdump's).
    if (SectionTableOffset === 0) return [];
    const ShdrSize = this.Is64Bits ? 64 : 40;
    const e_shentsize = read16(b, this.Is64Bits ? 58 : 46, le);
    if (e_shentsize !== ShdrSize) return unported(`llir: ELFFile::sections: invalid e_shentsize in ELF header: ${e_shentsize}`);
    const FileSize = b.length;
    if (SectionTableOffset + ShdrSize > FileSize) return unported("llir: ELFFile::sections: section header table goes past the end of the file");
    if (SectionTableOffset & ((this.Is64Bits ? 8 : 4) - 1)) return unported("llir: ELFFile::sections: invalid alignment of section headers");
    // `getShNum()`: e_shnum, or section 0's sh_size when e_shnum is 0 (`readShdrZero`).
    let NumSections = read16(b, this.Is64Bits ? 60 : 48, le);
    if (NumSections === 0) return unported("llir: ELFFile::getShNum: a section count in section 0's sh_size (readShdrZero)");
    const SectionTableSize = NumSections * ShdrSize;
    // Section table goes past end of file!
    if (SectionTableOffset + SectionTableSize > FileSize) return unported("llir: ELFFile::sections: section table goes past the end of file");
    const r: Elf_Shdr[] = [];
    for (let i = 0; i < NumSections; i++) {
      const at = SectionTableOffset + i * ShdrSize;
      r.push(
        this.Is64Bits
          ? { index: i, sh_name: read32(b, at, le), sh_type: read32(b, at + 4, le), sh_offset: read64(b, at + 24, le), sh_size: read64(b, at + 32, le), sh_link: read32(b, at + 40, le), sh_entsize: read64(b, at + 56, le) }
          : { index: i, sh_name: read32(b, at, le), sh_type: read32(b, at + 4, le), sh_offset: read32(b, at + 16, le), sh_size: read32(b, at + 20, le), sh_link: read32(b, at + 24, le), sh_entsize: read32(b, at + 36, le) },
      );
    }
    NumSections = r.length;
    return r;
  }

  // llvm: llvm/include/llvm/Object/ELFObjectFile.h:525 ELFObjectFile<ELFT>::initContent
  private initContent(): void {
    for (const Sec of this.Sections) {
      switch (Sec.sh_type) {
        case SHT_DYNSYM: {
          if (!this.DotDynSymSec) this.DotDynSymSec = Sec;
          break;
        }
        case SHT_SYMTAB: {
          if (!this.DotSymtabSec) this.DotSymtabSec = Sec;
          break;
        }
        case SHT_SYMTAB_SHNDX: {
          if (!this.DotSymtabShndxSec) this.DotSymtabShndxSec = Sec;
          break;
        }
      }
    }
  }

  // llvm: llvm/include/llvm/Object/ELFObjectFile.h:479 is64Bit
  is64Bit(): boolean {
    return this.Is64Bits;
  }

  /** `getSection(Sections, Index)` (ELF.h:607). */
  private getSection(Index: number): Elf_Shdr {
    if (Index >= this.Sections.length) return unported(`llir: ELFFile::getSection: invalid section index: ${Index}`);
    return this.Sections[Index]!;
  }

  // llvm: llvm/include/llvm/Object/ELF.h:689 ELFFile<ELFT>::getSectionContentsAsArray
  /** The checks of `getSectionContentsAsArray<T>` for `T` of `size` bytes and `align` alignment; the section's offset. */
  private getSectionContentsAsArray(Sec: Elf_Shdr, size: number, align: number): { Offset: number; count: number } {
    if (Sec.sh_entsize !== size && size !== 1) return unported(`llir: ELFFile::getSectionContentsAsArray: section ${Sec.index} has invalid sh_entsize: expected ${size}, but got ${Sec.sh_entsize}`);
    const Offset = Sec.sh_offset;
    const Size = Sec.sh_size;
    if (Size % size) return unported(`llir: ELFFile::getSectionContentsAsArray: section ${Sec.index} has an invalid sh_size (${Size}) which is not a multiple of its sh_entsize (${Sec.sh_entsize})`);
    if (Offset + Size > this.Data.length) return unported(`llir: ELFFile::getSectionContentsAsArray: section ${Sec.index}'s sh_offset + sh_size is greater than the file size`);
    if (Offset % align) return unported("llir: ELFFile::getSectionContentsAsArray: unaligned data");
    return { Offset, count: Size / size };
  }

  /** `EF.symbols(Sec)` (ELF.h:415): no section is an empty range. */
  private symbolsOf(Sec: Elf_Shdr | undefined): { Offset: number; count: number } {
    if (!Sec) return { Offset: 0, count: 0 };
    return this.getSectionContentsAsArray(Sec, this.sym_size(), this.Is64Bits ? 8 : 4);
  }

  /** `getSymbol(Sym)` (ELFObjectFile.h:459): `EF.getEntry<Elf_Sym>(DotSymtabSec, Sym)` (ELF.h:1102); the entry's offset too. */
  private getSymbol(Sym: number): Elf_Sym & { at: number } {
    const { Offset, count } = this.symbolsOf(this.DotSymtabSec);
    if (Sym >= count) return unported(`llir: ELFFile::getEntry: can't read symbol ${Sym}: it goes past the end of the section`);
    const at = Offset + Sym * this.sym_size();
    const b = this.Data;
    const le = this.IsLittleEndian;
    if (this.Is64Bits) return { at, st_name: read32(b, at, le), st_info: b[at + 4]!, st_other: b[at + 5]!, st_shndx: read16(b, at + 6, le), st_value: read64(b, at + 8, le) };
    return { at, st_name: read32(b, at, le), st_value: read32(b, at + 4, le), st_info: b[at + 12]!, st_other: b[at + 13]!, st_shndx: read16(b, at + 14, le) };
  }

  // llvm: llvm/include/llvm/Object/ELF.h:1332 ELFFile<ELFT>::getStringTable
  private getStringTable(Section: Elf_Shdr): { Offset: number; size: number } {
    // PORT: the default `WarnHandler` turns the wrong-sh_type warning into an error (`defaultWarningHandler`).
    if (Section.sh_type !== SHT_STRTAB) return unported(`llir: ELFFile::getStringTable: invalid sh_type for string table section ${Section.index}: expected SHT_STRTAB`);
    const { Offset, count } = this.getSectionContentsAsArray(Section, 1, 1);
    if (count === 0) return unported(`llir: ELFFile::getStringTable: SHT_STRTAB string table section ${Section.index} is empty`);
    if (this.Data[Offset + count - 1] !== 0) return unported(`llir: ELFFile::getStringTable: SHT_STRTAB string table section ${Section.index} is non-null terminated`);
    return { Offset, size: count };
  }

  // llvm: llvm/include/llvm/Object/ELFTypes.h:293 Elf_Sym_Impl<ELFT>::getName
  private symName(ESym: Elf_Sym, StrTab: { Offset: number; size: number }): Uint8Array {
    const Offset = ESym.st_name;
    if (Offset >= StrTab.size) return unported(`llir: Elf_Sym::getName: st_name (0x${Offset.toString(16)}) is past the end of the string table of size 0x${StrTab.size.toString(16)}`);
    return cString(this.Data, StrTab.Offset + Offset, "Elf_Sym::getName");
  }

  // llvm: llvm/include/llvm/Object/ELF.h:1449 ELFFile<ELFT>::getSectionName
  private getSectionName(Section: Elf_Shdr): Uint8Array {
    // `getSectionName(Section, WarnHandler)` (:1437): the section name string table (`getSectionStringTable`, :839), then this.
    const Index = this.e_shstrndx;
    if (Index === SHN_XINDEX) return unported("llir: ELFFile::getShStrNdx: e_shstrndx == SHN_XINDEX (readShdrZero)");
    // There is no section name string table (and no fake sections, see `sections`).
    if (!Index) return new Uint8Array(0);
    if (Index >= this.Sections.length) return unported(`llir: ELFFile::getSectionStringTable: section header string table index ${Index} does not exist`);
    const DotShstrtab = this.getStringTable(this.Sections[Index]!);
    const Offset = Section.sh_name;
    if (Offset === 0) return new Uint8Array(0);
    if (Offset >= DotShstrtab.size) return unported(`llir: ELFFile::getSectionName: a section ${Section.index} has an invalid sh_name`);
    return cString(this.Data, DotShstrtab.Offset + Offset, "ELFFile::getSectionName");
  }

  /** `getSymbolSection(Sym)` → `EF.getSection(ESym, SymTab, ShndxTable)` (ELF.h:650, `getSectionIndex` :633): undefined is
   *  `section_end()`. */
  private getSymbolSection(ESym: Elf_Sym): Elf_Shdr | undefined {
    const Index = ESym.st_shndx;
    if (Index === SHN_XINDEX) return unported("llir: ELFFile::getSectionIndex: SHN_XINDEX (the extended section index table)");
    if (Index === SHN_UNDEF || Index >= SHN_LORESERVE) return undefined;
    return this.getSection(Index);
  }

  // llvm: llvm/include/llvm/Object/ELFObjectFile.h:555 ELFObjectFile<ELFT>::getSymbolName
  getSymbolName(Sym: number): Uint8Array {
    const ESym = this.getSymbol(Sym);
    const SymTableSec = this.DotSymtabSec!;
    const StringTableSec = this.getSection(SymTableSec.sh_link);
    const SymStrTab = this.getStringTable(StringTableSec);
    const Name = this.symName(ESym, SymStrTab);
    if (Name.length !== 0) return Name;

    // If the symbol name is empty use the section name.
    if ((ESym.st_info & 0xf) === STT_SECTION) {
      const Sec = this.getSymbolSection(ESym);
      // PORT: `(*SecOrErr)->getName()` of `section_end()` dereferences the end iterator in LLVM; it stops.
      if (Sec === undefined) return unported("llir: ELFObjectFile::getSymbolName: the section name of a section symbol with no section");
      return this.getSectionName(Sec);
    }
    return Name;
  }

  /** `symbol_begin()` (ELFObjectFile.h:1229) to `symbol_end()` (:1237): the symbol table's entries from index 1 (the null symbol
   *  is skipped when the table holds one), up to `sh_size / sizeof(Elf_Sym)`. */
  // llvm: llvm/include/llvm/Object/ELFObjectFile.h:1229 ELFObjectFile<ELFT>::symbol_begin
  symbols(): number[] {
    const SymTab = this.DotSymtabSec;
    if (!SymTab) return [];
    const begin = SymTab.sh_size >= this.sym_size() ? 1 : 0;
    // `sh_size / sizeof(Elf_Sym)`, an unsigned division.
    const end = Math.floor(SymTab.sh_size / this.sym_size());
    const r: number[] = [];
    for (let i = begin; i < end; i++) r.push(i);
    return r;
  }

  // llvm: llvm/include/llvm/Object/ELFObjectFile.h:392 isExportedToOtherDSO
  private isExportedToOtherDSO(ESym: Elf_Sym): boolean {
    const Binding = ESym.st_info >> 4;
    const Visibility = ESym.st_other & 0x3;

    // A symbol is exported if its binding is either GLOBAL or WEAK, and its
    // visibility is either DEFAULT or PROTECTED. All other symbols are not
    // exported.
    return (Binding === STB_GLOBAL || Binding === STB_WEAK || Binding === STB_GNU_UNIQUE) && (Visibility === STV_DEFAULT || Visibility === STV_PROTECTED);
  }

  // llvm: llvm/include/llvm/Object/ELFObjectFile.h:755 ELFObjectFile<ELFT>::getSymbolFlags
  getSymbolFlags(Sym: number): number {
    const ESym = this.getSymbol(Sym);
    let Result: number = SF.None;
    const Binding = ESym.st_info >> 4;
    const Type = ESym.st_info & 0xf;

    if (Binding !== STB_LOCAL) Result |= SF.Global;

    if (Binding === STB_WEAK) Result |= SF.Weak;

    if (ESym.st_shndx === SHN_ABS) Result |= SF.Absolute;

    if (Type === STT_FILE || Type === STT_SECTION) Result |= SF.FormatSpecific;

    // Set the SF_FormatSpecific flag for the 0-index null symbol.
    const symtab = this.symbolsOf(this.DotSymtabSec);
    if (this.DotSymtabSec && ESym.at === symtab.Offset) Result |= SF.FormatSpecific;

    // Set the SF_FormatSpecific flag for the 0-index null symbol.
    const dynsym = this.symbolsOf(this.DotDynSymSec);
    if (this.DotDynSymSec && ESym.at === dynsym.Offset) Result |= SF.FormatSpecific;

    // PORT: `getSymbolName` errors are consumed by LLVM here ("TODO: Actually report errors helpfully"); the model's stop instead.
    if (this.e_machine === EM_AARCH64) {
      const Name = this.getSymbolName(Sym);
      if (startsWithStr(Name, "$d") || startsWithStr(Name, "$x")) Result |= SF.FormatSpecific;
    } else if (this.e_machine === EM_ARM) {
      const Name = this.getSymbolName(Sym);
      // TODO Investigate why empty name symbols need to be marked.
      if (Name.length === 0 || startsWithStr(Name, "$d") || startsWithStr(Name, "$t") || startsWithStr(Name, "$a")) Result |= SF.FormatSpecific;
      if (Type === STT_FUNC && (ESym.st_value & 1) === 1) Result |= SF.Thumb;
    } else if (this.e_machine === EM_CSKY) {
      const Name = this.getSymbolName(Sym);
      if (startsWithStr(Name, "$d") || startsWithStr(Name, "$t")) Result |= SF.FormatSpecific;
    } else if (this.e_machine === EM_RISCV) {
      const Name = this.getSymbolName(Sym);
      // Mark fake labels (used for label differences) and mapping symbols.
      if (equalsStr(Name, ".L0 ") || startsWithStr(Name, "$d") || startsWithStr(Name, "$x")) Result |= SF.FormatSpecific;
    }

    if (ESym.st_shndx === SHN_UNDEF) Result |= SF.Undefined;

    if (Type === STT_COMMON || ESym.st_shndx === SHN_COMMON) Result |= SF.Common;

    if (this.isExportedToOtherDSO(ESym)) Result |= SF.Exported;

    if (Type === STT_GNU_IFUNC) Result |= SF.Indirect;

    if ((ESym.st_other & 0x3) === STV_HIDDEN) Result |= SF.Hidden;

    return Result;
  }
}

function startsWithStr(Name: Uint8Array, s: string): boolean {
  return startswith(Name, bytes(s));
}
function equalsStr(Name: Uint8Array, s: string): boolean {
  return Name.length === s.length && startswith(Name, bytes(s));
}

// llvm: llvm/lib/Object/ELFObjectFile.cpp:76 ObjectFile::createELFObjectFile
function createELFObjectFile(Obj: Uint8Array, InitContent: boolean): ELFObjectFile {
  // `getElfArchType` (ELF.h:82).
  const Ident: [number, number] = Obj.length < EI_NIDENT ? [0, 0] : [Obj[EI_CLASS]!, Obj[EI_DATA]!];
  if (Ident[0] === ELFCLASS32) {
    if (Ident[1] === ELFDATA2LSB) return new ELFObjectFile(Obj, false, true, InitContent);
    else if (Ident[1] === ELFDATA2MSB) return new ELFObjectFile(Obj, false, false, InitContent);
    else return unported("llir: ObjectFile::createELFObjectFile: Invalid ELF data");
  } else if (Ident[0] === ELFCLASS64) {
    if (Ident[1] === ELFDATA2LSB) return new ELFObjectFile(Obj, true, true, InitContent);
    else if (Ident[1] === ELFDATA2MSB) return new ELFObjectFile(Obj, true, false, InitContent);
    else return unported("llir: ObjectFile::createELFObjectFile: Invalid ELF data");
  }
  return unported("llir: ObjectFile::createELFObjectFile: Invalid ELF class");
}

// ---- ObjectFile.cpp / SymbolicFile.cpp ------------------------------------------------------------------------------------

// llvm: llvm/lib/Object/ObjectFile.cpp:150 ObjectFile::createObjectFile
function createObjectFile(Object: Uint8Array, Type: file_magic, InitContent: boolean): ObjectFile {
  if (Type === "unknown") Type = identify_magic(Object);

  switch (Type) {
    case "unknown":
    case "bitcode":
    case "clang_ast":
    case "coff_cl_gl_object":
    case "archive":
    case "macho_universal_binary":
    case "windows_resource":
    case "pdb":
    case "minidump":
    case "cuda_fatbinary":
    case "offload_binary":
    case "offload_bundle":
    case "offload_bundle_compressed":
    case "spirv_object":
    case "tapi_file":
      // `errorCodeToError(object_error::invalid_file_type)`; `createSymbolicFile` never asks for these.
      return unported(`llir: ObjectFile::createObjectFile of ${Type} (invalid_file_type)`);
    case "elf":
    case "elf_relocatable":
    case "elf_executable":
    case "elf_shared_object":
    case "elf_core":
      return createELFObjectFile(Object, InitContent);
    case "macho_object":
    case "macho_executable":
    case "macho_fixed_virtual_memory_shared_lib":
    case "macho_core":
    case "macho_preload_executable":
    case "macho_dynamically_linked_shared_lib":
    case "macho_dynamic_linker":
    case "macho_bundle":
    case "macho_dynamically_linked_shared_lib_stub":
    case "macho_dsym_companion":
    case "macho_kext_bundle":
    case "macho_file_set":
      return createMachOObjectFile(Object);
    case "coff_object":
    case "coff_import_library":
    case "pecoff_executable":
      return unported(`llir: ObjectFile::createCOFFObjectFile (${Type}; the COFF reader is not modelled)`);
    case "xcoff_object_32":
    case "xcoff_object_64":
      return unported(`llir: ObjectFile::createXCOFFObjectFile (${Type}; not modelled)`);
    case "wasm_object":
      return unported("llir: ObjectFile::createWasmObjectFile (not modelled)");
    case "goff_object":
      return unported("llir: ObjectFile::createGOFFObjectFile (not modelled)");
    case "dxcontainer_object":
      return unported("llir: ObjectFile::createDXContainerObjectFile (not modelled)");
  }
}

/** `createSymbolicFile(Object, Type, Context, InitContent = true)`: `Context` is whether an `LLVMContext` was passed. */
// llvm: llvm/lib/Object/SymbolicFile.cpp:37 SymbolicFile::createSymbolicFile
export function createSymbolicFile(Object: Uint8Array, Type: file_magic, Context: boolean, InitContent = true): SymbolicFile {
  const Data = Object;
  if (Type === "unknown") Type = identify_magic(Data);

  // `errorCodeToError(object_error::invalid_file_type)`: rustc's callers ask `isSymbolicFile` first.
  if (!isSymbolicFile(Type, Context)) return unported(`llir: SymbolicFile::createSymbolicFile of ${Type} (invalid_file_type)`);

  switch (Type) {
    case "bitcode":
      // Context is guaranteed to be non-null here, because bitcode magic only
      // indicates a symbolic file when Context is non-null.
      return unported("llir: IRObjectFile::create (the symbols of an LLVM bitcode file)");
    case "elf":
    case "elf_executable":
    case "elf_shared_object":
    case "elf_core":
    case "goff_object":
    case "macho_executable":
    case "macho_fixed_virtual_memory_shared_lib":
    case "macho_core":
    case "macho_preload_executable":
    case "macho_dynamically_linked_shared_lib":
    case "macho_dynamic_linker":
    case "macho_bundle":
    case "macho_dynamically_linked_shared_lib_stub":
    case "macho_dsym_companion":
    case "macho_kext_bundle":
    case "macho_file_set":
    case "pecoff_executable":
    case "xcoff_object_32":
    case "xcoff_object_64":
    case "wasm_object":
    case "dxcontainer_object":
      return createObjectFile(Object, Type, InitContent);
    case "coff_import_library":
      return unported("llir: COFFImportFile (a COFF short import library; not modelled)");
    case "elf_relocatable":
    case "macho_object":
    case "coff_object": {
      const Obj = createObjectFile(Object, Type, InitContent);
      if (!Context) return Obj;
      // `IRObjectFile::findBitcodeInObject`: an object with an embedded bitcode section is read as that bitcode.
      return unported("llir: IRObjectFile::findBitcodeInObject (createSymbolicFile of an object with an LLVMContext)");
    }
    default:
      return unported(`llir: SymbolicFile::createSymbolicFile: Unexpected Binary File Type ${Type}`);
  }
}

// llvm: llvm/lib/Object/SymbolicFile.cpp:99 SymbolicFile::isSymbolicFile
export function isSymbolicFile(Type: file_magic, Context: boolean): boolean {
  switch (Type) {
    case "bitcode":
      return Context;
    case "elf":
    case "elf_executable":
    case "elf_shared_object":
    case "elf_core":
    case "goff_object":
    case "macho_executable":
    case "macho_fixed_virtual_memory_shared_lib":
    case "macho_core":
    case "macho_preload_executable":
    case "macho_dynamically_linked_shared_lib":
    case "macho_dynamic_linker":
    case "macho_bundle":
    case "macho_dynamically_linked_shared_lib_stub":
    case "macho_dsym_companion":
    case "macho_kext_bundle":
    case "macho_file_set":
    case "pecoff_executable":
    case "xcoff_object_32":
    case "xcoff_object_64":
    case "wasm_object":
    case "coff_import_library":
    case "elf_relocatable":
    case "macho_object":
    case "coff_object":
    case "dxcontainer_object":
      return true;
    default:
      return false;
  }
}
