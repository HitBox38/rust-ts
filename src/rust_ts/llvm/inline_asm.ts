// LLVM's inline-asm constraint parsing and verification (llvm/lib/IR/InlineAsm.cpp), for `LLVMRustInlineAsmVerify`
// (RustWrapper.cpp:654; plan-m7 D10, lane cg-asm). Not ported rustc code: a model of the LLVM functions the wrapper reaches,
// with `// llvm:` markers.
//
// PORT (cg-asm):
// - Strings are byte strings (one char per byte, as core.ts's `bytesArg` makes them); `StringRef::iterator` is an index.
// - `InlineAsm::ConstraintInfo` / `SubConstraintInfo` (llvm/IR/InlineAsm.h) are interfaces with the fields `Parse` writes;
//   `std::vector<std::string> Codes` is `string[]`. `hasMatchingInput()` (an inline member in InlineAsm.h, not pinned) is
//   `MatchingInput !== -1`, written out where it is called.
// - `Error` / `Error::success()` is `string | undefined` (the message of `makeStringError`, or `undefined`): the wrapper only
//   asks `errorToBool`.
// - Reading at the end iterator: `Parse` reads `*I` after a prefix without checking `I != E` (InlineAsm.cpp:115, and :100 /
//   :107 / :110 for the prefix itself never at E, as `ParseConstraints` rejects empty constraints). In LLVM that reads the byte
//   after the constraint: the next `,`, or past the string. The model reads `undefined` there, which compares unequal to every
//   character; the result differs from LLVM only if the byte past the whole string is `*`.
// - `^` and `@N` advance `I` by a fixed count (:202, :212), which can step past `E` on a malformed string; LLVM then reads past
//   the constraint (undefined behaviour). The model stops its loop at `I >= E` and slices within the string. rustc only
//   produces the well-formed `^Yk`, `^wa` and `@3Upa`.
//
// Module-level inline asm (`global_asm!`, naked functions) is here too: `LLVMRustAppendModuleInlineAsm` (RustWrapper.cpp:661, the
// LLVM >= 23 branch, as the pinned LLVM is 23), `Module::GlobalAsmFragment` / `GlobalAsmProperties` and
// `Module::appendModuleInlineAsm` (llvm/IR/Module.h), and the part of `AssemblyWriter::printModule` that prints them
// (AsmWriter.cpp:3129). `Module::GlobalScopeAsm` is ir.ts's `Module.GlobalScopeAsm` (lane llir-callbr-mangler; cg-asm had a side
// table, as it owned no file of the module class). `LLVMCloneModule` (tools.ts) copies the printed text, module asm included.

import { bytesArg, type FunctionType, type Module, StructType } from "./ir.ts";
import { printEscapedString } from "./printer.ts";
import type { PtrLenStr } from "./support.ts";

/** `InlineAsm::ConstraintPrefix` (llvm/IR/InlineAsm.h). */
export type ConstraintPrefix = "isInput" | "isOutput" | "isClobber" | "isLabel";

/** `InlineAsm::SubConstraintInfo` (llvm/IR/InlineAsm.h). */
export interface SubConstraintInfo {
  /// MatchingInput - If this is not -1, this is an output constraint where an
  /// input constraint is required to match it (e.g. "0").  The value is the
  /// constraint number that matches this one (for example, if this is
  /// constraint #0 and constraint #4 has the value "0", this will be 4).
  MatchingInput: number;
  /// Code - The constraint code, either the register name (in braces) or the
  /// constraint letter/number.
  Codes: string[];
}

/** `InlineAsm::ConstraintInfo` (llvm/IR/InlineAsm.h). */
export interface ConstraintInfo {
  /// Type - The basic type of the constraint: input/output/clobber/label
  Type: ConstraintPrefix;
  /// isEarlyClobber - "&": output operand writes result before inputs are all
  /// read.  This is only ever set for an output operand.
  isEarlyClobber: boolean;
  /// MatchingInput - If this is not -1, this is an output constraint where an
  /// input constraint is required to match it (e.g. "0").  The value is the
  /// constraint number that matches this one (for example, if this is
  /// constraint #0 and constraint #4 has the value "0", this will be 4).
  MatchingInput: number;
  /// hasMatchingInput - Return true if this is an output constraint that has
  /// a matching input constraint.
  // (inline member; see the header)
  /// isCommutative - This is set to true for a constraint that is commutative
  /// with the next operand.
  isCommutative: boolean;
  /// isIndirect - True if this operand is an indirect operand.  This means
  /// that the address of the source or destination is present in the call
  /// instruction, instead of it being returned or passed in explicitly.  This
  /// is represented with a '*' in the asm string.
  isIndirect: boolean;
  /// Code - The constraint code, either the register name (in braces) or the
  /// constraint letter/number.
  Codes: string[];
  /// isMultipleAlternative - '|': has multiple-alternative constraints.
  isMultipleAlternative: boolean;
  /// multipleAlternatives - If there are multiple alternative constraints,
  /// this array will contain them.  Otherwise it will be empty.
  multipleAlternatives: SubConstraintInfo[];
  /// The currently selected alternative constraint index.
  currentAlternativeIndex: number;
}

