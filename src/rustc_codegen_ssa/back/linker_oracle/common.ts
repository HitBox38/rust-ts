// Shared by ../linker_args.oracle.test.ts and ./regen.ts (lane ssa-linker; not a port): the cases whose linker command lines
// are compared with the oracle's `--print link-args`, and how both sides are normalised.
//
// Every oracle run links with `-C linker=<work>/fake/cc`: a script that copies the exported-symbols file (`-exported_symbols_list`
// on Apple targets, `--version-script=` on ELF ones) to `<work>/list-<case>` and exits 0. It is named `cc` so that
// `LinkerFlavor::with_linker_hints` keeps the target's own flavor, and it links nothing, so no case needs a Linux sysroot.
//
// Normalisation (applied to the oracle's line and to the port's, the same way):
// - the work directory becomes `$WORK` and the oracle's sysroot `$SYSROOT` (both machine paths, not random);
// - the link's temporary directory, `rustc` + 6 random characters (`TempDirBuilder::prefix("rustc")`), becomes `$TMP`; it is the only
//   random part;
// - in `PATH="..."` the entries after the sysroot's own tool directories (what the environment of the run passed in) become
//   `$INHERITED`.
import { join } from "node:path";
import type { CrateType } from "../../../rustc_structures/crate_type.ts";
import type { LinkOutputKind } from "../../../rustc_target/spec/mod.ts";

export const HERE = import.meta.dir;

export interface LinkCase {
  name: string;
  src: "hello.rs" | "lib.rs" | "nostd.rs" | "dedup.rs" | "rawdylib.rs";
  target: "aarch64-apple-darwin" | "x86_64-unknown-linux-gnu";
  crate_type: CrateType;
  flags: string[];
  /** What link.rs:2264 `link_output_kind` gives for the case (link.rs is lane ssa-link-b's); the args it leads to are compared. */
  output_kind: LinkOutputKind;
}

export const CASES: readonly LinkCase[] = [
  { name: "host-bin", src: "hello.rs", target: "aarch64-apple-darwin", crate_type: "Executable", flags: [], output_kind: "DynamicNoPicExe" },
  { name: "host-bin-strip", src: "hello.rs", target: "aarch64-apple-darwin", crate_type: "Executable", flags: ["-Cstrip=symbols"], output_kind: "DynamicNoPicExe" },
  { name: "host-bin-dead", src: "hello.rs", target: "aarch64-apple-darwin", crate_type: "Executable", flags: ["-Clink-dead-code"], output_kind: "DynamicNoPicExe" },
  { name: "host-dylib", src: "lib.rs", target: "aarch64-apple-darwin", crate_type: "Dylib", flags: ["-Cprefer-dynamic"], output_kind: "DynamicDylib" },
  { name: "host-cdylib", src: "lib.rs", target: "aarch64-apple-darwin", crate_type: "Cdylib", flags: [], output_kind: "DynamicDylib" },
  { name: "host-staticlib", src: "lib.rs", target: "aarch64-apple-darwin", crate_type: "StaticLib", flags: [], output_kind: "DynamicDylib" },
  { name: "linux-bin", src: "hello.rs", target: "x86_64-unknown-linux-gnu", crate_type: "Executable", flags: [], output_kind: "DynamicPicExe" },
  { name: "linux-bin-static-reloc", src: "hello.rs", target: "x86_64-unknown-linux-gnu", crate_type: "Executable", flags: ["-Crelocation-model=static"], output_kind: "DynamicNoPicExe" },
  { name: "linux-bin-strip", src: "hello.rs", target: "x86_64-unknown-linux-gnu", crate_type: "Executable", flags: ["-Cstrip=symbols"], output_kind: "DynamicPicExe" },
  { name: "linux-cdylib", src: "lib.rs", target: "x86_64-unknown-linux-gnu", crate_type: "Cdylib", flags: [], output_kind: "DynamicDylib" },
  { name: "linux-dylib", src: "lib.rs", target: "x86_64-unknown-linux-gnu", crate_type: "Dylib", flags: ["-Cprefer-dynamic"], output_kind: "DynamicDylib" },
];

