// Re-records this directory's oracle fixtures (lane cg-write). Run by hand, never by a test (README.md; review cg-write N1):
//
//   bun src/rustc_codegen_llvm/back/write_oracle/record.ts
//
// For each target of back/write.test.ts it compiles context_oracle/empty.rs with the pinned rustc under lldb, as the test's
// port side compiles it (from a work directory, the relative path `empty.rs`, `--crate-type lib --target <t> --emit=llvm-ir
// -Cno-prepopulate-passes`), with record_tm.py breaking at `LLVMRustCreateTargetMachine`, and writes `<target>.tm`: one line per
// call. It also writes `version.txt`, the `LLVM version:` line of `rustc -vV`. Prints one line per file it wrote; a failure is one
// `ERROR:` line and exit 1. Needs lldb (Xcode command-line tools) on aarch64-apple-darwin.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../../scripts/lib/common.ts";

const HERE = import.meta.dir;
const TARGETS = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"] as const;

function die(msg: string): never {
  console.log(`ERROR: ${msg}`);
  process.exit(1);
}

const env = { ...process.env, RUSTUP_AUTO_INSTALL: "0", RUSTC_ICE: "0" };
const sr = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env });
if (sr.exitCode !== 0) die(`no pinned toolchain (rustc +${PIN.toolchain} --print sysroot failed)`);
const SYSROOT = sr.stdout.toString().trim();
const WORK = join(DATA, "tmp", "cg-write-record", String(process.pid));
mkdirSync(WORK, { recursive: true });
writeFileSync(join(WORK, "empty.rs"), readFileSync(join(HERE, "..", "..", "context_oracle", "empty.rs")));

try {
  for (const target of TARGETS) {
    const r = Bun.spawnSync(
      [
        "lldb",
        "--batch",
        "-o",
        `command script import ${join(HERE, "record_tm.py")}`,
        // rustc gets a SIGUSR1 on the host target; pass it on without stopping.
        "-o",
        "process handle -p true -s false -n false SIGUSR1",
        "-o",
        "run",
        "-k",
        "process kill",
        "--",
        join(SYSROOT, "bin", "rustc"),
        "--crate-type",
        "lib",
        "--target",
        target,
        "--emit=llvm-ir",
        "-Cno-prepopulate-passes",
        "empty.rs",
      ],
      { cwd: WORK, env, timeout: 300_000 },
    );
    const out = r.stdout.toString();
    if (!out.includes("exited with status = 0")) die(`${target}: rustc under lldb did not exit with status 0 (lldb exit ${r.exitCode})`);
    const lines = out
      .split("\n")
      .filter((l) => l.startsWith("RECORD\t"))
      .map((l) => `${l.slice("RECORD\t".length)}\n`);
    if (lines.length === 0) die(`${target}: no LLVMRustCreateTargetMachine call recorded`);
    writeFileSync(join(HERE, `${target}.tm`), lines.join(""));
    console.log(`wrote ${target}.tm (${lines.length} calls)`);
  }
  const v = Bun.spawnSync([join(SYSROOT, "bin", "rustc"), "-vV"], { env });
  const line = v.stdout
    .toString()
    .split("\n")
    .find((l) => l.startsWith("LLVM version: "));
  if (v.exitCode !== 0 || line === undefined) die("rustc -vV printed no `LLVM version:` line");
  writeFileSync(join(HERE, "version.txt"), `${line}\n`);
  console.log("wrote version.txt");
} finally {
  rmSync(WORK, { recursive: true, force: true });
}
