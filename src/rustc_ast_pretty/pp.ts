//! This pretty-printer is a direct reimplementation of Philip Karlton's
//! Mesa pretty-printer, as described in the appendix to
//! Derek C. Oppen, "Pretty Printing" (1979),
//! Stanford Computer Science Department STAN-CS-79-770,
//! <http://i.stanford.edu/pub/cstr/reports/cs/tr/79/770/CS-TR-79-770.pdf>.
//!
//! The algorithm's aim is to break a stream into as few lines as possible
//! while respecting the indentation-consistency requirements of the enclosing
//! block, and avoiding breaking at silly places on block boundaries, for
//! example, between "x" and ")" in "x)".
//!
//! I am implementing this algorithm because it comes with 20 pages of
//! documentation explaining its theory, and because it addresses the set of
//! concerns I've seen other pretty-printers fall down on. Weirdly. Even though
//! it's 32 years old. What can I say?
//!
//! Despite some redundancies and quirks in the way it's implemented in that
//! paper, I've opted to keep the implementation here as similar as I can,
//! changing only what was blatantly wrong, a typo, or sufficiently
//! non-idiomatic rust that it really stuck out.
//!
//! In particular you'll see a certain amount of churn related to INTEGER vs.
//! CARDINAL in the Mesa implementation. Mesa apparently interconverts the two
//! somewhat readily? In any case, I've used usize for indices-in-buffers and
//! ints for character-sizes-and-indentation-offsets. This respects the need
//! for ints to "go negative" while carrying a pending-calculation balance, and
//! helps differentiate all the numbers flying around internally (slightly).
//!
//! I also inverted the indentation arithmetic used in the print stack, since
//! the Mesa implementation (somewhat randomly) stores the offset on the print
//! stack in terms of margin-col rather than col itself. I store col.
//!
//! I also implemented a small change in the String token, in that I store an
//! explicit length for the string. For most tokens this is just the length of
//! the accompanying string. But it's necessary to permit it to differ, for
//! encoding things that are supposed to "go on their own line" -- certain
//! classes of comment and blank-line -- where relying on adjacent
//! hardbreak-like Break tokens with long blankness indication doesn't actually
//! work. To see why, consider when there is a "thing that should be on its own
//! line" between two long blocks, say functions. If you put a hardbreak after
//! each function (or before each) and the breaking algorithm decides to break
//! there anyways (because the functions themselves are long) you wind up with
//! extra blank lines. If you don't put hardbreaks you can wind up with the
//! "thing which should be on its own line" not getting its own line in the
//! rare case of "really small functions" or such. This re-occurs with comments
//! and explicit blank lines. So in those cases we use a string with a payload
//! we want isolated to a line and an explicit length that's huge, surrounded
//! by two zero-length breaks. The algorithm will try its best to fit it on a
//! line (which it can't) and so naturally place the content on its own line to
//! avoid combining it with other lines and making matters even worse.
//!
//! # Explanation
//!
//! In case you do not have the paper, here is an explanation of what's going
//! on.
//!
//! There is a stream of input tokens flowing through this printer.
//!
//! The printer buffers up to 3N tokens inside itself, where N is linewidth.
//! Yes, linewidth is chars and tokens are multi-char, but in the worst
//! case every token worth buffering is 1 char long, so it's ok.
//!
//! Tokens are String, Break, and Begin/End to delimit blocks.
//!
//! Begin tokens can carry an offset, saying "how far to indent when you break
//! inside here", as well as a flag indicating "consistent" or "inconsistent"
//! breaking. Consistent breaking means that after the first break, no attempt
//! will be made to flow subsequent breaks together onto lines. Inconsistent
//! is the opposite. Inconsistent breaking example would be, say:
//!
//! ```ignore (illustrative)
//! foo(hello, there, good, friends)
//! ```
//!
//! breaking inconsistently to become
//!
//! ```ignore (illustrative)
//! foo(hello, there,
//!     good, friends);
//! ```
//!
//! whereas a consistent breaking would yield:
//!
//! ```ignore (illustrative)
//! foo(hello,
//!     there,
//!     good,
//!     friends);
//! ```
//!
//! That is, in the consistent-break blocks we value vertical alignment
//! more than the ability to cram stuff onto a line. But in all cases if it
//! can make a block a one-liner, it'll do so.
//!
//! Carrying on with high-level logic:
//!
//! The buffered tokens go through a ring-buffer, 'tokens'. The 'left' and
//! 'right' indices denote the active portion of the ring buffer as well as
//! describing hypothetical points-in-the-infinite-stream at most 3N tokens
//! apart (i.e., "not wrapped to ring-buffer boundaries"). The paper will switch
//! between using 'left' and 'right' terms to denote the wrapped-to-ring-buffer
//! and point-in-infinite-stream senses freely.
//!
//! There is a parallel ring buffer, `size`, that holds the calculated size of
//! each token. Why calculated? Because for Begin/End pairs, the "size"
//! includes everything between the pair. That is, the "size" of Begin is
//! actually the sum of the sizes of everything between Begin and the paired
//! End that follows. Since that is arbitrarily far in the future, `size` is
//! being rewritten regularly while the printer runs; in fact most of the
//! machinery is here to work out `size` entries on the fly (and give up when
//! they're so obviously over-long that "infinity" is a good enough
//! approximation for purposes of line breaking).
//!
//! The "input side" of the printer is managed as an abstract process called
//! SCAN, which uses `scan_stack`, to manage calculating `size`. SCAN is, in
//! other words, the process of calculating 'size' entries.
//!
//! The "output side" of the printer is managed by an abstract process called
//! PRINT, which uses `print_stack`, `margin` and `space` to figure out what to
//! do with each token/size pair it consumes as it goes. It's trying to consume
//! the entire buffered window, but can't output anything until the size is >=
//! 0 (sizes are set to negative while they're pending calculation).
//!
//! So SCAN takes input and buffers tokens and pending calculations, while
//! PRINT gobbles up completed calculations and tokens from the buffer. The
//! theory is that the two can never get more than 3N tokens apart, because
//! once there's "obviously" too much data to fit on a line, in a size
//! calculation, SCAN will write "infinity" to the size and let PRINT consume
//! it.
//!
//! In this implementation (following the paper, again) the SCAN process is the
//! methods called `Printer::scan_*`, and the 'PRINT' process is the
//! method called `Printer::print`.

