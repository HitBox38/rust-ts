// rust-ts: records tools.test.ts's oracle fixtures (lane llir-tools). A tool, run by hand when the pin moves:
//   bun src/rust_ts/llvm/tools_oracle/record.ts
// It writes, next to itself:
//   pipelines.json      the pipeline the oracle's `LLVMRustOptimize` builds (`-Zautodiff=PrintPasses` prints `MPM.printPipeline`) for
//                       hello.rs under each command line in `COMBOS`, for x86_64-unknown-linux-gnu (the IR suites' target);
//   opt.O<n>.ll         the oracle's `--emit=llvm-ir` (after its pipeline) of opt.rs at -Copt-level=0 and 2;
//   opt.O<n>.script     the oracle's C API calls for the same compiles with -Cno-prepopulate-passes (record.ts), building thread
//                       only, handles renumbered (as proof.oracle.test.ts writes ../proof/<case>.script).
// One line per file written; `ERROR:` on a failure.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, UPSTREAM } from "../../../../scripts/lib/common.ts";
import { record, recorderDylib } from "../record.ts";
import { buildingThread, parseScript } from "../replay.ts";

/** Each command line whose pipeline is recorded: a name and rustc's flags after the common ones. */
export const COMBOS: readonly (readonly [string, readonly string[]])[] = [
  ["o0", ["-Copt-level=0"]],
  ["o1", ["-Copt-level=1"]],
  ["o2", ["-Copt-level=2"]],
  ["o3", ["-Copt-level=3"]],
  ["os", ["-Copt-level=s"]],
  ["oz", ["-Copt-level=z"]],
  ["o2-no-vectorize-loops", ["-Copt-level=2", "-Cno-vectorize-loops"]],
  ["o3-no-vectorize-slp", ["-Copt-level=3", "-Cno-vectorize-slp"]],
  ["o2-verify", ["-Copt-level=2", "-Zverify-llvm-ir"]],
  ["o0-verify", ["-Copt-level=0", "-Zverify-llvm-ir"]],
  ["o2-lint", ["-Copt-level=2", "-Zlint-llvm-ir"]],
  ["o0-lint-verify", ["-Copt-level=0", "-Zlint-llvm-ir", "-Zverify-llvm-ir"]],
  ["o2-passes", ["-Copt-level=2", "-Cpasses=instcombine dce"]],
  ["o0-passes", ["-Copt-level=0", "-Cpasses=instcombine"]],
  ["o2-passes-module-first", ["-Copt-level=2", "-Cpasses=globaldce,instcombine"]],
  ["o2-no-prepopulate", ["-Copt-level=2", "-Cno-prepopulate-passes"]],
  ["o0-no-prepopulate-verify", ["-Copt-level=0", "-Cno-prepopulate-passes", "-Zverify-llvm-ir"]],
  ["o2-no-prepopulate-passes", ["-Copt-level=2", "-Cno-prepopulate-passes", "-Cpasses=instcombine"]],
];
export const TARGET = ["--target", "x86_64-unknown-linux-gnu"];
/** The flags opt.rs is compiled with. */
export const OPT_ARGS = ["--target", "x86_64-unknown-linux-gnu", "-Ccodegen-units=1"];

/** The building thread's lines, as thread 1, with handles renumbered in order of first appearance (proof.oracle.test.ts's form). */
export function canonical(raw: string): string {
  const ids = new Map<string, string>();
  return buildingThread(parseScript(raw))
    .map((c) => `1\t${c.text.replace(/%\d+/g, (h) => ids.get(h) ?? (ids.set(h, `%${ids.size + 1}`), ids.get(h)!))}\n`)
    .join("");
}

if (import.meta.main) {
  const here = import.meta.dir;
  const sysroot = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } }).stdout.toString().trim();
  const rustc = join(sysroot, "bin", "rustc");
  const work = join(DATA, "tmp", "llir-tools-record", String(process.pid));
  mkdirSync(work, { recursive: true });
  const env = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
  const run = (argv: string[]): string => {
    const r = Bun.spawnSync([rustc, ...argv], { cwd: work, env, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) {
      console.log(`ERROR: rustc ${argv.join(" ")}: ${r.stderr.toString().split("\n")[0]}`);
      process.exit(1);
    }
    return r.stdout.toString();
  };
  writeFileSync(join(work, "hello.rs"), readFileSync(join(here, "hello.rs")));
  writeFileSync(join(work, "opt.rs"), readFileSync(join(here, "opt.rs")));

  const pipelines = COMBOS.map(([name, flags]) => ({ name, flags, pipeline: run(["hello.rs", ...TARGET, "-Ccodegen-units=1", ...flags, "-Zautodiff=PrintPasses", "--emit=llvm-ir", "-o", "hello.ll"]).trim() }));
  writeFileSync(join(here, "pipelines.json"), `${JSON.stringify(pipelines, null, 1)}\n`);
  console.log(`wrote pipelines.json (${pipelines.length} pipelines)`);

  const dylib = recorderDylib(sysroot, DATA, UPSTREAM);
  for (const o of ["0", "2"]) {
    run(["opt.rs", ...OPT_ARGS, `-Copt-level=${o}`, "--emit=llvm-ir", "-o", `opt.O${o}.ll`]);
    writeFileSync(join(here, `opt.O${o}.ll`), readFileSync(join(work, `opt.O${o}.ll`)));
    console.log(`wrote opt.O${o}.ll`);
    const code = record(sysroot, dylib, join(work, `opt.O${o}.script`), ["opt.rs", ...OPT_ARGS, `-Copt-level=${o}`, "-Cno-prepopulate-passes", "--emit=llvm-ir", "-o", "pre.ll"], work);
    if (code !== 0) {
      console.log(`ERROR: the recorded compile of opt.rs at -Copt-level=${o} exited ${code}`);
      process.exit(1);
    }
    writeFileSync(join(here, `opt.O${o}.script`), Buffer.from(canonical(readFileSync(join(work, `opt.O${o}.script`), "latin1")), "latin1"));
    console.log(`wrote opt.O${o}.script`);
  }
  rmSync(work, { recursive: true, force: true });
}
