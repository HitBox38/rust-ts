// rust-ts: the FFI call recorder (review plan-m7 F6 item 2; lane llir-core-a). It records the LLVM C API calls the pinned rustc
// makes while it compiles a case, **with their arguments**, as a script that replay.ts plays against the model. So the model is
// tested on the calls real rustc makes, not on hand-written fixtures. Tests only: nothing in the compiler imports it.
//
//   bun src/rust_ts/llvm/record.ts <out.script> -- <rustc argv...>     record one compile (the argv's `rustc` is replaced by the
//                                                                   pinned toolchain's own bin/rustc)
//
// How: a dylib interposes (`__DATA,__interpose`, loaded with `DYLD_INSERT_LIBRARIES`) on every `LLVM*` C function of ffi.rs that
// librustc_driver imports, with a wrapper typed from ffi.rs's signature that logs the call. No file of the toolchain changes; the
// oracle's IR is unchanged by the recording (record.test.ts checks this). The same mechanism as scripts/lib/llvm-trace.ts (the
// harness's names-only trace for ir-diff), with typed arguments.
//
// **What cannot be recorded:** the 131 `LLVMRust*` wrappers are inside librustc_driver (1 exported), so their calls are never
// seen. Their effects are partly observed instead: before each recorded call the recorder looks at every module it has seen and
// emits an **inferred** line (`?`) for state that changed since the last look, in the order a wrapper would have made it:
//   `?global %G "name" %T %M`        a global variable the module has that no recorded call made (`LLVMRustGetOrInsertGlobal`)
//   `?datalayout %M "layout"`        the data layout changed (`LLVMRustSetDataLayoutFromTargetMachine`; also after a recorded
//                                    `LLVMSetDataLayout` that changed it, which replay skips as already applied)
//   `?triple %M "triple"`            the module's target triple changed (`LLVMRustSetNormalizedTarget`)
//   `?flag %M <behavior> "key" i <n>` / `... s "str"`   a module flag was added (`LLVMRustAddModuleFlagU32` / `...String`)
//   `?attr %A <llvm name> <int>` / `... type %T` / `?attr %A str "k" "v"`   an attribute handle no recorded call made
//   `?attrs %F <index> [%A, ...]`    the attributes of a function at an index grew (`LLVMRustAddFunctionAttributes`): all of them
// Not observed, so absent from every script: call-site attributes (`LLVMRustAddCallSiteAttributes`), `dso_local`
// (`LLVMRustSetDSOLocal`), the builder wrappers (`LLVMRustBuildMemCpy`, ...), debuginfo wrappers, inline
// asm, and anything else a wrapper does to an existing value. Comparisons against the oracle's IR project those away (replay.ts).
//
// **Script format,** one call per line: `<thread>\t<line>`, `<line>` being an inferred line or
// `[%<ret> = ]<fn>(<arg>, ...)`. Arguments: a handle `%N` (numbered on first sight) or `null`; an integer in decimal; a double
// `d0x<16 hex>`; a byte string `"..."` (printable ASCII but `"` and `\` as is, other bytes `\XX`); an array `[a, b]`; `?` for
// what the recorder does not decode (callbacks, out-parameters). A returned string is `"..."`.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ATTR_NAME } from "./core.ts";
import { FFI_PATH, type FfiFn, type FfiItems, parseFfi } from "./ffi_gen.ts";

