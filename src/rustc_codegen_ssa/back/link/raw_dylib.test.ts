// Unit test of raw_dylib.ts (lane ssa-link-b, review ssa-link-b F1): the file name of a raw-dylib ELF stub,
// `format!("{}{}{}", dll_prefix, hash.as_u128().to_base_fixed_len(CASE_INSENSITIVE), dll_suffix)` (raw_dylib.rs:179-184), and
// the file written under it. The expected name is the pinned rustc's, for the same library and import: the `-l:<name>` in
// ../linker_oracle/oracle/linux-raw-dylib.args (`#[link(name = "foo", kind = "raw-dylib")]` with `fn foo_fn`, regen.ts).
// The vendored ELF writer has no dynamic sections, so the writer is one that writes nothing.
import { afterEach, expect, test } from "bun:test";
// Load order: rustc_target through its crate root first (as back/link.ts does).
import "../../../rustc_target/lib.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Size } from "../../../rustc_abi/lib.ts";
import { DllCallingConvention, DllImport } from "../../../rustc_crate_store/cstore.gen.ts";
import type { Session } from "../../../rustc_session/session.ts";
import { create_default_session_globals_then, DUMMY_SP } from "../../../rustc_span/lib.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { Target } from "../../../rustc_target/spec/mod.ts";
import { TargetTuple } from "../../../rustc_target/spec/tuple.ts";
import type { NativeLib } from "../../lib.ts";
import { create_raw_dylib_elf_stub_shared_objects, type ElfStubWriter, vendor_object } from "./raw_dylib.ts";

const saved = { ...vendor_object };
afterEach(() => Object.assign(vendor_object, saved));

test("create_raw_dylib_elf_stub_shared_objects names the stub by the oracle's hash (raw_dylib.rs:179-184)", () => {
  const want = /"-l:([^"]+)"/.exec(readFileSync(join(import.meta.dir, "..", "linker_oracle", "oracle", "linux-raw-dylib.args"), "utf8"))![1]!;
  expect(want).toMatch(/^lib[0-9a-z]+\.so$/);
  create_default_session_globals_then(() => {
    const dir = mkdtempSync(join(tmpdir(), "rust-ts-raw-dylib-"));
    try {
      let ids = 0;
      vendor_object.new_elf_stub_writer = () =>
        new Proxy({} as ElfStubWriter, {
          get: (_t, name) => (String(name).startsWith("add_") || String(name).startsWith("reserve_") ? () => ids++ : () => ({ $: "Ok" })),
        });
      const r = Target.search(TargetTuple.from_tuple("x86_64-unknown-linux-gnu"), "", false);
      if (r.$ === "Err") throw new Error(r._0);
      const sess = { target: r._0[0], internal_target_features: new Set(), dcx: () => ({ abort_if_errors: () => {} }) } as unknown as Session;
      const import_ = new DllImport(Symbol.intern("foo_fn"), undefined, DllCallingConvention.C, DUMMY_SP, "Function", Size.from_bytes(0));
      const lib = { kind: { $: "RawDylib", as_needed: undefined }, name: Symbol.intern("foo"), cfg: undefined, verbatim: false, dll_imports: [import_] } as unknown as NativeLib;
      const out = create_raw_dylib_elf_stub_shared_objects(sess, [lib], dir);
      expect(out).toEqual([[want, true]]);
      expect(existsSync(join(dir, want))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
