// Port of colorchoice =1.0.4 `src/lib.rs`.
//
//! Global override of color control
//
// PORT: `static USER: AtomicChoice` → a module-level `AtomicChoice` whose `AtomicUsize` is a plain
// mutable `number` field (single-threaded; `Ordering::SeqCst` has nothing to order).

import { unwrap } from "../../std/panic.ts";

/// Selection for overriding color output
export type ColorChoice =
  /// Use colors if the output device appears to support them
  | "Auto"
  /// Like `Always`, except it never tries to use anything other than emitting ANSI
  /// color codes.
  | "AlwaysAnsi"
  /// Try very hard to emit colors.
  ///
  /// This includes emitting ANSI colors on Windows if the console API is unavailable.
  | "Always"
  /// Never emit colors.
  | "Never";

export const ColorChoice = {
  Auto: "Auto",
  AlwaysAnsi: "AlwaysAnsi",
  Always: "Always",
  Never: "Never",

  /// Get the current [`ColorChoice`] state
  // crate: colorchoice-1.0.4/src/lib.rs:30 global
  global(): ColorChoice {
    return USER.get();
  },

  /// Override the detected [`ColorChoice`]
  // crate: colorchoice-1.0.4/src/lib.rs:35 write_global
  write_global(self: ColorChoice): void {
    USER.set(self);
  },

  // impl Default for ColorChoice
  // crate: colorchoice-1.0.4/src/lib.rs:41 default
  default_(): ColorChoice {
    return "Auto";
  },
} as const;

/** `#[derive(Debug)]` */
export const debug_ColorChoice = (v: ColorChoice): string => v;

export class AtomicChoice {
  constructor(public _0: number) {}

  // crate: colorchoice-1.0.4/src/lib.rs:52 new
  static new(): AtomicChoice {
    return new AtomicChoice(AtomicChoice.from_choice("Auto"));
  }

  // crate: colorchoice-1.0.4/src/lib.rs:56 get
  get(): ColorChoice {
    const choice = this._0;
    return unwrap(AtomicChoice.to_choice(choice), "Only `ColorChoice` values can be `set`");
  }

  // crate: colorchoice-1.0.4/src/lib.rs:61 set
  set(choice: ColorChoice): void {
    const choice_ = AtomicChoice.from_choice(choice);
    this._0 = choice_;
  }

  // crate: colorchoice-1.0.4/src/lib.rs:66 from_choice
  static from_choice(choice: ColorChoice): number {
    switch (choice) {
      case "Auto":
        return 0;
      case "AlwaysAnsi":
        return 1;
      case "Always":
        return 2;
      case "Never":
        return 3;
    }
  }

  // crate: colorchoice-1.0.4/src/lib.rs:75 to_choice
  static to_choice(choice: number): ColorChoice | undefined {
    switch (choice) {
      case 0:
        return "Auto";
      case 1:
        return "AlwaysAnsi";
      case 2:
        return "Always";
      case 3:
        return "Never";
      default:
        return undefined;
    }
  }

  // impl Default for AtomicChoice
  // crate: colorchoice-1.0.4/src/lib.rs:87 default
  static default_(): AtomicChoice {
    return AtomicChoice.new();
  }
}

const USER: AtomicChoice = AtomicChoice.new();
