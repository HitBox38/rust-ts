// Port of annotate-snippets =0.12.16 `src/level.rs`.
//
//! [`Level`] constants for easy importing
//
// PORT: the module-level `ERROR`..`HELP` consts are defined after the class (a class must exist
// before its instances); `Level::ERROR` etc. are the same objects. `Level` values are never
// modified after construction, so sharing them is safe.
// PORT: `name: Option<Option<Cow<str>>>` → `{ $: "Some", _0: string | undefined } | undefined`
// (PORTING §5). `impl Into<OptionCow>` parameters take `string | undefined` (see snippet.ts).

import type { Style } from "../anstyle/style.ts";
import { debug_option, debug_struct, type Debug, type Fmt } from "../../std/fmt.ts";
import type { Stylesheet } from "./renderer/stylesheet.ts";
import { ERROR_TXT, HELP_TXT, INFO_TXT, NOTE_TXT, WARNING_TXT, type Message, type Title } from "./snippet.ts";
import { debug_string } from "./std_ext.ts";

/// Severity level for [`Title`]s and [`Message`]s
///
/// # Example
///
/// ```rust
/// # use annotate_snippets::*;
/// let report = &[
///     Level::ERROR.primary_title("mismatched types").id("E0308")
///         .element(Level::NOTE.message("expected reference")),
///     Group::with_title(
///         Level::HELP.secondary_title("function defined here")
///     ),
/// ];
/// ```
export class Level {
  constructor(
    readonly name: { readonly $: "Some"; readonly _0: string | undefined } | undefined,
    readonly level: LevelInner,
  ) {}

  // # Constructors
  static readonly ERROR: Level = new Level(undefined, "Error");
  static readonly WARNING: Level = new Level(undefined, "Warning");
  static readonly INFO: Level = new Level(undefined, "Info");
  static readonly NOTE: Level = new Level(undefined, "Note");
  static readonly HELP: Level = new Level(undefined, "Help");

  /// For the primary, or root cause, [`Group`][crate::Group] (the first) in a [`Report`][crate::Report]
  ///
  /// See [`Group::with_title`][crate::Group::with_title]
  ///
  /// <div class="warning">
  ///
  /// Text passed to this function is considered "untrusted input", as such
  /// all text is passed through a normalization function. Styled text is
  /// not allowed to be passed to this function.
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/level.rs:82 primary_title
  primary_title(text: string): Title {
    return {
      level: this,
      id: undefined,
      text: text,
      allows_styling: false,
    };
  }

  /// For any secondary, or context, [`Group`][crate::Group]s (subsequent) in a [`Report`][crate::Report]
  ///
  /// See [`Group::with_title`][crate::Group::with_title]
  ///
  /// <div class="warning">
  ///
  /// Text passed to this function is allowed to be styled, as such all
  /// text is considered "trusted input" and has no normalizations applied to
  /// it. [`normalize_untrusted_str`](crate::normalize_untrusted_str) can be
  /// used to normalize untrusted text before it is passed to this function.
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/level.rs:103 secondary_title
  secondary_title(text: string): Title {
    return {
      level: this,
      id: undefined,
      text: text,
      allows_styling: true,
    };
  }

  /// A text [`Element`][crate::Element] in a [`Group`][crate::Group]
  ///
  /// <div class="warning">
  ///
  /// Text passed to this function is allowed to be styled, as such all
  /// text is considered "trusted input" and has no normalizations applied to
  /// it. [`normalize_untrusted_str`](crate::normalize_untrusted_str) can be
  /// used to normalize untrusted text before it is passed to this function.
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/level.rs:122 message
  message(text: string): Message {
    return {
      level: this,
      text: text,
    };
  }

  // crate: annotate-snippets-0.12.16/src/level.rs:129 as_str
  as_str(): string {
    const name = this.name;
    if (name !== undefined && name._0 !== undefined) return name._0;
    if (name !== undefined) return "";
    switch (this.level) {
      case "Error":
        return ERROR_TXT;
      case "Warning":
        return WARNING_TXT;
      case "Info":
        return INFO_TXT;
      case "Note":
        return NOTE_TXT;
      case "Help":
        return HELP_TXT;
    }
  }

  // crate: annotate-snippets-0.12.16/src/level.rs:141 style
  style(stylesheet: Stylesheet): Style {
    return LevelInner.style(this.level, stylesheet);
  }

  // # Customize the `Level`

  /// Replace the name describing this [`Level`]
  ///
  /// <div class="warning">
  ///
  /// Text passed to this function is considered "untrusted input", as such
  /// all text is passed through a normalization function. Pre-styled text is
  /// not allowed to be passed to this function.
  ///
  /// </div>
  // crate: annotate-snippets-0.12.16/src/level.rs:165 with_name
  with_name(name: string | undefined): Level {
    return new Level({ $: "Some", _0: name }, this.level);
  }

  /// Do not show the [`Level`]s name
  ///
  /// Useful for:
  /// - Another layer of the application will include the level (e.g. when rendering errors)
  /// - [`Message`]s that are part of a previous [`Group`][crate::Group] [`Element`][crate::Element]s
  // crate: annotate-snippets-0.12.16/src/level.rs:209 no_name
  no_name(): Level {
    return this.with_name(undefined);
  }
}

/// Default `error:` [`Level`]
export const ERROR: Level = Level.ERROR;

/// Default `warning:` [`Level`]
export const WARNING: Level = Level.WARNING;

/// Default `info:` [`Level`]
export const INFO: Level = Level.INFO;

/// Default `note:` [`Level`]
export const NOTE: Level = Level.NOTE;

/// Default `help:` [`Level`]
export const HELP: Level = Level.HELP;

export const debug_Level: Debug<Level> = (v, f) =>
  debug_struct(f, "Level", [
    ["name", debug_option(v.name, f, (n: { readonly _0: string | undefined }, f: Fmt) => debug_option(n._0, f, debug_string))],
    ["level", debug_LevelInner(v.level, f)],
  ]);

export type LevelInner = "Error" | "Warning" | "Info" | "Note" | "Help";

export const LevelInner = {
  Error: "Error",
  Warning: "Warning",
  Info: "Info",
  Note: "Note",
  Help: "Help",

  // crate: annotate-snippets-0.12.16/src/level.rs:224 style
  style(self: LevelInner, stylesheet: Stylesheet): Style {
    switch (self) {
      case "Error":
        return stylesheet.error;
      case "Warning":
        return stylesheet.warning;
      case "Info":
        return stylesheet.info;
      case "Note":
        return stylesheet.note;
      case "Help":
        return stylesheet.help;
    }
  },
} as const;

export const debug_LevelInner: Debug<LevelInner> = (v) => v;
