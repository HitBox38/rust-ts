// The port's object writer (src/vendor/object/write) against the oracle's own (lane harness-w40s; review
// vendor-object-write N2). tools/probes/objwrite/objwrite.oracle.txt is what the objwrite probe (the oracle toolchain's
// `object` 0.39.1, through librustc_driver) prints for tools/probes/objwrite/cases.txt; tools/probes/fixtures.test.ts
// checks that file against the probe, so it can be neither stale nor edited by hand. Here the port runs the same script
// (tools/probes/objwrite/twin.ts) and must print the same text: every logged step result and error message, and every
// object byte for byte. This test needs no probe, so it always runs.
//
// It covers what rustc's own objects on the host do not reach (link_objects.test.ts): ELF REL/RELA on eight architectures
// (mips64el's `r_info` byte swap, big-endian targets), comdat groups, Mach-O TLS (`__thread_vars`), x86_64 Mach-O,
// subtractors and explicit addends (`ARM64_RELOC_ADDEND`). The review's surviving mutations each change this output:
// ELF `r_info` with `r_sym`/`r_type` swapped, a TLV entry of 2 pointers, a comdat header's `sh_info` 0, and an implicit
// `BRANCH26` addend.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilerCrateFile, probeMeta, rustcDevManifestViolations } from "../../../scripts/probes.ts";
import { objwrite } from "./twin.ts";

const DIR = import.meta.dir;
const CASES = readFileSync(join(DIR, "cases.txt"), "utf8");
const ORACLE = readFileSync(join(DIR, "objwrite.oracle.txt"), "utf8");

/** The first line where `got` and `want` differ, with the `out` section it is in, or undefined if they are equal. */
function firstDifference(got: string, want: string): string | undefined {
  if (got === want) return undefined;
  const g = got.split("\n");
  const w = want.split("\n");
  let section = "(before the first out)";
  for (let i = 0; i < Math.max(g.length, w.length); i++) {
    if (w[i]?.startsWith("out ")) section = w[i]!;
    if (g[i] !== w[i]) return `line ${i + 1}, in ${section}: oracle ${JSON.stringify(w[i] ?? "<end>")}, port ${JSON.stringify(g[i] ?? "<end>")}`;
  }
  return "same lines, different text";
}

test("the port's object writer prints the objwrite probe's output (objwrite.oracle.txt) for cases.txt", () => {
  expect(firstDifference(objwrite(CASES), ORACLE)).toBeUndefined();
});

test("objwrite.oracle.txt has every case of cases.txt: 13 objects and 2 write errors", () => {
  const outs = ORACLE.split("\n").filter((l) => l.startsWith("out ")).map((l) => l.slice(4));
  expect(outs).toEqual(CASES.split("\n").filter((l) => l.startsWith("out ")).map((l) => l.slice(4).trim()));
  expect(outs).toEqual([
    "x86_64-macho.o",
    "aarch64-macho.o",
    "x86_64-elf.o",
    "i386-elf.o",
    "mips64el-elf.o",
    "mips64be-elf.o",
    "mips-elf.o",
    "arm-elf.o",
    "ppc64-elf.o",
    "aarch64-elf.o",
    "riscv64-elf.o",
    "unknown-sym-elf.o",
    "comdat-nodup-elf.o",
    "ppc-macho.o",
    "i386-macho.o",
  ]);
  expect(ORACLE.split("\n").filter((l) => l.startsWith("object ")).length).toBe(13);
  expect(ORACLE.split("\n").filter((l) => l.startsWith("write Err(")).length).toBe(2);
});

test("firstDifference names the line and its out section", () => {
  expect(firstDifference("out a\nx\n", "out a\nx\n")).toBeUndefined();
  expect(firstDifference("out a\nx\nout b\ny\n", "out a\nx\nout b\nz\n")).toBe('line 4, in out b: oracle "z", port "y"');
  expect(firstDifference("out a\n", "out a\nx\n")).toBe('line 2, in out a: oracle "x", port ""');
});

test("the probe links the compiler's own object crate: a rustc-dev probe with sysroot_extern = [\"object\"]", () => {
  const meta = probeMeta("objwrite");
  expect(meta.rustcDev).toBe(true);
  expect(meta.sysrootExtern).toEqual(["object"]);
  expect(meta.env).toEqual({});
  expect(rustcDevManifestViolations({ package: { metadata: { "rust-ts": { rustc_dev: true, sysroot_extern: ["object"] } } } })).toEqual([]);
});

test("compilerCrateFile picks the one metadata-only copy, and says what it found otherwise", () => {
  // The pinned sysroot's two object 0.39.1 copies: std's (rlib + rmeta, no `write`) and the compiler's (rmeta only).
  const sysroot = ["libobject-0a888d7f84bd0c24.rmeta", "libobject-19b4bca1dbcf3607.rlib", "libobject-19b4bca1dbcf3607.rmeta", "libobject_x-11.rmeta", "libmemchr-22.rlib"];
  expect(compilerCrateFile("object", sysroot)).toEqual({ file: "libobject-0a888d7f84bd0c24.rmeta" });
  expect(compilerCrateFile("object", sysroot.slice(1))).toEqual({
    error: "no metadata-only libobject-*.rmeta in the sysroot (found: libobject-19b4bca1dbcf3607.{rlib,rmeta})",
  });
  expect(compilerCrateFile("object", [...sysroot, "libobject-33.rmeta"])).toEqual({
    error: "more than one metadata-only libobject-*.rmeta in the sysroot (found: libobject-0a888d7f84bd0c24.{rmeta}, libobject-19b4bca1dbcf3607.{rlib,rmeta}, libobject-33.{rmeta})",
  });
  expect(compilerCrateFile("nope", sysroot)).toEqual({ error: "no metadata-only libnope-*.rmeta in the sysroot (found: none)" });
});
