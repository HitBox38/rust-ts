// Oracle test for back/metadata.ts (the `DefaultMetadataLoader`) and the vendored object reader.
//
// Two probes are the oracle:
//   - objread (rustc-dev): the oracle compiler's own `DefaultMetadataLoader`: per file, what
//     `get_rlib_metadata` / `get_dylib_metadata` return (length, first 64 bytes, FNV-1a of all
//     bytes) or their error message;
//   - objlist (object 0.39.1 with rustc_codegen_ssa's features): per file, the archive kind and
//     members (name, offset, size), and for `lib.rmeta` members / non-archives the object format,
//     the `.rmeta` / `.rustc` section's file range and data length.
// The port prints the same lines from src/vendor/object and DefaultMetadataLoader.
//
// Files: every file of the oracle sysroot's x86_64-unknown-linux-gnu `lib` dir (rlibs, rmeta, the
// std .so, the sanitizer runtime archives); the host's rlibs when the host is linux or apple (ELF /
// Mach-O); `#![no_core]` rlibs built by the oracle for wasm32, x86_64-apple-darwin, i686,
// armv7, aarch64, powerpc, powerpc64 and s390x linux (Wasm, Mach-O, ELF 32/64 LE/BE); and a few
// broken inputs (empty, garbage, truncated). Generated files live in $RUST_TS_DATA/cache/objread.
//
// Without the probes (or the oracle toolchain) the oracle tests are a visible skip;
// RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { spec } from "../../rustc_target/lib.ts";
import { debug_str } from "../../std/fmt.ts";
import { ArchiveFile } from "../../vendor/object/read/archive.ts";
import { File } from "../../vendor/object/read/any.ts";
import { display_Error } from "../../vendor/object/read/mod.ts";
import { Object_provided } from "../../vendor/object/read/traits.ts";
import { DefaultMetadataLoader, search_for_section } from "./metadata.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const OBJREAD = join(DATA, "target", "probes", "release", "objread");
const OBJLIST = join(DATA, "target", "probes", "release", "objlist");
const HAVE_PROBES = existsSync(OBJREAD) && existsSync(OBJLIST);
const SKIP = !HAVE_PROBES && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: objread/objlist probes not built (bun scripts/probes.ts build objread objlist); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const FIXTURE_TARGETS = [
  "wasm32-unknown-unknown",
  "x86_64-apple-darwin",
  "i686-unknown-linux-gnu",
  "armv7-unknown-linux-gnueabihf",
  "aarch64-unknown-linux-gnu",
  "powerpc-unknown-linux-gnu",
  "powerpc64-unknown-linux-gnu",
  "s390x-unknown-linux-gnu",
];

const NO_CORE_SRC = `#![feature(no_core, lang_items)]
#![allow(internal_features)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
pub fn f() {}
pub fn g() -> i32 { 0 }
`;

interface Setup {
  sysroot: string;
  files: string[];
}

