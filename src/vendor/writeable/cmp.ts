// Port of writeable 0.6.4 `src/cmp.rs`.
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import { utf8 } from "../../std/str.ts";
import { encode_utf8 } from "./impls.ts";
import { FMT_OK, type FmtWrite, type fmt_Result, type Writeable } from "./lib.ts";

/** `core::cmp::Ordering` as -1 / 0 / 1. */
export type Ordering = -1 | 0 | 1;

/** `<[u8] as Ord>::cmp` */
export function cmp_bytes(a: Uint8Array, b: Uint8Array): Ordering {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

class WriteComparator implements FmtWrite {
  constructor(
    public code_units: Uint8Array,
    public result: Ordering,
  ) {}

  /// This is an infallible impl. Functions always return Ok, not Err.
  // crate: writeable-0.6.4/src/cmp.rs:17 write_str
  write_str(other: string): fmt_Result {
    if (this.result !== 0) {
      return FMT_OK;
    }
    const other_bytes = utf8(other);
    // `split_at_checked(other.len()).unwrap_or((self.code_units, &[]))`
    let this_: Uint8Array;
    let remainder: Uint8Array;
    if (other_bytes.length <= this.code_units.length) {
      this_ = this.code_units.subarray(0, other_bytes.length);
      remainder = this.code_units.subarray(other_bytes.length);
    } else {
      this_ = this.code_units;
      remainder = new Uint8Array(0);
    }
    this.code_units = remainder;
    this.result = cmp_bytes(this_, other_bytes);
    return FMT_OK;
  }

  write_char(c: number): fmt_Result {
    return this.write_str(encode_utf8(c));
  }

  // crate: writeable-0.6.4/src/cmp.rs:33 new
  static new(code_units: Uint8Array): WriteComparator {
    return new WriteComparator(code_units, 0);
  }

  // crate: writeable-0.6.4/src/cmp.rs:41 finish
  finish(): Ordering {
    if (this.result === 0 && this.code_units.length !== 0) {
      // Self is longer than Other
      return 1;
    } else {
      return this.result;
    }
  }
}

/// Compares the contents of a [`Writeable`] to the given UTF-8 bytes without allocating memory.
///
/// For more details, see: [`cmp_str`]
// crate: writeable-0.6.4/src/cmp.rs:54 cmp_utf8
export function cmp_utf8(writeable: Writeable, other: Uint8Array): Ordering {
  const wc = WriteComparator.new(other);
  const _ = writeable.write_to(wc);
  return reverse(wc.finish());
}

/// Compares the contents of a `Writeable` to the given bytes
/// without allocating a String to hold the `Writeable` contents.
///
/// This returns a lexicographical comparison, the same as if the Writeable
/// were first converted to a String and then compared with `Ord`. For a
/// string ordering suitable for display to end users, use a localized
/// collation crate, such as `icu_collator`.
// crate: writeable-0.6.4/src/cmp.rs:121 cmp_str
export function cmp_str(writeable: Writeable, other: string): Ordering {
  return cmp_utf8(writeable, utf8(other));
}

/** `Ordering::reverse` */
export function reverse(o: Ordering): Ordering {
  return (-o || 0) as Ordering;
}

export { WriteComparator };

// crate-skip: writeable-0.6.4/src/cmp.rs:135 test_write_char reads tests/data/data.rs (KEBAB_CASE_STRINGS); covered by the oracle test's parent lookups
// crate-skip: writeable-0.6.4/src/cmp.rs:148 test_write_str reads tests/data/data.rs (KEBAB_CASE_STRINGS); covered by the oracle test's parent lookups
// crate-skip: writeable-0.6.4/src/cmp.rs:159 test_mixed reads tests/data/data.rs (KEBAB_CASE_STRINGS); covered by the oracle test's parent lookups
