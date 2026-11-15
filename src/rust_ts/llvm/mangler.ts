// rust-ts: LLVM's IR name mangler (llvm/lib/IR/Mangler.cpp at the pin) and rustc's `LLVMRustGetMangledName` over it (lane
// llir-callbr-mangler). Not ported rustc code: each function copied from LLVM carries `// llvm:`.
//
// rustc asks for a global's assembler name in two places: `mangled_name` (asm.rs:527, naked functions and `global_asm!`'s `sym`
// operands) and `codegen_global_asm`'s pointer `const` operands. Both reach `Mangler().getNameWithPrefix(OS, GV, true)`.
//
// The data layout's mangling mode (`DataLayout::ManglingMode`, set by the layout's `m:<c>` spec) is read from the module's layout
// string here, as ir.ts's other layout readers do (`pointerSpecBitWidth`, ...): the model does not parse data layouts.
//
// PORT: names are the model's byte strings (ir.ts); `raw_ostream` is a string the caller appends to.
import { unported } from "../../std/panic.ts";
import { Function, GlobalAlias, GlobalObject, GlobalValue, type Module, type Value } from "./ir.ts";
import type { RustString } from "./support.ts";

// ---- the data layout's mangling mode (llvm/IR/DataLayout.h) -------------------------------------------------------------

/** `DataLayout::ManglingModeT` (DataLayout.h:124). */
export type ManglingModeT = "MM_None" | "MM_ELF" | "MM_MachO" | "MM_WinCOFF" | "MM_WinCOFFX86" | "MM_GOFF" | "MM_Mips" | "MM_XCOFF";

/** `DataLayout::ManglingMode` of a module's data layout: `MM_None` by default (DataLayout.h:134), else the last `m:<c>` spec's mode
 *  (`DataLayout::parseSpecification`, DataLayout.cpp:650-676). A spec that layout parsing rejects ("unknown mangling mode",
 *  `m:<mangling>`) is an error there and the module's layout could not have been set, so it stops here. */
export function manglingMode(DL: string): ManglingModeT {
  let ManglingMode: ManglingModeT = "MM_None";
  if (DL === "") return ManglingMode;
  for (const Spec of DL.split("-")) {
    if (!Spec.startsWith("m")) continue;
    const Rest = Spec.slice(1);
    if (!Rest.startsWith(":") || Rest.length !== 2) return unported(`llir: data layout mangling spec ${JSON.stringify(Spec)} (DataLayout parsing)`);
    switch (Rest[1]) {
      case "e":
        ManglingMode = "MM_ELF";
        break;
      case "l":
        ManglingMode = "MM_GOFF";
        break;
      case "o":
        ManglingMode = "MM_MachO";
        break;
      case "m":
        ManglingMode = "MM_Mips";
        break;
      case "w":
        ManglingMode = "MM_WinCOFF";
        break;
      case "x":
        ManglingMode = "MM_WinCOFFX86";
        break;
      case "a":
        ManglingMode = "MM_XCOFF";
        break;
      default:
        return unported(`llir: data layout mangling spec ${JSON.stringify(Spec)} (DataLayout parsing)`);
    }
  }
  return ManglingMode;
}

// llvm: llvm/include/llvm/IR/DataLayout.h:274 hasMicrosoftFastStdCallMangling
export function hasMicrosoftFastStdCallMangling(ManglingMode: ManglingModeT): boolean {
  return ManglingMode === "MM_WinCOFFX86";
}

/// Returns true if symbols with leading question marks should not receive IR
/// mangling. True for Windows mangling modes.
// llvm: llvm/include/llvm/IR/DataLayout.h:280 doNotMangleLeadingQuestionMark
export function doNotMangleLeadingQuestionMark(ManglingMode: ManglingModeT): boolean {
  return ManglingMode === "MM_WinCOFF" || ManglingMode === "MM_WinCOFFX86";
}

// llvm: llvm/include/llvm/IR/DataLayout.h:286 getLinkerPrivateGlobalPrefix
export function getLinkerPrivateGlobalPrefix(ManglingMode: ManglingModeT): string {
  if (ManglingMode === "MM_MachO") return "l";
  return "";
}

/** A `char`; `"\0"` is no prefix. */
// llvm: llvm/include/llvm/IR/DataLayout.h:292 getGlobalPrefix
export function getGlobalPrefix(ManglingMode: ManglingModeT): string {
  switch (ManglingMode) {
    case "MM_None":
    case "MM_ELF":
    case "MM_GOFF":
    case "MM_Mips":
    case "MM_WinCOFF":
    case "MM_XCOFF":
      return "\0";
    case "MM_MachO":
    case "MM_WinCOFFX86":
      return "_";
  }
}

