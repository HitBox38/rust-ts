// Port of anstyle-query =1.1.5 `src/lib.rs`.
//
//! Low level terminal capability lookups
//
// PORT: `std::env::var_os(k)` → `process.env[k]` (`undefined` = unset, `""` = set but empty; the
// distinction is kept exactly). `OsStr` comparisons are string comparisons. Only the
// `#[cfg(not(windows))]` arms are ported (rust-ts follows non-windows host semantics); the
// `#[cfg(windows)]` arms are kept as comments.
// crate-skip: anstyle-query-1.1.5/examples/query.rs:3 main example binary, not library code

export * as windows from "./windows.ts";

/// Check [CLICOLOR] status
///
/// - When `true`, ANSI colors are supported and should be used when the program isn't piped,
///   similar to [`term_supports_color`]
/// - When `false`, don’t output ANSI color escape codes, similar to [`no_color`]
///
/// See also:
/// - [terminfo](https://crates.io/crates/terminfo) or [term](https://crates.io/crates/term) for
///   checking termcaps
/// - [termbg](https://crates.io/crates/termbg) for detecting background color
///
/// [CLICOLOR]: https://bixense.com/clicolors/
// crate: anstyle-query-1.1.5/src/lib.rs:23 clicolor
export function clicolor(): boolean | undefined {
  const value = process.env["CLICOLOR"];
  if (value === undefined) return undefined;
  return value !== "0";
}

/// Check [CLICOLOR_FORCE] status
///
/// ANSI colors should be enabled no matter what.
///
/// [CLICOLOR_FORCE]: https://bixense.com/clicolors/
// crate: anstyle-query-1.1.5/src/lib.rs:34 clicolor_force
export function clicolor_force(): boolean {
  return non_empty(process.env["CLICOLOR_FORCE"]);
}

/// Check [NO_COLOR] status
///
/// When `true`, should prevent the addition of ANSI color.
///
/// User-level configuration files and per-instance command-line arguments should override
/// [NO_COLOR]. A user should be able to export `$NO_COLOR` in their shell configuration file as a
/// default, but configure a specific program in its configuration file to specifically enable
/// color.
///
/// [NO_COLOR]: https://no-color.org/
// crate: anstyle-query-1.1.5/src/lib.rs:49 no_color
export function no_color(): boolean {
  return non_empty(process.env["NO_COLOR"]);
}

/// Check `TERM` for color support
// crate: anstyle-query-1.1.5/src/lib.rs:55 term_supports_color
export function term_supports_color(): boolean {
  // #[cfg(not(windows))]
  {
    const k = process.env["TERM"];
    if (k === undefined) {
      // If TERM isn't set, then we are in a weird environment that
      // probably doesn't support colors.
      return false;
    } else {
      if (k === "dumb") {
        return false;
      }
    }
    return true;
  }
  // #[cfg(windows)]: On Windows, if TERM isn't set, then we shouldn't automatically
  // assume that colors aren't allowed (`TERM=dumb` → false, otherwise true).
}

/// Check `TERM` for ANSI color support
///
/// On Windows, you might need to also check [`windows::enable_ansi_colors`] as ANSI color support
/// is opt-in, rather than assumed.
// crate: anstyle-query-1.1.5/src/lib.rs:89 term_supports_ansi_color
export function term_supports_ansi_color(): boolean {
  // #[cfg(not(windows))]
  {
    return term_supports_color();
  }
  // #[cfg(windows)]: unset TERM → false; `dumb` or `cygwin` → false (cygwin doesn't seem to
  // support ANSI escape sequences and instead has its own variety); otherwise true.
}

/// Check [COLORTERM] for truecolor support
///
/// [COLORTERM]: https://github.com/termstandard/colors
// crate: anstyle-query-1.1.5/src/lib.rs:115 truecolor
export function truecolor(): boolean {
  const value_ = process.env["COLORTERM"];
  const value = value_ ?? "";
  return value === "truecolor" || value === "24bit";
}

/// Report whether this is running in CI
///
/// CI is a common environment where, despite being piped, ansi color codes are supported
///
/// This is not as exhaustive as you'd find in a crate like `is_ci` but it should work in enough
/// cases.
// crate: anstyle-query-1.1.5/src/lib.rs:128 is_ci
export function is_ci(): boolean {
  // Assuming its CI based on presence because who would be setting `CI=false`?
  //
  // This makes it easier to all of the potential values when considering our known values:
  // - Gitlab and Github set it to `true`
  // - Woodpecker sets it to `woodpecker`
  return process.env["CI"] !== undefined;
}

// crate: anstyle-query-1.1.5/src/lib.rs:137 non_empty
export function non_empty(var_: string | undefined): boolean {
  return !((var_ ?? "").length === 0);
}
