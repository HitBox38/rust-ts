// Port of anstream =0.6.21 `src/adapter/wincon.rs`.
//
// PORT: unlike `src/wincon.rs` this module is not `cfg(windows)`-gated (it is pure parsing over
// `anstyle-parse`), so it is ported. `String` is a JS `string`; `char`s are pushed with
// `String.fromCodePoint`. `anstyle::Style` values are compared with `Style_eq`.

import { panic } from "../../../std/panic.ts";
import { Ansi256Color, AnsiColor, Color, Effects, RgbColor, Style, Style_default, Style_eq } from "../../anstyle/lib.ts";
import { Parser, type Params, type Perform } from "../../anstyle_parse/lib.ts";

/** `&mut T` to a place. */
interface MutRef<T> {
  value: T;
}

/// Incrementally convert to wincon calls for non-contiguous data
export class WinconBytes {
  constructor(
    public parser: Parser,
    public capture: WinconCapture,
  ) {}

  /// Initial state
  // crate: anstream-0.6.21/src/adapter/wincon.rs:10 new
  static new(): WinconBytes {
    return WinconBytes.default_();
  }

  /** `#[derive(Default)]` */
  static default_(): WinconBytes {
    return new WinconBytes(Parser.default_(), WinconCapture.default_());
  }

  /// Strip the next segment of data
  // crate: anstream-0.6.21/src/adapter/wincon.rs:15 extract_next
  extract_next(bytes: Uint8Array): WinconBytesIter {
    this.capture.reset();
    // self.capture.printable.reserve(bytes.len());
    return new WinconBytesIter(bytes, this.parser, this.capture);
  }
}

/// See [`WinconBytes`]
export class WinconBytesIter {
  constructor(
    public bytes: Uint8Array,
    public parser: Parser,
    public capture: WinconCapture,
  ) {}

  // crate: anstream-0.6.21/src/adapter/wincon.rs:38 next
  next(): [Style, string] | undefined {
    const self = this;
    const bytes: MutRef<Uint8Array> = {
      get value() {
        return self.bytes;
      },
      set value(v) {
        self.bytes = v;
      },
    };
    return next_bytes(bytes, this.parser, this.capture);
  }

  *[Symbol.iterator](): Generator<[Style, string], void, undefined> {
    for (let x = this.next(); x !== undefined; x = this.next()) yield x;
  }
}

// crate: anstream-0.6.21/src/adapter/wincon.rs:44 next_bytes
function next_bytes(bytes: MutRef<Uint8Array>, parser: Parser, capture: WinconCapture): [Style, string] | undefined {
  capture.reset();
  while (capture.ready === undefined) {
    let byte: number;
    if (bytes.value.length !== 0) {
      byte = bytes.value[0]!;
      bytes.value = bytes.value.subarray(1);
    } else {
      break;
    }
    parser.advance(capture, byte);
  }
  if (capture.printable.length === 0) {
    return undefined;
  }

  const style = capture.ready ?? capture.style;
  const printable = capture.printable;
  capture.printable = "";
  return [style, printable];
}

export class WinconCapture implements Perform {
  constructor(
    public style: Style,
    public printable: string,
    public ready: Style | undefined,
  ) {}

  /** `#[derive(Default)]` */
  static default_(): WinconCapture {
    return new WinconCapture(Style_default(), "", undefined);
  }

  // crate: anstream-0.6.21/src/adapter/wincon.rs:75 reset
  reset(): void {
    this.ready = undefined;
  }

  // impl anstyle_parse::Perform for WinconCapture

  /// Draw a character to the screen and update states.
  // crate: anstream-0.6.21/src/adapter/wincon.rs:82 print
  print(c: number): void {
    this.printable += String.fromCodePoint(c);
  }

