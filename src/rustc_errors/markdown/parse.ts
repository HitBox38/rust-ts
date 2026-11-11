// Port of compiler/rustc_errors/src/markdown/parse.rs.
// PORT: the parser's `&'a [u8]` buffers are `Uint8Array` views (`subarray`, so `wip_buf.len() - loop_buf.len()` is
// still the consumed length); the `&'a str` it hands to `MdTree` are JS strings (see mod.ts). The `str` methods
// used on them (`trim`, `trim_end`, `ends_with(char::is_whitespace)`, ...) follow Rust's `char::is_whitespace`,
// not JS's `trim`: `trim`/`trim_end` and `parse::<u16>` are src/std's (`string_trim*`, num.ts), the pattern forms
// (`trim_matches('\n')`, `{starts,ends}_with(char::is_whitespace)`) and the `[u8]` ones are at the end of this file.
// PORT: the private fns and consts upstream's `tests` child module uses are exported for tests/parse.test.ts.
import { is_whitespace } from "../../std/char.ts";
import { panic, unreachable } from "../../std/panic.ts";
import { u16_from_str } from "../../std/num.ts";
import { from_utf8, string_trim, string_trim_end, utf8 } from "../../std/str.ts";
import { MdStream, MdTree } from "./mod.ts";

/// Short aliases that we can use in match patterns. If an end pattern is not
/// included, this type may be variable
const ANC_E: Uint8Array = utf8(">");
const ANC_S: Uint8Array = utf8("<");
const BRK: Uint8Array = utf8("---");
const CBK: Uint8Array = utf8("```");
const CIL: Uint8Array = utf8("`");
export const CMT_E: Uint8Array = utf8("-->");
export const CMT_S: Uint8Array = utf8("<!--");
const EMP_U: Uint8Array = utf8("_");
const EMP_A: Uint8Array = utf8("*");
const HDG: Uint8Array = utf8("#");
const LNK_CHARS: string = "$-_.+!*'()/&?=:%";
const LNK_E: Uint8Array = utf8("]");
const LNK_S: Uint8Array = utf8("[");
const STG_U: Uint8Array = utf8("__");
const STG_A: Uint8Array = utf8("**");
const STK: Uint8Array = utf8("~~");

/// Pattern replacements
const REPLACEMENTS: readonly (readonly [string, string])[] = [
  ["(c)", "©"],
  ["(C)", "©"],
  ["(r)", "®"],
  ["(R)", "®"],
  ["(tm)", "™"],
  ["(TM)", "™"],
  [":crab:", "🦀"],
  ["\n", " "],
];

/// `(extracted, remaining)`
type Parsed = [MdTree, Uint8Array];
/// Output of a parse function
type ParseResult = Parsed | undefined;

/// Parsing context
// #[derive(Clone, Copy, Debug, PartialEq)]
// The default values are the most common setting for non top-level parsing: not top block, not at
// line start (yes leading whitespace, not escaped).
interface Context {
  /// If true, we are at a the topmost level (not recursing a nested tt)
  readonly top_block: boolean; // = false
  /// Previous character
  readonly prev: Prev; // = Prev::Whitespace
}

/** `Context { .. }` (the default field values) */
const CONTEXT_DEFAULT: Context = { top_block: false, prev: "Whitespace" };

/// Character class preceding this one
// #[derive(Clone, Copy, Debug, PartialEq)]
type Prev =
  | "Newline"
  /// Whitespace that is not a newline
  | "Whitespace"
  | "Escape"
  | "Any";

/// Flags to simple parser function
// #[derive(Clone, Copy, Debug, PartialEq)]
export type ParseOpt =
  /// Ignore escapes before closing pattern, trim content
  | "TrimNoEsc"
  | "None";

/// Parse a buffer
// rustc: compiler/rustc_errors/src/markdown/parse.rs:71 entrypoint
export function entrypoint(txt: string): MdStream {
  const ctx: Context = { top_block: true, prev: "Newline" };
  return normalize(parse_recursive(utf8(string_trim(txt)), ctx), []);
}

