// rust-ts: lane llir-tools' object evidence (a tool, run by hand; not a test). For an empty lib and hello.rs, on
// x86_64-unknown-linux-gnu and aarch64-apple-darwin, at -Copt-level=0 and 2, it compares the oracle's `--emit=obj` with
// tools.ts's `LLVMRustWriteOutputFile` (llc) on the oracle's own IR after its pipeline (`--emit=llvm-ir`), every module of the
// compile (the CGU and the allocator shim): sections (name, size), symbols (`llvm-nm`), disassembly lines, and bytes.
// Plan-m7 D2/D8: object bytes are not a gate.
// Usage: bun src/rust_ts/llvm/tools_oracle/objects.ts. One line per object to stdout; files under
// $RUST_TS_DATA/tmp/llir-tools-objects/.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../../scripts/lib/common.ts";
import type { TargetMachine } from "../handles.ts";
import { Context, Module } from "../ir.ts";
import { LLVMRustWriteOutputFile, pinned_tool, set_module_text, with_cl_args } from "../tools.ts";
import { CL_ARGS, CODEGEN_LEVEL, tmFromRecorded, type Level } from "./fixtures.ts";

const sysroot = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } }).stdout.toString().trim();
const rustc = join(sysroot, "bin", "rustc");
const OUT = join(DATA, "tmp", "llir-tools-objects");
rmSync(OUT, { recursive: true, force: true });
const binDir = pinned_tool("opt").replace(/\/opt$/, "");
const tool = (name: string, args: string[]): string => {
  const r = Bun.spawnSync([join(binDir, name), ...args], { stdout: "pipe", stderr: "pipe" });
  return r.stdout.toString();
};
const PROGRAMS: Record<string, string> = { "empty-lib": "#![crate_type = \"lib\"]\n", hello: readFileSync(join(import.meta.dir, "hello.rs"), "utf8") };
const TARGETS: Record<string, string> = { "x86_64-unknown-linux-gnu": "x86_64-unknown-linux-gnu", "aarch64-apple-darwin": "aarch64-apple-darwin" };

/** `llvm-readobj --sections`: (name, size) per section, in order. */
function sections(o: string): string[] {
  const text = tool("llvm-readobj", ["--sections", o]);
  const out: string[] = [];
  let name = "";
  for (const line of text.split("\n")) {
    const n = /^\s+Name: (\S+)/.exec(line);
    if (n) name = n[1]!;
    const s = /^\s+Size: (\S+)/.exec(line);
    if (s) out.push(`${name} ${s[1]}`);
  }
  return out;
}
const symbols = (o: string): string[] => tool("llvm-nm", ["--no-sort", o]).split("\n").filter((l) => l !== "").map((l) => l.replace(/^[0-9a-f]+ /, "").trim()).sort();
/** Disassembly without the header line naming the file. */
const disasm = (o: string): string[] => tool("llvm-objdump", ["-d", "--no-show-raw-insn", o]).split("\n").filter((l) => !l.includes("file format"));

for (const [pname, src] of Object.entries(PROGRAMS)) {
  for (const [target, tmName] of Object.entries(TARGETS)) {
    for (const level of ["0", "2"] as Level[]) {
      const dir = join(OUT, `${pname}-${target}-O${level}`);
      mkdirSync(join(dir, "oracle"), { recursive: true });
      mkdirSync(join(dir, "ours"), { recursive: true });
      writeFileSync(join(dir, `${pname}.rs`), src);
      const argv = [`${pname}.rs`, "--crate-name", pname.replace("-", "_"), "--target", target, `-Copt-level=${level}`, "-Ccodegen-units=1", "--emit=obj,llvm-ir", "--out-dir", "oracle"];
      const r = Bun.spawnSync([rustc, ...argv], { cwd: dir, env: { ...process.env, RUSTC_ICE: "0" }, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) {
        console.log(`ERROR: ${pname} ${target} O${level}: rustc: ${r.stderr.toString().split("\n")[0]}`);
        continue;
      }
      // `--emit=obj,llvm-ir` keeps each module's files (`-Csave-temps` is not needed): one `.ll` and one `.o` per module.
      const tm = tmFromRecorded(readFileSync(join(import.meta.dir, "..", "..", "..", "rustc_codegen_llvm", "back", "write_oracle", `${tmName}.tm`), "utf8").split("\n")[1]!, CODEGEN_LEVEL[level]) as unknown as TargetMachine;
      for (const ll of readdirSync(join(dir, "oracle")).filter((f) => f.endsWith(".ll"))) {
        const base = ll.slice(0, -3);
        const M = new Module(new Context(), base);
        set_module_text(M, readFileSync(join(dir, "oracle", ll), "latin1"));
        const ours = join(dir, "ours", `${base}.o`);
        const res = with_cl_args(CL_ARGS, () => LLVMRustWriteOutputFile(tm, M, ours, undefined, "ObjectFile", false, false));
        const theirs = join(dir, "oracle", `${base}.o`);
        const [sa, sb] = [sections(ours), sections(theirs)];
        const [ya, yb] = [symbols(ours), symbols(theirs)];
        const [da, db] = [disasm(ours), disasm(theirs)];
        const dDiff = da.filter((l, i) => l !== db[i]).length + Math.abs(da.length - db.length);
        const [ba, bb] = [readFileSync(ours), readFileSync(theirs)];
        const firstByte = ba.findIndex((b, i) => b !== bb[i]);
        console.log(
          `${pname} ${target} O${level} ${base}: result ${res}; sections ${JSON.stringify(sa) === JSON.stringify(sb) ? `same (${sa.length})` : `DIFFER ${JSON.stringify(sa.filter((x) => !sb.includes(x)))} vs ${JSON.stringify(sb.filter((x) => !sa.includes(x)))}`}; symbols ${JSON.stringify(ya) === JSON.stringify(yb) ? `same (${ya.length})` : "DIFFER"}; disassembly ${dDiff === 0 ? `same (${da.length} lines)` : `${dDiff} lines differ`}; bytes ${ba.equals(bb) ? "identical" : `${ba.length} vs ${bb.length}, first difference at ${firstByte < 0 ? Math.min(ba.length, bb.length) : firstByte}`}`,
        );
      }
    }
  }
}