/** `ConstraintInfo()` (the default constructor in InlineAsm.h). */
export function newConstraintInfo(): ConstraintInfo {
  return {
    Type: "isInput",
    isEarlyClobber: false,
    MatchingInput: -1,
    isCommutative: false,
    isIndirect: false,
    Codes: [],
    isMultipleAlternative: false,
    multipleAlternatives: [],
    currentAlternativeIndex: 0,
  };
}

/** `isdigit(static_cast<unsigned char>(c))` in the C locale. */
function isdigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

/// Parse - Analyze the specified string (e.g. "==&{eax}") and fill in the
/// fields in this structure.  If the constraint string is not understood,
/// return true, otherwise return false.
// llvm: llvm/lib/IR/InlineAsm.cpp:79 InlineAsm::ConstraintInfo::Parse
export function ConstraintInfo_Parse(self: ConstraintInfo, Str: string, ConstraintsSoFar: ConstraintInfo[]): boolean {
  let I = 0;
  const E = Str.length;
  // `Str.count('|') + 1`
  let multipleAlternativeCount = 1;
  for (let k = 0; k < E; k++) if (Str[k] === "|") multipleAlternativeCount++;
  let multipleAlternativeIndex = 0;
  // `ConstraintCodeVector *pCodes = &Codes;`
  let pCodes = self.Codes;

  // Initialize
  self.isMultipleAlternative = multipleAlternativeCount > 1;
  if (self.isMultipleAlternative) {
    // `multipleAlternatives.resize(multipleAlternativeCount)`
    while (self.multipleAlternatives.length < multipleAlternativeCount) self.multipleAlternatives.push({ MatchingInput: -1, Codes: [] });
    self.multipleAlternatives.length = multipleAlternativeCount;
    pCodes = self.multipleAlternatives[0]!.Codes;
  }
  self.Type = "isInput";
  self.isEarlyClobber = false;
  self.MatchingInput = -1;
  self.isCommutative = false;
  self.isIndirect = false;
  self.currentAlternativeIndex = 0;

  // Parse prefixes.
  if (Str[I] === "~") {
    self.Type = "isClobber";
    ++I;

    // '{' must immediately follow '~'.
    if (I !== E && Str[I] !== "{") return true;
  } else if (Str[I] === "=") {
    ++I;
    self.Type = "isOutput";
  } else if (Str[I] === "!") {
    ++I;
    self.Type = "isLabel";
  }

  // PORT: `*I` may be the end iterator here (see the header).
  if (Str[I] === "*") {
    self.isIndirect = true;
    ++I;
  }

  if (I === E) return true; // Just a prefix, like "==" or "~".

  // Parse the modifiers.
  let DoneWithModifiers = false;
  while (!DoneWithModifiers) {
    switch (Str[I]) {
      default:
        DoneWithModifiers = true;
        break;
      case "&": // Early clobber.
        if (
          self.Type !== "isOutput" || // Cannot early clobber anything but output.
          self.isEarlyClobber // Reject &&&&&&
        )
          return true;
        self.isEarlyClobber = true;
        break;
      case "%": // Commutative.
        if (
          self.Type === "isClobber" || // Cannot commute clobbers.
          self.isCommutative // Reject %%%%%
        )
          return true;
        self.isCommutative = true;
        break;
      case "#": // Comment.
      case "*": // Register preferencing.
        return true; // Not supported.
    }

    if (!DoneWithModifiers) {
      ++I;
      if (I === E) return true; // Just prefixes and modifiers!
    }
  }

  // Parse the various constraints.
  // PORT: `I != E` is `I < E` (see the header).
  while (I < E) {
    if (Str[I] === "{") {
      // Physical register reference.
      // Find the end of the register name.
      let ConstraintEnd = Str.indexOf("}", I + 1);
      if (ConstraintEnd === -1) ConstraintEnd = E;
      if (ConstraintEnd === E) return true; // "{foo"
      pCodes.push(Str.slice(I, ConstraintEnd + 1));
      I = ConstraintEnd + 1;
    } else if (isdigit(Str[I])) {
      // Matching Constraint
      // Maximal munch numbers.
      const NumStart = I;
      while (I !== E && isdigit(Str[I])) ++I;
      pCodes.push(Str.slice(NumStart, I));
      // `atoi`: digits only here; a value past `INT_MAX` is undefined in C and cannot index `ConstraintsSoFar` anyway.
      const N = Number.parseInt(pCodes[pCodes.length - 1]!, 10);
      // Check that this is a valid matching constraint!
      if (N >= ConstraintsSoFar.length || ConstraintsSoFar[N]!.Type !== "isOutput" || self.Type !== "isInput") return true; // Invalid constraint number.

      // If Operand N already has a matching input, reject this.  An output
      // can't be constrained to the same value as multiple inputs.
      if (self.isMultipleAlternative) {
        if (multipleAlternativeIndex >= ConstraintsSoFar[N]!.multipleAlternatives.length) return true;
        const scInfo = ConstraintsSoFar[N]!.multipleAlternatives[multipleAlternativeIndex]!;
        if (scInfo.MatchingInput !== -1) return true;
        // Note that operand #n has a matching input.
        scInfo.MatchingInput = ConstraintsSoFar.length;
        // assert(scInfo.MatchingInput >= 0);
      } else {
        // `ConstraintsSoFar[N].hasMatchingInput()`
        if (ConstraintsSoFar[N]!.MatchingInput !== -1 && ConstraintsSoFar[N]!.MatchingInput !== ConstraintsSoFar.length) return true;
        // Note that operand #n has a matching input.
        ConstraintsSoFar[N]!.MatchingInput = ConstraintsSoFar.length;
        // assert(ConstraintsSoFar[N].MatchingInput >= 0);
      }
    } else if (Str[I] === "|") {
      multipleAlternativeIndex++;
      pCodes = self.multipleAlternatives[multipleAlternativeIndex]!.Codes;
      ++I;
    } else if (Str[I] === "^") {
      // Multi-letter constraint
      // FIXME: For now assuming these are 2-character constraints.
      pCodes.push(Str.slice(I + 1, I + 3));
      I += 3;
    } else if (Str[I] === "@") {
      // Multi-letter constraint
      ++I;
      const C = Str[I];
      // assert(isdigit(C) && "Expected a digit!");
      const N = C === undefined ? 0 : C.charCodeAt(0) - "0".charCodeAt(0);
      // assert(N > 0 && "Found a zero letter constraint!");
      ++I;
      pCodes.push(Str.slice(I, I + N));
      I += N;
    } else {
      // Single letter constraint.
      pCodes.push(Str.slice(I, I + 1));
      ++I;
    }
  }

  return false;
}