/// Parse a buffer with specified context
// rustc: compiler/rustc_errors/src/markdown/parse.rs:77 parse_recursive
function parse_recursive(buf: Uint8Array, ctx: Context): MdStream {
  // use ParseOpt as Po;
  // use Prev::{Escape, Newline, Whitespace};

  const stream: MdTree[] = [];
  const top_blk = ctx.top_block;
  let prev = ctx.prev;

  // wip_buf is our entire unprocessed (unpushed) buffer, loop_buf is our to
  // check buffer that shrinks with each loop
  let wip_buf = buf;
  let loop_buf = wip_buf;

  while (loop_buf.length !== 0) {
    const x = loop_buf[0]!;
    const next_prev: Prev = x === 0x0a ? "Newline" : x === 0x5c ? "Escape" : u8_is_ascii_whitespace(x) ? "Whitespace" : "Any";

    // PORT: the `match (top_blk, prev)` arms in order; a guard that fails falls through to the next arm.
    let res: ParseResult;
    if (starts_with(loop_buf, CMT_S)) {
      res = parse_simple_pat(loop_buf, CMT_S, CMT_E, "TrimNoEsc", MdTree.Comment);
    } else if (top_blk && prev === "Newline" && starts_with(loop_buf, CBK)) {
      res = parse_codeblock(loop_buf);
    } else if (starts_with(loop_buf, CIL)) {
      res = parse_codeinline(loop_buf);
    } else if (top_blk && (prev === "Newline" || prev === "Whitespace") && starts_with(loop_buf, HDG)) {
      res = parse_heading(loop_buf);
    } else if (top_blk && prev === "Newline" && starts_with(loop_buf, BRK)) {
      res = [MdTree.HorizontalRule, parse_to_newline(loop_buf)[1]];
    } else if (prev === "Newline" && unordered_list_start(loop_buf)) {
      res = parse_unordered_li(loop_buf);
    } else if ((prev === "Newline" || prev === "Whitespace") && starts_with(loop_buf, STG_U)) {
      res = parse_simple_pat(loop_buf, STG_U, STG_U, "None", MdTree.Strong);
    } else if (starts_with(loop_buf, STG_A)) {
      res = parse_simple_pat(loop_buf, STG_A, STG_A, "None", MdTree.Strong);
    } else if ((prev === "Newline" || prev === "Whitespace") && starts_with(loop_buf, EMP_U)) {
      res = parse_simple_pat(loop_buf, EMP_U, EMP_U, "None", MdTree.Emphasis);
    } else if (starts_with(loop_buf, EMP_A)) {
      res = parse_simple_pat(loop_buf, EMP_A, EMP_A, "None", MdTree.Emphasis);
    } else if (starts_with(loop_buf, STK)) {
      res = parse_simple_pat(loop_buf, STK, STK, "None", MdTree.Strikethrough);
    } else if ((prev === "Newline" || prev === "Whitespace") && starts_with(loop_buf, ANC_S)) {
      const tt_fn = (link: string): MdTree => ({ $: "Link", disp: link, link });
      const ret = parse_simple_pat(loop_buf, ANC_S, ANC_E, "None", tt_fn);
      if (ret !== undefined && ret[0].$ === "Link" && chars_all(ret[0].disp, (ch) => LNK_CHARS.includes(ch))) {
        res = ret;
      } else {
        res = undefined;
      }
    } else if (prev === "Newline" && ord_list_start(loop_buf) !== undefined) {
      res = parse_ordered_li(loop_buf);
    } else if (starts_with(loop_buf, LNK_S)) {
      res = parse_any_link(loop_buf, top_blk && prev === "Newline");
    } else {
      // (_, Escape | _) => None,
      res = undefined;
    }

    if (res !== undefined) {
      const [tree, rest] = res;
      // We found something: push our WIP and then push the found tree
      const prev_buf = wip_buf.subarray(0, wip_buf.length - loop_buf.length);
      if (prev_buf.length !== 0) {
        const prev_str = from_utf8_unwrap(prev_buf);
        stream.push(MdTree.PlainText(prev_str));
      }
      stream.push(tree);

      wip_buf = rest;
      loop_buf = rest;
    } else {
      // Just move on to the next character
      loop_buf = loop_buf.subarray(1);
      // If we are at the end and haven't found anything, just push plain text
      if (loop_buf.length === 0 && wip_buf.length !== 0) {
        const final_str = from_utf8_unwrap(wip_buf);
        stream.push(MdTree.PlainText(final_str));
      }
    }

    prev = next_prev;
  }

  return new MdStream(stream);
}

