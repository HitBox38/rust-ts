// Port of anstream =0.6.21 `src/auto.rs` (features `auto` + `wincon`, non-windows host).
//
// PORT: rust-ts follows non-windows host semantics: `cfg!(windows)` is `false` (`CFG_WINDOWS`) and
// the `#[cfg(all(windows, feature = "wincon"))]` `StreamInner::Wincon` variant and its match arms
// are omitted (`src/wincon.rs` is not ported). The `cfg!(windows)` branch of `always()` is kept as
// code; it is dead here. The bounds of `impl Write for AutoStream<S>` (`S: RawStream +
// AsLockedWrite`) are hoisted to the class. `lock()` serves both the `AutoStream<Stdout>` and
// `AutoStream<Stderr>` impls (locking is the identity in the shim). `#[derive(Debug)]` is not
// ported (no stream has a Debug impl rust-ts needs).

import { Err, type Result } from "../../std/result.ts";
import type { IoResult } from "../../std/io.ts";
import * as anstyle_query from "../anstyle_query/lib.ts";
import { ColorChoice } from "../colorchoice/lib.ts";
import { StripStream } from "./strip.ts";
import { write_vectored, type AsLockedWrite, type FmtArguments, type RawStream, type Stderr, type Stdout, type Write } from "./stream.ts";

/** `cfg!(windows)` */
const CFG_WINDOWS = false as boolean;

type StreamInner<S extends RawStream & AsLockedWrite> =
  | { readonly $: "PassThrough"; readonly _0: S }
  | { readonly $: "Strip"; readonly _0: StripStream<S> };

/// [`std::io::Write`] that adapts ANSI escape codes to the underlying `Write`s capabilities
///
/// This includes
/// - Stripping colors for non-terminals
/// - Respecting env variables like [NO_COLOR](https://no-color.org/) or [CLICOLOR](https://bixense.com/clicolors/)
/// - *(windows)* Falling back to the wincon API where [ENABLE_VIRTUAL_TERMINAL_PROCESSING](https://learn.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences#output-sequences) is unsupported
///
/// You can customize auto-detection by calling into
/// [anstyle_query](https://docs.rs/anstyle-query/latest/anstyle_query/)
/// to get a [`ColorChoice`] and then calling [`AutoStream::new(stream, choice)`].
export class AutoStream<S extends RawStream & AsLockedWrite> implements Write {
  constructor(public inner: StreamInner<S>) {}

  /// Runtime control over styling behavior
  ///
  /// # Example
  ///
  /// ```rust
  /// # #[cfg(feature = "auto")] {
  /// # use std::io::IsTerminal as _;
  /// // Like `AutoStream::choice` but without `NO_COLOR`, `CLICOLOR_FORCE`, `CI`
  /// fn choice(raw: &dyn anstream::stream::RawStream) -> anstream::ColorChoice {
  ///     let choice = anstream::ColorChoice::global();
  ///     if choice == anstream::ColorChoice::Auto {
  ///         if raw.is_terminal() && anstyle_query::term_supports_color() {
  ///             anstream::ColorChoice::Always
  ///         } else {
  ///             anstream::ColorChoice::Never
  ///         }
  ///     } else {
  ///         choice
  ///     }
  /// }
  ///
  /// let stream = std::io::stdout();
  /// let choice = choice(&stream);
  /// let auto = anstream::AutoStream::new(stream, choice);
  /// # }
  /// ```
  // crate: anstream-0.6.21/src/auto.rs:62 new
  static new<S extends RawStream & AsLockedWrite>(raw: S, choice: ColorChoice): AutoStream<S> {
    switch (choice) {
      // #[cfg(feature = "auto")]
      case "Auto":
        return AutoStream.auto(raw);
      case "AlwaysAnsi":
        return AutoStream.always_ansi(raw);
      case "Always":
        return AutoStream.always(raw);
      case "Never":
        return AutoStream.never(raw);
    }
  }

  /// Auto-adapt for the stream's capabilities
  // crate: anstream-0.6.21/src/auto.rs:77 auto
  static auto<S extends RawStream & AsLockedWrite>(raw: S): AutoStream<S> {
    const choice = AutoStream.choice(raw);
    // debug_assert_ne!(choice, ColorChoice::Auto);
    return AutoStream.new(raw, choice);
  }

  /// Report the desired choice for the given stream
  // crate: anstream-0.6.21/src/auto.rs:85 choice
  static choice<S extends RawStream>(raw: S): ColorChoice {
    return choice(raw);
  }

  /// Force ANSI escape codes to be passed through as-is, no matter what the inner `Write`
  /// supports.
  // crate: anstream-0.6.21/src/auto.rs:92 always_ansi
  static always_ansi<S extends RawStream & AsLockedWrite>(raw: S): AutoStream<S> {
    // #[cfg(feature = "auto")]
    {
      if (raw.is_terminal()) {
        void anstyle_query.windows.enable_ansi_colors();
      }
    }
    return AutoStream.always_ansi_(raw);
  }

  // crate: anstream-0.6.21/src/auto.rs:103 always_ansi_
  static always_ansi_<S extends RawStream & AsLockedWrite>(raw: S): AutoStream<S> {
    const inner: StreamInner<S> = { $: "PassThrough", _0: raw };
    return new AutoStream(inner);
  }

  /// Force color, no matter what the inner `Write` supports.
  // crate: anstream-0.6.21/src/auto.rs:110 always
  static always<S extends RawStream & AsLockedWrite>(raw: S): AutoStream<S> {
    if (CFG_WINDOWS) {
      // #[cfg(feature = "auto")]
      const use_wincon = raw.is_terminal() && !(anstyle_query.windows.enable_ansi_colors() ?? true) && !anstyle_query.term_supports_ansi_color();
      if (use_wincon) {
        const r = AutoStream.wincon(raw);
        return r.$ === "Ok" ? r._0 : AutoStream.always_ansi_(r._0);
      } else {
        return AutoStream.always_ansi_(raw);
      }
    } else {
      return AutoStream.always_ansi(raw);
    }
  }

