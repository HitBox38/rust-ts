// Mach-O wrapper files and the darwin archive against oracle-built files (lane object-write-macho). The fixtures are the
// oracle's output for a `#![no_core]` crate (`pub fn f() {}` and the three sizedness lang items) built with
// `--crate-type rlib --emit=link -Zcodegen-backend=dummy --target <t>` and no `MACOSX_DEPLOYMENT_TARGET` (or other
// `*_DEPLOYMENT_TARGET`) set: the whole rlib for the host, `aarch64-apple-darwin`, and the `lib.rmeta-link` member of the
// rlib for four other Apple targets, chosen for their Mach-O header and `LC_BUILD_VERSION`: x86_64 (CPU type), arm64_32
// watchOS (a 32-bit Mach-O), arm64e iOS (sub-architecture and `CPU_SUBTYPE_PTRAUTH_ABI`), Mac Catalyst (platform).
// Rebuilding them with the ported `create_wrapper_file` and `write_archive_to_stream` must give the same bytes; whole
// compilations are compared in docs/handoff/object-write-macho.md.
import { expect, test } from "bun:test";
import type { Session } from "../../rustc_session/session.ts";
import { OSVersion } from "../../rustc_target/spec/base/apple/mod.ts";
import type { Target } from "../../rustc_target/spec/mod.ts";
import { ArchiveWriter, DEFAULT_OBJECT_READER, NewArchiveMember, write_archive_to_stream } from "../../vendor/ar_archive_writer/lib.ts";
import type { Architecture, SubArchitecture } from "../../vendor/object/common.ts";
import { ArchiveFile } from "../../vendor/object/read/archive.ts";
import { File } from "../../vendor/object/read/any.ts";
import { create_wrapper_file } from "./metadata.ts";
import { RmetaLink } from "./rmeta_link.ts";

const b64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "base64"));

/** `libnc.rlib` for aarch64-apple-darwin. */
const HOST_RLIB = b64("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");

/**
 * The `lib.rmeta-link` member of `libnc.rlib` for other Apple targets, as the archive stores it: a darwin archive pads each
 * member to 8 bytes with `\n`, and the padding counts in the member's size (arm64_32's 300-byte object is 304 here).
 */
const RMETA_LINK: Record<string, string> = {
  "x86_64-apple-darwin": "z/rt/gcAAAEDAAAAAQAAAAQAAAAYAQAAAAAAAAAAAAAZAAAAmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAOAEAAAAAAAAPAAAAAAAAAAcAAAAHAAAAAQAAAAAAAAAucm1ldGEtbGluawAAAAAAX19EV0FSRgAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAA4AQAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAADIAAAAYAAAAAQAAAAAMCgAAAAAAAAAAAAIAAAAYAAAASAEAAAAAAABIAQAACAAAAAsAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABydXN0LWVuZC1maWxlAAAAAAAAAAAA",
  "arm64_32-apple-watchos": "zvrt/gwAAAIBAAAAAQAAAAQAAAD8AAAAAAAAAAEAAAB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAAAAGAEAAA8AAAAHAAAABwAAAAEAAAAAAAAALnJtZXRhLWxpbmsAAAAAAF9fRFdBUkYAAAAAAAAAAAAAAAAADwAAABgBAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAyAAAAGAAAAAQAAAAAAAUAAAAAAAAAAAACAAAAGAAAACgBAAAAAAAAKAEAAAQAAAALAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcnVzdC1lbmQtZmlsZQAAAAAACgoKCg==",
  "arm64e-apple-ios": "z/rt/gwAAAECAACAAQAAAAQAAAAYAQAAAAAAAAAAAAAZAAAAmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAOAEAAAAAAAAPAAAAAAAAAAcAAAAHAAAAAQAAAAAAAAAucm1ldGEtbGluawAAAAAAX19EV0FSRgAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAA4AQAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAADIAAAAYAAAAAgAAAAAADgAAAAAAAAAAAAIAAAAYAAAASAEAAAAAAABIAQAACAAAAAsAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABydXN0LWVuZC1maWxlAAAAAAAAAAAA",
  "aarch64-apple-ios-macabi": "z/rt/gwAAAEAAAAAAQAAAAQAAAAYAQAAAAAAAAAAAAAZAAAAmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AAAAAAAAAOAEAAAAAAAAPAAAAAAAAAAcAAAAHAAAAAQAAAAAAAAAucm1ldGEtbGluawAAAAAAX19EV0FSRgAAAAAAAAAAAAAAAAAAAAAADwAAAAAAAAA4AQAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAADIAAAAYAAAABgAAAAAADgAAAAAAAAAAAAIAAAAYAAAASAEAAAAAAABIAQAACAAAAAsAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABydXN0LWVuZC1maWxlAAAAAAAAAAAA",
};

