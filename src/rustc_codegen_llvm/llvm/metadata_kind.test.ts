// Tests of llvm/metadata_kind.ts (lane cg-contract). Upstream's check is a set of static assertions in RustWrapper.cpp
// ("Must be kept in sync with the corresponding static assertions in `RustWrapper.cpp`"); here each constant is checked
// against LLVM's own list, llvm/include/llvm/IR/FixedMetadataKinds.def at the pinned LLVM commit (harness/llvm-manifest.json,
// fetched under $RUST_TS_DATA/llvm-src by `bun scripts/llvm-src.ts fetch`), and against the IR model's
// `LLVMGetMDKindIDInContext`, which ported code uses for kinds by name.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LLVM_MANIFEST, llvmSrcDir, readManifest, sha256 } from "../../../scripts/lib/llvm-src.ts";
import { dataDir, REPO_ROOT } from "../../../scripts/lib/upstream-root.ts";
import * as llvm from "../../rust_ts/llvm/ffi.ts";
import * as md from "./metadata_kind.ts";

const DEF = "llvm/include/llvm/IR/FixedMetadataKinds.def";

/** `LLVM_FIXED_MD_KIND(MD_x, "name", N)` entries of the pinned .def, in order (an entry may span lines). */
function llvmFixedKinds(): { variant: string; name: string; value: number }[] {
  const m = readManifest(join(REPO_ROOT, LLVM_MANIFEST));
  // A missing file fails the test (run `bun scripts/llvm-src.ts fetch`); it never skips.
  const bytes = readFileSync(join(llvmSrcDir(dataDir(), m), DEF));
  // The file is the pinned one.
  expect(sha256(bytes)).toBe(m.files[DEF]!);
  const text = new TextDecoder().decode(bytes);
  return [...text.matchAll(/LLVM_FIXED_MD_KIND\(\s*(\w+)\s*,\s*"([^"]*)"\s*,\s*(\d+)\s*\)/g)].map((x) => ({
    variant: x[1]!,
    name: x[2]!,
    value: Number(x[3]),
  }));
}

const ours = Object.entries(md).filter(([k]) => k.startsWith("MD_")) as [string, number][];

describe("declare_fixed_metadata_kinds!", () => {
  test("42 kinds, values 0..41 (metadata_kind.rs:29-70)", () => {
    expect(ours.length).toBe(42);
    // A module namespace lists its exports by name, so order by value.
    expect(ours.map(([, v]) => v).sort((a, b) => a - b)).toEqual([...Array(42).keys()]);
    expect(md.MD_dbg as number).toBe(0);
    expect(md.MD_noalias_addrspace as number).toBe(41);
  });

  test("each constant equals LLVM's fixed kind of the same name (FixedMetadataKinds.def)", () => {
    const kinds = new Map(llvmFixedKinds().map((k) => [k.variant, k]));
    expect(kinds.size).toBeGreaterThanOrEqual(ours.length);
    for (const [variant, value] of ours) {
      expect(kinds.get(variant)?.value).toBe(value);
    }
  });

  test("the IR model hands back the same id for the kind's name (LLVMGetMDKindIDInContext)", () => {
    const kinds = new Map(llvmFixedKinds().map((k) => [k.variant, k]));
    const cx = llvm.LLVMContextCreate();
    for (const [variant, value] of ours) {
      const name = kinds.get(variant)!.name;
      expect(llvm.LLVMGetMDKindIDInContext(cx, name, Buffer.byteLength(name)) as number).toBe(value);
    }
  });
});
