// rust-ts: the hand-run generator of intrinsics_aarch64.ts (lane ir-fix-b), as gen_intrinsics_x86.ts is of the x86 table (review
// ir-fix-a N3). Not imported by the model and not run by any test; intrinsics.oracle.test.ts is what checks the committed table
// against libLLVM on every unit run.
//
//   bun src/rust_ts/llvm/gen_intrinsics_aarch64.ts           rewrite intrinsics_aarch64.ts from the oracle's libLLVM.dylib
//   bun src/rust_ts/llvm/gen_intrinsics_aarch64.ts --check   throw an `ERROR:` error (nonzero exit) unless the committed file is what it would write
//
// The aarch64 table is the run of IDs whose first component after `llvm.` is `aarch64` (gen_intrinsics_x86.ts's `readTargetTable`);
// its offset is the ID before the first. The text it writes, header included, is the committed file byte for byte. Never edit the
// table by hand: change this script, run it, and commit both.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTargetTable, renderTargetTable } from "./gen_intrinsics_x86.ts";

const OUT = join(import.meta.dir, "intrinsics_aarch64.ts");

const HEADER = `// rust-ts: the IR model's aarch64 intrinsic name table (lane ir-fix-b; intrinsics.ts header): LLVM's \`IntrinsicNameTable\` for the
// aarch64 target, in its order (sorted), with each one's \`isOverloaded\` bit, and the table's \`TargetInfos\` offset. Data from the
// oracle, as \`GENERIC_INTRINSICS\` and \`X86_INTRINSICS\` are: read out of the oracle toolchain's own libLLVM.dylib
// (\`LLVMIntrinsicGetName\` / \`LLVMIntrinsicIsOverloaded\` for every ID; the aarch64 names are the run of IDs whose first component
// after \`llvm.\` is \`aarch64\`). intrinsics.oracle.test.ts re-reads it from libLLVM.dylib and fails on any difference. An aarch64
// intrinsic's ID is its index in this table plus \`AARCH64_INTRINSICS_OFFSET + 1\` (\`Adjust\` in \`Intrinsic::lookupIntrinsicID\`).
// Written by gen_intrinsics_aarch64.ts (hand-run): do not edit the table by hand.
`;

if (import.meta.main) {
  const [offset, table] = readTargetTable("aarch64");
  const text = renderTargetTable(HEADER, "aarch64", "AARCH64", offset, table);
  if (process.argv.includes("--check")) {
    if (readFileSync(OUT, "latin1") !== text) throw new Error("ERROR: intrinsics_aarch64.ts differs from what gen_intrinsics_aarch64.ts writes");
  } else {
    writeFileSync(OUT, text, "latin1");
  }
}
