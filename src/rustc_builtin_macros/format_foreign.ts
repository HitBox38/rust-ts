// Port of compiler/rustc_builtin_macros/src/format_foreign.rs
//
// PORT: `&'a str` is a `Str` (byte-offset-indexed). `str_eq_literal` compares the pointer and length of
// two slices; a `Str` slice shares its backing buffer, so pointer equality is "same buffer, same start".
// `#[derive(Clone, Copy)]` on `StrCursor`: every method that takes `mut self` by value works on a copy
// (`clone()`), the `&mut self` ones edit the receiver.
import { len_utf8 } from "../std/char.ts";
import { debug_str, type Debug } from "../std/fmt.ts";
import type { Str } from "../std/str.ts";

export * as printf from "./format_foreign/printf/mod.ts";

export * as shell from "./format_foreign/shell/mod.ts";

export class StrCursor {
  constructor(
    public s: Str,
    public at: number,
  ) {}

  /** `#[derive(Clone, Copy)]` */
  clone(): StrCursor {
    return new StrCursor(this.s, this.at);
  }

  // rustc: compiler/rustc_builtin_macros/src/format_foreign.rs:12 new_at
  static new_at(s: Str, at: number): StrCursor {
    return new StrCursor(s, at);
  }

  // rustc: compiler/rustc_builtin_macros/src/format_foreign.rs:16 at_next_cp
  at_next_cp(): StrCursor | undefined {
    const self = this.clone();
    switch (self.try_seek_right_cp()) {
      case true:
        return self;
      case false:
        return undefined;
    }
  }

  // rustc: compiler/rustc_builtin_macros/src/format_foreign.rs:23 next_cp
  next_cp(): [number, StrCursor] | undefined {
    const self = this.clone();
    const cp = self.cp_after();
    if (cp === undefined) return undefined;
    self.seek_right(len_utf8(cp));
    return [cp, self];
  }

  // rustc: compiler/rustc_builtin_macros/src/format_foreign.rs:29 slice_before
  slice_before(): Str {
    return this.s.slice(0, this.at);
  }

  // rustc: compiler/rustc_builtin_macros/src/format_foreign.rs:33 slice_after
  slice_after(): Str {
    return this.s.slice(this.at);
  }

  // rustc: compiler/rustc_builtin_macros/src/format_foreign.rs:37 slice_between
  slice_between(until: StrCursor): Str | undefined {
    if (!str_eq_literal(this.s, until.s)) {
      return undefined;
    } else {
      const beg = Math.min(this.at, until.at);
      const end = Math.max(this.at, until.at);
      return this.s.slice(beg, end);
    }
  }

  // rustc: compiler/rustc_builtin_macros/src/format_foreign.rs:48 cp_after
  cp_after(): number | undefined {
    return this.slice_after().chars().next();
  }

  // rustc: compiler/rustc_builtin_macros/src/format_foreign.rs:52 try_seek_right_cp
  try_seek_right_cp(): boolean {
    const c = this.slice_after().chars().next();
    if (c !== undefined) {
      this.at += len_utf8(c);
      return true;
    } else {
      return false;
    }
  }

  // rustc: compiler/rustc_builtin_macros/src/format_foreign.rs:62 seek_right
  seek_right(bytes: number): void {
    this.at += bytes;
  }
}

/** `impl std::fmt::Debug for StrCursor<'_>` */
// rustc: compiler/rustc_builtin_macros/src/format_foreign.rs:68 fmt
export const debug_StrCursor: Debug<StrCursor> = (self) =>
  `StrCursor(${debug_str(self.slice_before().toString())} | ${debug_str(self.slice_after().toString())})`;

// rustc: compiler/rustc_builtin_macros/src/format_foreign.rs:73 str_eq_literal
function str_eq_literal(a: Str, b: Str): boolean {
  return a.b === b.b && a.lo === b.lo && a.len() === b.len();
}
