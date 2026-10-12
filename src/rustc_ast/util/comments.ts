// Port of compiler/rustc_ast/src/util/comments.rs
// Types and derived Debug impls are generated into comments.gen.ts (tools/codegen/types.ts).
import { Symbol } from "../../rustc_span/symbol.ts";
import { is_whitespace } from "../../std/char.ts";
import { utf8_len } from "../../std/str.ts";
import type { CommentKind } from "../token.ts";

export * from "./comments.gen.ts";

/// A fast conservative estimate on whether the string can contain documentation links.
/// A pair of square brackets `[]` must exist in the string, but we only search for the
/// opening bracket because brackets always go in pairs in practice.
// rustc: compiler/rustc_ast/src/util/comments.rs:31 may_have_doc_links
export function may_have_doc_links(s: string): boolean {
  return s.includes("[");
}

/// Makes a doc string more presentable to users.
/// Used by rustdoc and perhaps other tools, but not by rustc.
// rustc: compiler/rustc_ast/src/util/comments.rs:37 beautify_doc_string
export function beautify_doc_string(data: Symbol, kind: CommentKind): Symbol {
  // rustc: compiler/rustc_ast/src/util/comments.rs:38 get_vertical_trim
  function get_vertical_trim(lines: readonly string[]): [number, number] | undefined {
    let i = 0;
    let j = lines.length;
    // first line of all-stars should be omitted
    if (lines.length > 0 && all_chars(lines[0]!, (c) => c === "*")) {
      i += 1;
    }

    // like the first, a last line of all stars should be omitted
    if (j > i && lines[j - 1]!.length !== 0 && all_chars(lines[j - 1]!, (c) => c === "*")) {
      j -= 1;
    }

    if (i !== 0 || j !== lines.length) {
      return [i, j];
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_ast/src/util/comments.rs:54 get_horizontal_trim
  function get_horizontal_trim(lines_: readonly string[], kind: CommentKind): string | undefined {
    // PORT: `usize::MAX`; only compared against char indices and byte lengths.
    let i = Number.MAX_SAFE_INTEGER;
    let first = true;

    // In case we have doc comments like `/**` or `/*!`, we want to remove stars if they are
    // present. However, we first need to strip the empty lines so they don't get in the middle
    // when we try to compute the "horizontal trim".
    let lines: readonly string[];
    switch (kind) {
      case "Block": {
        // Whatever happens, we skip the first line.
        let i = lines_.length > 0 ? (str_trim_start(lines_[0]!).startsWith("*") ? 0 : 1) : 0;
        let j = lines_.length;

        while (i < j && str_trim(lines_[i]!).length === 0) {
          i += 1;
        }
        while (j > i && str_trim(lines_[j - 1]!).length === 0) {
          j -= 1;
        }
        lines = lines_.slice(i, j);
        break;
      }
      case "Line":
        lines = lines_;
        break;
    }

    for (const line of lines) {
      let j = 0;
      for (const c of line) {
        if (j > i || !"* \t".includes(c)) {
          return undefined;
        }
        if (c === "*") {
          if (first) {
            i = j;
            first = false;
          } else if (i !== j) {
            return undefined;
          }
          break;
        }
        j++;
      }
      if (i >= utf8_len(line)) {
        return undefined;
      }
    }
    if (lines.length === 0) return undefined;
    // PORT: `[..i]` is a byte index; the first `i` chars are ASCII (` `/`\t`), so it is also the
    // UTF-16 index.
    return lines[0]!.slice(0, i);
  }

  const data_s = Symbol.as_str(data);
  if (data_s.includes("\n")) {
    const all_lines = str_lines(data_s);
    let changes = false;
    let lines: string[];
    const vt = get_vertical_trim(all_lines);
    if (vt !== undefined) {
      const [i, j] = vt;
      changes = true;
      // remove whitespace-only lines from the start/end of lines
      lines = all_lines.slice(i, j);
    } else {
      lines = all_lines;
    }
    const horizontal = get_horizontal_trim(lines, kind);
    if (horizontal !== undefined) {
      changes = true;
      // remove a "[ \t]*\*" block from each line, if possible
      for (let k = 0; k < lines.length; k++) {
        let line = lines[k]!;
        if (line.startsWith(horizontal)) {
          const tmp = line.slice(horizontal.length);
          line = tmp;
          if (kind === "Block" && (line === "*" || line.startsWith("* ") || line.startsWith("**"))) {
            line = line.slice(1);
          }
          lines[k] = line;
        }
      }
    }
    if (changes) {
      return Symbol.intern(lines.join("\n"));
    }
  }
  return data;
}

// PORT: `str` helpers with Rust semantics (not in src/std yet).

/** `s.chars().all(f)` */
function all_chars(s: string, f: (c: string) => boolean): boolean {
  for (const c of s) {
    if (!f(c)) return false;
  }
  return true;
}

/** `str::lines`: split at `\n`, drop one trailing `\r` before each `\n`, no final empty line. */
function str_lines(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < s.length) {
    const nl = s.indexOf("\n", start);
    if (nl === -1) {
      out.push(s.slice(start));
      break;
    }
    let line = s.slice(start, nl);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    out.push(line);
    start = nl + 1;
  }
  return out;
}

/** `str::trim_start` (Unicode `White_Space`). */
function str_trim_start(s: string): string {
  let i = 0;
  while (i < s.length) {
    const c = s.codePointAt(i)!;
    if (!is_whitespace(c)) break;
    i += c > 0xffff ? 2 : 1;
  }
  return s.slice(i);
}

/** `str::trim` (Unicode `White_Space`). */
function str_trim(s: string): string {
  const t = str_trim_start(s);
  let j = t.length;
  while (j > 0) {
    const lo = t.charCodeAt(j - 1);
    const c = lo >= 0xdc00 && lo <= 0xdfff && j >= 2 ? t.codePointAt(j - 2)! : lo;
    if (!is_whitespace(c)) break;
    j -= c > 0xffff ? 2 : 1;
  }
  return t.slice(0, j);
}
