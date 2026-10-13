// Port of the `#[cfg(test)] mod tests` of object 0.39.1 `src/read/archive.rs`.
import { expect, test } from "bun:test";
import { ArchiveFile, type ArchiveMember } from "./archive.ts";
import type { Result } from "./mod.ts";

const b = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const str = (u: Uint8Array): string => String.fromCharCode(...u);

function unwrap<T>(r: Result<T>): T {
  if (r.$ === "Err") throw new globalThis.Error(`unwrap on Err: ${r._0._0}`);
  return r._0;
}
function next(it: { next(): Result<ArchiveMember> | undefined }): ArchiveMember {
  const m = it.next();
  if (m === undefined) throw new globalThis.Error("unwrap on None");
  return unwrap(m);
}

// crate: object-0.39.1/src/read/archive.rs:905 kind
test("kind", () => {
  let data = b("!<arch>\n");
  let archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Unknown");

  data = b("!<arch>\n" + "/                                               4         `\n" + "0000");
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Gnu");

  data = b("!<arch>\n" + "//                                              4         `\n" + "0000");
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Gnu");

  data = b(
    "!<arch>\n" +
      "/                                               4         `\n" +
      "0000" +
      "//                                              4         `\n" +
      "0000",
  );
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Gnu");

  data = b("!<arch>\n" + "/SYM64/                                         4         `\n" + "0000");
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Gnu64");

  data = b(
    "!<arch>\n" +
      "/SYM64/                                         4         `\n" +
      "0000" +
      "//                                              4         `\n" +
      "0000",
  );
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Gnu64");

  data = b("!<arch>\n" + "__.SYMDEF                                       4         `\n" + "0000");
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Bsd");

  data = b("!<arch>\n" + "#1/9                                            13        `\n" + "__.SYMDEF0000");
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Bsd");

  data = b("!<arch>\n" + "#1/16                                           20        `\n" + "__.SYMDEF SORTED0000");
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Bsd");

  data = b("!<arch>\n" + "__.SYMDEF_64                                    4         `\n" + "0000");
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Bsd64");

  data = b("!<arch>\n" + "#1/12                                           16        `\n" + "__.SYMDEF_640000");
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Bsd64");

  data = b("!<arch>\n" + "#1/19                                           23        `\n" + "__.SYMDEF_64 SORTED0000");
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Bsd64");

  data = b(
    "!<arch>\n" +
      "/                                               4         `\n" +
      "0000" +
      "/                                               4         `\n" +
      "0000" +
      "//                                              4         `\n" +
      "0000",
  );
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Coff");

  data = b(
    "<bigaf>\n" +
      "0                   0                   " +
      "0                   0                   " +
      "0                   128                 " +
      "6                   0                   " +
      "0                   \0\0\0\0\0\0\0\0\0\0\0\0" +
      "\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0" +
      "\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0" +
      "\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
  );
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("AixBig");

  data = b("!<thin>\n" + "/                                               4         `\n" + "0000");
  archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Gnu");
  expect(archive.is_thin()).toBe(true);
});

// crate: object-0.39.1/src/read/archive.rs:1025 gnu_names
test("gnu_names", () => {
  const data = b(
    "!<arch>\n" +
      "//                                              18        `\n" +
      "0123456789abcdef/\n" +
      "s p a c e/      0           0     0     644     4         `\n" +
      "0000" +
      "0123456789abcde/0           0     0     644     3         `\n" +
      "odd\n" +
      "/0              0           0     0     644     4         `\n" +
      "even",
  );
  const archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Gnu");
  const members = archive.members();

  let member = next(members);
  expect(str(member.name())).toBe("s p a c e");
  expect(str(unwrap(member.data(data)))).toBe("0000");

  member = next(members);
  expect(str(member.name())).toBe("0123456789abcde");
  expect(str(unwrap(member.data(data)))).toBe("odd");

  member = next(members);
  expect(str(member.name())).toBe("0123456789abcdef");
  expect(str(unwrap(member.data(data)))).toBe("even");

  expect(members.next()).toBeUndefined();
});

// crate: object-0.39.1/src/read/archive.rs:1057 thin_gnu_names
test("thin_gnu_names", () => {
  const data = b(
    "!<thin>\n" +
      "//                                              18        `\n" +
      "0123456789/abcde/\n" +
      "s p a c e/      0           0     0     644     4         `\n" +
      "0123456789abcde/0           0     0     644     3         `\n" +
      "/0              0           0     0     644     4         `\n",
  );
  const archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Gnu");
  const members = archive.members();

  let member = next(members);
  expect(str(member.name())).toBe("s p a c e");
  expect(member.is_thin()).toBe(true);
  expect(member.size()).toBe(4);
  expect(unwrap(member.data(data)).length).toBe(0);

  member = next(members);
  expect(str(member.name())).toBe("0123456789abcde");
  expect(member.is_thin()).toBe(true);
  expect(member.size()).toBe(3);
  expect(unwrap(member.data(data)).length).toBe(0);

  member = next(members);
  expect(str(member.name())).toBe("0123456789/abcde");
  expect(member.is_thin()).toBe(true);
  expect(member.size()).toBe(4);
  expect(unwrap(member.data(data)).length).toBe(0);

  expect(members.next()).toBeUndefined();
});

// crate: object-0.39.1/src/read/archive.rs:1093 bsd_names
test("bsd_names", () => {
  const data = b(
    "!<arch>\n" +
      "0123456789abcde 0           0     0     644     3         `\n" +
      "odd\n" +
      "#1/16           0           0     0     644     20        `\n" +
      "0123456789abcdefeven",
  );
  const archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("Unknown");
  const members = archive.members();

  let member = next(members);
  expect(str(member.name())).toBe("0123456789abcde");
  expect(str(unwrap(member.data(data)))).toBe("odd");

  member = next(members);
  expect(str(member.name())).toBe("0123456789abcdef");
  expect(str(unwrap(member.data(data)))).toBe("even");

  expect(members.next()).toBeUndefined();
});

// crate: object-0.39.1/src/read/archive.rs:1117 aix_names
test("aix_names", () => {
  const data = b(
    "<bigaf>\n" +
      "396                 0                   0                   " +
      "128                 262                 0                   " +
      "4                   262                 0                   " +
      "1662610370  223         1           644         16  " +
      "0123456789abcdef`\nord\n" +
      "4                   396                 128                 " +
      "1662610374  223         1           644         16  " +
      "fedcba9876543210`\nrev\n" +
      "94                  0                   262                 " +
      "0           0           0           0           0   " +
      "`\n2                   128                 " +
      "262                 0123456789abcdef\0fedcba9876543210\0",
  );
  const archive = unwrap(ArchiveFile.parse(data));
  expect(archive.kind()).toBe("AixBig");
  const members = archive.members();

  let member = next(members);
  expect(str(member.name())).toBe("0123456789abcdef");
  expect(str(unwrap(member.data(data)))).toBe("ord\n");

  member = next(members);
  expect(str(member.name())).toBe("fedcba9876543210");
  expect(str(unwrap(member.data(data)))).toBe("rev\n");

  expect(members.next()).toBeUndefined();
});
