// rust-ts: test helper (lane llir-init): the `LLVMRustCreateTargetMachine` calls cg-write recorded from the pinned rustc for the empty
// lib (rustc_codegen_llvm/back/write_oracle/<target>.tm, lldb, by hand), as the arguments ffi.ts takes. Tests only.
import { join } from "node:path";
import type * as L from "./ffi.ts";
import { CodeGenOptLevel_discriminant, CodeModel_discriminant, CompressionKind_discriminant, FloatAbi_discriminant, RelocModel_discriminant } from "./ffi_types.ts";

/** The directory of cg-write's `<target>.tm` fixtures. */
export const TM_FIXTURES = join(import.meta.dir, "../../rustc_codegen_llvm/back/write_oracle");

/** A recorded call's arguments, as ffi.ts takes them (record.ts's argument form: strings quoted, enums and booleans as numbers). */
export function tmArgs(line: string): Parameters<typeof L.LLVMRustCreateTargetMachine> {
  const m = /^LLVMRustCreateTargetMachine\((.*)\)$/.exec(line.trim());
  if (m === null) throw new Error(`ERROR: not a recorded LLVMRustCreateTargetMachine call: ${line}`);
  const a = m[1]!.match(/"(?:[^"\\]|\\.)*"|[^,\s]+/g)!.map((s) => (s.startsWith('"') ? s.slice(1, -1) : Number(s)));
  if (a.length !== 23) throw new Error(`ERROR: ${a.length} arguments, not 23: ${line}`);
  const e = <T extends string>(tbl: Readonly<Record<T, number>>, n: unknown): T => {
    const k = (Object.keys(tbl) as T[]).find((k) => tbl[k] === n);
    if (k === undefined) throw new Error(`ERROR: ${String(n)} is no discriminant of ${Object.keys(tbl).join("/")}`);
    return k;
  };
  const b = (n: unknown): boolean => n !== 0;
  return [
    a[0] as string, a[1] as string, a[2] as string, a[3] as string,
    e(CodeModel_discriminant, a[4]), e(RelocModel_discriminant, a[5]), e(CodeGenOptLevel_discriminant, a[6]), e(FloatAbi_discriminant, a[7]),
    b(a[8]), b(a[9]), b(a[10]), b(a[11]), b(a[12]), b(a[13]), b(a[14]), b(a[15]), b(a[16]),
    a[17] as string, a[18] as string, e(CompressionKind_discriminant, a[19]), b(a[20]), b(a[21]), BigInt(a[22] as number),
  ];
}