/**
 * Cases added by lane ssa-link-b (review ssa-link-b N1, F1) for ../link_with_args.oracle.test.ts, which builds the line with the
 * port's own `linker_with_args`. They are kept out of `CASES` so ../linker_args.oracle.test.ts (whose driver stands in for
 * `linker_with_args`) is unchanged; regen.ts writes both.
 * - host-dylib-static: a dylib without `-Cprefer-dynamic` links std statically, so the line has both `rmeta.o` and the
 *   allocator module's object (their order: link.rs:2975, :2984).
 * - linux-nostd-cdylib: no dynamic upstream native library, so the GNU hint state ends on `-Bstatic` and
 *   `reset_per_library_state` (link.rs:3120) shows as a `-Bdynamic`.
 * - linux-dedup: two consecutive `#[link(name = "m")]` blocks, of which the line keeps one (link.rs:3410).
 * - linux-raw-dylib: a raw-dylib library on ELF, linked by the stub's hashed file name (raw_dylib.rs:179-184).
 */
export const EXTRA_CASES: readonly LinkCase[] = [
  { name: "host-dylib-static", src: "lib.rs", target: "aarch64-apple-darwin", crate_type: "Dylib", flags: [], output_kind: "DynamicDylib" },
  { name: "linux-nostd-cdylib", src: "nostd.rs", target: "x86_64-unknown-linux-gnu", crate_type: "Cdylib", flags: ["-Cpanic=abort"], output_kind: "DynamicDylib" },
  { name: "linux-dedup", src: "dedup.rs", target: "x86_64-unknown-linux-gnu", crate_type: "Executable", flags: [], output_kind: "DynamicPicExe" },
  { name: "linux-raw-dylib", src: "rawdylib.rs", target: "x86_64-unknown-linux-gnu", crate_type: "Executable", flags: [], output_kind: "DynamicPicExe" },
];

export const CRATE_TYPE_FLAG: { readonly [K in CrateType]?: string } = { Executable: "bin", Dylib: "dylib", Cdylib: "cdylib", StaticLib: "staticlib" };

/** The rustc arguments of a case (without the program), for the oracle and for the port's session alike. */
export function case_args(c: LinkCase, work: string, sysroot: string): string[] {
  return [
    "--crate-type",
    CRATE_TYPE_FLAG[c.crate_type]!,
    "--target",
    c.target,
    "--sysroot",
    sysroot,
    "--out-dir",
    join(work, "out", c.name),
    "-C",
    `linker=${join(work, "fake", "cc")}`,
    ...c.flags,
    join(HERE, c.src),
  ];
}

/** The fake linker (see the header): the exported-symbols file goes to `$CAPTURE`. */
export function fake_cc(capture: string): string {
  return `#!/bin/sh
prev=""
for a in "$@"; do
  case "$prev" in -Wl,-exported_symbols_list) cp "\${a#-Wl,}" '${capture}';; esac
  case "$a" in -Wl,--version-script=*) cp "\${a#-Wl,--version-script=}" '${capture}';; esac
  prev="$a"
done
exit 0
`;
}

/** See the header. */
export function normalise(line: string, work: string, sysroot: string): string {
  let s = line.replaceAll(sysroot, "$SYSROOT").replaceAll(work, "$WORK");
  s = s.replace(/\/rustc[A-Za-z0-9]{6}(?=[/"])/g, "/$TMP");
  s = s.replace(/PATH="([^"]*)"/, (_m, v: string) => {
    const parts = v.split(":");
    let i = 0;
    while (i < parts.length && parts[i]!.startsWith("$SYSROOT/")) i++;
    return `PATH="${[...parts.slice(0, i), "$INHERITED"].join(":")}"`;
  });
  return s;
}

/** Splits a `{:?}` line of `std::process::Command` into its parts: `env -u` names, `K="v"` pairs, the program and the arguments.
 *  Only what the fixtures hold: no `env -i`, no `[program]` prefix, values without escapes other than the ones undone here. */
export interface ParsedCommand {
  removed: string[];
  env: [string, string][];
  program: string;
  args: string[];
}

function unquote(q: string): string {
  return q.slice(1, -1).replace(/\\(.)/g, "$1");
}

export function parse_command(line: string): ParsedCommand {
  const tokens = [...line.matchAll(/[A-Z_][A-Z0-9_]*="(?:[^"\\]|\\.)*"|"(?:[^"\\]|\\.)*"|\S+/g)].map((m) => m[0]);
  const removed: string[] = [];
  const env: [string, string][] = [];
  let i = 0;
  if (tokens[i] === "env") {
    i++;
    while (tokens[i] === "-u") {
      removed.push(tokens[i + 1]!);
      i += 2;
    }
  }
  while (i < tokens.length && !tokens[i]!.startsWith('"')) {
    const t = tokens[i]!;
    const eq = t.indexOf("=");
    env.push([t.slice(0, eq), unquote(t.slice(eq + 1))]);
    i++;
  }
  const program = unquote(tokens[i]!);
  const args = tokens.slice(i + 1).map(unquote);
  return { removed, env, program, args };
}
