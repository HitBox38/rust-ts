// Port of compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs
//
// PORT: the input is a `Str` (byte offsets); the `&'a str` of `Substitution::Name` is converted to
// `string` where it is produced. The tail returned by `parse_next_substitution` stays a `Str`.
import { InnerSpan } from "../../../rustc_span/lib.ts";
import { is_ascii_alphabetic, is_ascii_alphanumeric } from "../../../std/char.ts";
import { type Debug, debug_int, debug_str, debug_tuple } from "../../../std/fmt.ts";
import { Err, Ok, type Result } from "../../../std/result.ts";
import type { Str } from "../../../std/str.ts";
import { StrCursor as Cur } from "../../format_foreign.ts";

export type Substitution =
  | { readonly $: "Ordinal"; _0: number; _1: [number, number] }
  | { readonly $: "Name"; _0: string; _1: [number, number] }
  | { readonly $: "Escape"; _0: [number, number] };

/** `#[derive(Debug)]` */
export const debug_Substitution: Debug<Substitution> = (v, f) => {
  const pos = (p: [number, number]): string => debug_tuple(f, "", [debug_int(p[0], f), debug_int(p[1], f)]);
  switch (v.$) {
    case "Ordinal":
      return debug_tuple(f, "Ordinal", [debug_int(v._0, f), pos(v._1)]);
    case "Name":
      return debug_tuple(f, "Name", [debug_str(v._0), pos(v._1)]);
    case "Escape":
      return debug_tuple(f, "Escape", [pos(v._0)]);
  }
};

export const Substitution = {
  /** `impl ToString for Substitution<'_>` */
  // rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs:13 to_string
  to_string(self: Substitution): string {
    switch (self.$) {
      case "Ordinal":
        return `$${self._0}`;
      case "Name":
        return `$${self._0}`;
      case "Escape":
        return "$$";
    }
  },

  // rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs:23 position
  position(self: Substitution): InnerSpan {
    const pos = self.$ === "Escape" ? self._0 : self._1;
    return InnerSpan.new(pos[0], pos[1]);
  },

  // rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs:28 set_position
  set_position(self: Substitution, start: number, end: number): void {
    if (self.$ === "Escape") {
      self._0 = [start, end];
    } else {
      self._1 = [start, end];
    }
  },

  // rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs:33 translate
  translate(self: Substitution): Result<string, string | undefined> {
    switch (self.$) {
      case "Ordinal":
        return Ok(`{${self._0}}`);
      case "Name":
        return Ok(`{${self._0}}`);
      case "Escape":
        return Err(undefined);
    }
  },
};

/// Returns an iterator over all substitutions in a given string.
// rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs:43 iter_subs
export function iter_subs(s: Str, start_pos: number): Substitutions {
  return new Substitutions(s, start_pos);
}

/// Iterator over substitutions in a string.
export class Substitutions {
  constructor(
    public s: Str,
    public pos: number,
  ) {}

  // rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs:55 next
  next(): Substitution | undefined {
    const r = parse_next_substitution(this.s);
    if (r === undefined) return undefined;
    const [sub, tail] = r;
    this.s = tail;
    const { start, end } = Substitution.position(sub);
    Substitution.set_position(sub, start + this.pos, end + this.pos);
    this.pos += end;
    return sub;
  }

  // rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs:64 size_hint
  size_hint(): [number, number | undefined] {
    return [0, this.s.len()];
  }

  *[globalThis.Symbol.iterator](): Generator<Substitution> {
    for (let s = this.next(); s !== undefined; s = this.next()) yield s;
  }
}

/// Parse the next substitution from the input string.
// rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs:70 parse_next_substitution
export function parse_next_substitution(s: Str): [Substitution, Str] | undefined {
  let at_: Cur;
  {
    const start = s.find("$");
    if (start === undefined) return undefined;
    const c = s.slice(start + 1).chars().next();
    if (c === undefined) return undefined;
    if (c === 0x24 /* '$' */) {
      return [{ $: "Escape", _0: [start, start + 2] }, s.slice(start + 2)];
    } else if (c >= 0x30 /* '0' */ && c <= 0x39 /* '9' */) {
      const n = c - 0x30; /* b'0' */
      return [{ $: "Ordinal", _0: n, _1: [start, start + 2] }, s.slice(start + 2)];
    } else {
      /* fall-through */
    }

    at_ = Cur.new_at(s, start);
  }

  const at = at_.at_next_cp();
  if (at === undefined) return undefined;
  const r = at.next_cp();
  if (r === undefined) return undefined;
  const [c, inner] = r;

  if (!is_ident_head(c)) {
    return undefined;
  } else {
    const end = at_next_cp_while(inner, is_ident_tail);
    const slice = at.slice_between(end)!;
    const start = at.at - 1;
    const end_pos = at.at + slice.len();
    return [{ $: "Name", _0: slice.toString(), _1: [start, end_pos] }, end.slice_after()];
  }
}

// rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs:99 at_next_cp_while
function at_next_cp_while(cur: Cur, pred: (c: number) => boolean): Cur {
  for (;;) {
    const r = cur.next_cp();
    if (r !== undefined && pred(r[0])) {
      cur = r[1];
    } else {
      return cur;
    }
  }
}

// rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs:113 is_ident_head
function is_ident_head(c: number): boolean {
  return is_ascii_alphabetic(c) || c === 0x5f /* '_' */;
}

// rustc: compiler/rustc_builtin_macros/src/format_foreign/shell/mod.rs:117 is_ident_tail
function is_ident_tail(c: number): boolean {
  return is_ascii_alphanumeric(c) || c === 0x5f /* '_' */;
}