/// The simplest kind of patterns: data within start and end patterns
// rustc: compiler/rustc_errors/src/markdown/parse.rs:170 parse_simple_pat
export function parse_simple_pat(buf: Uint8Array, start_pat: Uint8Array, end_pat: Uint8Array, opts: ParseOpt, create_tt: (txt: string) => MdTree): ParseResult {
  const ignore_esc = opts === "TrimNoEsc";
  const trim = opts === "TrimNoEsc";
  const r = parse_with_end_pat(slice_from(buf, start_pat.length), end_pat, ignore_esc);
  if (r === undefined) return undefined;
  const [txt_, rest] = r;
  let txt = from_utf8_unwrap(txt_);
  if (trim) {
    txt = string_trim(txt);
  }
  return [create_tt(txt), rest];
}

/// Parse backtick-wrapped inline code. Accounts for >1 backtick sets
// rustc: compiler/rustc_errors/src/markdown/parse.rs:191 parse_codeinline
export function parse_codeinline(buf: Uint8Array): ParseResult {
  const seps = take_while_count(buf, (ch) => ch === 0x60);
  const r = parse_with_end_pat(buf.subarray(seps), buf.subarray(0, seps), true);
  if (r === undefined) return undefined;
  const [txt, rest] = r;
  return [MdTree.CodeInline(from_utf8_unwrap(txt)), rest];
}

/// Parse a codeblock. Accounts for >3 backticks and language specification
// rustc: compiler/rustc_errors/src/markdown/parse.rs:198 parse_codeblock
export function parse_codeblock(buf: Uint8Array): Parsed {
  // account for ````code```` style
  const seps = take_while_count(buf, (ch) => ch === 0x60);
  const end_sep = buf.subarray(0, seps);
  let working = buf.subarray(seps);

  // Handle "````rust" style language specifications
  const next_ws_idx = take_while_count(working, (ch) => !u8_is_ascii_whitespace(ch));

  let lang: string | undefined;
  if (next_ws_idx > 0) {
    // Munch the lang
    const tmp = from_utf8_unwrap(working.subarray(0, next_ws_idx));
    working = working.subarray(next_ws_idx);
    lang = tmp;
  } else {
    lang = undefined;
  }

  const end_pat = new Uint8Array(1 + end_sep.length);
  end_pat[0] = 0x0a;
  end_pat.set(end_sep, 1);

  // Find first end pattern with nothing else on its line
  let found: [Uint8Array, Uint8Array] | undefined;
  for (let idx = 0; idx < working.length; idx++) {
    if (!starts_with(working.subarray(idx), end_pat)) continue;
    const [eol_txt, rest] = parse_to_newline(slice_from(working, idx + end_pat.length));
    if (eol_txt.every(u8_is_ascii_whitespace)) {
      found = [working.subarray(0, idx), rest];
      break;
    }
  }

  const [txt_, rest] = found ?? [working, new Uint8Array(0)];
  const txt = str_trim_matches_newline(from_utf8_unwrap(txt_));

  return [{ $: "CodeBlock", txt, lang }, rest];
}

