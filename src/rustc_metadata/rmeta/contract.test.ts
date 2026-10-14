// The decoder.rs contract (lane rmeta-contract): every upstream fn of decoder.rs is either ported (a marker) or
// declared and installed as a stub, so the decoder lanes (rmeta-decoder-a / -b) only fill bodies.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { upstreamFns } from "../../../scripts/coverage.ts";
import "../lib.ts";
import { BlobDecodeContext, CrateMetadata, MetadataBlob, MetadataDecodeContext } from "./decoder.ts";
import { CrateRoot, LazyArray, LazyValue } from "./mod.ts";

const DECODER = "compiler/rustc_metadata/src/rmeta/decoder.rs";
const here = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
const TEXT = here("decoder.ts") + here("mod.ts");

/** Methods of these prototypes, ported or stubbed. */
const PROTOS: Record<string, object> = {
  MetadataBlob: MetadataBlob.prototype,
  CrateMetadata: CrateMetadata.prototype,
  MetadataDecodeContext: MetadataDecodeContext.prototype,
  BlobDecodeContext: BlobDecodeContext.prototype,
  CrateRoot: CrateRoot.prototype,
  LazyValue: LazyValue.prototype,
  LazyArray: LazyArray.prototype,
};

test("every decoder.rs fn is ported or declared (marker, rustc-decl, stub list or stub fn)", () => {
  const fns = upstreamFns(DECODER);
  expect(fns.length).toBe(156);
  const missing: string[] = [];
  for (const f of fns) {
    const marker = TEXT.includes(`// rustc: ${DECODER}:${f.line} ${f.name}`);
    const decl = new RegExp(`decoder\\.rs:${f.line}\\b`).test(TEXT);
    const installed = Object.values(PROTOS).some((p) => typeof (p as Record<string, unknown>)[f.name] === "function");
    if (!marker && !decl && !installed) missing.push(`${f.line} ${f.name}`);
  }
  expect(missing).toEqual([]);
});

test("the CrateMetadata contract: every declared method exists after loading lib.ts", () => {
  const decl = /export interface CrateMetadata \{([\s\S]*?)\n\}/.exec(here("decoder.ts"))![1]!;
  const names = [...decl.matchAll(/^\s{2}([a-z_][a-z0-9_]*)\(/gm)].map((m) => m[1]!);
  expect(names.length).toBeGreaterThan(80);
  for (const n of names) expect(typeof (CrateMetadata.prototype as unknown as Record<string, unknown>)[n]).toBe("function");
});

test("stubs stop as UNPORTED with their path", () => {
  // rmeta-decoder-b's region has no stubs left (lane rmeta-ty ported `get_associated_item`, its last M3 stop).
  // rmeta-decoder-a: `def_kind` is ported; an M3 stop of its region instead.
  const dcx = Object.create(MetadataDecodeContext.prototype) as MetadataDecodeContext;
  expect(() => dcx.decode_alloc_id()).toThrow("rustc_metadata::rmeta::decoder::MetadataDecodeContext::decode_alloc_id");
});
