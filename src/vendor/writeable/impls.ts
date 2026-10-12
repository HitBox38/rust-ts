// Port of writeable 0.6.4 `src/impls.rs` (the `str` / `String` / `&T` / `char` impls).
//
// This file is part of ICU4X. For terms of use, please see the file
// called LICENSE at the top level of the ICU4X source tree
// (online at: https://github.com/unicode-org/icu4x/blob/main/LICENSE ).
//
// PORT: a Rust `str`/`String` is a JS `string`, which cannot carry trait methods; `impl Writeable
// for str` is the `StrWriteable` wrapper class, and `writeable_str(s)` wraps a string. `String`
// and `&T` delegate (`impl_writeable_delegate!`), so they are the same wrapper / the value itself.
import { utf8_len } from "../../std/str.ts";
import {
  type FmtWrite,
  type fmt_Result,
  LengthHint,
  type PartsWrite,
  type Writeable,
  Writeable_write_to_parts,
  Writeable_write_to_string,
} from "./lib.ts";

/** `char::encode_utf8` into a string (a Rust `char` is a Unicode scalar `number`). */
export function encode_utf8(c: number): string {
  return String.fromCodePoint(c);
}

// impl_write_num! (impls.rs:8): integer `Writeable` impls are unused on rustc's path.
// crate-skip: writeable-0.6.4/src/impls.rs:12 write_to macro `impl_write_num!`: integer Writeables unused on rustc's path
// crate-skip: writeable-0.6.4/src/impls.rs:33 writeable_length_hint macro `impl_write_num!`: integer Writeables unused on rustc's path
// crate-skip: writeable-0.6.4/src/impls.rs:39 write_to macro `impl_write_num!`: integer Writeables unused on rustc's path
// crate-skip: writeable-0.6.4/src/impls.rs:46 writeable_length_hint macro `impl_write_num!`: integer Writeables unused on rustc's path

/** `impl Writeable for str` (also `String` via `impl_writeable_delegate!(String, |&self| self.as_str())`). */
export class StrWriteable implements Writeable {
  constructor(readonly s: string) {}

  // crate: writeable-0.6.4/src/impls.rs:100 write_to
  write_to(sink: FmtWrite): fmt_Result {
    return sink.write_str(this.s);
  }

  // crate: writeable-0.6.4/src/impls.rs:105 writeable_length_hint
  writeable_length_hint(): LengthHint {
    return LengthHint.exact(utf8_len(this.s));
  }

  // crate: writeable-0.6.4/src/impls.rs:110 writeable_borrow
  writeable_borrow(): string | undefined {
    return this.s;
  }

  write_to_parts(sink: PartsWrite): fmt_Result {
    return Writeable_write_to_parts(this, sink);
  }

  write_to_string(): string {
    return Writeable_write_to_string(this);
  }
}

// crate-skip: writeable-0.6.4/src/impls.rs:138 write_to_string macro arg of `impl_writeable_delegate!(&T, ..)`: `&T` erases to `T`

/** Wraps a string as a `Writeable` (`impl Writeable for str` / `String` / `&T`). */
export function writeable_str(s: string): StrWriteable {
  return new StrWriteable(s);
}

/** `impl Writeable for char` */
export class CharWriteable implements Writeable {
  constructor(readonly c: number) {}

  // crate: writeable-0.6.4/src/impls.rs:120 write_to
  write_to(sink: FmtWrite): fmt_Result {
    return sink.write_char(this.c);
  }

  // crate: writeable-0.6.4/src/impls.rs:125 writeable_length_hint
  writeable_length_hint(): LengthHint {
    return LengthHint.exact(utf8_len(encode_utf8(this.c)));
  }

  // crate: writeable-0.6.4/src/impls.rs:131 write_to_string
  write_to_string(): string {
    return encode_utf8(this.c);
  }

  write_to_parts(sink: PartsWrite): fmt_Result {
    return Writeable_write_to_parts(this, sink);
  }

  writeable_borrow(): string | undefined {
    return undefined;
  }
}

// impl_write_smart_pointer! (impls.rs:141): `Cow`/`Box`/`Rc`/`Arc` are the value itself in TS.
// crate-skip: writeable-0.6.4/src/impls.rs:146 write_to macro `impl_write_smart_pointer!`: smart pointers erase to the value
// crate-skip: writeable-0.6.4/src/impls.rs:150 write_to_parts macro `impl_write_smart_pointer!`: smart pointers erase to the value
// crate-skip: writeable-0.6.4/src/impls.rs:154 writeable_length_hint macro `impl_write_smart_pointer!`: smart pointers erase to the value
// crate-skip: writeable-0.6.4/src/impls.rs:158 writeable_borrow macro `impl_write_smart_pointer!`: smart pointers erase to the value
// crate-skip: writeable-0.6.4/src/impls.rs:162 write_to_string macro `impl_write_smart_pointer!`: smart pointers erase to the value