/// selectAlternative - Point this constraint to the alternative constraint
/// indicated by the index.
// llvm: llvm/lib/IR/InlineAsm.cpp:225 InlineAsm::ConstraintInfo::selectAlternative
export function ConstraintInfo_selectAlternative(self: ConstraintInfo, index: number): void {
  if (index < self.multipleAlternatives.length) {
    self.currentAlternativeIndex = index;
    const scInfo = self.multipleAlternatives[self.currentAlternativeIndex]!;
    self.MatchingInput = scInfo.MatchingInput;
    self.Codes = [...scInfo.Codes];
  }
}

// llvm: llvm/lib/IR/InlineAsm.cpp:236 InlineAsm::ParseConstraints
export function ParseConstraints(Constraints: string): ConstraintInfo[] {
  let Result: ConstraintInfo[] = [];

  // Scan the constraints string.
  const E = Constraints.length;
  for (let I = 0; I !== E; ) {
    const Info = newConstraintInfo();

    // Find the end of this constraint.
    let ConstraintEnd = Constraints.indexOf(",", I);
    if (ConstraintEnd === -1) ConstraintEnd = E;

    if (
      ConstraintEnd === I || // Empty constraint like ",,"
      ConstraintInfo_Parse(Info, Constraints.slice(I, ConstraintEnd), Result)
    ) {
      Result = []; // Erroneous constraint?
      break;
    }

    // `Result.push_back(Info)` copies `Info`; `Parse` of a later constraint writes `MatchingInput` of the copy in `Result`.
    Result.push(Info);

    // ConstraintEnd may be either the next comma or the end of the string.  In
    // the former case, we skip the comma.
    I = ConstraintEnd;
    if (I !== E) {
      ++I;
      if (I === E) {
        Result = [];
        break;
      } // don't allow "xyz,"
    }
  }

  return Result;
}

