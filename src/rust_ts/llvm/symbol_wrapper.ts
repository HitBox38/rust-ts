// rust-ts: rustc's compiler/rustc_llvm/llvm-wrapper/SymbolWrapper.cpp over the model's Object library (object_file.ts; lane
// llir-callbr-mangler, root's addition for pm-self F2). rustc's archive writer (rustc_codegen_llvm back/archive.rs,
// `LLVM_OBJECT_READER`) asks these for every archive member: the symbols of an object, and, for AIX big archives and COFF
// symbol maps only, whether it is 64-bit, an EC object or an Arm64 COFF file.
//
// PORT decisions:
// - `Callback` and `ErrorCallback` are archive.ts's functions: `Callback(State, name)` takes the name's bytes (the C string
//   without its NUL) and returns `undefined` (a null pointer) or the error to hand back; `LLVMRustGetSymbols` returns that, or
//   `undefined` for `0`.
// - `LLVMContext Context;` is the `true` passed as `createSymbolicFile`'s and `isSymbolicFile`'s context (a context exists).
// - The errors LLVM would report (to `ErrorCallback`, or `report_fatal_error` from `getFlags`) are the model's stops inside
//   object_file.ts (its header); no `ErrorCallback` call is reached.
import { unported } from "../../std/panic.ts";
import { createSymbolicFile, type file_magic, identify_magic, isSymbolicFile, SF, type SymbolicFile } from "./object_file.ts";

/** `object::BasicSymbolRef`: a symbol of a file. */
interface BasicSymbolRef {
  Obj: SymbolicFile;
  Symb: number;
}

// rustc: compiler/rustc_llvm/llvm-wrapper/SymbolWrapper.cpp:24 isArchiveSymbol
function isArchiveSymbol(S: BasicSymbolRef): boolean {
  // `S.getFlags()`; its error is `report_fatal_error` ("FIXME: Actually report errors helpfully."), a stop in the model.
  const SymFlagsOrErr = S.Obj.getSymbolFlags(S.Symb);
  if (SymFlagsOrErr & SF.FormatSpecific) return false;
  if (!(SymFlagsOrErr & SF.Global)) return false;
  if (SymFlagsOrErr & SF.Undefined) return false;
  return true;
}

/** `typedef void *(*LLVMRustGetSymbolsCallback)(void *, const char *);` */
type LLVMRustGetSymbolsCallback = (state: unknown, name: Uint8Array) => unknown;

/** `Expected<std::unique_ptr<SymbolicFile>>`: `undefined` is the null pointer (not a symbolic file). */
// rustc: compiler/rustc_llvm/llvm-wrapper/SymbolWrapper.cpp:43 getSymbolicFile
function getSymbolicFile(Buf: Uint8Array): SymbolicFile | undefined {
  const Type: file_magic = identify_magic(Buf);
  // Don't attempt to read non-symbolic file types.
  if (!isSymbolicFile(Type, true)) return undefined;
  if (Type === "bitcode") {
    return createSymbolicFile(Buf, "bitcode", true);
  } else {
    // `createSymbolicFile(Buf)`: `file_magic::unknown` and no context (SymbolicFile.h:176).
    return createSymbolicFile(Buf, "unknown", false);
  }
}