// mod ring;
import { panic, unwrap } from "../std/panic.ts";
import { utf8_len } from "../std/str.ts";
import { RingBuffer } from "./pp/ring.ts";

// PORT: isize/usize arithmetic. Every quantity here (sizes, totals, space, indent, offsets) is
// bounded by the length of the printed text plus a few multiples of SIZE_INFINITY, so it stays
// far below 2^53 and JS numbers compute it exactly; rustc's isize never overflows on these
// paths. `usize` values that upstream obtains by `isize as usize` (and which may therefore
// wrap) are kept as the signed value, per the recorded decision; the only place such a value
// would be observable (`pending_indentation as usize` in `print_string`) mirrors the panic.

/// How to break. Described in more detail in the module docs.
export type Breaks = "Consistent" | "Inconsistent";
export const Breaks = { Consistent: "Consistent", Inconsistent: "Inconsistent" } as const;

export type IndentStyle =
  /// Vertically aligned under whatever column this block begins at.
  ///
  ///     fn demo(arg1: usize,
  ///             arg2: usize) {}
  | { readonly $: "Visual" }
  /// Indented relative to the indentation level of the previous line.
  ///
  ///     fn demo(
  ///         arg1: usize,
  ///         arg2: usize,
  ///     ) {}
  | { readonly $: "Block"; offset: number };
export const IndentStyle = {
  Visual: Object.freeze({ $: "Visual" }) as IndentStyle,
} as const;

/** `#[derive(PartialEq)]` on `IndentStyle`. */
export function IndentStyle_eq(a: IndentStyle, b: IndentStyle): boolean {
  if (a.$ === "Block" && b.$ === "Block") return a.offset === b.offset;
  return a.$ === b.$;
}

export interface BreakToken {
  offset: number;
  blank_space: number;
  /** `Option<char>`: a Unicode scalar value. */
  pre_break: number | undefined;
}

