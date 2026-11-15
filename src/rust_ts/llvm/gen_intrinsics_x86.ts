// rust-ts: the hand-run generator of intrinsics_x86.ts (lane ir-fix-a, review ir-fix-a N3). Not imported by the model and not run by
// any test; intrinsics.oracle.test.ts is what checks the committed table against libLLVM on every unit run.
//
//   bun src/rust_ts/llvm/gen_intrinsics_x86.ts           rewrite intrinsics_x86.ts from the oracle's libLLVM.dylib
//   bun src/rust_ts/llvm/gen_intrinsics_x86.ts --check   throw an `ERROR:` error (nonzero exit) unless the committed file is what it would write
//
// It reads the oracle toolchain's own libLLVM.dylib (`rustc +<pin> --print sysroot`, as intrinsics.oracle.test.ts does) through bun:ffi:
// `LLVMIntrinsicGetName` / `LLVMIntrinsicIsOverloaded` for every ID from 1 up to the first that is not an intrinsic name. The x86 table
// is the run of IDs whose first component after `llvm.` is `x86`; its offset is the ID before the first. The text it writes, header
// included, is the committed file byte for byte. Never edit the table by hand: change this script, run it, and commit both.
// `readTargetTable` and `renderTargetTable` are shared with gen_intrinsics_aarch64.ts (lane ir-fix-b), which does the same for
// `aarch64`; importing this file runs nothing (`import.meta.main`).
import { dlopen, type Pointer, toArrayBuffer } from "bun:ffi";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const OUT = join(import.meta.dir, "intrinsics_x86.ts");

const HEADER = `// rust-ts: the IR model's x86 intrinsic name table (lane ir-fix-a; intrinsics.ts header): LLVM's \`IntrinsicNameTable\` for the x86
// target, in its order (sorted), with each one's \`isOverloaded\` bit, and the table's \`TargetInfos\` offset. Data from the oracle, as
// \`GENERIC_INTRINSICS\` is: read out of the oracle toolchain's own libLLVM.dylib (\`LLVMIntrinsicGetName\` /
// \`LLVMIntrinsicIsOverloaded\` for every ID; the x86 names are the run of IDs whose first component after \`llvm.\` is \`x86\`).
// intrinsics.oracle.test.ts re-reads it from libLLVM.dylib and fails on any difference. An x86 intrinsic's ID is its index in this
// table plus \`X86_INTRINSICS_OFFSET + 1\` (\`Adjust\` in \`Intrinsic::lookupIntrinsicID\`, Intrinsics.cpp:766).
// Written by gen_intrinsics_x86.ts (hand-run; review ir-fix-a N3): do not edit the table by hand.
`;

/** The run of the oracle's intrinsic names whose target component is `target`: `[offset, [[name, isOverloaded], ...]]`. */
export function readTargetTable(target: string): [number, [string, 0 | 1][]] {
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } });
  if (r.exitCode !== 0) throw new Error("ERROR: the pinned toolchain is unavailable (rustc +<pin> --print sysroot failed)");
  const sysroot = r.stdout.toString().trim();
  const lib = dlopen(join(sysroot, "lib", "libLLVM.dylib"), {
    LLVMIntrinsicGetName: { args: ["u32", "ptr"], returns: "ptr" },
    LLVMIntrinsicIsOverloaded: { args: ["u32"], returns: "i32" },
  }).symbols;
  const len = new BigUint64Array(1);
  const prefix = `llvm.${target}.`;
  const run: [string, 0 | 1][] = [];
  let first = 0;
  for (let id = 1; ; id++) {
    const p = lib.LLVMIntrinsicGetName(id, len) as Pointer | null;
    const n = Number(len[0]);
    if (p === null || n <= 5 || n > 200) break;
    const name = Buffer.from(toArrayBuffer(p, 0, n)).toString("latin1");
    if (!name.startsWith("llvm.")) break;
    if (name.startsWith(prefix)) {
      if (run.length === 0) first = id;
      run.push([name, lib.LLVMIntrinsicIsOverloaded(id) !== 0 ? 1 : 0]);
    } else if (run.length > 0) break;
  }
  if (run.length === 0) throw new Error(`ERROR: no ${prefix}* intrinsics in libLLVM.dylib`);
  return [first - 1, run];
}

/** A table file's text: the header, the offset, and the table at most 130 columns wide, as committed. `target` is the target's
 *  name as the doc comments write it (`x86`), `upper` the constants' prefix (`X86`). */
export function renderTargetTable(header: string, target: string, upper: string, offset: number, table: readonly [string, 0 | 1][]): string {
  const lines: string[] = [];
  let cur = "  ";
  for (const [name, o] of table) {
    const item = `["${name}", ${o}], `;
    if (cur.length + item.length > 130) {
      lines.push(cur.trimEnd());
      cur = "  ";
    }
    cur += item;
  }
  if (cur.trim() !== "") lines.push(cur.trimEnd());
  return [
    header,
    `/** \`TargetInfos[${target}].Offset\` at the pin: the number of names before the ${target} table in \`IntrinsicNameTable\` (header). */`,
    `export const ${upper}_INTRINSICS_OFFSET = ${offset};`,
    "",
    `/** \`IntrinsicNameTable\` (${target} part) at the pin: \`[name, isOverloaded]\`, sorted (header). */`,
    "// prettier-ignore",
    `export const ${upper}_INTRINSICS: readonly (readonly [string, 0 | 1])[] = [`,
    ...lines,
    "];",
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [offset, table] = readTargetTable("x86");
  const text = renderTargetTable(HEADER, "x86", "X86", offset, table);
  if (process.argv.includes("--check")) {
    if (readFileSync(OUT, "latin1") !== text) throw new Error("ERROR: intrinsics_x86.ts differs from what gen_intrinsics_x86.ts writes");
  } else {
    writeFileSync(OUT, text, "latin1");
  }
}
