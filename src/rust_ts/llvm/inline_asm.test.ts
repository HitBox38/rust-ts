// Unit tests of inline_asm.ts (`InlineAsm::verify`, lane cg-asm) against the pinned LLVM's answers, and of the module-asm model.
//
// FIXTURES: each row is a constraint string, the return and parameter types of the asm's function type, and what the pinned
// `llvm-as` (nightly-2026-10-11's llvm-tools) says about `call <ret> asm sideeffect "", "<constraints>"(<params>)`: LLParser runs
// `InlineAsm::verify` and prints its message (`null`: verify passed; rows LLParser accepted but the IR verifier rejected for
// another reason, such as `!i` outside `callbr` or a missing `elementtype`, are `null` too). Generated once by a script that writes
// the module, runs llvm-as and keeps the `error:` text; the strings cover what rustc's codegen_inline_asm builds (x86_64, aarch64)
// and every failure path of `ParseConstraints`, `ConstraintInfo::Parse` and `verify`.
import { describe, expect, test } from "bun:test";
import * as L from "./ffi.ts";
import { LLVMRustAppendModuleInlineAsm, ParseConstraints, printModuleInlineAsm, verify } from "./inline_asm.ts";
import type { FunctionType, Type } from "./ir.ts";

const FIXTURES: readonly [constraints: string, ret: string, params: readonly string[], llvm: string | null][] = [
  ["~{dirflag},~{fpsr},~{flags},~{memory}", "void", [], null],
  ["r,~{memory}", "void", ["ptr"], null],
  ["=r,~{dirflag},~{fpsr},~{flags},~{memory}", "i64", [], null],
  ["=&r,r,~{dirflag},~{fpsr},~{flags}", "i64", ["i64"], null],
  ["={ax},{ax},~{dirflag},~{fpsr},~{flags},~{memory}", "i64", ["i64"], null],
  ["={ax},0,~{dirflag},~{fpsr},~{flags},~{memory}", "i64", ["i64"], null],
  ["=r,=r,0,1,~{cc},~{memory}", "{ i64, i64 }", ["i64", "i64"], null],
  ["=x,x,~{dirflag},~{fpsr},~{flags}", "<4 x float>", ["<4 x float>"], null],
  ["={xmm0},{xmm1},~{dirflag},~{fpsr},~{flags}", "float", ["float"], null],
  ["=^Yk,^Yk,~{dirflag},~{fpsr},~{flags}", "i16", ["i16"], null],
  ["=w,w,~{cc},~{memory}", "<2 x i64>", ["<2 x i64>"], null],
  ["={x0},{x1},~{cc}", "i64", ["i64"], null],
  ["={w0},~{x1},~{x2},~{cc},~{memory}", "i32", [], null],
  ["=@3Upa,@3Upa,~{cc}", "<vscale x 16 x i1>", ["<vscale x 16 x i1>"], null],
  ["s,~{cc},~{memory}", "void", ["ptr"], null],
  ["!i,~{cc},~{memory}", "void", [], null],
  ["=r,!i,~{cc},~{memory}", "i64", [], null],
  ["~{st},~{st(1)},~{st(2)},~{dirflag},~{fpsr},~{flags},~{memory}", "void", [], null],
  ["", "void", [], null],
  ["{x0},{x1},{x2}", "void", ["i64", "i64", "i64"], null],
  ["=r,r,~{$fcc0}", "i32", ["i32"], null],
  ["=*m,~{memory}", "void", ["ptr"], null],
  ["=*m,r", "void", ["ptr", "i32"], null],
  ["r|m,~{memory}", "void", ["i32"], null],
  ["=r|r,0|0", "i32", ["i32"], null],
  ["=%r,r", "i32", ["i32"], null],
  ["=r,r,=r", "i32", ["i32"], "output constraint occurs after input, clobber or label constraint"],
  ["~{memory},r", "void", ["i32"], "input constraint occurs after clobber constraint"],
  ["~{memory},!i", "void", [], "label constraint occurs after clobber constraint"],
  ["r", "i32", ["i32"], "inline asm without outputs must return void"],
  ["=r", "{ i32 }", [], "inline asm with one output cannot return struct"],
  ["=r,=r", "{ i32, i32, i32 }", [], "number of output constraints does not match number of return struct elements"],
  ["=r,=r", "i64", [], "number of output constraints does not match number of return struct elements"],
  ["r,r", "void", ["i32"], "number of input constraints does not match number of parameters"],
  ["r", "void", ["i32", "i32"], "number of input constraints does not match number of parameters"],
  ["r,,r", "void", ["i32", "i32"], "failed to parse constraints"],
  ["r,", "void", ["i32"], "failed to parse constraints"],
  [",r", "void", ["i32"], "failed to parse constraints"],
  ["~r", "void", [], "failed to parse constraints"],
  ["~", "void", [], "failed to parse constraints"],
  ["=", "i32", [], "failed to parse constraints"],
  ["=&", "i32", [], "failed to parse constraints"],
  ["&r", "void", ["i32"], "failed to parse constraints"],
  ["=&&r", "i32", [], "failed to parse constraints"],
  ["~%{x}", "void", [], "failed to parse constraints"],
  ["=%%r", "i32", [], "failed to parse constraints"],
  ["#r", "void", ["i32"], "failed to parse constraints"],
  ["=r,*r", "i32", ["i32"], null],
  ["{foo", "void", ["i32"], "failed to parse constraints"],
  ["0", "void", ["i32"], "failed to parse constraints"],
  ["=r,r,0", "i32", ["i32", "i32"], null],
  ["=r,1", "i32", ["i32"], "failed to parse constraints"],
  ["r,0", "void", ["i32", "i32"], "failed to parse constraints"],
  ["=r,0,0", "i32", ["i32", "i32"], "failed to parse constraints"],
  ["=r,=r,0,0", "{ i32, i32 }", ["i32", "i32"], "failed to parse constraints"],
  ["=r|r,0|0|0", "i32", ["i32"], "failed to parse constraints"],
  ["=r|r,0|0,0", "i32", ["i32", "i32"], null],
  ["!i", "void", [], null],
  ["=r,~{memory}", "void", [], null],
  ["*m", "void", ["ptr"], null],
  ["=r,=*m,r", "i32", ["ptr", "i32"], null],
  ["=*m,=r", "i32", ["ptr"], null],
  ["~{a}{b}", "void", [], null],
  ["r12", "void", ["i32"], "failed to parse constraints"],
  ["=r,10", "i32", ["i32"], "failed to parse constraints"],
];

