// The rlib path against an oracle-built file (plan-m6 D4, lane miri-sysroot): FIXTURE is `libcore-*.rlib` of the Miri sysroot
// (`cargo miri setup`, x86_64-unknown-linux-gnu, `-Z embed-metadata=no`: lib.rmeta wraps only the metadata stub), as base64.
// Rebuilding it member by member with the ported `create_wrapper_file`, `RmetaLink` and `write_archive_to_stream` must give the
// same bytes; the whole-crate comparison is the `miri-sysroot-*` report suites.
import { expect, test } from "bun:test";
import type { Session } from "../../rustc_session/session.ts";
import { ArchiveWriter, DEFAULT_OBJECT_READER, NewArchiveMember, write_archive_to_stream } from "../../vendor/ar_archive_writer/lib.ts";
import { ArchiveFile } from "../../vendor/object/read/archive.ts";
import { File } from "../../vendor/object/read/any.ts";
import { create_wrapper_file } from "./metadata.ts";
import { read_from_data, RmetaLink } from "./rmeta_link.ts";

const FIXTURE = Uint8Array.from(Buffer.from("ITxhcmNoPgovICAgICAgICAgICAgICAgMCAgICAgICAgICAgMCAgICAgMCAgICAgMCAgICAgICA4ICAgICAgICAgYAoAAAAAAAAAAGxpYi5ybWV0YS8gICAgICAwICAgICAgICAgICAwICAgICAwICAgICA2NDQgICAgIDY5NiAgICAgICBgCn9FTEYCAQEAAAAAAAAAAAABAD4AAQAAAAAAAAAAAAAAAAAAAAAAAAA4AQAAAAAAAAAAAABAAAAAAABAAAYABQAEAAAAEAAAAAUAAABHTlUAAgAAwAQAAAADAAAAAAAAAHJ1c3QAAAALVgAAAAAAAAAAAAAAAAAAAOeui3LKkvhRzHF26iVL6b0scnVzdGMgMS4xMDEuMC1uaWdodGx5ICg2ZjVkYTQwNmIgMjAyNi0xMC0xMCnBABh4ODZfNjQtdW5rbm93bi1saW51eC1nbnXBAp8FAAFydXN0LWVuZC1maWxlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC5ub3RlLmdudS5wcm9wZXJ0eQAuc2hzdHJ0YWIALnN0cnRhYgAuc3ltdGFiAC5ybWV0YQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAABwAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAALgAAAAEAAAAAAACAAAAAAAAAAAAAAAAAYAAAAAAAAACDAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAACYAAAACAAAAAAAAAAAAAAAAAAAAAAAAAOgAAAAAAAAAGAAAAAAAAAAEAAAAAQAAAAgAAAAAAAAAGAAAAAAAAAAeAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAFAAAAAMAAAAAAAAAAAAAAAAAAAAAAAAAAQEAAAAAAAA1AAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAGxpYi5ybWV0YS1saW5rLyAwICAgICAgICAgICAwICAgICAwICAgICA2NDQgICAgIDU4NCAgICAgICBgCn9FTEYCAQEAAAAAAAAAAAABAD4AAQAAAAAAAAAAAAAAAAAAAAAAAADIAAAAAAAAAAAAAABAAAAAAABAAAYABQAEAAAAEAAAAAUAAABHTlUAAgAAwAQAAAADAAAAAAAAAAAAcnVzdC1lbmQtZmlsZQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC5ub3RlLmdudS5wcm9wZXJ0eQAucm1ldGEtbGluawAuc2hzdHJ0YWIALnN0cnRhYgAuc3ltdGFiAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAUAAAAAQAAAAAAAIAAAAAAAAAAAAAAAABgAAAAAAAAAA8AAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAMgAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAcAAAAAAAAAAYAAAAAAAAAAQAAAABAAAACAAAAAAAAAAYAAAAAAAAACoAAAADAAAAAAAAAAAAAAAAAAAAAAAAAIgAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAgAAAAAwAAAAAAAAAAAAAAAAAAAAAAAACJAAAAAAAAADoAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAA", "base64"));

/** What `create_wrapper_file` asks of the session, for x86_64-unknown-linux-gnu. */
const SESS = {
  target: {
    options: { endian: "Little", binary_format: "Elf", is_like_darwin: false, is_like_wasm: false, os: { $: "Linux" } },
    object_architecture: () => ["X86_64", undefined],
  },
  internal_target_features: new Set(),
} as unknown as Session;

const utf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

function members(): [string, Uint8Array][] {
  const a = ArchiveFile.parse(FIXTURE);
  if (a.$ !== "Ok") throw new Error("fixture archive");
  return [...a._0.members()].map((m) => {
    if (m.$ !== "Ok") throw new Error("fixture member");
    const d = m._0.data(FIXTURE);
    if (d.$ !== "Ok") throw new Error("fixture data");
    return [utf8(m._0.name()), d._0];
  });
}

function section(obj: Uint8Array, name: string): Uint8Array {
  const f = File.parse(obj);
  if (f.$ !== "Ok") throw new Error("not an object file");
  const s = f._0.section_by_name_bytes(new TextEncoder().encode(name));
  if (s === undefined) throw new Error(`no section ${name}`);
  const d = s.data();
  if (d.$ !== "Ok") throw new Error("section data");
  return d._0;
}

test("the fixture is two wrappers, lib.rmeta then lib.rmeta-link", () => {
  expect(members().map(([n]) => n)).toEqual(["lib.rmeta", "lib.rmeta-link"]);
});

test("create_wrapper_file rebuilds both ELF members", () => {
  const [[, rmeta], [, link]] = members() as [[string, Uint8Array], [string, Uint8Array]];
  const a = create_wrapper_file(SESS, ".rmeta", section(rmeta, ".rmeta"));
  expect(a[1]).toBe("First");
  expect([...a[0]]).toEqual([...rmeta]);
  const b = create_wrapper_file(SESS, ".rmeta-link", section(link, ".rmeta-link"));
  expect([...b[0]]).toEqual([...link]);
});

test("RmetaLink encodes an rlib without objects or native libraries as the oracle does, and reads back", () => {
  const [, [, link]] = members() as [[string, Uint8Array], [string, Uint8Array]];
  expect([...new RmetaLink([], []).encode()]).toEqual([...section(link, ".rmeta-link")]);
  const r = read_from_data(FIXTURE, "x.rlib");
  expect(r).toEqual(new RmetaLink([], []));
});

test("RmetaLink round-trips names and absent names", () => {
  const v = new RmetaLink(["a.o", "b-c.o"], [undefined, "libx.a"]);
  expect(RmetaLink.decode(v.encode())).toEqual(v);
});

test("write_archive_to_stream rebuilds the whole rlib", () => {
  const w = new ArchiveWriter();
  const r = write_archive_to_stream(w, members().map(([n, d]) => new NewArchiveMember(d, DEFAULT_OBJECT_READER, n, 0, 0, 0, 0o644)), "Gnu", false, false);
  expect(r).toEqual({ $: "Ok", _0: null });
  expect([...w.bytes()]).toEqual([...FIXTURE]);
});
