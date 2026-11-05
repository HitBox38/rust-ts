// The C API call trace behind scripts/ir-diff.ts (review plan-m7 F6): the first differing call separates "the port called
// something else" from "the model answered differently", the classification F1's tier rule reads. No imports beyond node:.
//
// **The oracle side** is a dylib that interposes on every `LLVM*` C function librustc_driver imports (349 at the pin), through
// `DYLD_INSERT_LIBRARIES`, on the toolchain's own `bin/rustc` (the rustup proxy would load it too, and has no LLVM). No file of the
// toolchain changes, and the traced IR is byte-identical to the untraced (a test pins this). It sees C functions only: the 131
// `LLVMRust*` wrappers are inside the driver, so **no trace has them**, and `compareCalls` ignores them on the port side.
//
// **The port side:** `src/rust_ts/llvm` writes the same format to the file named by `RUST_TS_LLVM_TRACE`, one call per line. It
// does not exist yet (lane llir-core owns it); until then ir-diff says the port wrote no trace.
//
// **Format,** one call per line, tab-separated: `<C function>[\t<answer>...]`.
//   `LLVMBuild*`:  `inst` (a new instruction), `operand` (returned an operand: IRBuilder::CreateCast's no-op), `const <printed>`
//                  (folded), `null`. Not `LLVMBuildCall*`, `LLVMBuildInvoke*`: they are plain lines.
//   `LLVMSetValueName2`, `LLVMAppendBasicBlockInContext`, `LLVMAddGlobal`:  `<name asked for>\t<name given>`; the two differ on a collision.
//   everything else: the function's name alone.
// The oracle's raw file has a thread number first (`<n>\t...`); `parseCalls` keeps the thread that creates the first module, the one
// that builds, since the driver's other threads call into LLVM in no fixed order.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256File } from "./llvm-tools.ts";

export const LLVM_TRACE_ENV = "RUST_TS_LLVM_TRACE";
/** The first call of a module: its thread is the one `parseCalls` keeps. */
const MODULE_CREATE = "LLVMModuleCreateWithNameInContext";

/** The driver's imports from `nm -u` output: C functions, without the leading underscore. */
export function importedCFunctions(nmOutput: string): string[] {
  return nmOutput
    .split("\n")
    .map((l) => l.trim().replace(/^_/, ""))
    .filter((s) => /^LLVM(?!Rust)/.test(s));
}

/** Builders whose result the tracer classifies: 8 register arguments at most, returning a value. */
const classifies = (s: string): boolean => /^LLVMBuild/.test(s) && !/Invoke|CallWith|^LLVMBuildCall2$|^LLVMBuildCallBr$/.test(s);
const NAMED = new Set(["LLVMSetValueName2", "LLVMAppendBasicBlockInContext", "LLVMAddGlobal"]);

