// rust-ts: how ffi.ts binds its functions (lane llir-core-a): `stub` for a function no lane implements yet, `bind` for one an
// implementation module exports. With `RUST_TS_LLVM_TRACE=<file>` set when this module loads, `bind` wraps every function so
// that each call writes one line to that file: the port's side of the C API call trace that scripts/ir-diff.ts compares
// with the oracle's (review plan-m7 F6 item 4). The format is scripts/lib/llvm-trace.ts's:
//
//   `LLVMBuild*` (not calls and invokes)   `<fn>\tinst` | `<fn>\toperand` | `<fn>\tconst <printed, at most 300 bytes>` | `<fn>\tnull`
//   `LLVMSetValueName2`, `LLVMAppendBasicBlockInContext`, `LLVMAddGlobal`   `<fn>\t<name asked for>\t<name given>`
//   anything else                          `<fn>`
//
// Lines are bytes (names are written as their bytes, as the oracle's tracer does). `LLVMRust*` calls are written too; the
// comparison drops them, since the oracle's tracer cannot see them.
import { closeSync, openSync, writeSync } from "node:fs";
import { unported } from "../../std/panic.ts";
import { Constant, Instruction, type Value } from "./ir.ts";
import { printValueToString } from "./printer.ts";

/** The function every unimplemented ffi.rs name is bound to. */
export function stub(name: string): () => never {
  return () => unported(`llir: ${name}`);
}

const TRACE_FILE = process.env.RUST_TS_LLVM_TRACE;
let fd: number | undefined;
if (TRACE_FILE !== undefined && TRACE_FILE !== "") {
  fd = openSync(TRACE_FILE, "w");
  process.on("exit", () => {
    if (fd !== undefined) closeSync(fd);
    fd = undefined;
  });
}

const classifies = (s: string): boolean => /^LLVMBuild/.test(s) && !/Invoke|CallWith|^LLVMBuildCall2$|^LLVMBuildCallBr$/.test(s);

/** Bytes of a trace line: a byte string written byte for byte. */
const write = (line: string): void => {
  if (fd !== undefined) writeSync(fd, Buffer.from(`${line}\n`, "latin1"));
};

/** The name argument as the bytes the oracle's tracer prints (`%.*s` of the pointer and length, or the C string). */
function askedName(a: unknown): string {
  if (typeof a === "string") return Buffer.from(a, "utf8").toString("latin1");
  if (a instanceof Uint8Array) return Buffer.from(a).toString("latin1");
  return "";
}

/** What `built()` in the oracle's tracer prints for a builder's result.
 *
 * **Known false differences for scripts/ir-diff.ts** (review llir-core-a N10): the model prints a floating-point constant
 * in hex (`double f0x3FF8000000000000`) where LLVM prints a decimal when it round-trips (`double 1.500000e+00`), and a
 * non-C calling convention as `cc N` where LLVM prints its name (`fastcc`). Both parse to the same IR, so the normal form is
 * unaffected, but a folded float `const` answer (or a printed function) differs from the oracle's trace text and would read as
 * "the model answered differently"; the trace comparison should mask float `const` answers. Integer, pointer, aggregate and
 * expression constants print as LLVM's do (capi.oracle.test.ts). */
function builtAnswer(r: unknown, args: readonly unknown[]): string {
  if (r === undefined || r === null) return "null";
  for (let k = 1; k < 4; k++) if (r === args[k]) return "operand";
  if (r instanceof Instruction) return "inst";
  if (r instanceof Constant) {
    // snprintf(b, 320, "const %.300s", s), then '\n' and '\t' become ' '.
    const s = Buffer.from(printValueToString(r as Value), "latin1").subarray(0, 300).toString("latin1");
    return `const ${s}`.replace(/[\n\t]/g, " ");
  }
  return "inst";
}

/** `f` itself, or, when tracing, `f` wrapped to write its trace line after it returns. */
export function bind<F extends (...args: never[]) => unknown>(name: string, f: F): F {
  if (fd === undefined) return f;
  const g = (...args: never[]): unknown => {
    const r = f(...args);
    if (classifies(name)) write(`${name}\t${builtAnswer(r, args)}`);
    else if (name === "LLVMSetValueName2") write(`${name}\t${askedName(args[1])}\t${(args[0] as Value).name}`);
    else if (name === "LLVMAppendBasicBlockInContext") write(`${name}\t${askedName(args[2])}\t${(r as Value).name}`);
    else if (name === "LLVMAddGlobal") write(`${name}\t${askedName(args[2])}\t${(r as Value).name}`);
    else write(name);
    return r;
  };
  return g as F;
}