/** `#[derive(Default)]` on `BreakToken`. */
export function BreakToken_default(): BreakToken {
  return { offset: 0, blank_space: 0, pre_break: undefined };
}

/** `#[derive(PartialEq)]` on `BreakToken`. */
export function BreakToken_eq(a: BreakToken, b: BreakToken): boolean {
  return a.offset === b.offset && a.blank_space === b.blank_space && a.pre_break === b.pre_break;
}

export interface BeginToken {
  indent: IndentStyle;
  breaks: Breaks;
}

/** `#[derive(PartialEq)]` on `BeginToken`. */
export function BeginToken_eq(a: BeginToken, b: BeginToken): boolean {
  return IndentStyle_eq(a.indent, b.indent) && a.breaks === b.breaks;
}

export type Token =
  // In practice a string token contains either a `&'static str` or a
  // `String`. `Cow` is overkill for this because we never modify the data,
  // but it's more convenient than rolling our own more specialized type.
  // PORT: `Cow<'static, str>` is a JS string; its `len()` is `utf8_len`.
  | { readonly $: "String"; _0: string }
  | { readonly $: "Break"; _0: BreakToken }
  | { readonly $: "Begin"; _0: BeginToken }
  | { readonly $: "End" };
export const Token = {
  End: Object.freeze({ $: "End" }) as Token,

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:191 is_hardbreak_tok
  is_hardbreak_tok(self: Token): boolean {
    return Token_eq(self, Printer.hardbreak_tok_offset(0));
  },
} as const;

/** `#[derive(PartialEq)]` on `Token`. */
export function Token_eq(a: Token, b: Token): boolean {
  switch (a.$) {
    case "String":
      return b.$ === "String" && a._0 === b._0;
    case "Break":
      return b.$ === "Break" && BreakToken_eq(a._0, b._0);
    case "Begin":
      return b.$ === "Begin" && BeginToken_eq(a._0, b._0);
    case "End":
      return b.$ === "End";
  }
}

type PrintFrame = { readonly $: "Fits" } | { readonly $: "Broken"; indent: number; breaks: Breaks };
const PrintFrame = {
  Fits: Object.freeze({ $: "Fits" }) as PrintFrame,
} as const;
// `PrintFrame::Broken { indent: 0, breaks: Breaks::Inconsistent }` (the `get_top` fallback).
const PRINT_FRAME_BROKEN_DEFAULT: PrintFrame = Object.freeze({ $: "Broken", indent: 0, breaks: Breaks.Inconsistent });

export const SIZE_INFINITY: number = 0xffff;

/// Target line width.
export const MARGIN: number = 78;
/// Every line is allowed at least this much space, even if highly indented.
export const MIN_SPACE: number = 60;

interface BufEntry {
  token: Token;
  size: number;
}

// Boxes opened with methods like `Printer::{cbox,ibox}` must be closed with
// `Printer::end`. Failure to do so can result in bad indenting, or in extreme
// cases, cause no output to be produced at all.
//
// Box opening and closing used to be entirely implicit, which was hard to
// understand and easy to get wrong. This marker type is now returned from the
// box opening methods and forgotten by `Printer::end`. Any marker that isn't
// forgotten will trigger a panic in `drop`. (Closing a box more than once
// isn't possible because `BoxMarker` doesn't implement `Copy` or `Clone`.)
//
// Note: it would be better to make open/close mismatching impossible and avoid
// the need for this marker type altogether by having functions like
// `with_ibox` that open a box, call a closure, and then close the box. That
// would work for simple cases, but box lifetimes sometimes interact with
// complex control flow and across function boundaries in ways that are
// difficult to handle with such a technique.
// PORT: JS has no destructors, so the drop-check is not enforced at runtime: an unended
// `BoxMarker` is silently dropped instead of panicking. The class (and `drop`) is kept so call
// sites keep upstream's shape (`const ib = s.ibox(0); ...; s.end(ib)`); the brand stops a
// `BoxMarker` being confused with other values in TypeScript.
export class BoxMarker {
  declare private readonly __brand: "BoxMarker";

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:265 drop
  drop(): never {
    panic("BoxMarker not ended with `Printer::end()`");
  }
}

