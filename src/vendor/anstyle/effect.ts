// Port of anstyle =1.0.13 `src/effect.rs`.
//
// PORT: `struct Effects(u16)` is a `Copy` newtype over bits → a branded number (equality is `===`,
// like PORTING §5's interned handles); its associated consts and methods live on the companion
// const. Operator impls (`BitOr`, `Sub`, ...) become named functions; the `*Assign` ones take a
// `{ value }` cell for `&mut self`.

import { debug_struct, debug_tuple, type Debug, type Fmt } from "../../std/fmt.ts";
import { Ok, type Result } from "../../std/result.ts";
import { utf8 } from "../../std/str.ts";
import type { Write } from "./lib.ts";

/// A set of text effects
///
/// # Examples
///
/// ```rust
/// let effects = anstyle::Effects::BOLD | anstyle::Effects::UNDERLINE;
/// ```
export type Effects = number & { readonly __brand: "Effects" };

const mk = (bits: number): Effects => bits as Effects;

export const Effects = {
  /// No [`Effects`] applied
  PLAIN: mk(0),

  BOLD: mk(1 << 0),
  DIMMED: mk(1 << 1),
  /// Not widely supported. Sometimes treated as inverse or blink
  ITALIC: mk(1 << 2),
  /// Style extensions exist for Kitty, VTE, mintty and iTerm2.
  UNDERLINE: mk(1 << 3),
  DOUBLE_UNDERLINE: mk(1 << 4),
  CURLY_UNDERLINE: mk(1 << 5),
  DOTTED_UNDERLINE: mk(1 << 6),
  DASHED_UNDERLINE: mk(1 << 7),
  BLINK: mk(1 << 8),
  /// Swap foreground and background colors; inconsistent emulation
  INVERT: mk(1 << 9),
  HIDDEN: mk(1 << 10),
  ///  Characters legible but marked as if for deletion. Not supported in Terminal.app
  STRIKETHROUGH: mk(1 << 11),

  /// No effects enabled
  // crate: anstyle-1.0.13/src/effect.rs:48 new
  new(): Effects {
    return Effects.PLAIN;
  },

  /// Check if no effects are enabled
  // crate: anstyle-1.0.13/src/effect.rs:64 is_plain
  is_plain(self: Effects): boolean {
    return self === Effects.PLAIN;
  },

  /// Returns `true` if all of the effects in `other` are contained within `self`.
  // crate: anstyle-1.0.13/src/effect.rs:80 contains
  contains(self: Effects, other: Effects): boolean {
    return (other & self) === other;
  },

  /// Inserts the specified effects in-place.
  // crate: anstyle-1.0.13/src/effect.rs:97 insert
  insert(self: Effects, other: Effects): Effects {
    return mk(self | other);
  },

  /// Removes the specified effects in-place.
  // crate: anstyle-1.0.13/src/effect.rs:113 remove
  remove(self: Effects, other: Effects): Effects {
    // PORT: `!other.0` on a u16 → mask to 16 bits.
    return mk(self & ~other & 0xffff);
  },

  /// Reset all effects in-place
  // crate: anstyle-1.0.13/src/effect.rs:126 clear
  clear(_self: Effects): Effects {
    return Effects.new();
  },

  /// Enable or disable the specified effects depending on the passed value.
  // crate: anstyle-1.0.13/src/effect.rs:140 set
  set(self: Effects, other: Effects, enable: boolean): Effects {
    if (enable) {
      return Effects.insert(self, other);
    } else {
      return Effects.remove(self, other);
    }
  },

  /// Iterate over enabled effects
  // crate: anstyle-1.0.13/src/effect.rs:150 iter
  iter(self: Effects): EffectIter {
    return new EffectIter(0, self);
  },

  /// Iterate over enabled effect indices
  // crate: anstyle-1.0.13/src/effect.rs:159 index_iter
  index_iter(self: Effects): EffectIndexIter {
    return new EffectIndexIter(0, self);
  },

  /// Render the ANSI code
  // crate: anstyle-1.0.13/src/effect.rs:168 render
  render(self: Effects): string {
    return new EffectsDisplay(self).fmt({ alternate: false });
  },

  // crate: anstyle-1.0.13/src/effect.rs:174 write_to
  write_to(self: Effects, write: Write): Result<undefined, unknown> {
    const it = Effects.index_iter(self);
    for (let index = it.next(); index !== undefined; index = it.next()) {
      const r = write.write_all(utf8(METADATA[index]!.escape));
      if (r.$ === "Err") return r;
    }
    return Ok(undefined);
  },

  // impl core::ops::BitOr for Effects
  // crate: anstyle-1.0.13/src/effect.rs:215 bitor
  bitor(self: Effects, rhs: Effects): Effects {
    return Effects.insert(self, rhs);
  },

  // impl core::ops::BitOrAssign for Effects
  // crate: anstyle-1.0.13/src/effect.rs:229 bitor_assign
  bitor_assign(self: { value: Effects }, other: Effects): void {
    self.value = Effects.insert(self.value, other);
  },

  // impl core::ops::Sub for Effects
  // crate: anstyle-1.0.13/src/effect.rs:244 sub
  sub(self: Effects, other: Effects): Effects {
    return Effects.remove(self, other);
  },

  // impl core::ops::SubAssign for Effects
  // crate: anstyle-1.0.13/src/effect.rs:258 sub_assign
  sub_assign(self: { value: Effects }, other: Effects): void {
    self.value = Effects.remove(self.value, other);
  },
} as const;