const C = L.LLVMContextCreate();
function ty(s: string): Type {
  const i = (n: number) => L.LLVMIntTypeInContext(C, n);
  let m: RegExpExecArray | null;
  if (s === "void") return L.LLVMVoidTypeInContext(C);
  if (s === "ptr") return L.LLVMPointerTypeInContext(C, 0);
  if (s === "float") return L.LLVMFloatTypeInContext(C);
  if ((m = /^i(\d+)$/.exec(s))) return i(Number(m[1]));
  if ((m = /^<vscale x (\d+) x (.+)>$/.exec(s))) return L.LLVMScalableVectorType(ty(m[2]!), Number(m[1]));
  if ((m = /^<(\d+) x (.+)>$/.exec(s))) return L.LLVMVectorType(ty(m[2]!), Number(m[1]));
  if ((m = /^\{ (.+) \}$/.exec(s))) {
    const els = m[1]!.split(", ").map(ty);
    return L.LLVMStructTypeInContext(C, els, els.length, L.FALSE);
  }
  throw new Error(`ERROR: fixture type ${s}`);
}

describe("InlineAsm::verify", () => {
  test("matches the pinned LLVM on every fixture", () => {
    const wrong: string[] = [];
    for (const [cons, ret, params, llvm] of FIXTURES) {
      const fty = L.LLVMFunctionType(ty(ret), params.map(ty), params.length, L.FALSE) as FunctionType;
      const got = verify(fty, cons) ?? null;
      if (got !== llvm) wrong.push(`${JSON.stringify(cons)} (${ret} <- ${params.join(", ")}): model ${got}, llvm ${llvm}`);
      // `LLVMRustInlineAsmVerify` answers `!errorToBool(verify(..))`.
      expect(L.LLVMRustInlineAsmVerify(fty, cons, cons.length)).toBe(llvm === null);
    }
    expect(wrong).toEqual([]);
  });

  test("variadic function types are rejected first", () => {
    const fty = L.LLVMFunctionType(ty("void"), [], 0, L.TRUE) as FunctionType;
    expect(verify(fty, "r,,")).toBe("inline asm cannot be variadic");
  });

  test("ParseConstraints records matching inputs and alternatives", () => {
    const cs = ParseConstraints("=r|m,0|0,~{memory}");
    expect(cs.map((c) => c.Type)).toEqual(["isOutput", "isInput", "isClobber"]);
    expect(cs[0]!.isMultipleAlternative).toBe(true);
    expect(cs[0]!.multipleAlternatives.map((a) => a.MatchingInput)).toEqual([1, 1]);
    expect(cs[0]!.multipleAlternatives.map((a) => a.Codes)).toEqual([["r"], ["m"]]);
    const single = ParseConstraints("={ax},0,^Yk,@3Upa");
    expect(single[0]!.MatchingInput).toBe(1);
    expect(single.map((c) => c.Codes)).toEqual([["{ax}"], ["0"], ["Yk"], ["Upa"]]);
  });
});

describe("module inline asm", () => {
  test("fragments with equal properties merge, an empty fragment is dropped, and the printer splits lines", () => {
    const M = L.LLVMModuleCreateWithNameInContext("m", C);
    expect(printModuleInlineAsm(M)).toBe("");
    LLVMRustAppendModuleInlineAsm(M, "", 0, "", 0, "apple-m1", 8);
    expect(printModuleInlineAsm(M)).toBe("");
    for (const a of ["mov x0, 5", "mov x0, 10\n"]) LLVMRustAppendModuleInlineAsm(M, a, a.length, "", 0, "apple-m1", 8);
    LLVMRustAppendModuleInlineAsm(M, 'x "q"', 5, "+neon", 5, "apple-m1", 8);
    expect(printModuleInlineAsm(M)).toBe(
      '\nmodule asm(target_cpu: "apple-m1")\n    "mov x0, 5"\n    "mov x0, 10"\nmodule asm(target_features: "+neon", target_cpu: "apple-m1")\n    "x \\22q\\22"\n',
    );
  });
});
