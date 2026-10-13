// Port of compiler/rustc_structures/src/sanitizer_set.rs
// The `bitflags!` type is generated into sanitizer_set.gen.ts (branded number + `Flags` companion);
// the inherent methods extend the companion here (PORTING §8).
import { panic } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { Debug } from "../std/fmt.ts";
import { IterNames } from "../vendor/bitflags/iter.ts";
import { to_writer } from "../vendor/bitflags/parser.ts";
import * as gen from "./sanitizer_set.gen.ts";

export * from "./sanitizer_set.gen.ts";

export type SanitizerSet = gen.SanitizerSet;

// #[cfg(feature = "nightly")]
// rustc_data_structures::external_bitflags_debug! { SanitizerSet }
// PORT: the macro expands to `impl Debug for SanitizerSet { fn fmt(..) { bitflags::parser::to_writer(self, f) } }`
// (compiler/rustc_data_structures/src/lib.rs:147).
export const debug_SanitizerSet: Debug<SanitizerSet> = (v, _f) => to_writer(gen.SanitizerSet.FLAGS_DESC, v);

const S = gen.SanitizerSet;

export const SanitizerSet = {
  ...gen.SanitizerSet,

  // Taken from LLVM's sanitizer compatibility logic:
  // https://github.com/llvm/llvm-project/blob/release/18.x/clang/lib/Driver/SanitizerArgs.cpp#L512
  MUTUALLY_EXCLUSIVE: [
    [S.ADDRESS, S.MEMORY],
    [S.ADDRESS, S.THREAD],
    [S.ADDRESS, S.HWADDRESS],
    [S.ADDRESS, S.MEMTAG],
    [S.ADDRESS, S.KERNELADDRESS],
    [S.ADDRESS, S.KERNELHWADDRESS],
    [S.ADDRESS, S.SAFESTACK],
    [S.LEAK, S.MEMORY],
    [S.LEAK, S.THREAD],
    [S.LEAK, S.KERNELADDRESS],
    [S.LEAK, S.KERNELHWADDRESS],
    [S.LEAK, S.SAFESTACK],
    [S.MEMORY, S.THREAD],
    [S.MEMORY, S.HWADDRESS],
    [S.MEMORY, S.KERNELADDRESS],
    [S.MEMORY, S.KERNELHWADDRESS],
    [S.MEMORY, S.SAFESTACK],
    [S.THREAD, S.HWADDRESS],
    [S.THREAD, S.KERNELADDRESS],
    [S.THREAD, S.KERNELHWADDRESS],
    [S.THREAD, S.SAFESTACK],
    [S.HWADDRESS, S.MEMTAG],
    [S.HWADDRESS, S.KERNELADDRESS],
    [S.HWADDRESS, S.KERNELHWADDRESS],
    [S.HWADDRESS, S.SAFESTACK],
    [S.CFI, S.KCFI],
    [S.MEMTAG, S.KERNELADDRESS],
    [S.MEMTAG, S.KERNELHWADDRESS],
    [S.KERNELADDRESS, S.KERNELHWADDRESS],
    [S.KERNELADDRESS, S.SAFESTACK],
    [S.KERNELHWADDRESS, S.SAFESTACK],
  ] as readonly (readonly [SanitizerSet, SanitizerSet])[],

  /// Return sanitizer's name
  ///
  /// Returns none if the flags is a set of sanitizers numbering not exactly one.
  // rustc: compiler/rustc_structures/src/sanitizer_set.rs:72 as_str
  as_str(self: SanitizerSet): string | undefined {
    switch (self) {
      case S.ADDRESS:
        return "address";
      case S.CFI:
        return "cfi";
      case S.DATAFLOW:
        return "dataflow";
      case S.KCFI:
        return "kcfi";
      case S.KERNELADDRESS:
        return "kernel-address";
      case S.KERNELHWADDRESS:
        return "kernel-hwaddress";
      case S.LEAK:
        return "leak";
      case S.MEMORY:
        return "memory";
      case S.MEMTAG:
        return "memtag";
      case S.SAFESTACK:
        return "safestack";
      case S.SHADOWCALLSTACK:
        return "shadow-call-stack";
      case S.THREAD:
        return "thread";
      case S.HWADDRESS:
        return "hwaddress";
      case S.REALTIME:
        return "realtime";
      default:
        return undefined;
    }
  },

  // rustc: compiler/rustc_structures/src/sanitizer_set.rs:92 mutually_exclusive
  mutually_exclusive(self: SanitizerSet): [SanitizerSet, SanitizerSet] | undefined {
    const found = SanitizerSet.MUTUALLY_EXCLUSIVE.find(([a, b]) => S.contains(self, a) && S.contains(self, b));
    return found === undefined ? undefined : [found[0], found[1]];
  },

  /// Disable default sanitizers that are incompatible with explicitly requested ones,
  /// matching Clang's `SanitizerArgs` driver logic.
  // rustc: compiler/rustc_structures/src/sanitizer_set.rs:101 combine_with_defaults
  combine_with_defaults(self: SanitizerSet, defaults: SanitizerSet): SanitizerSet {
    for (const [a, b] of SanitizerSet.MUTUALLY_EXCLUSIVE) {
      if (S.contains(defaults, a) && S.contains(self, b)) {
        defaults = S.difference(defaults, a);
      }
      if (S.contains(defaults, b) && S.contains(self, a)) {
        defaults = S.difference(defaults, b);
      }
    }
    return S.union(self, defaults);
  },

  /** `impl FromStr for SanitizerSet` (`type Err = String`) */
  // rustc: compiler/rustc_structures/src/sanitizer_set.rs:132 from_str
  from_str(s: string): Result<SanitizerSet, string> {
    switch (s) {
      case "address":
        return Ok(S.ADDRESS);
      case "cfi":
        return Ok(S.CFI);
      case "dataflow":
        return Ok(S.DATAFLOW);
      case "kcfi":
        return Ok(S.KCFI);
      case "kernel-address":
        return Ok(S.KERNELADDRESS);
      case "kernel-hwaddress":
        return Ok(S.KERNELHWADDRESS);
      case "leak":
        return Ok(S.LEAK);
      case "memory":
        return Ok(S.MEMORY);
      case "memtag":
        return Ok(S.MEMTAG);
      case "safestack":
        return Ok(S.SAFESTACK);
      case "shadow-call-stack":
        return Ok(S.SHADOWCALLSTACK);
      case "thread":
        return Ok(S.THREAD);
      case "hwaddress":
        return Ok(S.HWADDRESS);
      case "realtime":
        return Ok(S.REALTIME);
      default:
        return Err(`unknown sanitizer ${s}`);
    }
  },
};

