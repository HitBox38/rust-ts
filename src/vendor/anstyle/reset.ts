// Port of anstyle =1.0.13 `src/reset.rs`.

import type { Debug, Fmt } from "../../std/fmt.ts";

/// Reset terminal formatting
// PORT: unit struct → class without fields; construct with `new Reset()`.
export class Reset {
  /// Render the ANSI code
  ///
  /// `Reset` also implements `Display` directly, so calling this method is optional.
  // crate: anstyle-1.0.13/src/reset.rs:11 render
  render(): string {
    // PORT: returns `self` as `impl Display`; rendered eagerly (see lib.ts).
    return this.fmt({ alternate: false });
  }

  // crate: anstyle-1.0.13/src/reset.rs:17 fmt
  fmt(_f: Fmt): string {
    return RESET;
  }
}

export const debug_Reset: Debug<Reset> = () => "Reset";

export const RESET: string = "\x1B[0m";