// rustc: compiler/rustc_errors/src/markdown/parse.rs:235 parse_heading
export function parse_heading(buf_: Uint8Array): ParseResult {
  const level = take_while_count(buf_, (ch) => ch === 0x23);
  const buf = buf_.subarray(level);

  if (level > 6 || (buf.length > 1 && !u8_is_ascii_whitespace(buf[0]!))) {
    // Enforce max 6 levels and whitespace following the `##` pattern
    return undefined;
  }

  const [txt, rest] = parse_to_newline(slice_from(buf, 1));
  const ctx: Context = CONTEXT_DEFAULT;
  const stream = parse_recursive(txt, ctx);

  // `level.try_into().unwrap()` (u8): level <= 6 here.
  return [{ $: "Heading", _0: level, _1: stream }, rest];
}

/// Bulleted list
// rustc: compiler/rustc_errors/src/markdown/parse.rs:252 parse_unordered_li
export function parse_unordered_li(buf: Uint8Array): Parsed {
  const [txt, rest] = get_indented_section(slice_from(buf, 2));
  const ctx: Context = CONTEXT_DEFAULT;
  const stream = parse_recursive(trim_ascii_start(txt), ctx);
  return [{ $: "UnorderedListItem", _0: stream }, rest];
}

/// Numbered list
// rustc: compiler/rustc_errors/src/markdown/parse.rs:260 parse_ordered_li
export function parse_ordered_li(buf: Uint8Array): Parsed {
  const r = ord_list_start(buf); // success tested in caller
  if (r === undefined) return panic("called `Option::unwrap()` on a `None` value");
  const [num, pos] = r;
  const [txt, rest] = get_indented_section(slice_from(buf, pos));
  const ctx: Context = CONTEXT_DEFAULT;
  const stream = parse_recursive(trim_ascii_start(txt), ctx);
  return [{ $: "OrderedListItem", _0: num, _1: stream }, rest];
}

// rustc: compiler/rustc_errors/src/markdown/parse.rs:268 get_indented_section
export function get_indented_section(buf: Uint8Array): [Uint8Array, Uint8Array] {
  const lines = split_byte(buf, 0x0a);
  // `lines.next().map_or(0, |line| line.len())`: a slice split always yields a first item.
  let end = lines[0]!.length;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > 0) {
      const first = line[0]!;
      if (unordered_list_start(line) || !u8_is_ascii_whitespace(first)) {
        break;
      }
    }
    end += line.length + 1;
  }

  return [buf.subarray(0, end), buf.subarray(end)];
}

// rustc: compiler/rustc_errors/src/markdown/parse.rs:283 unordered_list_start
function unordered_list_start(buf_: Uint8Array): boolean {
  let buf = buf_;
  while (buf.length > 0 && buf[0] === 0x20) {
    buf = buf.subarray(1);
  }
  return buf.length >= 2 && (buf[0] === 0x2a || buf[0] === 0x2d) && buf[1] === 0x20;
}

/// Verify a valid ordered list start (e.g. `1.`) and parse it. Returns the
/// parsed number and offset of character after the dot.
// rustc: compiler/rustc_errors/src/markdown/parse.rs:292 ord_list_start
function ord_list_start(buf: Uint8Array): [number, number] | undefined {
  const pos = buf.subarray(0, 10).indexOf(0x2e);
  if (pos < 0) return undefined;
  const n = from_utf8(buf.subarray(0, pos));
  if (n.$ === "Err") return undefined;
  const next = buf[pos + 1];
  if (next === undefined) return undefined;
  if (!u8_is_ascii_whitespace(next)) {
    return undefined;
  }
  const v = u16_from_str(n._0);
  return v.$ === "Err" ? undefined : [v._0, pos + 2];
}