// rustc: compiler/rustc_llvm/llvm-wrapper/SymbolWrapper.cpp:66 LLVMRustGetSymbols
export function LLVMRustGetSymbols(BufPtr: Uint8Array | undefined, BufLen: number, State: unknown, Callback: unknown, ErrorCallback: unknown): unknown {
  void ErrorCallback;
  if (BufPtr === undefined) return unported("llir: LLVMRustGetSymbols of a null buffer");
  // `MemoryBuffer::getMemBuffer(StringRef(BufPtr, BufLen), "LLVMRustGetSymbolsObject", false)`.
  const Buf = BufPtr.subarray(0, BufLen);

  // In the scenario when LLVMContext is populated SymbolicFile will contain a
  // reference to it, thus SymbolicFile should be destroyed first.
  const Obj = getSymbolicFile(Buf);
  if (Obj === undefined) {
    return undefined;
  }

  for (const Symb of Obj.symbols()) {
    const S: BasicSymbolRef = { Obj, Symb };
    if (!isArchiveSymbol(S)) continue;
    // `S.printName(SymName)`, then `SymName << '\0'`: the callback reads the C string.
    const SymNameBuf = Obj.printSymbolName(Symb);
    const E = (Callback as LLVMRustGetSymbolsCallback)(State, SymNameBuf);
    if (E !== undefined && E !== null) {
      return E;
    }
  }
  return undefined;
}

/** `bool withBufferAsSymbolicFile(char *BufPtr, size_t BufLen, std::function<bool(object::SymbolicFile &)> Callback)`. */
// rustc: compiler/rustc_llvm/llvm-wrapper/SymbolWrapper.cpp:106 withBufferAsSymbolicFile
function withBufferAsSymbolicFile(BufPtr: Uint8Array | undefined, BufLen: number, Callback: (Obj: SymbolicFile) => boolean): boolean {
  if (BufPtr === undefined) return unported("llir: withBufferAsSymbolicFile of a null buffer");
  const Buf = BufPtr.subarray(0, BufLen);
  // (`ObjOrErr`'s error is `false`; the model's errors are stops inside object_file.ts.)
  const Obj = getSymbolicFile(Buf);
  if (Obj === undefined) {
    return false;
  }
  return Callback(Obj);
}

// rustc: compiler/rustc_llvm/llvm-wrapper/SymbolWrapper.cpp:129 LLVMRustIs64BitSymbolicFile
export function LLVMRustIs64BitSymbolicFile(BufPtr: Uint8Array | undefined, BufLen: number): boolean {
  return withBufferAsSymbolicFile(BufPtr, BufLen, (Obj) => Obj.is64Bit());
}

// rustc: compiler/rustc_llvm/llvm-wrapper/SymbolWrapper.cpp:134 LLVMRustIsECObject
export function LLVMRustIsECObject(BufPtr: Uint8Array | undefined, BufLen: number): boolean {
  return withBufferAsSymbolicFile(BufPtr, BufLen, (Obj) => {
    // Code starting from this line is copied from isECObject in
    // ArchiveWriter.cpp with an extra #if to work with LLVM 17.
    // (`createSymbolicFile` stops for COFF objects and import files and for bitcode, so these three are never true here.)
    if (Obj.isCOFF()) return unported("llir: LLVMRustIsECObject of a COFF object (COFFObjectFile::getMachine)");

    if (Obj.isCOFFImportFile()) return unported("llir: LLVMRustIsECObject of a COFF import file");

    if (Obj.isIR()) return unported("llir: LLVMRustIsECObject of bitcode (getBitcodeTargetTriple)");

    return false;
  });
}

// rustc: compiler/rustc_llvm/llvm-wrapper/SymbolWrapper.cpp:160 LLVMRustIsAnyArm64Coff
export function LLVMRustIsAnyArm64Coff(BufPtr: Uint8Array | undefined, BufLen: number): boolean {
  return withBufferAsSymbolicFile(BufPtr, BufLen, (Obj) => {
    // Code starting from this line is copied from isAnyArm64COFF in
    // ArchiveWriter.cpp.
    if (Obj.isCOFF()) return unported("llir: LLVMRustIsAnyArm64Coff of a COFF object (COFFObjectFile::getMachine)");

    if (Obj.isCOFFImportFile()) return unported("llir: LLVMRustIsAnyArm64Coff of a COFF import file");

    if (Obj.isIR()) return unported("llir: LLVMRustIsAnyArm64Coff of bitcode (getBitcodeTargetTriple)");

    return false;
  });
}