  /// Only pass printable data to the inner `Write`.
  // crate: anstream-0.6.21/src/auto.rs:130 never
  static never<S extends RawStream & AsLockedWrite>(raw: S): AutoStream<S> {
    const inner: StreamInner<S> = { $: "Strip", _0: StripStream.new(raw) };
    return new AutoStream(inner);
  }

  // crate: anstream-0.6.21/src/auto.rs:136 wincon
  static wincon<S extends RawStream & AsLockedWrite>(raw: S): Result<AutoStream<S>, S> {
    // #[cfg(not(all(windows, feature = "wincon")))]
    {
      return Err(raw);
    }
  }

  /// Get the wrapped [`RawStream`]
  // crate: anstream-0.6.21/src/auto.rs:151 into_inner
  into_inner(): S {
    switch (this.inner.$) {
      case "PassThrough":
        return this.inner._0;
      case "Strip":
        return this.inner._0.into_inner();
    }
  }

  /// Get the wrapped [`RawStream`]
  // crate: anstream-0.6.21/src/auto.rs:162 as_inner
  as_inner(): S {
    switch (this.inner.$) {
      case "PassThrough":
        return this.inner._0;
      case "Strip":
        return this.inner._0.as_inner();
    }
  }

  /// Returns `true` if the descriptor/handle refers to a terminal/tty.
  // crate: anstream-0.6.21/src/auto.rs:173 is_terminal
  is_terminal(): boolean {
    switch (this.inner.$) {
      case "PassThrough":
        return this.inner._0.is_terminal();
      case "Strip":
        return this.inner._0.is_terminal();
    }
  }

  /// Prefer [`AutoStream::choice`]
  ///
  /// This doesn't report what is requested but what is currently active.
  // crate: anstream-0.6.21/src/auto.rs:187 current_choice
  current_choice(): ColorChoice {
    switch (this.inner.$) {
      case "PassThrough":
        return "AlwaysAnsi";
      case "Strip":
        return "Never";
    }
  }

  /// Get exclusive access to the `AutoStream`
  ///
  /// Why?
  /// - Faster performance when writing in a loop
  /// - Avoid other threads interleaving output with the current thread
  // crate: anstream-0.6.21/src/auto.rs:232 lock
  // crate: anstream-0.6.21/src/auto.rs:250 lock
  lock<T extends Stdout | Stderr>(this: AutoStream<T>): AutoStream<T> {
    let inner: StreamInner<T>;
    switch (this.inner.$) {
      case "PassThrough":
        inner = { $: "PassThrough", _0: this.inner._0.lock() as T };
        break;
      case "Strip":
        inner = { $: "Strip", _0: this.inner._0.lock() };
        break;
    }
    return new AutoStream(inner);
  }

  // impl<S> std::io::Write for AutoStream<S>
  // Must forward all calls to ensure locking happens appropriately
  // crate: anstream-0.6.21/src/auto.rs:267 write
  write(buf: Uint8Array): IoResult<number> {
    switch (this.inner.$) {
      case "PassThrough":
        return this.inner._0.as_locked_write().write(buf);
      case "Strip":
        return this.inner._0.write(buf);
    }
  }

  // crate: anstream-0.6.21/src/auto.rs:276 write_vectored
  write_vectored(bufs: readonly Uint8Array[]): IoResult<number> {
    switch (this.inner.$) {
      case "PassThrough":
        return write_vectored(this.inner._0.as_locked_write(), bufs);
      case "Strip":
        return this.inner._0.write_vectored(bufs);
    }
  }

  // is_write_vectored: nightly only
  // crate: anstream-0.6.21/src/auto.rs:286 flush
  flush(): IoResult<void> {
    switch (this.inner.$) {
      case "PassThrough":
        return this.inner._0.as_locked_write().flush();
      case "Strip":
        return this.inner._0.flush();
    }
  }

  // crate: anstream-0.6.21/src/auto.rs:295 write_all
  write_all(buf: Uint8Array): IoResult<void> {
    switch (this.inner.$) {
      case "PassThrough":
        return this.inner._0.as_locked_write().write_all(buf);
      case "Strip":
        return this.inner._0.write_all(buf);
    }
  }

  // write_all_vectored: nightly only
  // crate: anstream-0.6.21/src/auto.rs:305 write_fmt
  write_fmt(args: FmtArguments): IoResult<void> {
    switch (this.inner.$) {
      case "PassThrough":
        return this.inner._0.as_locked_write().write_fmt(args);
      case "Strip":
        return this.inner._0.write_fmt(args);
    }
  }
}

// crate: anstream-0.6.21/src/auto.rs:198 choice
function choice(raw: RawStream): ColorChoice {
  const choice = ColorChoice.global();
  switch (choice) {
    case "Auto": {
      const clicolor = anstyle_query.clicolor();
      const clicolor_enabled = clicolor ?? false;
      const clicolor_disabled = !(clicolor ?? true);
      if (anstyle_query.no_color()) {
        return "Never";
      } else if (anstyle_query.clicolor_force()) {
        return "Always";
      } else if (clicolor_disabled) {
        return "Never";
      } else if (raw.is_terminal() && (anstyle_query.term_supports_color() || clicolor_enabled || anstyle_query.is_ci())) {
        return "Always";
      } else {
        return "Never";
      }
    }
    case "AlwaysAnsi":
    case "Always":
    case "Never":
      return choice;
  }
}