  /// Execute a C0 or C1 control function.
  // crate: anstream-0.6.21/src/adapter/wincon.rs:87 execute
  execute(byte: number): void {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20) {
      // byte.is_ascii_whitespace()
      this.printable += String.fromCharCode(byte);
    }
  }

  // crate: anstream-0.6.21/src/adapter/wincon.rs:93 csi_dispatch
  csi_dispatch(params: Params, _intermediates: Uint8Array, ignore: boolean, action: number): void {
    if (ignore) {
      return;
    }
    if (action !== 0x6d /* b'm' */) {
      return;
    }

    let style = this.style;
    // param/value differences are dependent on the escape code
    let state: CsiState = "Normal";
    let r: number | undefined = undefined;
    let g: number | undefined = undefined;
    let color_target: ColorTarget = "Fg";
    for (const param of params) {
      values: for (const value of param) {
        if (state === "Normal" && value === 0) {
          style = Style_default();
          break values;
        } else if (state === "Normal" && value === 1) {
          style = Style.bold(style);
          break values;
        } else if (state === "Normal" && value === 2) {
          style = Style.dimmed(style);
          break values;
        } else if (state === "Normal" && value === 3) {
          style = Style.italic(style);
          break values;
        } else if (state === "Normal" && value === 4) {
          style = Style.underline(style);
          state = "Underline";
        } else if (state === "Normal" && value === 21) {
          style = Style.bitor(style, Effects.DOUBLE_UNDERLINE);
          break values;
        } else if (state === "Normal" && value === 7) {
          style = Style.invert(style);
          break values;
        } else if (state === "Normal" && value === 8) {
          style = Style.hidden(style);
          break values;
        } else if (state === "Normal" && value === 9) {
          style = Style.strikethrough(style);
          break values;
        } else if (state === "Normal" && value >= 30 && value <= 37) {
          const color = expect(to_ansi_color(value - 30), "within 4-bit range");
          style = Style.fg_color(style, Color.from_AnsiColor(color));
          break values;
        } else if (state === "Normal" && value === 38) {
          color_target = "Fg";
          state = "PrepareCustomColor";
        } else if (state === "Normal" && value === 39) {
          style = Style.fg_color(style, undefined);
          break values;
        } else if (state === "Normal" && value >= 40 && value <= 47) {
          const color = expect(to_ansi_color(value - 40), "within 4-bit range");
          style = Style.bg_color(style, Color.from_AnsiColor(color));
          break values;
        } else if (state === "Normal" && value === 48) {
          color_target = "Bg";
          state = "PrepareCustomColor";
        } else if (state === "Normal" && value === 49) {
          style = Style.bg_color(style, undefined);
          break values;
        } else if (state === "Normal" && value === 58) {
          color_target = "Underline";
          state = "PrepareCustomColor";
        } else if (state === "Normal" && value >= 90 && value <= 97) {
          const color = AnsiColor.bright(expect(to_ansi_color(value - 90), "within 4-bit range"), true);
          style = Style.fg_color(style, Color.from_AnsiColor(color));
          break values;
        } else if (state === "Normal" && value >= 100 && value <= 107) {
          const color = AnsiColor.bright(expect(to_ansi_color(value - 100), "within 4-bit range"), true);
          style = Style.bg_color(style, Color.from_AnsiColor(color));
          break values;
        } else if (state === "PrepareCustomColor" && value === 5) {
          state = "Ansi256";
        } else if (state === "PrepareCustomColor" && value === 2) {
          state = "Rgb";
          r = undefined;
          g = undefined;
        } else if (state === "Ansi256") {
          const n = value;
          const color = new Ansi256Color(n & 0xff);
          switch (color_target) {
            case "Fg":
              style = Style.fg_color(style, Color.from_Ansi256Color(color));
              break;
            case "Bg":
              style = Style.bg_color(style, Color.from_Ansi256Color(color));
              break;
            case "Underline":
              style = Style.underline_color(style, Color.from_Ansi256Color(color));
              break;
          }
          break values;
        } else if (state === "Rgb") {
          const b = value;
          if (r === undefined) {
            r = b;
          } else if (g === undefined) {
            g = b;
          } else {
            const color = new RgbColor(r & 0xff, g & 0xff, b & 0xff);
            switch (color_target) {
              case "Fg":
                style = Style.fg_color(style, Color.from_RgbColor(color));
                break;
              case "Bg":
                style = Style.bg_color(style, Color.from_RgbColor(color));
                break;
              case "Underline":
                style = Style.underline_color(style, Color.from_RgbColor(color));
                break;
            }
            break values;
          }
        } else if (state === "Underline" && value === 0) {
          style = Style.effects(style, Effects.remove(Style.get_effects(style), Effects.UNDERLINE));
        } else if (state === "Underline" && value === 1) {
          // underline already set
        } else if (state === "Underline" && value === 2) {
          style = Style.bitor(Style.effects(style, Effects.remove(Style.get_effects(style), Effects.UNDERLINE)), Effects.DOUBLE_UNDERLINE);
        } else if (state === "Underline" && value === 3) {
          style = Style.bitor(Style.effects(style, Effects.remove(Style.get_effects(style), Effects.UNDERLINE)), Effects.CURLY_UNDERLINE);
        } else if (state === "Underline" && value === 4) {
          style = Style.bitor(Style.effects(style, Effects.remove(Style.get_effects(style), Effects.UNDERLINE)), Effects.DOTTED_UNDERLINE);
        } else if (state === "Underline" && value === 5) {
          style = Style.bitor(Style.effects(style, Effects.remove(Style.get_effects(style), Effects.UNDERLINE)), Effects.DASHED_UNDERLINE);
        } else {
          break values;
        }
      }
    }

    if (!Style_eq(style, this.style) && this.printable.length !== 0) {
      this.ready = this.style;
    }
    this.style = style;
  }
}

/** `Option::expect` */
function expect<T>(v: T | undefined, msg: string): T {
  if (v === undefined) return panic(msg);
  return v;
}

type CsiState = "Normal" | "PrepareCustomColor" | "Ansi256" | "Rgb" | "Underline";

type ColorTarget = "Fg" | "Bg" | "Underline";

// crate: anstream-0.6.21/src/adapter/wincon.rs:287 to_ansi_color
function to_ansi_color(digit: number): AnsiColor | undefined {
  switch (digit) {
    case 0:
      return "Black";
    case 1:
      return "Red";
    case 2:
      return "Green";
    case 3:
      return "Yellow";
    case 4:
      return "Blue";
    case 5:
      return "Magenta";
    case 6:
      return "Cyan";
    case 7:
      return "White";
    default:
      return undefined;
  }
}
