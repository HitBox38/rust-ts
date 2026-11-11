// The generated `#[derive(Encodable, BlobDecodable)]` codecs of `TargetModifier`, `OptionsTargetModifiers` and the
// `$tmod_enum`s (tools/codegen/options.ts -> options.gen.ts; lane driver-cli-2): every variant round-trips through the
// opaque encoder, the bytes are the derive's (a `u8` variant index for the 2-variant `OptionsTargetModifiers` and the
// 12-variant `UnstableOptionsTargetModifiers`, none for the 1-variant `CodegenOptionsTargetModifiers`, then the
// `String`), and a bad tag panics with the derive's text. The oracle comparison (rmeta bytes and `-Zls` of crates built
// with target modifiers) is in docs/handoff/driver-cli-2.md.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FileEncoder, MemDecoder } from "../rustc_serialize/opaque.ts";
import type { BlobDecoder } from "../rustc_span/lib.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";
import { unwrap_result } from "../std/result.ts";
import { TargetModifier } from "./options.ts";
import {
  CodegenOptionsTargetModifiers,
  CodegenOptionsTargetModifiers_discriminant,
  decode_TargetModifier,
  encode_TargetModifier,
  OptionsTargetModifiers,
  UnstableOptionsTargetModifiers,
  UnstableOptionsTargetModifiers_discriminant,
} from "./options.gen.ts";

const SCRATCH = test_scratch_dir("target-modifier-codec");
let tmp_n = 0;

function encode_all(values: TargetModifier[]): Uint8Array {
  const path = join(SCRATCH, `tmp${tmp_n++}`);
  const e = unwrap_result(FileEncoder.new(path));
  for (const v of values) encode_TargetModifier(v, e);
  unwrap_result(e.finish());
  e.drop();
  return new Uint8Array(readFileSync(path));
}

// PORT: `decode_TargetModifier` reads only `Decoder` methods, so a `MemDecoder` stands in for the `BlobDecoder`.
const blob = (d: MemDecoder): BlobDecoder => d as unknown as BlobDecoder;

const all_opts = (): OptionsTargetModifiers[] => [
  ...(Object.keys(UnstableOptionsTargetModifiers_discriminant) as UnstableOptionsTargetModifiers[]).map((v) => OptionsTargetModifiers.UnstableOptions(v)),
  ...(Object.keys(CodegenOptionsTargetModifiers_discriminant) as CodegenOptionsTargetModifiers[]).map((v) => OptionsTargetModifiers.CodegenOptions(v)),
];

test("every TargetModifier variant round-trips", () => {
  const opts = all_opts();
  expect(opts.length).toBe(13);
  const values = opts.flatMap((opt, i) => [new TargetModifier(opt, ""), new TargetModifier(opt, `v${i}=é,+x`)]);
  const decoder = unwrap_result(MemDecoder.new(encode_all(values), 0));
  for (const v of values) {
    const d = decode_TargetModifier(blob(decoder));
    expect(d.opt).toBe(v.opt); // interned: the same object
    expect(d.value_name).toBe(v.value_name);
  }
  expect(decoder.remaining()).toBe(0);
});

test("the derive's bytes: variant indices in declaration order, no tag for a one-variant enum", () => {
  // `String`: LEB128 length, the bytes, STR_SENTINEL (0xC1).
  const str = (s: string) => [s.length, ...new TextEncoder().encode(s), 0xc1];
  const bytes = (v: TargetModifier) => [...encode_all([v])].slice(0, -"rust-end-file".length);
  expect(bytes(new TargetModifier(OptionsTargetModifiers.UnstableOptions(UnstableOptionsTargetModifiers.BranchProtection), "bti"))).toEqual([0, 0, ...str("bti")]);
  expect(bytes(new TargetModifier(OptionsTargetModifiers.UnstableOptions(UnstableOptionsTargetModifiers.Sanitizer), "address"))).toEqual([0, 9, ...str("address")]);
  expect(bytes(new TargetModifier(OptionsTargetModifiers.UnstableOptions(UnstableOptionsTargetModifiers.SanitizerCfiMinimalRuntime), ""))).toEqual([0, 11, ...str("")]);
  expect(bytes(new TargetModifier(OptionsTargetModifiers.CodegenOptions(CodegenOptionsTargetModifiers.TargetCpu), "znver3"))).toEqual([1, ...str("znver3")]);
});

test("a bad tag panics with the derive's message", () => {
  const good = encode_all([new TargetModifier(OptionsTargetModifiers.UnstableOptions(UnstableOptionsTargetModifiers.Sanitizer), "")]);
  const bad_outer = good.slice();
  bad_outer[0] = 2;
  expect(() => decode_TargetModifier(blob(unwrap_result(MemDecoder.new(bad_outer, 0))))).toThrow(
    "invalid enum variant tag while decoding `OptionsTargetModifiers`, expected 0..2, actual 2",
  );
  const bad_inner = good.slice();
  bad_inner[1] = 12;
  expect(() => decode_TargetModifier(blob(unwrap_result(MemDecoder.new(bad_inner, 0))))).toThrow(
    "invalid enum variant tag while decoding `UnstableOptionsTargetModifiers`, expected 0..12, actual 12",
  );
});
