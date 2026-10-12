// Port of writeable 0.6.4 `src/parts_write_adapter.rs` (`CoreWriteAsPartsWrite`).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
import type { FmtWrite, fmt_Result, Part, PartsWrite } from "./lib.ts";

/// A wrapper around a type implementing [`fmt::Write`] that implements [`PartsWrite`].
// #[derive(Debug)]
export class CoreWriteAsPartsWrite implements PartsWrite {
  constructor(public _0: FmtWrite) {}

  // crate: writeable-0.6.4/src/parts_write_adapter.rs:14 write_str
  write_str(s: string): fmt_Result {
    return this._0.write_str(s);
  }

  // crate: writeable-0.6.4/src/parts_write_adapter.rs:19 write_char
  write_char(c: number): fmt_Result {
    return this._0.write_char(c);
  }

  // crate: writeable-0.6.4/src/parts_write_adapter.rs:28 with_part
  with_part(_part: Part, f: (sink: PartsWrite) => fmt_Result): fmt_Result {
    return f(this);
  }
}

// `WithPart<T>` (parts_write_adapter.rs:83) is not ported: unused on rustc's path.
// crate-skip: writeable-0.6.4/src/parts_write_adapter.rs:92 write_to WithPart: unused on rustc's path
// crate-skip: writeable-0.6.4/src/parts_write_adapter.rs:97 write_to_parts WithPart: unused on rustc's path
// crate-skip: writeable-0.6.4/src/parts_write_adapter.rs:102 writeable_length_hint WithPart: unused on rustc's path
// crate-skip: writeable-0.6.4/src/parts_write_adapter.rs:106 writeable_borrow WithPart: unused on rustc's path
// crate-skip: writeable-0.6.4/src/parts_write_adapter.rs:112 write_to_string WithPart: unused on rustc's path