/// Parse links. `can_be_def` indicates that a link definition is possible (top
/// level, located at the start of a line)
// rustc: compiler/rustc_errors/src/markdown/parse.rs:303 parse_any_link
export function parse_any_link(buf: Uint8Array, can_be_def: boolean): ParseResult {
  const r = parse_with_end_pat(slice_from(buf, 1), LNK_E, true);
  if (r === undefined) return undefined;
  const [bracketed, rest] = r;
  if (rest.length === 0) {
    return undefined;
  }

  const disp = from_utf8_unwrap(bracketed);
  const c = rest[0]!;
  if (can_be_def && c === 0x3a) {
    const [link_, tmp] = parse_to_newline(rest.subarray(1));
    const link = string_trim(from_utf8_unwrap(link_));
    return [{ $: "LinkDef", id: disp, link }, tmp];
  } else if (c === 0x28) {
    return parse_simple_pat(rest, utf8("("), utf8(")"), "TrimNoEsc", (link) => ({ $: "Link", disp, link }));
  } else if (c === 0x5b) {
    return parse_simple_pat(rest, utf8("["), utf8("]"), "TrimNoEsc", (id) => ({ $: "RefLink", disp, id }));
  } else {
    return [{ $: "RefLink", disp, id: undefined }, rest];
  }
}

/// Find and consume an end pattern, return `(match, residual)`
// rustc: compiler/rustc_errors/src/markdown/parse.rs:328 parse_with_end_pat
function parse_with_end_pat(buf: Uint8Array, end_sep: Uint8Array, ignore_esc: boolean): [Uint8Array, Uint8Array] | undefined {
  // Find positions that start with the end separator
  for (let idx = 0; idx < buf.length; idx++) {
    if (!starts_with(buf.subarray(idx), end_sep)) continue;
    if (!ignore_esc && idx > 0 && buf[idx - 1] === 0x5c) {
      continue;
    }
    return [buf.subarray(0, idx), buf.subarray(idx + end_sep.length)];
  }
  return undefined;
}

/// Return `(match, residual)` to end of line. The EOL is returned with the
/// residual.
// rustc: compiler/rustc_errors/src/markdown/parse.rs:345 parse_to_newline
function parse_to_newline(buf: Uint8Array): [Uint8Array, Uint8Array] {
  const pos = buf.indexOf(0x0a);
  return pos < 0 ? [buf, new Uint8Array(0)] : [buf.subarray(0, pos), buf.subarray(pos)];
}

/// Take a parsed stream and fix the little things
// rustc: compiler/rustc_errors/src/markdown/parse.rs:350 normalize
function normalize(stream_: MdStream, linkdefs: MdTree[]): MdStream {
  const stream = stream_._0;
  let new_stream: MdTree[] = [];
  const new_defs = stream.filter((tt) => tt.$ === "LinkDef");
  linkdefs.push(...new_defs);

  // Run plaintext expansions on types that need it, call this function on nested types
  for (const item of stream) {
    switch (item.$) {
      case "PlainText":
        expand_plaintext(item._0, new_stream, MdTree.PlainText);
        break;
      case "Strong":
        expand_plaintext(item._0, new_stream, MdTree.Strong);
        break;
      case "Emphasis":
        expand_plaintext(item._0, new_stream, MdTree.Emphasis);
        break;
      case "Strikethrough": {
        expand_plaintext(item._0, new_stream, MdTree.Strikethrough);
        break;
      }
      case "RefLink":
        new_stream.push(match_reflink(linkdefs, item.disp, item.id));
        break;
      case "OrderedListItem": {
        new_stream.push({ $: "OrderedListItem", _0: item._0, _1: normalize(item._1, linkdefs) });
        break;
      }
      case "UnorderedListItem": {
        new_stream.push({ $: "UnorderedListItem", _0: normalize(item._0, linkdefs) });
        break;
      }
      case "Heading":
        new_stream.push({ $: "Heading", _0: item._0, _1: normalize(item._1, linkdefs) });
        break;
      default:
        new_stream.push(item);
    }
  }

  // Remove non printing types, duplicate paragraph breaks, and breaks at start/end
  new_stream = new_stream.filter((x) => !(x.$ === "Comment" || x.$ === "LinkDef"));
  new_stream = new_stream.filter((x, i) => i === 0 || !(x.$ === "ParagraphBreak" && new_stream[i - 1]!.$ === "ParagraphBreak"));

  if (new_stream.length > 0 && is_break_ty(new_stream[0]!)) {
    new_stream.splice(0, 1);
  }
  if (new_stream.length > 0 && is_break_ty(new_stream[new_stream.length - 1]!)) {
    new_stream.pop();
  }

  // Remove paragraph breaks that shouldn't be there. w[1] is what will be
  // removed in these cases. Note that these are the items to keep, not delete
  // (for `retain`)
  const to_keep: boolean[] = [];
  for (let i = 0; i + 3 <= new_stream.length; i++) {
    const w0 = new_stream[i]!;
    const w1 = new_stream[i + 1]!;
    const w2 = new_stream[i + 2]!;
    to_keep.push(
      !(
        (w1.$ === "ParagraphBreak" && matches_always1_or_never(should_break(w0, w2))) ||
        (w1.$ === "PlainText" && string_trim(w1._0) === "" && matches_always_or_never(should_break(w0, w2)))
      ),
    );
  }
  const keep = [true, ...to_keep, true];
  new_stream = new_stream.filter((_, i) => {
    const k = keep[i];
    if (k === undefined) return panic("called `Option::unwrap()` on a `None` value");
    return k;
  });

  // Insert line or paragraph breaks where there should be some
  let insertions = 0;
  const to_insert: [number, MdTree][] = [];
  for (let idx = 0; idx + 2 <= new_stream.length; idx++) {
    const r = should_break(new_stream[idx]!, new_stream[idx + 1]!);
    let tt: MdTree | undefined;
    if (r.$ === "Always" && r._0 === 1) tt = MdTree.LineBreak;
    else if (r.$ === "Always" && r._0 === 2) tt = MdTree.ParagraphBreak;
    else tt = undefined;
    if (tt !== undefined) {
      insertions += 1;
      to_insert.push([idx + insertions, tt]);
    }
  }
  for (const [idx, tt] of to_insert) new_stream.splice(idx, 0, tt);

  return new MdStream(new_stream);
}