/** `<SanitizerSet as IntoIterator>::into_iter` = bitflags `Iter` (bitflags-2.10.0/src/iter.rs):
 * every contained named flag, then one value with any remaining unnamed bits. */
function iter(self: SanitizerSet): SanitizerSet[] {
  // PORT: bitflags `Iter` is not in src/vendor/bitflags yet; built on its `IterNames`.
  const out: SanitizerSet[] = [];
  const names = IterNames.new(S.FLAGS_DESC, self);
  let next;
  while ((next = names.next()) !== undefined) out.push(next[1]);
  const remaining = names.remaining();
  if (!S.is_empty(remaining)) out.push(S.from_bits_retain(S.bits(remaining)));
  return out;
}

/// Formats a sanitizer set as a comma separated list of sanitizers' names.
// rustc: compiler/rustc_structures/src/sanitizer_set.rs:116 fmt
export function display_SanitizerSet(v: SanitizerSet): string {
  let out = "";
  let first = true;
  for (const s of iter(v)) {
    const name = SanitizerSet.as_str(s) ?? panic(`unrecognized sanitizer ${debug_SanitizerSet(s, { alternate: false })}`);
    if (!first) {
      out += ", ";
    }
    out += name;
    first = false;
  }
  return out;
}

// rustc-skip: compiler/rustc_structures/src/sanitizer_set.rs:154 schema_name schemars::JsonSchema impl (target-spec JSON schema generation; not used by rustc)
// rustc-skip: compiler/rustc_structures/src/sanitizer_set.rs:157 json_schema schemars::JsonSchema impl (target-spec JSON schema generation; not used by rustc)
// rustc-skip: compiler/rustc_structures/src/sanitizer_set.rs:167 deserialize serde::Deserialize impl (target-spec JSON parsing; port with the target-spec loader)