let setup_: Setup | undefined;
/** The oracle sysroot and the input files (building the fixtures on first use). */
function setup(): Setup {
  if (setup_ !== undefined) return setup_;
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  const sysroot = oracle.oracleSysroot();
  const host = oracle.oracleHost();
  const files: string[] = [];
  const linux = join(sysroot, "lib", "rustlib", "x86_64-unknown-linux-gnu", "lib");
  for (const n of readdirSync(linux).sort()) if (statSync(join(linux, n)).isFile()) files.push(join(linux, n));
  if (host.includes("-linux-") || host.includes("-apple-")) {
    const h = join(sysroot, "lib", "rustlib", host, "lib");
    for (const n of readdirSync(h).sort()) if (n.endsWith(".rlib")) files.push(join(h, n));
  }
  const cache = join(DATA, "cache", "objread");
  mkdirSync(cache, { recursive: true });
  const src = join(cache, "nc.rs");
  writeFileSync(src, NO_CORE_SRC);
  for (const t of FIXTURE_TARGETS) {
    const out = join(cache, `nc-${t}.rlib`);
    if (!existsSync(out)) {
      const r = Bun.spawnSync(oracle.oracleRustcCmd(["--target", t, "--crate-type", "rlib", "-o", out, src]));
      if (r.exitCode !== 0) throw new globalThis.Error(`oracle rustc --target ${t} failed:\n${r.stderr.toString()}`);
    }
    files.push(out);
  }
  const rmeta = join(cache, "nc-meta.rmeta");
  if (!existsSync(rmeta)) {
    const r = Bun.spawnSync(oracle.oracleRustcCmd(["--target", "x86_64-unknown-linux-gnu", "--crate-type", "rlib", "--emit=metadata", "-o", rmeta, src]));
    if (r.exitCode !== 0) throw new globalThis.Error(`oracle rustc --emit=metadata failed:\n${r.stderr.toString()}`);
  }
  files.push(rmeta);
  const rlib0 = readFileSync(join(cache, "nc-aarch64-unknown-linux-gnu.rlib"));
  const broken: [string, Uint8Array][] = [
    ["empty.bin", new Uint8Array(0)],
    ["garbage.bin", new Uint8Array(Array.from({ length: 100 }, (_, i) => (i * 37 + 11) & 0xff))],
    ["truncated-header.rlib", rlib0.subarray(0, 100)],
    // Cut inside the lib.rmeta member's ELF section headers.
    ["truncated-member.rlib", rlib0.subarray(0, 900)],
    ["thin.rlib", new TextEncoder().encode("!<thin>\n//                                              10        `\nlib.rmeta/\n/0              0           0     0     644     4         `\n")],
  ];
  for (const [n, bytes] of broken) {
    writeFileSync(join(cache, n), bytes);
    files.push(join(cache, n));
  }
  files.push(join(cache, "does-not-exist.rlib"));
  return (setup_ = { sysroot, files });
}