export class Printer {
  constructor(
    public out: string,
    /// Number of spaces left on line
    // PORT: the field `space` and the method `Printer::space()` share a name in Rust; a JS class
    // cannot have both, so the (private) field is `space_` and the public method keeps its name.
    public space_: number,
    /// Ring-buffer of tokens and calculated sizes
    public buf: RingBuffer<BufEntry>,
    /// Running size of stream "...left"
    public left_total: number,
    /// Running size of stream "...right"
    public right_total: number,
    /// Pseudo-stack, really a ring too. Holds the
    /// primary-ring-buffers index of the Begin that started the
    /// current block, possibly with the most recent Break after that
    /// Begin (if there is any) on top of it. Stuff is flushed off the
    /// bottom as it becomes irrelevant due to the primary ring-buffer
    /// advancing.
    // PORT: `VecDeque<usize>` is a plain JS array (`pop_front` is `shift`).
    public scan_stack: number[],
    /// Stack of blocks-in-progress being flushed by print
    public print_stack: PrintFrame[],
    /// Level of indentation of current line
    public indent: number,
    /// Buffered indentation to avoid writing trailing whitespace
    public pending_indentation: number,
    /// The token most recently popped from the left boundary of the
    /// ring-buffer for printing
    public last_printed: Token | undefined,
  ) {}

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:271 new
  static new(): Printer {
    return new Printer("", MARGIN, RingBuffer.new(), 0, 0, [], [], 0, 0, undefined);
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:286 last_token
  last_token(): Token | undefined {
    return this.last_token_still_buffered() ?? this.last_printed;
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:290 last_token_still_buffered
  last_token_still_buffered(): Token | undefined {
    return this.buf.last()?.token;
  }

  /// Be very careful with this!
  // rustc: compiler/rustc_ast_pretty/src/pp.rs:295 replace_last_token_still_buffered
  replace_last_token_still_buffered(token: Token): void {
    unwrap(this.buf.last_mut()).token = token;
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:299 scan_eof
  scan_eof(): void {
    if (!(this.scan_stack.length === 0)) {
      this.check_stack(0);
      this.advance_left();
    }
  }

  // This is where `BoxMarker`s are produced.
  // rustc: compiler/rustc_ast_pretty/src/pp.rs:307 scan_begin
  scan_begin(token: BeginToken): BoxMarker {
    if (this.scan_stack.length === 0) {
      this.left_total = 1;
      this.right_total = 1;
      this.buf.clear();
    }
    const right = this.buf.push({ token: { $: "Begin", _0: token }, size: -this.right_total });
    this.scan_stack.push(right);
    return new BoxMarker();
  }

  // This is where `BoxMarker`s are consumed.
  // rustc: compiler/rustc_ast_pretty/src/pp.rs:319 scan_end
  scan_end(_b: BoxMarker): void {
    if (this.scan_stack.length === 0) {
      this.print_end();
    } else {
      const right = this.buf.push({ token: Token.End, size: -1 });
      this.scan_stack.push(right);
    }
    // std::mem::forget(b)
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:329 scan_break
  scan_break(token: BreakToken): void {
    if (this.scan_stack.length === 0) {
      this.left_total = 1;
      this.right_total = 1;
      this.buf.clear();
    } else {
      this.check_stack(0);
    }
    const right = this.buf.push({ token: { $: "Break", _0: token }, size: -this.right_total });
    this.scan_stack.push(right);
    this.right_total += token.blank_space;
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:342 scan_string
  scan_string(string: string): void {
    if (this.scan_stack.length === 0) {
      this.print_string(string);
    } else {
      const len = utf8_len(string);
      this.buf.push({ token: { $: "String", _0: string }, size: len });
      this.right_total += len;
      this.check_stream();
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:353 offset
  offset(offset: number): void {
    const last = this.buf.last_mut();
    if (last !== undefined && last.token.$ === "Break") {
      // PORT: `BreakToken` is `Copy`; every buffered Break owns a fresh object (built by
      // `scan_break` or `hardbreak_tok_offset`), so updating it in place is the same as
      // updating the copy stored in the ring buffer.
      last.token._0.offset += offset;
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:359 check_stream
  check_stream(): void {
    while (this.right_total - this.left_total > this.space_) {
      if (unwrap(this.scan_stack[0]) === this.buf.index_of_first()) {
        unwrap(this.scan_stack.shift());
        unwrap(this.buf.first_mut()).size = SIZE_INFINITY;
      }
      this.advance_left();
      if (this.buf.is_empty()) {
        break;
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:372 advance_left
  advance_left(): void {
    while (unwrap(this.buf.first()).size >= 0) {
      const left = unwrap(this.buf.pop_first());

      const token = left.token;
      switch (token.$) {
        case "String": {
          const string = token._0;
          this.left_total += utf8_len(string);
          this.print_string(string);
          break;
        }
        case "Break": {
          this.left_total += token._0.blank_space;
          this.print_break(token._0, left.size);
          break;
        }
        case "Begin":
          this.print_begin(token._0, left.size);
          break;
        case "End":
          this.print_end();
          break;
      }

      this.last_printed = left.token;

      if (this.buf.is_empty()) {
        break;
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:397 check_stack
  check_stack(depth: number): void {
    loop: while (this.scan_stack.length !== 0) {
      const index = this.scan_stack[this.scan_stack.length - 1] as number;
      const entry = this.buf.index_mut(index);
      switch (entry.token.$) {
        case "Begin": {
          if (depth === 0) {
            break loop;
          }
          unwrap(this.scan_stack.pop());
          entry.size += this.right_total;
          depth -= 1;
          break;
        }
        case "End": {
          // paper says + not =, but that makes no sense.
          unwrap(this.scan_stack.pop());
          entry.size = 1;
          depth += 1;
          break;
        }
        default: {
          unwrap(this.scan_stack.pop());
          entry.size += this.right_total;
          if (depth === 0) {
            break loop;
          }
        }
      }
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:426 get_top
  get_top(): PrintFrame {
    return this.print_stack[this.print_stack.length - 1] ?? PRINT_FRAME_BROKEN_DEFAULT;
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:433 print_begin
  print_begin(token: BeginToken, size: number): void {
    if (size > this.space_) {
      this.print_stack.push({ $: "Broken", indent: this.indent, breaks: token.breaks });
      const indent = token.indent;
      switch (indent.$) {
        case "Block": {
          const offset = indent.offset;
          this.indent = usize_try_from_unwrap(this.indent + offset);
          break;
        }
        case "Visual":
          // PORT: `(MARGIN - self.space) as usize` wraps when `space > MARGIN` (after a
          // break with a negative indent); the signed value is kept (recorded decision), and
          // every later use converts it back with `as isize`, which is the identity here.
          this.indent = MARGIN - this.space_;
          break;
      }
    } else {
      this.print_stack.push(PrintFrame.Fits);
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:447 print_end
  print_end(): void {
    const frame = unwrap(this.print_stack.pop());
    if (frame.$ === "Broken") {
      this.indent = frame.indent;
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:453 print_break
  print_break(token: BreakToken, size: number): void {
    const top = this.get_top();
    let fits: boolean;
    if (top.$ === "Fits") {
      fits = true;
    } else if (top.breaks === "Consistent") {
      fits = false;
    } else {
      fits = size <= this.space_;
    }
    if (fits) {
      this.pending_indentation += token.blank_space;
      this.space_ -= token.blank_space;
    } else {
      const pre_break = token.pre_break;
      if (pre_break !== undefined) {
        this.out += String.fromCodePoint(pre_break);
      }
      this.out += "\n";
      const indent = this.indent + token.offset;
      this.pending_indentation = indent;
      this.space_ = Math.max(MARGIN - indent, MIN_SPACE);
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:473 print_string
  print_string(string: string): void {
    // Write the pending indent. A more concise way of doing this would be:
    //
    //   write!(self.out, "{: >n$}", "", n = self.pending_indentation as usize)?;
    //
    // But that is significantly slower. This code is sufficiently hot, and indents can get
    // sufficiently large, that the difference is significant on some workloads.
    // PORT: a negative `pending_indentation` (a break with a negative indent) becomes a huge
    // `usize`, and `String::reserve` panics with "capacity overflow" before writing anything.
    if (this.pending_indentation < 0) panic("capacity overflow");
    this.out += " ".repeat(this.pending_indentation);
    this.pending_indentation = 0;

    this.out += string;
    this.space_ -= utf8_len(string);
  }

  /// Synthesizes a comment that was not textually present in the original
  /// source file.
  // rustc: compiler/rustc_ast_pretty/src/pp.rs:490 synth_comment
  synth_comment(text: string): void {
    this.word("/*");
    this.space();
    this.word(text);
    this.space();
    this.word("*/");
  }

  /// "raw box"
  // rustc: compiler/rustc_ast_pretty/src/pp.rs:499 rbox
  rbox(indent: number, breaks: Breaks): BoxMarker {
    return this.scan_begin({ indent: { $: "Block", offset: indent }, breaks });
  }

  /// Inconsistent breaking box
  // rustc: compiler/rustc_ast_pretty/src/pp.rs:504 ibox
  ibox(indent: number): BoxMarker {
    return this.rbox(indent, Breaks.Inconsistent);
  }

  /// Consistent breaking box
  // rustc: compiler/rustc_ast_pretty/src/pp.rs:509 cbox
  cbox(indent: number): BoxMarker {
    return this.rbox(indent, Breaks.Consistent);
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:513 visual_align
  visual_align(): BoxMarker {
    return this.scan_begin({ indent: IndentStyle.Visual, breaks: Breaks.Consistent });
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:517 break_offset
  break_offset(n: number, off: number): void {
    this.scan_break({
      ...BreakToken_default(),
      offset: off,
      blank_space: n,
    });
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:525 end
  end(b: BoxMarker): void {
    this.scan_end(b);
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:529 eof
  eof(): string {
    this.scan_eof();
    return this.out;
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:534 word
  word(wrd: string): void {
    const string = wrd;
    this.scan_string(string);
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:539 word_space
  word_space(w: string): void {
    this.word(w);
    this.space();
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:544 nbsp
  nbsp(): void {
    this.word(" ");
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:548 word_nbsp
  word_nbsp(w: string): void {
    this.word(w);
    this.nbsp();
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:553 spaces
  spaces(n: number): void {
    this.break_offset(n, 0);
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:557 zerobreak
  zerobreak(): void {
    this.spaces(0);
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:561 space
  space(): void {
    this.spaces(1);
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:565 popen
  popen(): void {
    this.word("(");
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:569 pclose
  pclose(): void {
    this.word(")");
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:573 hardbreak
  hardbreak(): void {
    this.spaces(SIZE_INFINITY);
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:577 is_beginning_of_line
  is_beginning_of_line(): boolean {
    const last_token = this.last_token();
    if (last_token !== undefined) {
      return Token.is_hardbreak_tok(last_token);
    } else {
      return true;
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:584 hardbreak_if_not_bol
  hardbreak_if_not_bol(): void {
    if (!this.is_beginning_of_line()) {
      this.hardbreak();
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:590 space_if_not_bol
  space_if_not_bol(): void {
    if (!this.is_beginning_of_line()) {
      this.space();
    }
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:596 hardbreak_tok_offset
  static hardbreak_tok_offset(off: number): Token {
    return {
      $: "Break",
      _0: {
        ...BreakToken_default(),
        offset: off,
        blank_space: SIZE_INFINITY,
      },
    };
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:604 trailing_comma
  trailing_comma(): void {
    this.scan_break({ ...BreakToken_default(), pre_break: 0x2c /* ',' */ });
  }

  // rustc: compiler/rustc_ast_pretty/src/pp.rs:608 trailing_comma_or_space
  trailing_comma_or_space(): void {
    this.scan_break({
      ...BreakToken_default(),
      blank_space: 1,
      pre_break: 0x2c /* ',' */,
    });
  }
}

/** `usize::try_from(x: isize).unwrap()`. */
function usize_try_from_unwrap(x: number): number {
  if (x < 0) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return x;
}
