// Generates the static libraries of the report suite `rlib-native` (harness/suites.ts; lane harness-w46, docs/handoff/link-rlib-native.md
// "Proposed report suite") into harness/corpus/rlib-native/libs/, from the C files in harness/corpus/rlib-native/c/. The libraries are
// checked in, so the oracle cache key covers them and no case builds anything: they are inputs of both sides, made by the host's
// tools and the oracle toolchain's llvm-ar, never by the port.
//
//   bun harness/corpus/gen-rlib-native.ts
//
// Tools: the host's `clang` (objects for arm64 and x86_64 macOS and x86_64 Linux, -O1, no debug info, so no path is embedded),
// `ar` (BSD archives with a `__.SYMDEF SORTED` symbol table; under ZERO_AR_DATE=1 it stores no time, and uid and gid 0) and
// `lipo`; `llvm-ar` of the oracle toolchain's llvm-tools (GNU, thin, BSD with ELF objects, which the host's `ar` drops, and the
// empty archive). What is made:
// - libs/host (aarch64-apple-darwin): libfoo.a (foo.o, bar.o), libbaz.a (other objects under the same names), liblong.a (a member
//   name over 15 bytes), libfat.a (universal: x86_64 + arm64 libfoo.a), libthin.a (thin, GNU: foo.o and bar.o read from libs/host),
//   libgnu.a (libfoo.a's objects in a GNU archive: a format warning), libempty.a, libbad.a (not an archive);
// - libs/elf (x86_64-unknown-linux-gnu): GNU archives libfoo.a, libbaz.a, liblong.a (the `//` name table), and libbsd.a (a BSD
//   archive: a format warning);
// - libs/x86 (x86_64-apple-darwin): libfoo.a.
// Re-running it gives the same bytes on the root host (checked twice); other tool versions may not, and would change every key.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { llvmBinDir } from "../../scripts/lib/llvm-tools.ts";
import { oracleHost, oracleSysroot } from "../../scripts/lib/oracle.ts";

const ROOT = resolve(import.meta.dir, "rlib-native");
const C = join(ROOT, "c");
const LIBS = join(ROOT, "libs");
const LLVM_AR = join(llvmBinDir(oracleSysroot(), oracleHost()), "llvm-ar");

function sh(cmd: string[], cwd: string, env: Record<string, string> = {}): void {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: exit ${r.exitCode}: ${r.stderr.toString()}`);
}

const TARGETS = { arm64: "arm64-apple-macos11", x86_64: "x86_64-apple-macos10.12", elf: "x86_64-unknown-linux-gnu" } as const;
const tmp = mkdtempSync(join(tmpdir(), "gen-rlib-native-"));
try {
  // Objects: <tmp>/<arch>/{foo,bar,long_member_name_over_16}.o and <tmp>/<arch>/baz/{foo,bar}.o.
  const obj = (arch: keyof typeof TARGETS, src: string, out: string) => {
    mkdirSync(join(tmp, arch, "baz"), { recursive: true });
    sh(["clang", `--target=${TARGETS[arch]}`, "-O1", "-c", join(C, src), "-o", join(tmp, arch, out)], tmp);
  };
  for (const arch of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) {
    obj(arch, "foo.c", "foo.o");
    obj(arch, "bar.c", "bar.o");
    obj(arch, "long_member_name_over_16.c", "long_member_name_over_16.o");
    obj(arch, "baz_foo.c", "baz/foo.o");
    obj(arch, "baz_bar.c", "baz/bar.o");
  }
  rmSync(LIBS, { recursive: true, force: true });
  const host = join(LIBS, "host");
  const elf = join(LIBS, "elf");
  const x86 = join(LIBS, "x86");
  for (const d of [host, elf, x86]) mkdirSync(d, { recursive: true });
  const bsd = (out: string, dir: string, members: string[]) => sh(["ar", "rcs", out, ...members], dir, { ZERO_AR_DATE: "1" });
  const llvm = (out: string, dir: string, flags: string[], members: string[]) => sh([LLVM_AR, "rcs", ...flags, out, ...members], dir);
  const a = (arch: string) => join(tmp, arch);
  bsd(join(host, "libfoo.a"), a("arm64"), ["foo.o", "bar.o"]);
  bsd(join(host, "libbaz.a"), join(a("arm64"), "baz"), ["foo.o", "bar.o"]);
  bsd(join(host, "liblong.a"), a("arm64"), ["foo.o", "long_member_name_over_16.o"]);
  bsd(join(x86, "libfoo.a"), a("x86_64"), ["foo.o", "bar.o"]);
  sh(["lipo", "-create", join(x86, "libfoo.a"), join(host, "libfoo.a"), "-output", join(host, "libfat.a")], tmp);
  // A thin archive names its members by paths relative to itself: they are copied beside it.
  for (const f of ["foo.o", "bar.o"]) copyFileSync(join(a("arm64"), f), join(host, f));
  llvm("libthin.a", host, ["--thin", "--format=gnu"], ["foo.o", "bar.o"]);
  llvm(join(host, "libgnu.a"), a("arm64"), ["--format=gnu"], ["foo.o", "bar.o"]);
  llvm(join(host, "libempty.a"), a("arm64"), ["--format=darwin"], []);
  writeFileSync(join(host, "libbad.a"), "not an archive\n");
  llvm(join(elf, "libfoo.a"), a("elf"), ["--format=gnu"], ["foo.o", "bar.o"]);
  llvm(join(elf, "libbaz.a"), join(a("elf"), "baz"), ["--format=gnu"], ["foo.o", "bar.o"]);
  llvm(join(elf, "liblong.a"), a("elf"), ["--format=gnu"], ["foo.o", "long_member_name_over_16.o"]);
  llvm(join(elf, "libbsd.a"), a("elf"), ["--format=bsd"], ["foo.o", "bar.o"]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`wrote ${LIBS}`);
