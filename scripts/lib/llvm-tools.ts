// The pinned toolchain's `llvm-tools` (plan-m7 D1, review F1): `opt`, `llc` and `llvm-as`, called by absolute path. They come
// with the oracle toolchain's own `llvm-tools-preview` component, in `rust.components` already (scripts/lib/toolchain.ts),
// so nothing is ever installed for them: if one is missing, the toolchain is damaged. They load
// `lib/rustlib/<host>/lib/libLLVM.dylib` (`@rpath`, `@loader_path/../lib`), and rustc loads `lib/libLLVM.dylib`: two files, which
// must be one build, or a normal form would not be made by the LLVM that wrote the text (review plan-m7, "What I checked").
// No imports beyond node:, so unit tests can load it without scripts/lib/common.ts (see scripts/lib/deps.test.ts).
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

/** What the harness runs. `llvm-as`: N2 and N3 go through bitcode, as `opt --discard-value-names` refuses text. */
export const LLVM_TOOLS = ["opt", "llc", "llvm-as"] as const;
export type LlvmTool = (typeof LLVM_TOOLS)[number];

/** The directory holding the tools. */
export const llvmBinDir = (sysroot: string, host: string): string => join(sysroot, "lib", "rustlib", host, "bin");

/** The two copies of the LLVM library: rustc's, and the one the tools load. */
export const libLlvmCopies = (sysroot: string, host: string): [string, string] => [join(sysroot, "lib", "libLLVM.dylib"), join(sysroot, "lib", "rustlib", host, "lib", "libLLVM.dylib")];

/** SHA-256 of a file, streamed: the library is 143 MB. */
export function sha256File(p: string): string {
  const h = createHash("sha256");
  const fd = openSync(p, "r");
  try {
    const b = Buffer.alloc(1 << 20);
    for (let n = readSync(fd, b); n > 0; n = readSync(fd, b)) h.update(b.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

/** The SHA-256 of the tools and of the library, as `LLVM_TOOLS_PINNED` records them. */
export function llvmToolHashes(sysroot: string, host: string): Record<LlvmTool | "libLLVM", string> {
  const [a] = libLlvmCopies(sysroot, host);
  const bin = llvmBinDir(sysroot, host);
  return { opt: sha256File(join(bin, "opt")), llc: sha256File(join(bin, "llc")), "llvm-as": sha256File(join(bin, "llvm-as")), libLLVM: sha256File(a) };
}

/**
 * Pinned per host: the tools of the toolchain at this repo's pin. Another host has none yet.
 * **Trust on first use** (review harness-m7a H8): these were read from the files on this host. Only `libLLVM`'s has a second witness (review
 * plan-m7). `opt`, `llc` and `llvm-as` were not checked against anything independent, such as the dist tarball, so the pin shows that they have not
 * changed, not that they are the release's. llvm-tools.test.ts does check that their `--version` matches `rustc -vV`.
 */
export const LLVM_TOOLS_PINNED: Record<string, Record<LlvmTool | "libLLVM", string>> = {
  "aarch64-apple-darwin": {
    opt: "08fbe6994221b032254a35d87296801b4eea608182ec76c7fdb585a06b726455",
    llc: "3eebf5569ca0fedff6caf82adced7a06521b68fb1919480d8fbfec9065059f19",
    "llvm-as": "68685dbe2881239b5c67e6e139054cb922876da12092f33ad2ba2d3d6a7fe046",
    libLLVM: "468b56993bc4e1cacb5dd0b3972da21a36ffcf8ab52aba2ae92e421be2a55910",
  },
};

/** `undefined` if `hashes` (`llvmToolHashes`) are what `LLVM_TOOLS_PINNED` holds for `host`, or it holds nothing for `host`; else one line (no `ERROR:` prefix). */
export function llvmToolsPinError(hashes: Record<LlvmTool | "libLLVM", string>, host: string): string | undefined {
  const pin = LLVM_TOOLS_PINNED[host];
  if (pin === undefined) return undefined;
  const changed = ([...LLVM_TOOLS, "libLLVM"] as const).filter((t) => hashes[t] !== pin[t]);
  return changed.length ? `llvm-tools: ${changed.join(", ")} differ from the hashes pinned in scripts/lib/llvm-tools.ts, so the oracle toolchain has changed; never change it: reinstall the pinned toolchain only by the owner's decision` : undefined;
}

/**
 * `undefined` if the tools and both library copies exist, and the copies are one build; else one line (no `ERROR:` prefix).
 * It says nothing to install: `llvm-tools` is part of the oracle toolchain, and the oracle toolchain is never changed.
 * `hashCopies: false` checks only that they exist and have one size, for a path that runs per process.
 */
export function llvmToolsError(sysroot: string, host: string, hashCopies = true): string | undefined {
  const bin = llvmBinDir(sysroot, host);
  const missing = LLVM_TOOLS.map((t) => join(bin, t)).filter((p) => !existsSync(p));
  const copies = libLlvmCopies(sysroot, host);
  missing.push(...copies.filter((p) => !existsSync(p)));
  const fix = "the oracle toolchain holds them (UPSTREAM.json rust.components: llvm-tools-preview); never change it: reinstall the pinned toolchain only by the owner's decision";
  if (missing.length) return `llvm-tools: missing ${missing.join(", ")}; ${fix}`;
  const differ = statSync(copies[0]).size !== statSync(copies[1]).size || (hashCopies && sha256File(copies[0]) !== sha256File(copies[1]));
  if (differ) return `llvm-tools: ${copies[0]} and ${copies[1]} are not one build, so normal forms would not come from the LLVM that wrote the text; ${fix}`;
  return undefined;
}