/** `matches!(r, BreakRule::Always(1) | BreakRule::Never)` */
function matches_always1_or_never(r: BreakRule): boolean {
  return (r.$ === "Always" && r._0 === 1) || r.$ === "Never";
}

/** `matches!(r, BreakRule::Always(_) | BreakRule::Never)` */
function matches_always_or_never(r: BreakRule): boolean {
  return r.$ === "Always" || r.$ === "Never";
}

/// Whether two types should or shouldn't have a paragraph break between them
// #[derive(Clone, Copy, Debug, PartialEq)]
type BreakRule = { readonly $: "Always"; readonly _0: number } | { readonly $: "Never" } | { readonly $: "Optional" };

const BreakRule = {
  Never: Object.freeze({ $: "Never" }) as BreakRule,
  Optional: Object.freeze({ $: "Optional" }) as BreakRule,
  Always: (_0: number): BreakRule => ({ $: "Always", _0 }),
} as const;

/** `#[derive(PartialEq)]` of `BreakRule` */
function BreakRule_eq(a: BreakRule, b: BreakRule): boolean {
  return a.$ === b.$ && (a.$ !== "Always" || a._0 === (b as { _0: number })._0);
}

/** The text types of `should_break`'s last regular arm. */
function is_text_ty(tt: MdTree): boolean {
  switch (tt.$) {
    case "CodeInline":
    case "Strong":
    case "Emphasis":
    case "Strikethrough":
    case "PlainText":
    case "Link":
    case "RefLink":
    case "LinkDef":
      return true;
    default:
      return false;
  }
}

