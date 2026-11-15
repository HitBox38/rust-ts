// rust-ts: tests of SymbolWrapper.cpp's port (symbol_wrapper.ts) over the model's Object library (object_file.ts) (lane
// llir-callbr-mangler, root's addition for pm-self F2).
//
// The oracle is already on disk: every rlib in the pinned toolchain's sysroot was written by the pinned rustc, whose archive
// writer took each member's symbols from LLVM's `LLVMRustGetSymbols`, in member order. So each rlib's symbol table (`__.SYMDEF`
// on aarch64-apple-darwin, `/` on x86_64-unknown-linux-gnu) lists, per member, exactly what the port must answer for that
// member's bytes, in the same order. The test reads every rlib of both targets' sysroots (over 900 Mach-O and ELF objects:
// std, core, alloc, compiler_builtins, ...), runs the port on each member, and compares. Members that are not objects
// (`lib.rmeta`) must give no symbols. One rlib is left out: tikv-jemalloc-sys on aarch64-apple-darwin bundles jemalloc's objects
// as LLVM bitcode (clang's `-flto`), and bitcode needs `IRObjectFile`, which the model does not have (it stops, tested below).
//
// Then the archives the port builds itself: symbol_oracle/symlib.rs as an rlib (`-Cembed-bitcode=no`, as cargo passes without LTO;
// rustc's default embeds bitcode, which stops earlier, at the model's ThinLTO buffer) and as a staticlib (std's objects too), on
// aarch64-apple-darwin and x86_64-unknown-linux-gnu, by the port and by the pinned rustc: the symbol table members must be equal
// byte for byte (names, order and member offsets).
//
// Without the toolchain this is skipped, unless RUST_TS_REQUIRE_PROBES=1.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import { Unported } from "../../std/panic.ts";
import * as L from "./ffi.ts";
import { identify_magic } from "./object_file.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SYSROOT = (() => {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
    return r.exitCode === 0 ? r.stdout.toString().trim() : "";
  } catch {
    return "";
  }
})();
const TARGETS = ["aarch64-apple-darwin", "x86_64-unknown-linux-gnu"] as const;
const libDir = (t: string): string => join(SYSROOT, "lib", "rustlib", t, "lib");
const HAVE = SYSROOT !== "" && TARGETS.every((t) => existsSync(libDir(t)));
if (!HAVE && !REQUIRE) console.log("SKIP: the pinned toolchain's sysroot is unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const latin1 = (b: Uint8Array): string => Buffer.from(b).toString("latin1");

/** An archive's members (header offset, name, data) and its symbol table as (member header offset, name) pairs in order. */
function readArchive(buf: Uint8Array): { members: { offset: number; name: string; data: Uint8Array }[]; symtab: [number, string][] } {
  expect(latin1(buf.subarray(0, 8))).toBe("!<arch>\n");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const members: { offset: number; name: string; data: Uint8Array }[] = [];
  let symtab: [number, string][] | undefined;
  let longNames: Uint8Array = new Uint8Array(0);
  for (let off = 8; off < buf.length; ) {
    const hdr = latin1(buf.subarray(off, off + 60));
    const size = Number(hdr.slice(48, 58).trim());
    let name = hdr.slice(0, 16).trimEnd();
    let data = buf.subarray(off + 60, off + 60 + size);
    if (name.startsWith("#1/")) {
      // BSD: the name is the first N bytes of the data.
      const n = Number(name.slice(3));
      name = latin1(data.subarray(0, n)).replace(/\0+$/, "");
      data = data.subarray(n);
    }
    const dataAt = data.byteOffset - buf.byteOffset;
    if (name === "__.SYMDEF") {
      // `ranlib` entries: (string offset, member offset) u32 pairs, then the string table, all little-endian on Darwin.
      const ranlibSize = dv.getUint32(dataAt, true);
      const strAt = dataAt + 4 + ranlibSize + 4;
      symtab = [];
      for (let i = 0; i < ranlibSize / 8; i++) {
        const strx = dv.getUint32(dataAt + 4 + 8 * i, true);
        const memberOff = dv.getUint32(dataAt + 8 + 8 * i, true);
        const s = strAt + strx;
        symtab.push([memberOff, latin1(buf.subarray(s, buf.indexOf(0, s)))]);
      }
    } else if (name === "/") {
      // GNU: a big-endian count, the member offsets, then the NUL-terminated names.
      const count = dv.getUint32(dataAt, false);
      symtab = [];
      let s = dataAt + 4 + 4 * count;
      for (let i = 0; i < count; i++) {
        const e = buf.indexOf(0, s);
        symtab.push([dv.getUint32(dataAt + 4 + 4 * i, false), latin1(buf.subarray(s, e))]);
        s = e + 1;
      }
    } else if (name === "//") {
      longNames = data;
    } else {
      if (/^\/\d+$/.test(name)) {
        const at = Number(name.slice(1));
        name = latin1(longNames.subarray(at, longNames.indexOf(0x0a, at))).replace(/\/$/, "");
      } else name = name.replace(/\/$/, "");
      members.push({ offset: off, name, data });
    }
    off += 60 + size + (size & 1);
  }
  if (symtab === undefined) throw new Error("ERROR: an rlib without a symbol table");
  return { members, symtab };
}

/** The port's answer for one member: the names `LLVMRustGetSymbols` hands its callback, in order. */
function portSymbols(data: Uint8Array): string[] {
  const names: string[] = [];
  const err = L.LLVMRustGetSymbols(data, data.length, names, (state: unknown, name: Uint8Array) => {
    (state as string[]).push(latin1(name));
    return undefined;
  }, () => {
    throw new Error("ERROR: the error callback ran");
  });
  expect(err).toBeUndefined();
  return names;
}

describe.skipIf(!HAVE && !REQUIRE)("LLVMRustGetSymbols against the sysroot rlibs' symbol tables (written by the pinned rustc)", () => {
  for (const t of TARGETS) {
    test(`${t}: every member of every rlib`, () => {
      const rlibs = readdirSync(libDir(t)).filter((f) => f.endsWith(".rlib"));
      expect(rlibs.length).toBeGreaterThan(20);
      let objects = 0;
      let symbols = 0;
      const wrong: string[] = [];
      const withBitcode: string[] = [];
      for (const f of rlibs) {
        const { members, symtab } = readArchive(new Uint8Array(readFileSync(join(libDir(t), f))));
        const bitcode = members.find((m) => identify_magic(m.data) === "bitcode");
        if (bitcode !== undefined) {
          withBitcode.push(f.replace(/-[0-9a-f]{16}\.rlib$/, ""));
          expect(() => portSymbols(bitcode.data)).toThrow(Unported);
          continue;
        }
        const got: [number, string][] = [];
        for (const m of members) {
          const kind = identify_magic(m.data);
          if (kind === "macho_object" || kind === "elf_relocatable") objects++;
          for (const n of portSymbols(m.data)) got.push([m.offset, n]);
        }
        symbols += got.length;
        if (JSON.stringify(got) !== JSON.stringify(symtab)) wrong.push(`${f}: port ${got.length} symbols, symbol table ${symtab.length}`);
      }
      expect(wrong).toEqual([]);
      expect(withBitcode).toEqual(t === "aarch64-apple-darwin" ? ["libtikv_jemalloc_sys"] : []);
      // The sysroot is large enough to mean something: std, core, alloc and compiler_builtins' objects.
      expect(objects).toBeGreaterThan(400);
      expect(symbols).toBeGreaterThan(2500);
    });
  }
});

describe("SymbolWrapper.cpp on what is not a native object", () => {
  test("a file that is not symbolic (rmeta, text) gives no symbols and is neither 64-bit nor EC nor Arm64 COFF", () => {
    for (const b of [new TextEncoder().encode("rust\0\0\0\x09metadata"), new Uint8Array([1, 2]), new Uint8Array(0)]) {
      expect(portSymbols(b)).toEqual([]);
      expect(L.LLVMRustIs64BitSymbolicFile(b, b.length)).toBe(false);
      expect(L.LLVMRustIsECObject(b, b.length)).toBe(false);
      expect(L.LLVMRustIsAnyArm64Coff(b, b.length)).toBe(false);
    }
  });

  test("bitcode and COFF stop (IRObjectFile and the COFF reader are not modelled)", () => {
    for (const magic of [[0x42, 0x43, 0xc0, 0xde], [0xde, 0xc0, 0x17, 0x0b], [0x64, 0x86, 0, 0]]) {
      const b = new Uint8Array([...magic, ...new Array(60).fill(0)]);
      expect(() => portSymbols(b)).toThrow(Unported);
    }
  });

  test("identify_magic", () => {
    const m = (...b: number[]) => identify_magic(new Uint8Array([...b, ...new Array(64).fill(0)]));
    expect(m(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0)).toBe("elf_relocatable");
    expect(m(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0)).toBe("elf_shared_object");
    expect(m(0x7f, 0x45, 0x4c, 0x46, 2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)).toBe("elf_relocatable");
    expect(m(0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0)).toBe("macho_object");
    expect(m(0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0, 0, 1, 0, 0, 0, 0, 6, 0, 0, 0)).toBe("macho_dynamically_linked_shared_lib");
    expect(m(0xfe, 0xed, 0xfa, 0xce, 0, 0, 0, 7, 0, 0, 0, 3, 0, 0, 0, 1)).toBe("macho_object");
    expect(m(0x42, 0x43, 0xc0, 0xde)).toBe("bitcode");
    expect(m(0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a)).toBe("archive");
    expect(m(0x72, 0x75, 0x73, 0x74)).toBe("unknown");
    expect(m(0x64, 0xaa)).toBe("coff_object");
    expect(m(0x4c, 0x01)).toBe("coff_object");
    expect(m(0x90, 0x01)).toBe("unknown");
    expect(m(0x90, 0x02)).toBe("coff_object");
    expect(identify_magic(new Uint8Array([0x7f, 0x45, 0x4c]))).toBe("unknown");
  });
});

// ---- the port's own archives against the oracle's ---------------------------------------------------------------------------

const MAIN = join(import.meta.dir, "..", "main.ts");
const CRATE = join(import.meta.dir, "symbol_oracle", "symlib.rs");
const WORK = join(DATA, "tmp", "llir-symbols-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

/** The archive's first member, its symbol table, header and data (`!<arch>\n` then a 60-byte header). */
function symbolTableMember(buf: Uint8Array): Uint8Array {
  const size = Number(latin1(buf.subarray(8 + 48, 8 + 58)).trim());
  return buf.subarray(8, 8 + 60 + size);
}

interface Built {
  stderr: string;
  code: number | null;
  archive: Uint8Array | undefined;
}

/** One compile of symlib.rs as `kind` for `target` into WORK/`out`. */
async function build(cmd: string[], target: string, kind: "rlib" | "staticlib", out: string): Promise<Built> {
  const dir = join(WORK, out);
  mkdirSync(dir, { recursive: true });
  const extra = kind === "rlib" ? ["-Cembed-bitcode=no"] : [];
  const p = Bun.spawn([...cmd, "--sysroot", SYSROOT, "--crate-type", kind, "--edition", "2024", "--target", target, "-O", ...extra, CRATE, "--out-dir", dir], { env: { ...process.env, RUSTC_ICE: "0" }, stdout: "ignore", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  let archive: Uint8Array | undefined;
  try {
    archive = new Uint8Array(readFileSync(join(dir, kind === "rlib" ? "libsymlib.rlib" : "libsymlib.a")));
  } catch {
    archive = undefined;
  }
  return { stderr, code, archive };
}

const KINDS = ["rlib", "staticlib"] as const;
const BUILT = new Map<string, Built>();

describe.skipIf(!HAVE && !REQUIRE)("the port's archives against the pinned rustc's", () => {
  // The eight compiles run four at a time (unit-test wall time), before the comparisons.
  beforeAll(async () => {
    const jobs: (() => Promise<void>)[] = [];
    for (const t of TARGETS)
      for (const kind of KINDS)
        for (const side of ["port", "oracle"] as const)
          jobs.push(async () => {
            BUILT.set(`${t}-${kind}-${side}`, await build(side === "port" ? [process.execPath, MAIN] : [join(SYSROOT, "bin", "rustc")], t, kind, `${t}-${kind}-${side}`));
          });
    let next = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < jobs.length) await jobs[next++]!();
      }),
    );
  }, 120_000);

  for (const t of TARGETS) {
    for (const kind of KINDS) {
      test(`${kind} for ${t}: the symbol tables are equal`, () => {
        const built = (side: string): Uint8Array => {
          const b = BUILT.get(`${t}-${kind}-${side}`)!;
          expect(b.stderr).toBe("");
          expect(b.code).toBe(0);
          return b.archive!;
        };
        const port = built("port");
        const oracle = built("oracle");
        const want = symbolTableMember(oracle);
        expect(latin1(want.subarray(0, 16))).toMatch(t === "aarch64-apple-darwin" ? /^#1\/12/ : /^\/ /);
        expect(Buffer.from(symbolTableMember(port)).equals(Buffer.from(want))).toBe(true);
        // And the symbols themselves, read back (a readable failure if the bytes differ).
        expect(readArchive(port).symtab).toEqual(readArchive(oracle).symtab);
        expect(readArchive(oracle).symtab.some(([, n]) => n.endsWith("sym_c_fn"))).toBe(true);
      });
    }
  }
});