// llvm: llvm/lib/IR/InlineAsm.cpp:270 makeStringError
function makeStringError(Msg: string): string {
  // `createStringError(errc::invalid_argument, Msg)`
  return Msg;
}

/** `Error InlineAsm::verify(FunctionType *Ty, StringRef ConstStr)`: the error's message, or `undefined` for success. */
// llvm: llvm/lib/IR/InlineAsm.cpp:274 InlineAsm::verify
export function verify(Ty: FunctionType, ConstStr: string): string | undefined {
  if (Ty.isVarArg) return makeStringError("inline asm cannot be variadic");

  const Constraints = ParseConstraints(ConstStr);

  // Error parsing constraints.
  if (Constraints.length === 0 && ConstStr.length !== 0) return makeStringError("failed to parse constraints");

  let NumOutputs = 0,
    NumInputs = 0,
    NumClobbers = 0;
  let NumIndirect = 0,
    NumLabels = 0;

  // PORT: the `switch` is an if-chain, as `noFallthroughCasesInSwitch` rejects the `isOutput` -> `isInput` fallthrough.
  for (const Constraint of Constraints) {
    if (Constraint.Type === "isOutput") {
      if (NumInputs - NumIndirect !== 0 || NumClobbers !== 0 || NumLabels !== 0)
        return makeStringError("output constraint occurs after input, " + "clobber or label constraint");

      if (!Constraint.isIndirect) {
        ++NumOutputs;
        continue;
      }
      ++NumIndirect;
      // [[fallthrough]]; // We fall through for Indirect Outputs.
    }
    if (Constraint.Type === "isOutput" || Constraint.Type === "isInput") {
      if (NumClobbers) return makeStringError("input constraint occurs after clobber " + "constraint");
      ++NumInputs;
    } else if (Constraint.Type === "isClobber") {
      ++NumClobbers;
    } else {
      // case InlineAsm::isLabel:
      if (NumClobbers) return makeStringError("label constraint occurs after clobber " + "constraint");

      ++NumLabels;
    }
  }

  switch (NumOutputs) {
    case 0:
      if (Ty.returnType.typeID !== "Void") return makeStringError("inline asm without outputs must return void");
      break;
    case 1:
      if (Ty.returnType instanceof StructType) return makeStringError("inline asm with one output cannot return struct");
      break;
    default: {
      const STy = Ty.returnType instanceof StructType ? Ty.returnType : undefined;
      if (STy === undefined || (STy.body ?? []).length !== NumOutputs)
        return makeStringError("number of output constraints does not match " + "number of return struct elements");
      break;
    }
  }

  if (Ty.params.length !== NumInputs) return makeStringError("number of input constraints does not match number " + "of parameters");

  // We don't have access to labels here, NumLabels will be checked separately.
  return undefined;
}

// ---- module-level inline asm -------------------------------------------------------------------------------------------

/** `Module::GlobalAsmProperties` (llvm/IR/Module.h:172). */
export interface GlobalAsmProperties {
  TargetFeatures: string;
  TargetCPU: string;
}

/** `GlobalAsmProperties::operator==`. */
// llvm: llvm/include/llvm/IR/Module.h:183 operator==
function GlobalAsmProperties_eq(a: GlobalAsmProperties, b: GlobalAsmProperties): boolean {
  return a.TargetFeatures === b.TargetFeatures && a.TargetCPU === b.TargetCPU;
}

/// Get a list of set properties as pairs of key and value.
// llvm: llvm/lib/IR/Module.cpp:992 Module::GlobalAsmProperties::getAsStrings
export function GlobalAsmProperties_getAsStrings(self: GlobalAsmProperties): [string, string][] {
  const Props: [string, string][] = [];
  if (self.TargetFeatures !== "") Props.push(["target_features", self.TargetFeatures]);
  if (self.TargetCPU !== "") Props.push(["target_cpu", self.TargetCPU]);
  return Props;
}