/// Blocks that automatically handle their own text wrapping
// rustc: compiler/rustc_errors/src/markdown/parse.rs:434 should_break
function should_break(left: MdTree, right: MdTree): BreakRule {
  // use MdTree::*;

  const l = left.$;
  const r = right.$;
  if (
    // Separate these types with a single line
    l === "HorizontalRule" ||
    r === "HorizontalRule" ||
    (l === "OrderedListItem" && r === "OrderedListItem") ||
    (l === "UnorderedListItem" && r === "UnorderedListItem")
  ) {
    return BreakRule.Always(1);
  } else if (
    // Condensed types shouldn't have an extra break on either side
    l === "Comment" ||
    l === "ParagraphBreak" ||
    l === "Heading" ||
    r === "Comment" ||
    r === "ParagraphBreak"
  ) {
    return BreakRule.Never;
  } else if (
    // Block types should always be separated by full breaks
    l === "CodeBlock" ||
    l === "OrderedListItem" ||
    l === "UnorderedListItem" ||
    r === "CodeBlock" ||
    r === "Heading" ||
    r === "OrderedListItem" ||
    r === "UnorderedListItem"
  ) {
    return BreakRule.Always(2);
  } else if (is_text_ty(left) && is_text_ty(right)) {
    // Text types may or may not be separated by a break
    return BreakRule.Optional;
  } else {
    // (LineBreak, _) | (_, LineBreak) =>
    return unreachable("should have been removed during deduplication");
  }
}

/// Types that indicate some form of break
// rustc: compiler/rustc_errors/src/markdown/parse.rs:478 is_break_ty
function is_break_ty(val: MdTree): boolean {
  return (
    val.$ === "ParagraphBreak" ||
    val.$ === "LineBreak" ||
    // >1 break between paragraphs acts as a break
    (val.$ === "PlainText" && string_trim(val._0) === "")
  );
}

/// Perform transformations to text. This splits paragraphs, replaces patterns,
/// and corrects newlines.
///
/// To avoid allocating strings (and using a different heavier tt type), our
/// replace method means split into three and append each. For this reason, any
/// viewer should treat consecutive `PlainText` types as belonging to the same
/// paragraph.
// rustc: compiler/rustc_errors/src/markdown/parse.rs:491 expand_plaintext
function expand_plaintext(txt: string, stream: MdTree[], f: (txt: string) => MdTree): void {
  if (txt === "") {
    return;
  } else if (txt === "\n") {
    const tt = stream[stream.length - 1];
    if (tt !== undefined) {
      const tmp = MdTree.PlainText(" ");
      if (BreakRule_eq(should_break(tt, tmp), BreakRule.Optional)) {
        stream.push(tmp);
      }
    }
    return;
  }
  let queue1: string[] = [];
  let queue2: string[] = [];
  const stream_start_len = stream.length;
  for (const paragraph_ of txt.split("\n\n")) {
    if (paragraph_ === "") {
      stream.push(MdTree.ParagraphBreak);
      continue;
    }
    const paragraph = trim_extra_ws(paragraph_);

    queue1.length = 0;
    queue1.push(paragraph);

    for (const [from, to] of REPLACEMENTS) {
      queue2.length = 0;
      for (const item of queue1) {
        // PORT: `str::split` with a non-empty `&str` pattern yields the same pieces as JS's `split`.
        for (const s of item.split(from)) {
          queue2.push(s, to);
        }
        if (queue2.length > 1) {
          void queue2.pop(); // remove last unnecessary intersperse
        }
      }
      [queue1, queue2] = [queue2, queue1];
    }

    // Make sure we don't double whitespace
    queue1 = queue1.filter((s) => s !== "");
    for (let idx = 0; idx < queue1.length; idx++) {
      queue1[idx] = trim_extra_ws(queue1[idx]!);
      if (idx < queue1.length - 1 && str_ends_with_whitespace(queue1[idx]!) && str_starts_with_whitespace(queue1[idx + 1]!)) {
        queue1[idx] = string_trim_end(queue1[idx]!);
      }
    }
    stream.push(...queue1.filter((txt) => txt !== "").map(f));
    stream.push(MdTree.ParagraphBreak);
  }

  if (stream.length - stream_start_len > 1) {
    void stream.pop(); // remove last unnecessary intersperse
  }
}