/** C type of a Rust parameter or return type of ffi.rs (aarch64 macOS, LP64). */
function cType(rust: string, items: FfiItems): string {
  const t = rust.replace(/'\w+ ?/g, "").replace(/\s+/g, " ").trim();
  if (t === "Bool" || t === "llvm::Bool" || t === "c_int" || t === "i32") return "int";
  if (t === "bool") return "_Bool";
  if (t === "c_uint" || t === "u32" || t === "MetadataKindId" || t === "NonZero<c_uint>") return "unsigned";
  if (t === "u64" || t === "c_ulonglong" || t === "size_t" || t === "usize") return "unsigned long long";
  if (t === "i64") return "long long";
  if (t === "f64" || t === "c_double") return "double";
  if (items.enums.some((e) => e.name === t) || /^RawEnum</.test(t)) return "unsigned";
  if (items.flags.some((f) => f.name === t)) return items.flags.find((f) => f.name === t)!.repr.includes("64") ? "unsigned long long" : "unsigned";
  return "void*";
}

/** How the logger prints an argument: its kind and, for pointers with a length, the length parameter's index. */
type ArgFmt = { k: "handle" | "int" | "uint" | "dbl" | "cstr" | "skip" } | { k: "bytes" | "harr" | "warr"; len: number };

function argFmts(f: FfiFn, items: FfiItems): ArgFmt[] {
  const isLen = (i: number): boolean => i >= 0 && i < f.params.length && /^(c_uint|size_t|usize|u64|u32)$/.test(f.params[i]!.rust.trim());
  return f.params.map((p, i) => {
    const t = p.rust.replace(/'\w+ ?/g, "").replace(/\s+/g, " ").trim();
    const lenAt = isLen(i + 1) ? i + 1 : isLen(i - 1) ? i - 1 : -1;
    if (t === "*const c_uchar") return lenAt >= 0 ? { k: "bytes", len: lenAt } : { k: "skip" };
    if (t === "*const c_char") return { k: "cstr" };
    if (/^\*const (&|Option<&)/.test(t)) return lenAt >= 0 ? { k: "harr", len: lenAt } : { k: "skip" };
    if (t === "*const u64") return lenAt >= 0 ? { k: "warr", len: lenAt } : { k: "skip" };
    if (/^(&mut |\*mut |\*const )/.test(t) || /fn\(/.test(t) || /Callback|HandlerTy/.test(t)) {
      // `&mut T` / `*mut T` out-parameters and callbacks; but a `&mut Builder` or `*mut` handle is a handle.
      return /Builder|Linker|ThinLTOData|Buffer|Context|DIBuilder|TargetMachine|MCSubtargetInfo|OperandBundle/.test(t) ? { k: "handle" } : { k: "skip" };
    }
    const c = cType(t, items);
    if (c === "double") return { k: "dbl" };
    if (c === "int" || c === "long long" || c === "_Bool") return { k: "int" };
    if (c === "unsigned" || c === "unsigned long long") return { k: "uint" };
    return { k: "handle" };
  });
}

/** The interposer's C source for the ffi.rs C functions in `syms`. */
export function recorderSource(items: FfiItems, syms: ReadonlySet<string>): string {
  const fns = items.fns.filter((f) => !f.name.startsWith("LLVMRust") && syms.has(f.name));
  let c = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
typedef void* P;
extern P LLVMGetFirstGlobal(P); extern P LLVMGetNextGlobal(P); extern P LLVMGlobalGetValueType(P);
extern const char* LLVMGetValueName2(P, size_t*); extern const char* LLVMGetTarget(P); extern const char* LLVMGetDataLayoutStr(P);
extern unsigned LLVMGetNamedMetadataNumOperands(P, const char*); extern void LLVMGetNamedMetadataOperands(P, const char*, P*);
extern unsigned LLVMGetMDNodeNumOperands(P); extern void LLVMGetMDNodeOperands(P, P*);
extern P LLVMGetFirstFunction(P); extern P LLVMGetNextFunction(P); extern unsigned LLVMCountParams(P);
extern unsigned LLVMGetAttributeCountAtIndex(P, unsigned); extern void LLVMGetAttributesAtIndex(P, unsigned, P*);
extern int LLVMIsEnumAttribute(P); extern int LLVMIsStringAttribute(P); extern int LLVMIsTypeAttribute(P);
extern unsigned LLVMGetEnumAttributeKind(P); extern unsigned long long LLVMGetEnumAttributeValue(P); extern P LLVMGetTypeAttributeValue(P);
extern const char* LLVMGetStringAttributeKind(P, unsigned*); extern const char* LLVMGetStringAttributeValue(P, unsigned*);
extern unsigned LLVMGetEnumAttributeKindForName(const char*, size_t); extern P LLVMGetModuleContext(P);
extern P LLVMIsAConstantInt(P); extern unsigned long long LLVMConstIntGetZExtValue(P); extern P LLVMIsAMDString(P);
extern const char* LLVMGetMDString(P, unsigned*);
static FILE* out; static pthread_mutex_t mu = PTHREAD_RECURSIVE_MUTEX_INITIALIZER; static pthread_key_t key; static long threads;
static P* ids; static size_t nids, capids;
#define MAXM 64
static P mods[MAXM]; static long modtid[MAXM]; static int nmods; static char* triples[MAXM]; static char* layouts[MAXM]; static unsigned nflags[MAXM];
__attribute__((constructor)) static void init(void){ const char* p=getenv("RUST_TS_LLVM_RECORD"); if(p) out=fopen(p,"w"); pthread_key_create(&key,0); }
__attribute__((destructor)) static void fini(void){ if(out) fclose(out); out=0; }
static long tid(void){ long t=(long)pthread_getspecific(key); if(!t){ t=__sync_add_and_fetch(&threads,1); pthread_setspecific(key,(void*)t);} return t; }
static long find(P p){ for(size_t i=0;i<nids;i++) if(ids[i]==p) return (long)i+1; return 0; }
static long id(P p){ long i=find(p); if(i) return i; if(nids==capids){ capids=capids?capids*2:1024; ids=realloc(ids,capids*sizeof(P)); } ids[nids++]=p; return (long)nids; }
static void bytes(const unsigned char* s, size_t n){ fputc('"',out); for(size_t i=0;i<n;i++){ unsigned c=s[i]; if(c>=0x20&&c<0x7f&&c!='"'&&c!='\\\\') fputc(c,out); else fprintf(out,"\\\\%02X",c);} fputc('"',out); }
static void h(P p){ if(!p) fputs("null",out); else fprintf(out,"%%%ld",id(p)); }
static const char* attrnames[] = { ATTRNAMES }; static unsigned attrkinds[sizeof(attrnames)/sizeof(*attrnames)]; static int attrinit;
static const char* attrname(unsigned k){ if(!attrinit){ for(size_t i=0;i<sizeof(attrnames)/sizeof(*attrnames);i++) attrkinds[i]=LLVMGetEnumAttributeKindForName(attrnames[i],strlen(attrnames[i])); attrinit=1; }
  for(size_t i=0;i<sizeof(attrnames)/sizeof(*attrnames);i++) if(attrkinds[i]==k) return attrnames[i]; return 0; }
typedef struct { P f; unsigned n; unsigned* c; } FA; static FA* fas; static size_t nfas, capfas;
static FA* fa(P f){ for(size_t i=0;i<nfas;i++) if(fas[i].f==f) return &fas[i]; if(nfas==capfas){ capfas=capfas?capfas*2:256; fas=realloc(fas,capfas*sizeof(FA)); }
  unsigned n=LLVMCountParams(f)+2; fas[nfas]=(FA){f,n,calloc(n,sizeof(unsigned))}; return &fas[nfas++]; }
/* An attribute handle no recorded call made (an LLVMRustCreate* wrapper's): described by kind and value. */
static void attr(P a){ if(find(a)) return; long i=id(a); fprintf(out,"%ld\\t?attr %%%ld ",tid(),i);
  if(LLVMIsStringAttribute(a)){ unsigned kl=0,vl=0; const char* k=LLVMGetStringAttributeKind(a,&kl); const char* v=LLVMGetStringAttributeValue(a,&vl); fputs("str ",out); bytes((const unsigned char*)k,kl); fputc(' ',out); bytes((const unsigned char*)v,vl); }
  else { const char* n=attrname(LLVMGetEnumAttributeKind(a)); if(n) fputs(n,out); else fprintf(out,"kind%u",LLVMGetEnumAttributeKind(a));
    if(LLVMIsTypeAttribute(a)){ P t=LLVMGetTypeAttributeValue(a); fputs(" type ",out); if(find(t)) h(t); else fputs("?",out); }
    else if(LLVMIsEnumAttribute(a)) fprintf(out," %llu",LLVMGetEnumAttributeValue(a)); }
  fputc('\\n',out); }
/* Inferred lines: state a wrapper made since the last look. */
static void scan(void){
  for(int m=0;m<nmods;m++){ P M=mods[m]; if(!M || modtid[m]!=tid()) continue; /* a module is only read on the thread that builds it */
    for(P g=LLVMGetFirstGlobal(M); g; g=LLVMGetNextGlobal(g)) if(!find(g)){ size_t n=0; const char* s=LLVMGetValueName2(g,&n); P t=LLVMGlobalGetValueType(g);
      fprintf(out,"%ld\\t?global ",tid()); h(g); fputc(' ',out); bytes((const unsigned char*)s,n); fputc(' ',out); if(find(t)) h(t); else fputs("?",out); fputc(' ',out); h(M); fputc('\\n',out); }
    const char* dl=LLVMGetDataLayoutStr(M); if(!layouts[m] || strcmp(layouts[m],dl)){ if(*dl || layouts[m]){ fprintf(out,"%ld\\t?datalayout ",tid()); h(M); fputc(' ',out); bytes((const unsigned char*)dl,strlen(dl)); fputc('\\n',out);} free(layouts[m]); layouts[m]=strdup(dl); }
    const char* tr=LLVMGetTarget(M); if(!triples[m] || strcmp(triples[m],tr)){ if(*tr || triples[m]){ fprintf(out,"%ld\\t?triple ",tid()); h(M); fputc(' ',out); bytes((const unsigned char*)tr,strlen(tr)); fputc('\\n',out);} free(triples[m]); triples[m]=strdup(tr); }
    /* Module flags, read from the named metadata's nodes: LLVMCopyModuleFlagsMetadata traps on the Max and Min behaviors
       (map_from_llvmModFlagBehavior's llvm_unreachable). LLVMGetMDNodeOperands hands a ConstantAsMetadata back as its constant. */
    unsigned nf=LLVMGetNamedMetadataNumOperands(M,"llvm.module.flags");
    if(nf>nflags[m]){ P* fl=calloc(nf,sizeof(P)); LLVMGetNamedMetadataOperands(M,"llvm.module.flags",fl);
      for(unsigned i=nflags[m];i<nf;i++){ P ops[3]={0,0,0}; if(LLVMGetMDNodeNumOperands(fl[i])!=3) continue; LLVMGetMDNodeOperands(fl[i],ops);
        unsigned kl=0; const char* k=LLVMGetMDString(ops[1],&kl); fprintf(out,"%ld\\t?flag ",tid()); h(M); fprintf(out," %llu ",LLVMConstIntGetZExtValue(ops[0])); bytes((const unsigned char*)k,kl);
        if(LLVMIsAConstantInt(ops[2])) fprintf(out," i %llu",LLVMConstIntGetZExtValue(ops[2]));
        else if(LLVMIsAMDString(ops[2])){ unsigned sl=0; const char* v=LLVMGetMDString(ops[2],&sl); fputs(" s ",out); bytes((const unsigned char*)v,sl); }
        else fputs(" ?",out);
        fputc('\\n',out); }
      free(fl); nflags[m]=nf; }
    /* Function attributes (LLVMRustAddFunctionAttributes): an index whose attribute count grew is logged whole. */
    for(P f=LLVMGetFirstFunction(M); f; f=LLVMGetNextFunction(f)){ if(!find(f)) continue; FA* s=fa(f);
      for(unsigned j=0;j<s->n;j++){ unsigned idx = j==0 ? 0xFFFFFFFFu : j-1; unsigned n=LLVMGetAttributeCountAtIndex(f,idx); if(n==s->c[j]) continue;
        P* as=calloc(n,sizeof(P)); LLVMGetAttributesAtIndex(f,idx,as); for(unsigned k=0;k<n;k++) attr(as[k]);
        fprintf(out,"%ld\\t?attrs ",tid()); h(f); fprintf(out," %u [",idx); for(unsigned k=0;k<n;k++){ if(k) fputs(", ",out); h(as[k]); } fputs("]\\n",out); free(as); s->c[j]=n; } } }
}
`;
  fns.forEach((f, i) => {
    const fmts = argFmts(f, items);
    const ps = f.params.map((p, j) => `${cType(p.rust, items)} a${j}`).join(", ") || "void";
    const ret = f.ret === undefined ? "void" : cType(f.ret, items);
    const retStr = f.ret !== undefined && /c_char/.test(f.ret);
    c += `extern ${ret} o${i}(${ps}) __asm__("_${f.name}");\n`;
    c += `__attribute__((used)) static ${ret} w${i}(${ps}){\n  if(out){ pthread_mutex_lock(&mu); scan(); pthread_mutex_unlock(&mu); }\n`;
    if (f.name === "LLVMContextDispose") c += `  if(out){ pthread_mutex_lock(&mu); for(int m=0;m<nmods;m++) if(mods[m] && LLVMGetModuleContext(mods[m])==a0) mods[m]=0; pthread_mutex_unlock(&mu); }\n`;
    c += `  ${ret === "void" ? "" : `${ret} r = `}o${i}(${f.params.map((_, j) => `a${j}`).join(", ")});\n`;
    c += `  if(out){ pthread_mutex_lock(&mu);${f.name === "LLVMModuleCreateWithNameInContext" ? " if(nmods<MAXM){ modtid[nmods]=tid(); mods[nmods++]=(P)r; }" : ""} fprintf(out,"%ld\\t",tid());`;
    if (ret !== "void") c += retStr ? ` fputs("",out);` : ret === "void*" ? ` h((P)r); fputs(" = ",out);` : ` fprintf(out,"%lld = ",(long long)r);`;
    c += ` fputs("${f.name}(",out);`;
    fmts.forEach((fm, j) => {
      if (j) c += ` fputs(", ",out);`;
      switch (fm.k) {
        case "handle":
          c += ` h((P)a${j});`;
          break;
        case "int":
          c += ` fprintf(out,"%lld",(long long)a${j});`;
          break;
        case "uint":
          c += ` fprintf(out,"%llu",(unsigned long long)a${j});`;
          break;
        case "dbl":
          c += ` { union{double d; unsigned long long u;} x; x.d=a${j}; fprintf(out,"d0x%016llX",x.u); }`;
          break;
        case "cstr":
          c += ` if(a${j}) bytes((const unsigned char*)a${j},strlen((const char*)a${j})); else fputs("null",out);`;
          break;
        case "bytes":
          c += ` bytes((const unsigned char*)a${j},(size_t)a${fm.len});`;
          break;
        case "harr":
          c += ` fputc('[',out); for(unsigned long long k=0;k<(unsigned long long)a${fm.len};k++){ if(k) fputs(", ",out); h(((P*)a${j})[k]); } fputc(']',out);`;
          break;
        case "warr":
          c += ` fputc('[',out); for(unsigned long long k=0;k<(unsigned long long)a${fm.len};k++){ if(k) fputs(", ",out); fprintf(out,"%llu",((unsigned long long*)a${j})[k]); } fputc(']',out);`;
          break;
        case "skip":
          c += ` fputs("?",out);`;
          break;
      }
    });
    c += ` fputs(")",out);`;
    if (retStr) c += ` fputs(" -> ",out); if(r) bytes((const unsigned char*)r,strlen((const char*)r)); else fputs("null",out);`;
    c += ` fputc('\\n',out); pthread_mutex_unlock(&mu); }\n  ${ret === "void" ? "" : "return r;"}\n}\n`;
    c += `__attribute__((used,section("__DATA,__interpose"))) static struct{void*a;void*b;} ip${i}={(void*)w${i},(void*)o${i}};\n`;
  });
  const names = [...new Set([...Object.values(ATTR_NAME), "align", "dereferenceable", "dereferenceable_or_null", "uwtable", "allocsize", "allockind", "memory", "captures"])];
  return c.replace("ATTRNAMES", names.map((n) => JSON.stringify(n)).join(", "));
}

/** The recorder dylib for the toolchain at `sysroot`, built with `cc` and cached under `dataDir/llvm-record/<key>/`. */
export function recorderDylib(sysroot: string, dataDir: string, upstream: string): string {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error(`the recorder is written for aarch64 macOS, not ${process.platform} ${process.arch}`);
  const libDir = join(sysroot, "lib");
  const nm = Bun.spawnSync(["sh", "-c", `nm -u "${libDir}"/librustc_driver-*.dylib`], { stdout: "pipe", stderr: "pipe" });
  if (nm.exitCode !== 0) throw new Error(`nm on librustc_driver failed: ${nm.stderr.toString().trim().split("\n")[0]}`);
  const syms = new Set(nm.stdout.toString().split("\n").map((l) => l.trim().replace(/^_/, "")));
  const source = recorderSource(parseFfi(readFileSync(join(upstream, FFI_PATH), "utf8")), syms);
  const key = createHash("sha256").update(source).update(readFileSync(join(libDir, "libLLVM.dylib"))).digest("hex").slice(0, 16);
  const dir = join(dataDir, "llvm-record", key);
  const dylib = join(dir, "rec.dylib");
  if (existsSync(dylib)) return dylib;
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `rec-${process.pid}`);
  writeFileSync(`${tmp}.c`, source);
  const cc = Bun.spawnSync(["cc", "-dynamiclib", "-O1", "-w", `${tmp}.c`, "-o", `${tmp}.dylib`, `-L${libDir}`, "-lLLVM", `-Wl,-rpath,${libDir}`], { stdout: "pipe", stderr: "pipe" });
  if (cc.exitCode !== 0) throw new Error(`cc failed on the recorder: ${cc.stderr.toString().trim().split("\n")[0]}`);
  renameSync(`${tmp}.dylib`, dylib);
  return dylib;
}

/** Runs the toolchain's own `bin/rustc` (not the rustup proxy) with the recorder loaded; returns its exit code. */
export function record(sysroot: string, dylib: string, script: string, argv: readonly string[], cwd: string): number {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), DYLD_INSERT_LIBRARIES: dylib, RUST_TS_LLVM_RECORD: script, RUSTC_ICE: "0" };
  const p = Bun.spawnSync([join(sysroot, "bin", "rustc"), ...argv], { cwd, env, stdout: "inherit", stderr: "inherit" });
  return p.exitCode ?? 1;
}

if (import.meta.main) {
  const { DATA, PIN, UPSTREAM } = await import("../../../scripts/lib/common.ts");
  const sep = process.argv.indexOf("--");
  const outFile = process.argv[2];
  if (outFile === undefined || sep < 0) {
    console.log("ERROR: usage: bun src/rust_ts/llvm/record.ts <out.script> -- <rustc argv...>");
    process.exit(2);
  }
  const sysroot = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"]).stdout.toString().trim();
  const code = record(sysroot, recorderDylib(sysroot, DATA, UPSTREAM), outFile, process.argv.slice(sep + 1), process.cwd());
  process.exit(code);
}