/** `Module::GlobalAsmFragment` (llvm/IR/Module.h:193). `Asm` is a byte string. */
export interface GlobalAsmFragment {
  Asm: string;
  Props: GlobalAsmProperties;
}

/** `GlobalAsmFragment(std::string AsmArg, GlobalAsmProperties Props = {})`. */
// llvm: llvm/include/llvm/IR/Module.h:198 GlobalAsmFragment
export function newGlobalAsmFragment(AsmArg: string, Props: GlobalAsmProperties = { TargetFeatures: "", TargetCPU: "" }): GlobalAsmFragment {
  let Asm = AsmArg;
  if (Asm !== "" && Asm[Asm.length - 1] !== "\n") Asm += "\n";
  return { Asm, Props };
}

/** `Module::getModuleInlineAsm() const`. */
// llvm: llvm/include/llvm/IR/Module.h:330 getModuleInlineAsm
export function getModuleInlineAsm(M: Module): readonly GlobalAsmFragment[] {
  return M.GlobalScopeAsm;
}

/** `Module::hasModuleInlineAsm()`. */
// llvm: llvm/include/llvm/IR/Module.h:340 hasModuleInlineAsm
export function hasModuleInlineAsm(M: Module): boolean {
  return M.GlobalScopeAsm.length !== 0;
}

/// Append to the module-scope inline assembly blocks.
/// A trailing newline is added if the input doesn't have one.
/** `Module::appendModuleInlineAsm(GlobalAsmFragment)`. */
// llvm: llvm/include/llvm/IR/Module.h:393 appendModuleInlineAsm
export function appendModuleInlineAsm(M: Module, Fragment: GlobalAsmFragment): void {
  // `Fragment.empty()`
  if (Fragment.Asm === "") return;

  const list = M.GlobalScopeAsm;
  // `GlobalScopeAsm.back().hasSameProperties(Fragment)`
  if (list.length !== 0 && GlobalAsmProperties_eq(list[list.length - 1]!.Props, Fragment.Props)) {
    list[list.length - 1]!.Asm += Fragment.Asm;
  } else {
    list.push(Fragment);
  }
}

// rustc: compiler/rustc_llvm/llvm-wrapper/RustWrapper.cpp:661 LLVMRustAppendModuleInlineAsm
export function LLVMRustAppendModuleInlineAsm(
  M: Module,
  Asm: PtrLenStr | undefined,
  AsmLen: number,
  TargetFeatures: PtrLenStr | undefined,
  TargetFeaturesLen: number,
  TargetCPU: PtrLenStr | undefined,
  TargetCPULen: number,
): void {
  // #if LLVM_VERSION_GE(23, 0)
  const Props: GlobalAsmProperties = { TargetFeatures: "", TargetCPU: "" };
  Props.TargetFeatures = bytesArg(TargetFeatures, TargetFeaturesLen);
  Props.TargetCPU = bytesArg(TargetCPU, TargetCPULen);
  appendModuleInlineAsm(M, newGlobalAsmFragment(bytesArg(Asm, AsmLen), Props));
}

/**
 * The module-asm lines of `AssemblyWriter::printModule` (AsmWriter.cpp:3129-3160; the function's marker is on printer.ts's
 * `module_`): what follows `target triple`, or `""` when the module has none.
 */
export function printModuleInlineAsm(M: Module): string {
  let Out = "";
  if (hasModuleInlineAsm(M)) {
    Out += "\n";

    for (const Frag of getModuleInlineAsm(M)) {
      Out += "module asm";
      const Props = GlobalAsmProperties_getAsStrings(Frag.Props);
      if (Props.length !== 0) {
        // `ListSeparator LS;` (", ")
        Out += "(";
        Out += Props.map(([Key, Value]) => `${Key}: "${printEscapedString(Value)}"`).join(", ");
        Out += ")";
      }
      Out += "\n";
      // Split the string into lines, to make it easier to read the .ll file.
      let Asm = Frag.Asm;
      do {
        // `std::tie(Front, Asm) = Asm.split('\n');`
        const nl = Asm.indexOf("\n");
        const Front = nl === -1 ? Asm : Asm.slice(0, nl);
        Asm = nl === -1 ? "" : Asm.slice(nl + 1);

        // We found a newline, print the portion of the asm string from the
        // last newline up to this newline.
        Out += '    "';
        Out += printEscapedString(Front);
        Out += '"\n';
      } while (Asm !== "");
    }
  }
  return Out;
}