// impl core::fmt::Debug for Effects
/// ```rust
/// let effects = anstyle::Effects::BOLD | anstyle::Effects::UNDERLINE;
/// assert_eq!(format!("{:?}", effects), "Effects(BOLD | UNDERLINE)");
/// ```
// crate: anstyle-1.0.13/src/effect.rs:192 fmt
export const debug_Effects: Debug<Effects> = (self) => {
  let f = "Effects(";
  let i = 0;
  const it = Effects.index_iter(self);
  for (let index = it.next(); index !== undefined; index = it.next(), i++) {
    if (i !== 0) {
      f += " | ";
    }
    f += METADATA[index]!.name;
  }
  f += ")";
  return f;
};

export interface Metadata {
  readonly name: string;
  readonly escape: string;
}

export const METADATA: readonly Metadata[] = [
  { name: "BOLD", escape: "\x1B[1m" /* escape!("1") */ },
  { name: "DIMMED", escape: "\x1B[2m" /* escape!("2") */ },
  { name: "ITALIC", escape: "\x1B[3m" /* escape!("3") */ },
  { name: "UNDERLINE", escape: "\x1B[4m" /* escape!("4") */ },
  { name: "DOUBLE_UNDERLINE", escape: "\x1B[21m" /* escape!("21") */ },
  { name: "CURLY_UNDERLINE", escape: "\x1B[4:3m" /* escape!("4:3") */ },
  { name: "DOTTED_UNDERLINE", escape: "\x1B[4:4m" /* escape!("4:4") */ },
  { name: "DASHED_UNDERLINE", escape: "\x1B[4:5m" /* escape!("4:5") */ },
  { name: "BLINK", escape: "\x1B[5m" /* escape!("5") */ },
  { name: "INVERT", escape: "\x1B[7m" /* escape!("7") */ },
  { name: "HIDDEN", escape: "\x1B[8m" /* escape!("8") */ },
  { name: "STRIKETHROUGH", escape: "\x1B[9m" /* escape!("9") */ },
];

export class EffectsDisplay {
  constructor(readonly _0: Effects) {}

  // crate: anstyle-1.0.13/src/effect.rs:324 fmt
  fmt(_f: Fmt): string {
    let f = "";
    const it = Effects.index_iter(this._0);
    for (let index = it.next(); index !== undefined; index = it.next()) {
      f += METADATA[index]!.escape;
    }
    return f;
  }
}

export const debug_EffectsDisplay: Debug<EffectsDisplay> = (v, f) => debug_tuple(f, "EffectsDisplay", [debug_Effects(v._0, f)]);

/// Enumerate each enabled value in [`Effects`]
export class EffectIter {
  constructor(
    public index: number,
    public effects: Effects,
  ) {}

  // crate: anstyle-1.0.13/src/effect.rs:342 next
  next(): Effects | undefined {
    while (this.index < METADATA.length) {
      const index = this.index;
      this.index += 1;

      const effect = mk(1 << index);
      if (Effects.contains(this.effects, effect)) {
        return effect;
      }
    }

    return undefined;
  }
}

export const debug_EffectIter: Debug<EffectIter> = (v, f) =>
  debug_struct(f, "EffectIter", [
    ["index", String(v.index)],
    ["effects", debug_Effects(v.effects, f)],
  ]);

export class EffectIndexIter {
  constructor(
    public index: number,
    public effects: Effects,
  ) {}

  // crate: anstyle-1.0.13/src/effect.rs:366 next
  next(): number | undefined {
    while (this.index < METADATA.length) {
      const index = this.index;
      this.index += 1;

      const effect = mk(1 << index);
      if (Effects.contains(this.effects, effect)) {
        return index;
      }
    }

    return undefined;
  }
}

export const debug_EffectIndexIter: Debug<EffectIndexIter> = (v, f) =>
  debug_struct(f, "EffectIndexIter", [
    ["index", String(v.index)],
    ["effects", debug_Effects(v.effects, f)],
  ]);
