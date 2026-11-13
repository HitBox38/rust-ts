// Re-records this directory's oracle fixtures (lane cg-write). Run by hand, never by a test (README.md; review cg-write N1):
//
//   bun src/rustc_codegen_llvm/back/write_oracle/record.ts
//
// For each target of back/write.test.ts it compiles context_oracle/empty.rs with the pinned rustc under lldb, as the test's
// port side compiles it (from a work directory, the relative path `empty.rs`, `--crate-type lib --target <t> --emit=llvm-ir
// -Cno-prepopulate-passes`), with record_tm.py breaking at `LLVMRustCreateTargetMachine`, and writes `<target>.tm`: one line per
// call. It also writes `version.txt`, the `LLVM version:` line of `rustc -vV`. Prints one line per file it wrote; a failure is one
// `ERROR:` line and exit 1. Needs lldb (Xcode command-line tools) on aarch64-apple-darwin.
//
// lldb runs with `-x` (no `~/.lldbinit`) and a timeout per run. Every recording is made before any file is written, so a failure
// leaves the fixtures as they were, and the scratch directory is removed on every path (review cg-write-recheck R1).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../../scripts/lib/common.ts";

const HERE = import.meta.dir;
const TARGETS = ["x86_64-unknown-linux-gnu", "aarch64-apple-darwin"] as const;
/** Per lldb run; a hung lldb ends here, with an `ERROR:` line. */
const LLDB_TIMEOUT_MS = 120_000;

/** A failure `die` reports; `main`'s caller prints it as the one `ERROR:` line, after the scratch directory is gone. */
class RecordError extends Error {}

function die(msg: string): never {
  throw new RecordError(msg);
}

/** The last few lines of a process's stderr, on one line, for an `ERROR:` line. */
function stderr_tail(stderr: Buffer | undefined): string {
  const lines = (stderr?.toString() ?? "").trim().split("\n").filter((l) => l !== "");
  return lines.length === 0 ? "(empty)" : lines.slice(-3).join(" | ");
}

const env = { ...process.env, RUSTUP_AUTO_INSTALL: "0", RUSTC_ICE: "0" };

function main(): void {
  const sr = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env });
  if (sr.exitCode !== 0) die(`no pinned toolchain (rustc +${PIN.toolchain} --print sysroot failed; stderr: ${stderr_tail(sr.stderr)})`);
  const SYSROOT = sr.stdout.toString().trim();
  const WORK = join(DATA, "tmp", "cg-write-record", String(process.pid));
  /** `[file name, contents, what the output line adds]`, written only once every recording has succeeded. */
  const files: [string, string, string][] = [];
  try {
    mkdirSync(WORK, { recursive: true });
    writeFileSync(join(WORK, "empty.rs"), readFileSync(join(HERE, "..", "..", "context_oracle", "empty.rs")));
    for (const target of TARGETS) {
      let r: ReturnType<typeof Bun.spawnSync>;
      try {
        r = Bun.spawnSync(
          [
            "lldb",
            // --no-lldbinit: a user's ~/.lldbinit must not change the recording.
            "-x",
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
          { cwd: WORK, env, timeout: LLDB_TIMEOUT_MS },
        );
      } catch (e) {
        // A missing lldb is a spawn error (ENOENT), not an exit status.
        die(`${target}: lldb could not be started (${(e as Error).message})`);
      }
      if (r.exitedDueToTimeout) die(`${target}: lldb did not finish within ${LLDB_TIMEOUT_MS / 1000} s (stderr: ${stderr_tail(r.stderr)})`);
      const out = r.stdout?.toString() ?? "";
      if (!out.includes("exited with status = 0")) {
        die(
          `${target}: rustc under lldb did not exit with status 0 (lldb exit ${r.exitCode}${r.signalCode ? `, ${r.signalCode}` : ""}; stderr: ${stderr_tail(r.stderr)})`,
        );
      }
      const lines = out
        .split("\n")
        .filter((l) => l.startsWith("RECORD\t"))
        .map((l) => `${l.slice("RECORD\t".length)}\n`);
      if (lines.length === 0) die(`${target}: no LLVMRustCreateTargetMachine call recorded`);
      files.push([`${target}.tm`, lines.join(""), ` (${lines.length} calls)`]);
    }
    const v = Bun.spawnSync([join(SYSROOT, "bin", "rustc"), "-vV"], { env });
    const line = v.stdout
      .toString()
      .split("\n")
      .find((l) => l.startsWith("LLVM version: "));
    if (v.exitCode !== 0 || line === undefined) die(`rustc -vV printed no \`LLVM version:\` line (exit ${v.exitCode}; stderr: ${stderr_tail(v.stderr)})`);
    files.push(["version.txt", `${line}\n`, ""]);
  } finally {
    rmSync(WORK, { recursive: true, force: true });
  }
  for (const [name, text, note] of files) {
    writeFileSync(join(HERE, name), text);
    console.log(`wrote ${name}${note}`);
  }
}

try {
  main();
} catch (e) {
  console.log(`ERROR: ${e instanceof RecordError ? e.message : String(e)}`);
  process.exit(1);
}