function probe(bin: string, args: string[]): string {
  const r = Bun.spawnSync([bin, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new globalThis.Error(`${bin} failed: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** 64-bit FNV-1a in four 16-bit limbs (`h ^= b; h *= 0x100000001b3` mod 2^64). */
function fnv1a64(bytes: Uint8Array): string {
  let h0 = 0x2325,
    h1 = 0x8422,
    h2 = 0x9ce4,
    h3 = 0xcbf2;
  for (let i = 0; i < bytes.length; i++) {
    h0 ^= bytes[i]!;
    // prime = 0x0000_0100_0000_01b3: limbs (0x01b3, 0, 0x0100, 0)
    const r0 = h0 * 0x1b3;
    const r1 = h1 * 0x1b3 + (r0 >>> 16);
    const r2 = h2 * 0x1b3 + h0 * 0x100 + Math.floor(r1 / 0x10000);
    const r3 = h3 * 0x1b3 + h1 * 0x100 + Math.floor(r2 / 0x10000);
    h0 = r0 & 0xffff;
    h1 = r1 & 0xffff;
    h2 = r2 % 0x10000;
    h3 = r3 % 0x10000;
  }
  return [h3, h2, h1, h0].map((x) => x.toString(16).padStart(4, "0")).join("");
}

function target(sysroot: string): spec.Target {
  const r = spec.Target.search(spec.TargetTuple.from_tuple("x86_64-unknown-linux-gnu"), sysroot, false);
  if (r.$ === "Err") throw new globalThis.Error(r._0);
  return r._0[0];
}

/** The port's version of the objread probe output. */
function port_objread(sysroot: string, files: readonly string[]): string {
  const t = target(sysroot);
  let out = "";
  for (const p of files) {
    out += `file ${p}\n`;
    for (const [kind, r] of [
      ["rlib", DefaultMetadataLoader.get_rlib_metadata(t, p)],
      ["dylib", DefaultMetadataLoader.get_dylib_metadata(t, p)],
    ] as const) {
      if (r.$ === "Ok") out += `  ${kind} ok len=${r._0.length} head=${hex(r._0.subarray(0, 64))} fnv=${fnv1a64(r._0)}\n`;
      else out += `  ${kind} err ${r._0}\n`;
    }
  }
  return out;
}

/** The port's version of the objlist probe output. */
function port_objlist(files: readonly string[]): string {
  let out = "";
  const object = (label: string, bytes: Uint8Array, section: string): void => {
    const file = File.parse(bytes);
    if (file.$ === "Err") {
      out += `  object ${label} err ${display_Error(file._0)}\n`;
      return;
    }
    out += `  object ${label} ${file._0.format()}\n`;
    const s = Object_provided.section_by_name(file._0, section);
    if (s === undefined) {
      out += `  section ${section} none\n`;
      return;
    }
    const range = s.file_range();
    out += range !== undefined ? `  section ${section} ${range[0]} ${range[1]}\n` : `  section ${section} nodata\n`;
    const d = s.data();
    out += d.$ === "Ok" ? `  data ok len=${d._0.length}\n` : `  data err ${display_Error(d._0)}\n`;
  };
  for (const p of files) {
    if (!existsSync(p)) continue;
    out += `file ${p}\n`;
    const data = new Uint8Array(readFileSync(p));
    const archive = ArchiveFile.parse(data);
    if (archive.$ === "Err") {
      out += `  archive err ${display_Error(archive._0)}\n`;
      object("-", data, ".rustc");
      continue;
    }
    out += `  archive ${archive._0.kind()} thin=${archive._0.is_thin()}\n`;
    for (const m of archive._0.members()) {
      if (m.$ === "Err") {
        out += `  member err ${display_Error(m._0)}\n`;
        break;
      }
      const name = new TextDecoder().decode(m._0.name()); // lossy UTF-8, as `from_utf8_lossy`
      const [o, n] = m._0.file_range();
      out += `  member ${debug_str(name)} ${o} ${n}\n`;
      if (name === "lib.rmeta") {
        const d = m._0.data(data);
        if (d.$ === "Err") out += `  member-data err ${display_Error(d._0)}\n`;
        else object(debug_str(name), d._0, ".rmeta");
      }
    }
  }
  return out;
}

function first_difference(want: string, got: string): string | undefined {
  const a = want.split("\n");
  const b = got.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `line ${i + 1}:\n  oracle ${(a[i] ?? "<eof>").slice(0, 300)}\n  port   ${(b[i] ?? "<eof>").slice(0, 300)}`;
  }
  return undefined;
}

test.skipIf(SKIP)("objlist: archive members, object formats and metadata sections match object 0.39.1", () => {
  const { files } = setup();
  const present = files.filter((p) => existsSync(p));
  const want = probe(OBJLIST, present);
  expect(want.length).toBeGreaterThan(0);
  expect(first_difference(want, port_objlist(present))).toBeUndefined();
}, 300_000);

test.skipIf(SKIP)("objread: DefaultMetadataLoader results match the oracle's", () => {
  const { sysroot, files } = setup();
  const want = probe(OBJREAD, ["x86_64-unknown-linux-gnu", sysroot, ...files]);
  expect(first_difference(want, port_objread(sysroot, files))).toBeUndefined();
}, 300_000);

test.skipIf(SKIP)("get_rlib_metadata returns a view into the mapped file at the member's section", () => {
  const { sysroot, files } = setup();
  const t = target(sysroot);
  let checked = 0;
  for (const p of files) {
    if (!p.endsWith(".rlib") || !existsSync(p)) continue;
    const data = new Uint8Array(readFileSync(p));
    const archive = ArchiveFile.parse(data);
    if (archive.$ === "Err") continue;
    for (const m of archive._0.members()) {
      if (m.$ === "Err" || new TextDecoder().decode(m._0.name()) !== "lib.rmeta") continue;
      const member = m._0.data(data);
      if (member.$ === "Err") break;
      const file = File.parse(member._0);
      if (file.$ === "Err" || file._0.format() === "Wasm") break;
      const range = Object_provided.section_by_name(file._0, ".rmeta")?.file_range();
      if (range === undefined) break;
      const blob = DefaultMetadataLoader.get_rlib_metadata(t, p);
      expect(blob.$).toBe("Ok");
      if (blob.$ === "Ok") {
        expect(blob._0.byteOffset).toBe(m._0.file_range()[0] + range[0]);
        expect(blob._0.length).toBe(range[1]);
      }
      checked++;
      break;
    }
  }
  expect(checked).toBeGreaterThan(10);
}, 300_000);

test("search_for_section: bytes that are not an object file are the metadata themselves", () => {
  const raw = new TextEncoder().encode("rust\0\0\0\x0bnot an object file at all");
  const r = search_for_section("x.rmeta", raw, ".rmeta");
  expect(r.$).toBe("Ok");
  if (r.$ === "Ok") expect(r._0).toBe(raw);
});