/** The interposer's C source, for aarch64 (`x0-x8`, `d0-d7` are what a call can pass; the rest of the stack is untouched). */
export function tracerSource(syms: readonly string[]): string {
  const names = syms.map((s) => JSON.stringify(s)).join(",");
  let c = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
typedef void* P; typedef unsigned long L;
extern int LLVMIsAInstruction(P); extern const char* LLVMGetValueName2(P,size_t*); extern const char* LLVMGetBasicBlockName(P);
extern char* LLVMPrintValueToString(P); extern void LLVMDisposeMessage(char*);
static const char* names[]={${names}};
static FILE* out; static pthread_key_t key; static long threads;
__attribute__((constructor)) static void init(void){ const char* p=getenv("${LLVM_TRACE_ENV}"); if(p) out=fopen(p,"w"); pthread_key_create(&key,0); }
__attribute__((destructor)) static void fini(void){ if(out) fclose(out); out=0; }
static long tid(void){ long t=(long)pthread_getspecific(key); if(!t){ t=__sync_add_and_fetch(&threads,1); pthread_setspecific(key,(void*)t);} return t; }
__attribute__((used)) void __tr_call(long i){ if(!out) return; flockfile(out); fprintf(out,"%ld\\t%s\\n",tid(),names[i]); funlockfile(out); }
static void answer(long i,const char* a,const char* b){ if(!out) return; flockfile(out); fprintf(out,"%ld\\t%s\\t%s%s%s\\n",tid(),names[i],a,b?"\\t":"",b?b:""); funlockfile(out); }
static void built(long i,P r,L* a){ if(!out) return; if(!r){ answer(i,"null",0); return; } for(int k=1;k<4;k++) if((L)r==a[k]){ answer(i,"operand",0); return; }
 if(LLVMIsAInstruction(r)){ answer(i,"inst",0); return; } char* s=LLVMPrintValueToString(r); char b[320]; snprintf(b,320,"const %.300s",s); for(char* q=b;*q;q++) if(*q=='\\n'||*q=='\\t') *q=' '; answer(i,b,0); LLVMDisposeMessage(s); }
`;
  syms.forEach((s, i) => {
    c += `extern void o${i}(void) __asm__("_${s}");\n`;
  });
  syms.forEach((s, i) => {
    if (classifies(s)) {
      c += `__attribute__((used)) static L w${i}(L a0,L a1,L a2,L a3,L a4,L a5,L a6,L a7){ L r=((L(*)(L,L,L,L,L,L,L,L))o${i})(a0,a1,a2,a3,a4,a5,a6,a7); L a[8]={a0,a1,a2,a3,a4,a5,a6,a7}; built(${i},(P)r,a); return r; }\n`;
    } else if (s === "LLVMSetValueName2") {
      c += `__attribute__((used)) static void w${i}(P v,const char* n,size_t l){ ((void(*)(P,const char*,size_t))o${i})(v,n,l); size_t g=0; const char* got=LLVMGetValueName2(v,&g); char w[256],h[256]; snprintf(w,256,"%.*s",(int)l,n); snprintf(h,256,"%.*s",(int)g,got); answer(${i},w,h); }\n`;
    } else if (s === "LLVMAppendBasicBlockInContext") {
      c += `__attribute__((used)) static P w${i}(P x,P f,const char* n){ P r=((P(*)(P,P,const char*))o${i})(x,f,n); answer(${i},n,LLVMGetBasicBlockName(r)); return r; }\n`;
    } else if (s === "LLVMAddGlobal") {
      c += `__attribute__((used)) static P w${i}(P m,P t,const char* n){ P r=((P(*)(P,P,const char*))o${i})(m,t,n); size_t g=0; char h[512]; const char* got=LLVMGetValueName2(r,&g); snprintf(h,512,"%.*s",(int)g,got); answer(${i},n,h); return r; }\n`;
    } else {
      c += `__attribute__((naked,used)) static void w${i}(void){ __asm__("stp x29,x30,[sp,#-16]!\\n sub sp,sp,#160\\n stp x0,x1,[sp]\\n stp x2,x3,[sp,#16]\\n stp x4,x5,[sp,#32]\\n stp x6,x7,[sp,#48]\\n str x8,[sp,#64]\\n stp d0,d1,[sp,#80]\\n stp d2,d3,[sp,#96]\\n stp d4,d5,[sp,#112]\\n stp d6,d7,[sp,#128]\\n mov x0,#${i}\\n bl ___tr_call\\n ldp x0,x1,[sp]\\n ldp x2,x3,[sp,#16]\\n ldp x4,x5,[sp,#32]\\n ldp x6,x7,[sp,#48]\\n ldr x8,[sp,#64]\\n ldp d0,d1,[sp,#80]\\n ldp d2,d3,[sp,#96]\\n ldp d4,d5,[sp,#112]\\n ldp d6,d7,[sp,#128]\\n add sp,sp,#160\\n ldp x29,x30,[sp],#16\\n adrp x16,_${s}@GOTPAGE\\n ldr x16,[x16,_${s}@GOTPAGEOFF]\\n br x16\\n"); }\n`;
    }
    c += `__attribute__((used,section("__DATA,__interpose"))) static struct{void*a;void*b;} ip${i}={(void*)w${i},(void*)o${i}};\n`;
  });
  return c;
}

/**
 * The tracer dylib for the toolchain at `sysroot`, built with `cc` once per driver and cached under `dataDir/llvm-trace/`
 * (AGENTS.md: a tool's cache lives in RUST_TS_DATA). Throws with one line if `cc` fails.
 */
export function tracerDylib(sysroot: string, dataDir: string): string {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error(`the LLVM C API tracer is written for aarch64 macOS, not ${process.platform} ${process.arch}`);
  const libDir = join(sysroot, "lib");
  const nm = Bun.spawnSync(["sh", "-c", `nm -u "${libDir}"/librustc_driver-*.dylib`], { stdout: "pipe", stderr: "pipe" });
  if (nm.exitCode !== 0) throw new Error(`nm on librustc_driver failed: ${nm.stderr.toString().trim().split("\n")[0]}`);
  const syms = importedCFunctions(nm.stdout.toString());
  const source = tracerSource(syms);
  const key = createHash("sha256").update(source).update(sha256File(join(libDir, "libLLVM.dylib"))).digest("hex").slice(0, 16);
  const dir = join(dataDir, "llvm-trace", key);
  const dylib = join(dir, "tr.dylib");
  if (existsSync(dylib)) return dylib;
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `tr-${process.pid}`);
  writeFileSync(`${tmp}.c`, source);
  const cc = Bun.spawnSync(["cc", "-dynamiclib", "-O1", "-w", `${tmp}.c`, "-o", `${tmp}.dylib`, `-L${libDir}`, "-lLLVM", `-Wl,-rpath,${libDir}`], { stdout: "pipe", stderr: "pipe" });
  if (cc.exitCode !== 0) throw new Error(`cc failed on the tracer: ${cc.stderr.toString().trim().split("\n")[0]}`);
  renameSync(`${tmp}.dylib`, dylib);
  return dylib;
}

/** The oracle's raw trace, as calls of the thread that builds (see the header). */
export function parseOracleCalls(raw: string): string[] {
  const rows = raw.split("\n").filter(Boolean);
  const first = rows.find((r) => r.slice(r.indexOf("\t") + 1).split("\t")[0] === MODULE_CREATE);
  if (first === undefined) return [];
  const t = first.slice(0, first.indexOf("\t") + 1);
  const start = rows.indexOf(first);
  return rows.slice(start).filter((r) => r.startsWith(t)).map((r) => r.slice(t.length));
}

/** The port's trace, from its first module, without `LLVMRust*` (the oracle's trace cannot have them). */
export function parsePortCalls(raw: string): string[] {
  const rows = raw.split("\n").filter(Boolean);
  const start = rows.findIndex((r) => r.split("\t")[0] === MODULE_CREATE);
  return (start < 0 ? rows : rows.slice(start)).filter((r) => !r.startsWith("LLVMRust"));
}

export type CallVerdict =
  | { kind: "match"; calls: number }
  /** Another function, or a different name asked for: the layer above the model. */
  | { kind: "called-differently"; index: number; oracle: string; port: string }
  /** The same call, another answer: the model. */
  | { kind: "answered-differently"; index: number; oracle: string; port: string }
  | { kind: "port-stops"; index: number; oracle: string }
  | { kind: "port-extra"; index: number; port: string };

const NAME_ANSWER = (row: string): [call: string, answer: string] => {
  const f = row.split("\t");
  // For a named call, the name asked for is part of the call and the name given is the answer.
  return NAMED.has(f[0]!) ? [`${f[0]}\t${f[1] ?? ""}`, f.slice(2).join("\t")] : [f[0]!, f.slice(1).join("\t")];
};

/** The first difference between two call lists (`parseOracleCalls`, `parsePortCalls`). */
export function compareCalls(oracle: readonly string[], port: readonly string[]): CallVerdict {
  const n = Math.min(oracle.length, port.length);
  for (let i = 0; i < n; i++) {
    if (oracle[i] === port[i]) continue;
    const [oc, oa] = NAME_ANSWER(oracle[i]!);
    const [pc, pa] = NAME_ANSWER(port[i]!);
    return { kind: oc === pc && oa !== pa ? "answered-differently" : "called-differently", index: i, oracle: oracle[i]!, port: port[i]! };
  }
  if (oracle.length > n) return { kind: "port-stops", index: n, oracle: oracle[n]! };
  if (port.length > n) return { kind: "port-extra", index: n, port: port[n]! };
  return { kind: "match", calls: n };
}

export const readCalls = (file: string, parse: (raw: string) => string[]): string[] | undefined => (existsSync(file) ? parse(readFileSync(file, "latin1")) : undefined);
