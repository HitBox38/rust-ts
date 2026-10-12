// Port of fluent-syntax-0.12.0/src/parser/pattern.rs.

import { debug_int, debug_tuple, type Debug } from "../../../std/fmt.ts";
import { unreachable } from "../../../std/panic.ts";
import { Ok } from "../../../std/result.ts";
import * as ast from "../ast/mod.ts";
import { Parser, type Result } from "./core.ts";
import { error, ErrorKind } from "./errors.ts";
import { get_current_byte, get_remaining_bytes } from "./macros.ts";
import { Slice_str } from "./slice.ts";

type TextElementTermination = "LineFeed" | "Crlf" | "PlaceableStart" | "Eof";
const TextElementTermination = { LineFeed: "LineFeed", Crlf: "Crlf", PlaceableStart: "PlaceableStart", Eof: "Eof" } as const;
const debug_TextElementTermination: Debug<TextElementTermination> = (v) => v;

// This enum tracks the placement of the text element in the pattern, which is needed for
// dedentation logic.
type TextElementPosition = "InitialLineStart" | "LineStart" | "Continuation";
const TextElementPosition = { InitialLineStart: "InitialLineStart", LineStart: "LineStart", Continuation: "Continuation" } as const;
const debug_TextElementPosition: Debug<TextElementPosition> = (v) => v;

// PORT: the derived Debug impls of these private enums are never used upstream; ported for completeness.

// This enum allows us to mark pointers in the source which will later become text elements
// but without slicing them out of the source string. This makes the indentation adjustments
// cheaper since they'll happen on the pointers, rather than extracted slices.
type PatternElementPlaceholders =
  | { $: "Placeable"; _0: ast.Expression }
  // (start, end, indent, position)
  | { $: "TextElement"; _0: number; _1: number; _2: number; _3: TextElementPosition };
const debug_PatternElementPlaceholders: Debug<PatternElementPlaceholders> = (v, f) =>
  v.$ === "Placeable"
    ? debug_tuple(f, "Placeable", [ast.debug_Expression(v._0, f)])
    : debug_tuple(f, "TextElement", [debug_int(v._0, f), debug_int(v._1, f), debug_int(v._2, f), debug_TextElementPosition(v._3, f)]);

// This enum tracks whether the text element is blank or not.
// This is important to identify text elements which should not be taken into account
// when calculating common indent.
type TextElementType = "Blank" | "NonBlank";
const TextElementType = { Blank: "Blank", NonBlank: "NonBlank" } as const;
const debug_TextElementType: Debug<TextElementType> = (v) => v;

declare module "./core.ts" {
  interface Parser {
    get_pattern(): Result<ast.Pattern | undefined>;
    get_text_slice(): Result<[number, number, TextElementType, TextElementTermination]>;
  }
}

