// rust-ts: tests of the recorder's handle bookkeeping (record.ts; lane llir-init). The recorder's C source is compiled into a test
// program, without its interpose section, against the pinned libLLVM, and its static functions are driven directly:
// - review llir-folder-notes N-a: after `retire` (what the LLVMContextDispose wrapper calls), an attribute address that a later
//   context reuses gets a new handle and its own `?attr` line, while a handle of another context keeps its number;
// - the handle tables are hash tables: many handles, retired and reused addresses, all looked up right.
// proof.oracle.test.ts checks that real recordings are unchanged by these (every committed script records byte for byte).
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, UPSTREAM } from "../../../scripts/lib/common.ts";
import { FFI_PATH, parseFfi } from "../../../tools/llir/ffi_gen.ts";
import { recorderSource } from "./record.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const HAVE = SYSROOT !== "" && process.platform === "darwin" && process.arch === "arm64";
if (!HAVE && !REQUIRE) console.log("SKIP: the pinned toolchain on aarch64 macOS is unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");
const WORK = join(DATA, "tmp", "llir-record-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);

/** The recorder's source for the functions librustc_driver imports, as recorderDylib builds it. */
function source(): string {
  const libDir = join(SYSROOT, "lib");
  const nm = Bun.spawnSync(["sh", "-c", `nm -u "${libDir}"/librustc_driver-*.dylib`], { stdout: "pipe" });
  const syms = new Set(nm.stdout.toString().split("\n").map((l) => l.trim().replace(/^_/, "")));
  return recorderSource(parseFfi(readFileSync(join(UPSTREAM, FFI_PATH), "utf8")), syms);
}

const MAIN = `
extern P LLVMContextCreate(void); extern P LLVMCreateEnumAttribute(P, unsigned, unsigned long long);
int main(int argc, char** argv){
  out = fopen(argv[1], "w");
  /* N-a: an attribute of context c1, logged once; after c1's handles are retired, the same address is new again. */
  P c1 = LLVMContextCreate(); pthread_setspecific(ckey, c1);
  long hc1 = id(c1);
  P a = LLVMCreateEnumAttribute(c1, LLVMGetEnumAttributeKindForName("nounwind", 8), 0);
  attr(a); attr(a);
  /* A handle of another context is not retired with c1's. */
  pthread_setspecific(ckey, (P)0x10); long other = id((P)0x1238); pthread_setspecific(ckey, c1);
  retire(c1);
  attr(a);
  fprintf(out, "ctx %ld %ld other %ld %ld cur %p\\n", hc1, find(c1), other, find((P)0x1238), pthread_getspecific(ckey));
  /* Many handles: every lookup right, through growth, retirement and reuse. */
  long bad = 0; long first = (long)nids + 1;
  for (long i = 0; i < 300000; i++) if (id((P)(0x100000 + i * 16)) != first + i) bad++;
  for (long i = 0; i < 300000; i += 2) forget((P)(0x100000 + i * 16));
  for (long i = 0; i < 300000; i++) { long f = find((P)(0x100000 + i * 16)); if (i % 2 ? f != first + i : f != 0) bad++; }
  long again = id((P)0x100000);
  fprintf(out, "bad %ld again %ld\\n", bad, again - (first + 300000));
  fclose(out); out = 0;
  return 0;
}
`;

describe.skipIf(!HAVE && !REQUIRE)("the recorder's handle tables", () => {
  test("N-a: a disposed context's handles are retired; lookups are hash-table lookups", () => {
    mkdirSync(WORK, { recursive: true });
    try {
      const src = source();
      // The LLVMContextDispose wrapper retires the context's handles after it logs the call.
      expect(src).toMatch(/fputs\("LLVMContextDispose\(",out\);[^\n]* retire\(\(P\)a0\);/);
      const program = src.replace(/__attribute__\(\(used,section\("__DATA,__interpose"\)\)\)[^\n]*\n/g, "") + MAIN;
      writeFileSync(join(WORK, "t.c"), program);
      const libDir = join(SYSROOT, "lib");
      const cc = Bun.spawnSync(["cc", "-O1", "-w", join(WORK, "t.c"), "-o", join(WORK, "t"), `-L${libDir}`, "-lLLVM", `-Wl,-rpath,${libDir}`], { stdout: "pipe", stderr: "pipe" });
      expect(cc.stderr.toString().split("\n")[0]!).toBe("");
      expect(cc.exitCode).toBe(0);
      const run = Bun.spawnSync([join(WORK, "t"), join(WORK, "out.txt")], { stdout: "pipe", stderr: "pipe" });
      expect(run.exitCode).toBe(0);
      const lines = readFileSync(join(WORK, "out.txt"), "utf8").split("\n").filter((l) => l !== "");
      expect(lines).toEqual([
        "0\t?attr %2 nounwind 0",
        // The same address after retirement: a new handle and its own line (review llir-folder-notes N-a).
        "0\t?attr %4 nounwind 0",
        "ctx 1 0 other 3 3 cur 0x0",
        "bad 0 again 0",
      ]);
    } finally {
      rmSync(WORK, { recursive: true, force: true });
    }
  });
});