// llvm: llvm/include/llvm/IR/DataLayout.h:308 getInternalSymbolPrefix
export function getInternalSymbolPrefix(ManglingMode: ManglingModeT): string {
  switch (ManglingMode) {
    case "MM_None":
      return "";
    case "MM_ELF":
    case "MM_WinCOFF":
      return ".L";
    case "MM_GOFF":
      return "L#";
    case "MM_Mips":
      return "$";
    case "MM_MachO":
    case "MM_WinCOFFX86":
      return "L";
    case "MM_XCOFF":
      return "L..";
  }
}

// ---- Mangler.cpp --------------------------------------------------------------------------------------------------------

type ManglerPrefixTy = "Default" | "Private" | "LinkerPrivate";

// llvm: llvm/lib/IR/Mangler.cpp:35 getNameWithPrefixImpl
function getNameWithPrefixImpl4(GVName: string, PrefixTy: ManglerPrefixTy, DL: ManglingModeT, Prefix: string): string {
  let OS = "";
  const Name = GVName;
  // assert(!Name.empty() && "getNameWithPrefix requires non-empty name");

  // No need to do anything special if the global has the special "do not
  // mangle" flag in the name.
  if (Name[0] === "\x01") {
    OS += Name.slice(1);
    return OS;
  }

  if (doNotMangleLeadingQuestionMark(DL) && Name[0] === "?") Prefix = "\0";

  if (PrefixTy === "Private") OS += getInternalSymbolPrefix(DL);
  else if (PrefixTy === "LinkerPrivate") OS += getLinkerPrivateGlobalPrefix(DL);

  if (Prefix !== "\0") OS += Prefix;

  // If this is a simple string that doesn't need escaping, just append it.
  OS += Name;
  return OS;
}

// llvm: llvm/lib/IR/Mangler.cpp:64 getNameWithPrefixImpl
function getNameWithPrefixImpl(GVName: string, DL: ManglingModeT, PrefixTy: ManglerPrefixTy): string {
  const Prefix = getGlobalPrefix(DL);
  return getNameWithPrefixImpl4(GVName, PrefixTy, DL, Prefix);
}

// llvm: llvm/lib/IR/Mangler.cpp:83 hasByteCountSuffix
function hasByteCountSuffix(CC: number): boolean {
  switch (CC) {
    case CallingConv_X86_FastCall:
    case CallingConv_X86_StdCall:
    case CallingConv_X86_VectorCall:
      return true;
    default:
      return false;
  }
}

/// Microsoft fastcall and stdcall functions require a suffix on their name
/// indicating the number of words of arguments they take.
// llvm: llvm/lib/IR/Mangler.cpp:96 addByteCountSuffix
function addByteCountSuffix(F: Function): string {
  // Calculate arguments size total.
  const ArgWords = 0;
  for (const _A of F.args) {
    // PORT: each argument's size needs `hasStructRetAttr`, `getPassPointeeByValueCopySize` and `DataLayout::getTypeAllocSize`,
    // which the model does not compute; a function with parameters stops (no built-in target of the D3 set reaches this).
    return unported("llir: Mangler addByteCountSuffix of a function with parameters (DataLayout::getTypeAllocSize)");
  }
  return `@${ArgWords}`;
}

/** `CallingConv::X86_StdCall`, `X86_FastCall`, `X86_VectorCall` (llvm/IR/CallingConv.h). */
const CallingConv_X86_StdCall = 64;
const CallingConv_X86_FastCall = 65;
const CallingConv_X86_VectorCall = 80;

/** `GlobalValue::getAliaseeObject` (Globals.cpp:521) through `findBaseObject` (Globals.cpp:482) with no-op `Op`. */
// llvm: llvm/lib/IR/Globals.cpp:482 findBaseObject
function findBaseObject(C: Value, Aliases: Set<GlobalAlias>): GlobalObject | undefined {
  if (C instanceof GlobalObject) return C;
  if (C instanceof GlobalAlias) {
    if (Aliases.has(C)) return undefined;
    Aliases.add(C);
    return findBaseObject(C.aliasee, Aliases);
  }
  // PORT: the `ConstantExpr` arms (an alias of an offset, a cast or a difference) are not modelled; rustc's aliases name a
  // global directly (`LLVMAddAlias2` of a function or static).
  return unported("llir: GlobalValue::getAliaseeObject through a constant expression");
}

