// The archive layouts of ar_archive_writer's `write_archive_to_stream`, by hand from the format; the GNU layout with no symbols is
// also checked against an oracle rlib in src/rustc_codegen_ssa/back/rlib_stub.oracle.test.ts.
import { expect, test } from "bun:test";
import { ArchiveFile } from "../object/read/archive.ts";
import { type ArchiveKind, ArchiveWriter, DEFAULT_OBJECT_READER, NewArchiveMember, write_archive_to_stream } from "./lib.ts";

const b = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (u: Uint8Array): string => new TextDecoder("latin1").decode(u);

function archive(kind: ArchiveKind, members: [string, string][]): Uint8Array {
  const w = new ArchiveWriter();
  const r = write_archive_to_stream(w, members.map(([n, d]) => NewArchiveMember.new(b(d), DEFAULT_OBJECT_READER, n)), kind, false, false);
  expect(r.$).toBe("Ok");
  return w.bytes();
}

test("gnu: empty symbol table, short name, odd member padded", () => {
  const got = text(archive("Gnu", [["a", "xyz"]]));
  const sym = `/               0           0     0     0       8         \`\n\0\0\0\0\0\0\0\0`;
  const mem = `a/              0           0     0     644     3         \`\nxyz\n`;
  expect(got).toBe(`!<arch>\n${sym}${mem}`);
});

test("gnu: a long name goes to the string table, and a repeat reuses it", () => {
  const long = "a-name-of-sixteen-or-more";
  const got = text(archive("Gnu", [[long, "ab"], [long, "cd"]]));
  // `<name>/\n` is 27 bytes: padded to even, with a newline.
  expect(got).toContain(`//                                              ${"28".padEnd(10)}\`\n${long}/\n\n`);
  expect(got.match(/\/0              0           0     0     644     2         `\n/g)?.length).toBe(2);
});

test("no members: gnu has no symbol table, darwin does", () => {
  expect(text(archive("Gnu", []))).toBe("!<arch>\n");
  expect(text(archive("Darwin", []))).toContain("__.SYMDEF");
});

test("bsd, darwin: the name follows the header, and the result reads back", () => {
  for (const kind of ["Bsd", "Darwin"] as const) {
    const bytes = archive(kind, [["member.o", "data!"]]);
    const a = ArchiveFile.parse(bytes);
    if (a.$ !== "Ok") throw new Error("not an archive");
    const ms = [...a._0.members()].map((m) => {
      if (m.$ !== "Ok") throw new Error("member");
      const d = m._0.data(bytes);
      if (d.$ !== "Ok") throw new Error("data");
      return [text(m._0.name()), text(d._0)];
    });
    expect(ms).toEqual([["member.o", kind === "Darwin" ? "data!\n\n\n" : "data!"]]);
  }
});

test("darwin: duplicate names get increasing timestamps", () => {
  const got = text(archive("Darwin", [["m.o", "12345678"], ["m.o", "12345678"]]));
  expect(got).toMatch(/#1\/\d+ +1 {11}0 {5}0 {5}644 /);
  expect(got).toMatch(/#1\/\d+ +2 {11}0 {5}0 {5}644 /);
});