/**
 * What `create_wrapper_file` asks of the session for an Apple target. `object_architecture` is the pair
 * `Target::object_architecture` gives for it; `apple_deployment_target` is the session's, with no deployment-target
 * variable set.
 */
function sess(llvm_target: string, os: string, env: string, arch: string, object_architecture: [Architecture, SubArchitecture | undefined]): Session {
  const target = {
    llvm_target,
    os: { $: os },
    env: { $: env },
    arch: { $: arch },
    options: { endian: "Little", binary_format: "MachO", is_like_darwin: true, is_like_wasm: false },
    object_architecture: () => object_architecture,
  } as unknown as Target;
  return {
    target,
    internal_target_features: new Set(),
    apple_deployment_target: () => OSVersion.minimum_deployment_target(target),
  } as unknown as Session;
}

const SESS: Record<string, Session> = {
  "aarch64-apple-darwin": sess("arm64-apple-macosx", "MacOs", "Unspecified", "AArch64", ["Aarch64", undefined]),
  "x86_64-apple-darwin": sess("x86_64-apple-macosx", "MacOs", "Unspecified", "X86_64", ["X86_64", undefined]),
  "arm64_32-apple-watchos": sess("arm64_32-apple-watchos", "WatchOs", "Unspecified", "AArch64", ["Aarch64_Ilp32", undefined]),
  "arm64e-apple-ios": sess("arm64e-apple-ios", "IOs", "Unspecified", "AArch64", ["Aarch64", "Arm64E"]),
  "aarch64-apple-ios-macabi": sess("arm64-apple-ios-macabi", "IOs", "MacAbi", "AArch64", ["Aarch64", undefined]),
};

const utf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

function members(rlib: Uint8Array): [string, Uint8Array][] {
  const a = ArchiveFile.parse(rlib);
  if (a.$ !== "Ok") throw new Error("fixture archive");
  return [...a._0.members()].map((m) => {
    if (m.$ !== "Ok") throw new Error("fixture member");
    const d = m._0.data(rlib);
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

test("the host fixture is a darwin archive of two Mach-O wrappers, lib.rmeta then lib.rmeta-link", () => {
  expect(members(HOST_RLIB).map(([n]) => n)).toEqual(["lib.rmeta", "lib.rmeta-link"]);
  const f = File.parse(members(HOST_RLIB)[0]![1]);
  expect(f.$ === "Ok" && f._0.format()).toBe("MachO");
});

test("create_wrapper_file rebuilds both Mach-O members of the host rlib", () => {
  const [[, rmeta], [, link]] = members(HOST_RLIB) as [[string, Uint8Array], [string, Uint8Array]];
  const a = create_wrapper_file(SESS["aarch64-apple-darwin"]!, ".rmeta", section(rmeta, ".rmeta"));
  expect(a[1]).toBe("First");
  expect([...a[0]]).toEqual([...rmeta]);
  const b = create_wrapper_file(SESS["aarch64-apple-darwin"]!, ".rmeta-link", new RmetaLink([], []).encode());
  expect([...b[0]]).toEqual([...link]);
});

test("write_archive_to_stream rebuilds the whole host rlib as a darwin archive", () => {
  const w = new ArchiveWriter();
  const ms = members(HOST_RLIB).map(([n, d]) => new NewArchiveMember(d, DEFAULT_OBJECT_READER, n, 0, 0, 0, 0o644));
  const r = write_archive_to_stream(w, ms, "Darwin", false, false);
  expect(r).toEqual({ $: "Ok", _0: null });
  expect([...w.bytes()]).toEqual([...HOST_RLIB]);
});

for (const [t, link] of Object.entries(RMETA_LINK)) {
  test(`create_wrapper_file rebuilds the lib.rmeta-link wrapper for ${t}`, () => {
    const expected = b64(link);
    const got = [...create_wrapper_file(SESS[t]!, ".rmeta-link", new RmetaLink([], []).encode())[0]];
    while (got.length % 8 !== 0) got.push(0x0a);
    expect(got).toEqual([...expected]);
  });
}