/** `Mangler`: `AnonGlobalIDs` numbers unnamed globals per mangler (llvm/IR/Mangler.h). */
export class Mangler {
  /// We need to give global values the same name every time they are mangled.
  /// This keeps track of the number we give to anonymous ones.
  readonly AnonGlobalIDs = new Map<GlobalValue, number>();

  /// Print the appropriate prefix and the specified global variable's name.
  /// If the global variable doesn't have a name, this fills in a unique name
  /// for the global.
  // llvm: llvm/lib/IR/Mangler.cpp:121 Mangler::getNameWithPrefix
  getNameWithPrefix(GV: GlobalValue, CannotUsePrivateLabel: boolean): string {
    let OS = "";
    let PrefixTy: ManglerPrefixTy = "Default";
    // assert(GV != nullptr && "Invalid Global Value");
    if (GV.linkage === "PrivateLinkage") {
      if (CannotUsePrivateLabel) PrefixTy = "LinkerPrivate";
      else PrefixTy = "Private";
    }

    // `GV->getDataLayout()`: the parent module's (GlobalValue::getDataLayout, Globals.cpp).
    const M: Module | undefined = GV.parent;
    if (M === undefined) throw new Error("llvm: GlobalValue::getDataLayout of a global with no parent module");
    const DL = manglingMode(M.dataLayout);
    if (!GV.hasName()) {
      // Get the ID for the global, assigning a new one if we haven't got one
      // already.
      let ID = this.AnonGlobalIDs.get(GV) ?? 0;
      if (ID === 0) {
        // `unsigned &ID = AnonGlobalIDs[GV]` inserts the entry before `size()` is read.
        this.AnonGlobalIDs.set(GV, 0);
        ID = this.AnonGlobalIDs.size;
        this.AnonGlobalIDs.set(GV, ID);
      }

      // Must mangle the global into a unique ID.
      OS += getNameWithPrefixImpl(`__unnamed_${ID}`, DL, PrefixTy);
      return OS;
    }

    const Name = GV.name;
    let Prefix = getGlobalPrefix(DL);

    // Mangle functions with Microsoft calling conventions specially.  Only do
    // this mangling for x86_64 vectorcall and 32-bit x86.
    const GO = findBaseObject(GV, new Set());
    let MSFunc: Function | undefined = GO instanceof Function ? GO : undefined;

    // Don't add byte count suffixes when '\01' or '?' are in the first
    // character.
    if (Name.startsWith("\x01") || (doNotMangleLeadingQuestionMark(DL) && Name.startsWith("?"))) MSFunc = undefined;

    const CC = MSFunc !== undefined ? MSFunc.callingConv : 0;
    if (!hasMicrosoftFastStdCallMangling(DL) && CC !== CallingConv_X86_VectorCall) MSFunc = undefined;
    if (MSFunc !== undefined) {
      if (CC === CallingConv_X86_FastCall)
        Prefix = "@"; // fastcall functions have an @ prefix instead of _.
      else if (CC === CallingConv_X86_VectorCall) Prefix = "\0"; // vectorcall functions have no prefix.
    }

    OS += getNameWithPrefixImpl4(Name, PrefixTy, DL, Prefix);

    if (MSFunc === undefined) return OS;

    // If we are supposed to add a microsoft-style suffix for stdcall, fastcall,
    // or vectorcall, add it.  These functions have a suffix of @N where N is the
    // cumulative byte size of all of the parameters to the function in decimal.
    if (CC === CallingConv_X86_VectorCall) OS += "@"; // vectorcall functions use a double @ suffix.
    const FT = MSFunc.functionType;
    if (
      hasByteCountSuffix(CC) &&
      // "Pure" variadic functions do not receive @0 suffix.
      (!FT.isVarArg || FT.params.length === 0 || (FT.params.length === 1 && hasStructRetAttr(MSFunc)))
    )
      OS += addByteCountSuffix(MSFunc);
    return OS;
  }
}

/** `Function::hasStructRetAttr` (llvm/IR/Function.h, not pinned): the `sret` attribute on parameter 0 or 1. Not modelled: it stops. */
function hasStructRetAttr(_F: Function): boolean {
  return unported("llir: Function::hasStructRetAttr (the Mangler's variadic stdcall/fastcall rule)");
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:1662 LLVMRustGetMangledName
export function LLVMRustGetMangledName(V: Value, Str: RustString): void {
  // `RawRustStringOstream`: the bytes go to `Str` as they are written.
  if (!(V instanceof GlobalValue)) throw new Error("llvm: unwrap<GlobalValue> of a value that is not a global");
  const GV = V;
  for (const c of new Mangler().getNameWithPrefix(GV, true)) Str.bytes.push(c.charCodeAt(0));
}
