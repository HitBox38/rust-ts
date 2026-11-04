// rust-ts glue (not an upstream mirror) for committed oracle fixtures of one small Miri program: `<name>.rs` and the isolated
// oracle's `<name>.stdout`, `<name>.stderr` and `<name>.exit`. Unlike rust_ts/miri_program.ts, whose tests run the oracle live,
// a test here runs only the port. The program's Miri flags are on a first line `// miri-flags: ...`.
//
//   bun src/rust_ts/miri_fixture.ts <file.rs>...     regenerate the fixtures from the isolated oracle
//
// Programs run with their directory as cwd, so a path in the output is the file's base name.
import { readFileSync, writeFileSync } from "node:fs";
import { type MiriRun, run_miri_oracle, run_miri_port } from "./miri_program.ts";

const stem = (file: string): string => file.replace(/\.rs$/, "");

function miri_fixture_flags(file: string): string[] {
  const m = /^\/\/ miri-flags:(.*)$/m.exec(readFileSync(file, "utf8").split("\n", 1)[0]!);
  return m === null ? [] : m[1]!.split(/\s+/).filter((f) => f !== "");
}

/** What the oracle gave for `file` when the fixture was made. */
export function miri_fixture_expected(file: string): MiriRun {
  return {
    status: Number(readFileSync(`${stem(file)}.exit`, "utf8").trim()),
    stdout: readFileSync(`${stem(file)}.stdout`, "utf8"),
    stderr: readFileSync(`${stem(file)}.stderr`, "utf8"),
  };
}

/** The port's result on `file`, to compare with `miri_fixture_expected`. */
export function miri_fixture_port(file: string): MiriRun {
  return run_miri_port(file, miri_fixture_flags(file));
}

if (import.meta.main) {
  for (const file of process.argv.slice(2)) {
    const r = run_miri_oracle(file, miri_fixture_flags(file));
    writeFileSync(`${stem(file)}.stdout`, r.stdout);
    writeFileSync(`${stem(file)}.stderr`, r.stderr);
    writeFileSync(`${stem(file)}.exit`, `${r.status}\n`);
    console.log(`${file}: exit ${r.status}, ${r.stdout.length} bytes of stdout, ${r.stderr.length} of stderr`);
  }
}
