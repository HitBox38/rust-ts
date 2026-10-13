// Not an upstream mirror. PORT: stand-ins for rustc_target's dependencies that are not ported yet.
//   rustc_structures   SanitizerSet (`pub use rustc_structures::SanitizerSet` in spec/mod.rs; the hir-def
//                      lane ports rustc_structures: replace this by a re-export of its module then)
import type { Debug } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";

/** rustc_structures/src/sanitizer_set.rs:9 `bitflags! SanitizerSet: u16` (values copied). */
export type SanitizerSet = number;
export const SanitizerSet = {
  ADDRESS: 1 << 0,
  LEAK: 1 << 1,
  MEMORY: 1 << 2,
  THREAD: 1 << 3,
  HWADDRESS: 1 << 4,
  CFI: 1 << 5,
  MEMTAG: 1 << 6,
  SHADOWCALLSTACK: 1 << 7,
  KCFI: 1 << 8,
  KERNELADDRESS: 1 << 9,
  KERNELHWADDRESS: 1 << 10,
  SAFESTACK: 1 << 11,
  DATAFLOW: 1 << 12,
  REALTIME: 1 << 13,
  empty: (): SanitizerSet => 0,
  /** `#[derive(Default)]` of the bitflags newtype: no bits. */
  default: (): SanitizerSet => 0,
  /** bitflags `all()` */
  all: (): SanitizerSet => (1 << 14) - 1,
  /** bitflags `contains` */
  contains: (self: SanitizerSet, other: SanitizerSet): boolean => (self & other) === other,
  /** bitflags `iter()`: the named flags contained in `self`, in definition order (then any unknown bits). */
  iter(self: SanitizerSet): SanitizerSet[] {
    const out: SanitizerSet[] = [];
    let rest = self;
    for (let i = 0; i < 14; i++) {
      const f = 1 << i;
      if ((self & f) === f) {
        out.push(f);
        rest &= ~f;
      }
    }
    if (rest !== 0) out.push(rest);
    return out;
  },

  // PORT: the fns below are copied verbatim from rustc_structures/src/sanitizer_set.rs (no markers:
  // the hir-def lane ports rustc_structures; replace this stand-in by its module then).

  /** `const MUTUALLY_EXCLUSIVE` */
  MUTUALLY_EXCLUSIVE: [
    [1 << 0, 1 << 2],
    [1 << 0, 1 << 3],
    [1 << 0, 1 << 4],
    [1 << 0, 1 << 6],
    [1 << 0, 1 << 9],
    [1 << 0, 1 << 10],
    [1 << 0, 1 << 11],
    [1 << 1, 1 << 2],
    [1 << 1, 1 << 3],
    [1 << 1, 1 << 9],
    [1 << 1, 1 << 10],
    [1 << 1, 1 << 11],
    [1 << 2, 1 << 3],
    [1 << 2, 1 << 4],
    [1 << 2, 1 << 9],
    [1 << 2, 1 << 10],
    [1 << 2, 1 << 11],
    [1 << 3, 1 << 4],
    [1 << 3, 1 << 9],
    [1 << 3, 1 << 10],
    [1 << 3, 1 << 11],
    [1 << 4, 1 << 6],
    [1 << 4, 1 << 9],
    [1 << 4, 1 << 10],
    [1 << 4, 1 << 11],
    [1 << 5, 1 << 8],
    [1 << 6, 1 << 9],
    [1 << 6, 1 << 10],
    [1 << 9, 1 << 10],
    [1 << 9, 1 << 11],
    [1 << 10, 1 << 11],
  ] as readonly (readonly [SanitizerSet, SanitizerSet])[],

  /** sanitizer_set.rs `as_str` */
  as_str(self: SanitizerSet): string | undefined {
    switch (self) {
      case 1 << 0:
        return "address";
      case 1 << 5:
        return "cfi";
      case 1 << 12:
        return "dataflow";
      case 1 << 8:
        return "kcfi";
      case 1 << 9:
        return "kernel-address";
      case 1 << 10:
        return "kernel-hwaddress";
      case 1 << 1:
        return "leak";
      case 1 << 2:
        return "memory";
      case 1 << 6:
        return "memtag";
      case 1 << 11:
        return "safestack";
      case 1 << 7:
        return "shadow-call-stack";
      case 1 << 3:
        return "thread";
      case 1 << 4:
        return "hwaddress";
      case 1 << 13:
        return "realtime";
      default:
        return undefined;
    }
  },

  /** sanitizer_set.rs `combine_with_defaults` */
  combine_with_defaults(self: SanitizerSet, defaults: SanitizerSet): SanitizerSet {
    for (const [a, b] of SanitizerSet.MUTUALLY_EXCLUSIVE) {
      if ((defaults & a) === a && (self & b) === b) {
        defaults &= ~a;
      }
      if ((defaults & b) === b && (self & a) === a) {
        defaults &= ~b;
      }
    }
    return self | defaults;
  },

  /** sanitizer_set.rs `impl Display` (comma separated names) */
  display(self: SanitizerSet): string {
    return SanitizerSet.iter(self)
      .map((s) => SanitizerSet.as_str(s) ?? panic(`unrecognized sanitizer ${s}`))
      .join(", ");
  },
} as const;
// PORT: `external_bitflags_debug!` (rustc_data_structures) is not ported.
export const debug_SanitizerSet: Debug<SanitizerSet> = () => unported("rustc_structures::SanitizerSet Debug");

