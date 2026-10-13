// Port of compiler/rustc_attr_ir/src/stability.rs
// Types and derived Debug/Clone/PrintAttribute impls are generated into stability.gen.ts
// (tools/codegen/types.ts).
//
// PORT: methods of the generated classes are attached to their prototypes (`declare module`);
// statics are typed on the re-exported class const (the rustc_ast/expand/typetree.ts pattern); enum
// methods live on the companion consts (PORTING §8).
import { sym, type Symbol } from "../rustc_span/symbol.ts";
import * as gen from "./stability.gen.ts";
import { clone_StableSince, type StableSince } from "./stability.gen.ts";

export * from "./stability.gen.ts";

declare module "./stability.gen.ts" {
  interface Stability {
    is_unstable(): boolean;
    is_stable(): boolean;
    stable_since(): StableSince | undefined;
  }
  interface ConstStability {
    is_const_unstable(): boolean;
    is_const_stable(): boolean;
  }
  interface PartialConstStability {
    is_const_unstable(): boolean;
    is_const_stable(): boolean;
  }
}

/// The version placeholder that recently stabilized features contain inside the
/// `since` field of the `#[stable]` attribute.
///
/// For more, see [this pull request](https://github.com/rust-lang/rust/pull/100591).
export const VERSION_PLACEHOLDER: string = "CURRENT_RUSTC_VERSIO" + "N";
// Note that the `concat!` macro above prevents `src/tools/replace-version-placeholder` from
// replacing the constant with the current version. Hardcoding the tool to skip this file doesn't
// work as the file can (and at some point will) be moved around.
//
// Turning the `concat!` macro into a string literal will make Pietro cry. That'd be sad :(

export type Stability = gen.Stability;
export const Stability = gen.Stability;

// rustc: compiler/rustc_attr_ir/src/stability.rs:32 is_unstable
Stability.prototype.is_unstable = function (this: Stability): boolean {
  return StabilityLevel.is_unstable(this.level);
};

// rustc: compiler/rustc_attr_ir/src/stability.rs:36 is_stable
Stability.prototype.is_stable = function (this: Stability): boolean {
  return StabilityLevel.is_stable(this.level);
};

// rustc: compiler/rustc_attr_ir/src/stability.rs:40 stable_since
Stability.prototype.stable_since = function (this: Stability): StableSince | undefined {
  return StabilityLevel.stable_since(this.level);
};

export type ConstStability = gen.ConstStability;
export const ConstStability = gen.ConstStability as typeof gen.ConstStability & {
  from_partial: (partial: PartialConstStability, const_stable_indirect: boolean) => ConstStability;
  unmarked: (const_stable_indirect: boolean, regular_stab: Stability) => ConstStability;
};

// rustc: compiler/rustc_attr_ir/src/stability.rs:58 from_partial
ConstStability.from_partial = function ({ level, feature, promotable }: PartialConstStability, const_stable_indirect: boolean): ConstStability {
  // Self { const_stable_indirect, level, feature, promotable }
  return new gen.ConstStability(level, feature, promotable, const_stable_indirect);
};

/// The stability assigned to unmarked items when -Zforce-unstable-if-unmarked is set.
// rustc: compiler/rustc_attr_ir/src/stability.rs:66 unmarked
ConstStability.unmarked = function (const_stable_indirect: boolean, regular_stab: Stability): ConstStability {
  // Self { feature, promotable: false, level, const_stable_indirect }
  return new gen.ConstStability(regular_stab.level, regular_stab.feature, false, const_stable_indirect);
};

// rustc: compiler/rustc_attr_ir/src/stability.rs:75 is_const_unstable
ConstStability.prototype.is_const_unstable = function (this: ConstStability): boolean {
  return StabilityLevel.is_unstable(this.level);
};

// rustc: compiler/rustc_attr_ir/src/stability.rs:79 is_const_stable
ConstStability.prototype.is_const_stable = function (this: ConstStability): boolean {
  return StabilityLevel.is_stable(this.level);
};

export type PartialConstStability = gen.PartialConstStability;
export const PartialConstStability = gen.PartialConstStability;

// rustc: compiler/rustc_attr_ir/src/stability.rs:96 is_const_unstable
PartialConstStability.prototype.is_const_unstable = function (this: PartialConstStability): boolean {
  return StabilityLevel.is_unstable(this.level);
};

// rustc: compiler/rustc_attr_ir/src/stability.rs:100 is_const_stable
PartialConstStability.prototype.is_const_stable = function (this: PartialConstStability): boolean {
  return StabilityLevel.is_stable(this.level);
};

export type StabilityLevel = gen.StabilityLevel;
// PORT: the generated module has no `StabilityLevel` companion (no unit variants).
export const StabilityLevel = {
  // rustc: compiler/rustc_attr_ir/src/stability.rs:161 is_unstable
  is_unstable(self: StabilityLevel): boolean {
    return self.$ === "Unstable";
  },
  // rustc: compiler/rustc_attr_ir/src/stability.rs:164 is_stable
  is_stable(self: StabilityLevel): boolean {
    return self.$ === "Stable";
  },
  // rustc: compiler/rustc_attr_ir/src/stability.rs:167 stable_since
  stable_since(self: StabilityLevel): StableSince | undefined {
    switch (self.$) {
      case "Stable": {
        const since = self.since;
        return clone_StableSince(since);
      }
      case "Unstable":
        return undefined;
    }
  },
};

export type UnstableReason = gen.UnstableReason;
export const UnstableReason = {
  ...gen.UnstableReason,

  // rustc: compiler/rustc_attr_ir/src/stability.rs:192 from_opt_reason
  from_opt_reason(reason: Symbol | undefined): UnstableReason {
    // UnstableReason::Default constructed manually
    if (reason !== undefined) {
      const r = reason;
      return { $: "Some", _0: r };
    } else {
      return UnstableReason.None;
    }
  },

  // rustc: compiler/rustc_attr_ir/src/stability.rs:200 to_opt_reason
  to_opt_reason(self: UnstableReason): Symbol | undefined {
    switch (self.$) {
      case "None":
        return undefined;
      case "Default":
        return sym.unstable_location_reason_default;
      case "Some": {
        const r = self._0;
        return r;
      }
    }
  },
};