/// Turn reflinks (links with reference IDs) into normal standalone links using
/// listed link definitions
// rustc: compiler/rustc_errors/src/markdown/parse.rs:555 match_reflink
function match_reflink(linkdefs: readonly MdTree[], disp: string, match_id: string | undefined): MdTree {
  const to_match = match_id ?? disp; // Match with the display name if there isn't an id
  for (const def of linkdefs) {
    if (def.$ === "LinkDef") {
      const { id, link } = def;
      if (id === to_match) {
        return { $: "Link", disp, link };
      }
    }
  }
  return { $: "Link", disp, link: "" }; // link not found
}

/// If there is more than one whitespace char at start or end, trim the extras
// rustc: compiler/rustc_errors/src/markdown/parse.rs:568 trim_extra_ws
function trim_extra_ws(txt_: string): string {
  // PORT: byte positions of ASCII whitespace; every unit before (after) the first (last) non-whitespace byte is ASCII,
  // so the UTF-16 index is the byte index.
  let txt = txt_;
  let p = 0;
  while (p < txt.length && u8_is_ascii_whitespace(txt.charCodeAt(p))) p++;
  const start_ws = Math.max(p - 1, 0);
  txt = txt.slice(start_ws);
  let q = 0;
  while (q < txt.length && u8_is_ascii_whitespace(txt.charCodeAt(txt.length - 1 - q))) q++;
  const end_ws = Math.max(q - 1, 0);
  return txt.slice(0, txt.length - end_ws);
}

// ---- std helpers (Rust semantics) ----

/** `u8::is_ascii_whitespace`: `\t`, `\n`, `\x0C`, `\r`, ` ` (not `\x0B`). */
function u8_is_ascii_whitespace(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d;
}

/** `<[u8]>::starts_with` */
function starts_with(buf: Uint8Array, pat: Uint8Array): boolean {
  if (pat.length > buf.length) return false;
  for (let i = 0; i < pat.length; i++) if (buf[i] !== pat[i]) return false;
  return true;
}

/** `&buf[i..]`, which panics past the end. */
function slice_from(buf: Uint8Array, i: number): Uint8Array {
  if (i > buf.length) return panic(`range start index ${i} out of range for slice of length ${buf.length}`);
  return buf.subarray(i);
}

/** `buf.iter().take_while(pred).count()` */
function take_while_count(buf: Uint8Array, pred: (b: number) => boolean): number {
  let n = 0;
  while (n < buf.length && pred(buf[n]!)) n++;
  return n;
}

/** `buf.split(|&byte| byte == b)`, collected */
function split_byte(buf: Uint8Array, b: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === b) {
      out.push(buf.subarray(start, i));
      start = i + 1;
    }
  }
  out.push(buf.subarray(start));
  return out;
}

/** `<[u8]>::trim_ascii_start` */
function trim_ascii_start(buf: Uint8Array): Uint8Array {
  // PORT: `u8::is_ascii_whitespace` (`trim_ascii_start` uses the same set).
  return buf.subarray(take_while_count(buf, u8_is_ascii_whitespace));
}

/** `str::from_utf8(b).unwrap()` */
function from_utf8_unwrap(b: Uint8Array): string {
  const r = from_utf8(b);
  if (r.$ === "Err") return panic(`called \`Result::unwrap()\` on an \`Err\` value: ${r._0.debug()}`);
  return r._0;
}

/** `s.chars().all(pred)` (over Unicode scalar values) */
function chars_all(s: string, pred: (ch: string) => boolean): boolean {
  for (const ch of s) if (!pred(ch)) return false;
  return true;
}

/** `str::trim_matches('\n')` */
function str_trim_matches_newline(s: string): string {
  let i = 0;
  let j = s.length;
  while (i < j && s.charCodeAt(i) === 0x0a) i++;
  while (j > i && s.charCodeAt(j - 1) === 0x0a) j--;
  return s.slice(i, j);
}

/** `s.ends_with(char::is_whitespace)` */
function str_ends_with_whitespace(s: string): boolean {
  return s.length > 0 && is_whitespace(s.charCodeAt(s.length - 1));
}

/** `s.starts_with(char::is_whitespace)` */
function str_starts_with_whitespace(s: string): boolean {
  return s.length > 0 && is_whitespace(s.charCodeAt(0));
}
