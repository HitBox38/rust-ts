// Regenerates oracle.json from the pinned rustc. Run by hand only: `bun src/rustc_codegen_ssa/back/link_oracle/regen.ts`.
// No test runs it; link.test.ts reads the committed oracle.json.
//
// - `native_static_libs[tuple]`: the text after `note: native-static-libs: ` for nsl.rs built as a staticlib.
// - `link_args[]`: for bin.rs with the case's flags, from the first line of `--print link-args` (the `Command`'s Debug,
//   printed before the linker runs, so a missing linker does not matter): the program (the first quoted token, after the
//   environment prefix), whether any argument starts with `-Wl,` (a cc-wrapped linker, linker.rs `link_args`) and whether
//   `-fuse-ld=lld` is passed (cc driving lld).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../../scripts/lib/common.ts";

const HERE = import.meta.dir;
const OUT = join(DATA, "tmp", "link-oracle-regen");
const TUPLES = ["aarch64-apple-darwin", "x86_64-unknown-linux-gnu"];
const CASES: { id: string; flags: string[] }[] = [
  { id: "default", flags: [] },
  { id: "linker-fake-ld", flags: ["-Clinker=fake-ld.sh"] },
  { id: "linker-mycc", flags: ["-Clinker=mycc"] },
  { id: "linker-rust-lld", flags: ["-Clinker=rust-lld"] },
  { id: "flavor-gcc", flags: ["-Clinker-flavor=gcc"] },
  { id: "flavor-ld", flags: ["-Clinker-flavor=ld"] },
  { id: "features-lld", flags: ["-Zunstable-options", "-Clinker-features=+lld"] },
  { id: "features-no-lld", flags: ["-Zunstable-options", "-Clinker-features=-lld"] },
];

function rustc(args: string[]): string {
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--edition", "2024", ...args], {
    cwd: HERE,
    env: { ...process.env, RUSTC_ICE: "0", RUSTUP_AUTO_INSTALL: "0" },
  });
  return r.stdout.toString() + r.stderr.toString();
}

mkdirSync(OUT, { recursive: true });
const native_static_libs: Record<string, string> = {};
for (const tuple of TUPLES) {
  const out = rustc(["--crate-type", "staticlib", "--target", tuple, "--print", "native-static-libs", "--out-dir", join(OUT, tuple), "nsl.rs"]);
  const line = out.split("\n").find((l) => l.startsWith("note: native-static-libs: "));
  if (line === undefined) throw new Error(`no native-static-libs line for ${tuple}:\n${out}`);
  native_static_libs[tuple] = line.slice("note: native-static-libs: ".length);
}
const link_args: { tuple: string; id: string; flags: string[]; program: string; wl: boolean; fuse_lld: boolean }[] = [];
for (const tuple of TUPLES) {
  for (const { id, flags } of CASES) {
    const out = rustc(["--crate-type", "bin", "--target", tuple, "-Cpanic=abort", "--print", "link-args", "--out-dir", join(OUT, `${tuple}-${id}`), ...flags, "bin.rs"]);
    const first = out.split("\n")[0]!;
    const tokens = first.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
    const program = tokens.find((t) => t.startsWith('"'));
    if (program === undefined) throw new Error(`no link args for ${tuple} ${id}:\n${out}`);
    link_args.push({
      tuple,
      id,
      flags,
      program: JSON.parse(program) as string,
      wl: tokens.some((t) => t.startsWith('"-Wl,')),
      fuse_lld: tokens.some((t) => t === '"-fuse-ld=lld"'),
    });
  }
}
writeFileSync(join(HERE, "oracle.json"), JSON.stringify({ toolchain: PIN.toolchain, commit: PIN.commit, native_static_libs, link_args }, null, 2) + "\n");
