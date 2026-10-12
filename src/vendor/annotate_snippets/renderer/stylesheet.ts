// Port of annotate-snippets =0.12.16 `src/renderer/stylesheet.rs`.
//
// PORT: `Stylesheet` is `Copy` → a readonly interface; field updates build a new object
// (`{ ...stylesheet, error: style }`). Its functions live on the same-named companion const.

import { debug_struct, type Debug } from "../../../std/fmt.ts";
import { debug_Style, Style } from "../../anstyle/style.ts";

export interface Stylesheet {
  readonly error: Style;
  readonly warning: Style;
  readonly info: Style;
  readonly note: Style;
  readonly help: Style;
  readonly line_num: Style;
  readonly emphasis: Style;
  readonly none: Style;
  readonly context: Style;
  readonly addition: Style;
  readonly removal: Style;
}

export const Stylesheet = {
  // impl Default for Stylesheet
  // crate: annotate-snippets-0.12.16/src/renderer/stylesheet.rs:19 default
  default(): Stylesheet {
    return Stylesheet.plain();
  },

  // crate: annotate-snippets-0.12.16/src/renderer/stylesheet.rs:25 plain
  plain(): Stylesheet {
    return {
      error: Style.new(),
      warning: Style.new(),
      info: Style.new(),
      note: Style.new(),
      help: Style.new(),
      line_num: Style.new(),
      emphasis: Style.new(),
      none: Style.new(),
      context: Style.new(),
      addition: Style.new(),
      removal: Style.new(),
    };
  },
} as const;

export const debug_Stylesheet: Debug<Stylesheet> = (v, f) =>
  debug_struct(f, "Stylesheet", [
    ["error", debug_Style(v.error, f)],
    ["warning", debug_Style(v.warning, f)],
    ["info", debug_Style(v.info, f)],
    ["note", debug_Style(v.note, f)],
    ["help", debug_Style(v.help, f)],
    ["line_num", debug_Style(v.line_num, f)],
    ["emphasis", debug_Style(v.emphasis, f)],
    ["none", debug_Style(v.none, f)],
    ["context", debug_Style(v.context, f)],
    ["addition", debug_Style(v.addition, f)],
    ["removal", debug_Style(v.removal, f)],
  ]);