// crate: fluent-syntax-0.12.0/src/parser/pattern.rs:45 get_pattern
Parser.prototype.get_pattern = function (this: Parser): Result<ast.Pattern | undefined> {
  const elements: PatternElementPlaceholders[] = [];
  let last_non_blank: number | undefined = undefined;
  let common_indent: number | undefined = undefined;

  this.skip_blank_inline();

  let text_element_role: TextElementPosition;
  if (this.skip_eol()) {
    this.skip_blank_block();
    text_element_role = TextElementPosition.LineStart;
  } else {
    text_element_role = TextElementPosition.InitialLineStart;
  }

  while (this.ptr < this.length) {
    if (this.take_byte_if(0x7b /* b'{' */)) {
      if (text_element_role === TextElementPosition.LineStart) {
        common_indent = 0;
      }
      const exp = this.get_placeable();
      if (exp.$ === "Err") return exp;
      last_non_blank = elements.length;
      elements.push({ $: "Placeable", _0: exp._0 });
      text_element_role = TextElementPosition.Continuation;
    } else {
      const slice_start = this.ptr;
      let indent = 0;
      if (text_element_role === TextElementPosition.LineStart) {
        indent = this.skip_blank_inline();
        const b = get_current_byte(this);
        if (b !== undefined) {
          if (indent === 0) {
            if (b !== 0x0d /* b'\r' */ && b !== 0x0a /* b'\n' */) {
              break;
            }
          } else if (!Parser.is_byte_pattern_continuation(b)) {
            this.ptr = slice_start;
            break;
          }
        } else {
          break;
        }
      }
      const slice_r = this.get_text_slice();
      if (slice_r.$ === "Err") return slice_r;
      const [start, end, text_element_type, termination_reason] = slice_r._0;
      if (start !== end) {
        if (text_element_role === TextElementPosition.LineStart && text_element_type === TextElementType.NonBlank) {
          const common = common_indent;
          if (common !== undefined) {
            if (indent < common) {
              common_indent = indent;
            }
          } else {
            common_indent = indent;
          }
        }
        if (
          text_element_role !== TextElementPosition.LineStart ||
          text_element_type === TextElementType.NonBlank ||
          termination_reason === TextElementTermination.LineFeed
        ) {
          if (text_element_type === TextElementType.NonBlank) {
            last_non_blank = elements.length;
          }
          elements.push({ $: "TextElement", _0: slice_start, _1: end, _2: indent, _3: text_element_role });
        }
      }

      switch (termination_reason) {
        case "LineFeed":
          text_element_role = TextElementPosition.LineStart;
          break;
        case "Crlf":
          text_element_role = TextElementPosition.LineStart;
          break;
        case "PlaceableStart":
          text_element_role = TextElementPosition.Continuation;
          break;
        case "Eof":
          text_element_role = TextElementPosition.Continuation;
          break;
      }
    }
  }

  if (last_non_blank !== undefined) {
    // PORT: `.into_iter().take(last_non_blank + 1).enumerate().map(..).collect()`
    const out: ast.PatternElement[] = [];
    for (let i = 0; i < elements.length && i < last_non_blank + 1; i++) {
      const elem = elements[i]!;
      if (elem.$ === "Placeable") {
        const expression = elem._0;
        out.push({ $: "Placeable", expression });
      } else {
        let start = elem._0;
        const end = elem._1;
        const indent = elem._2;
        const role = elem._3;
        if (role === TextElementPosition.LineStart) {
          start = common_indent === undefined ? start + indent : start + Math.min(indent, common_indent);
        }
        let value = Slice_str.slice(this.source, start, end);
        if (last_non_blank === i) {
          value = Slice_str.trim(value);
        }
        out.push({ $: "TextElement", value });
      }
    }
    return Ok({ elements: out });
  }

  return Ok(undefined);
};

// PORT: `memchr::memchr3(n1, n2, n3, haystack)` → a plain byte search (first index of any needle).
function memchr3(n1: number, n2: number, n3: number, haystack: Uint8Array): number | undefined {
  for (let i = 0; i < haystack.length; i++) {
    const c = haystack[i]!;
    if (c === n1 || c === n2 || c === n3) return i;
  }
  return undefined;
}

// crate: fluent-syntax-0.12.0/src/parser/pattern.rs:156 get_text_slice
Parser.prototype.get_text_slice = function (this: Parser): Result<[number, number, TextElementType, TextElementTermination]> {
  const start_pos = this.ptr;
  const rest = get_remaining_bytes(this);
  if (rest === undefined) {
    return Ok([start_pos, this.ptr, TextElementType.Blank, TextElementTermination.Eof]);
  }
  const end = memchr3(0x0a /* b'\n' */, 0x7b /* b'{' */, 0x7d /* b'}' */, rest);
  const element_type = (text: Uint8Array): TextElementType => {
    if (text.some((c) => c !== 0x20 /* b' ' */)) {
      return TextElementType.NonBlank;
    } else {
      return TextElementType.Blank;
    }
  };
  // PORT: `match end.map(|p| &rest[..=p])` with slice patterns, arms in upstream order.
  if (end !== undefined) {
    const s = rest.subarray(0, end + 1);
    const last = s[s.length - 1];
    if (last === 0x7d /* [text @ .., b'}'] */) {
      const text = s.subarray(0, s.length - 1);
      this.ptr += text.length;
      return error(ErrorKind.UnbalancedClosingBrace, this.ptr);
    } else if (s.length >= 2 && s[s.length - 2] === 0x0d && last === 0x0a /* [text @ .., b'\r', b'\n'] */) {
      const text = s.subarray(0, s.length - 2);
      this.ptr += text.length + 1;
      return Ok([start_pos, this.ptr - 1, element_type(text), TextElementTermination.Crlf]);
    } else if (last === 0x0a /* [text @ .., b'\n'] */) {
      const text = s.subarray(0, s.length - 1);
      this.ptr += text.length + 1;
      return Ok([start_pos, this.ptr, element_type(text), TextElementTermination.LineFeed]);
    } else if (last === 0x7b /* [text @ .., b'{'] */) {
      const text = s.subarray(0, s.length - 1);
      this.ptr += text.length;
      return Ok([start_pos, this.ptr, element_type(text), TextElementTermination.PlaceableStart]);
    } else {
      unreachable();
    }
  } else {
    this.ptr += rest.length;
    return Ok([start_pos, this.ptr, element_type(rest), TextElementTermination.Eof]);
  }
};
