// Port of compiler/rustc_attr_ir/src/lang_items.rs
//! Defines lang items.
//!
//! Language items are items that represent concepts intrinsic to the language
//! itself. Examples are:
//!
//! * Traits that specify "kinds"; e.g., `Sync`, `Send`.
//! * Traits that represent operators; e.g., `Add`, `Sub`, `Index`.
//! * Functions called by the compiler itself.
//
// Generated into lang_items.gen.ts (tools/codegen/types.ts): `LanguageItems`, `GenericRequirement`,
// the `LangItem` enum `language_item_table!` declares (+ `LangItem_discriminant` = `LangItem as u32`,
// Debug/Clone/PrintAttribute) and the table's rows as data (`language_item_table`).
// PORT: the fns the macro generates are ported here over those rows (markers on the macro's fn lines);
// `LangItem` methods live on its companion const (PORTING §8), including `is_weak` / `link_name`
// from weak_lang_items.rs.
import { type DefId, DefIdMap } from "../rustc_span/def_id.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { panic, unwrap } from "../std/panic.ts";
import * as gen from "./lang_items.gen.ts";
import { type GenericRequirement, language_item_table, type LanguageItemTableRow, LangItem_discriminant, type LanguageItemsGetters } from "./lang_items.gen.ts";
import { clone_Target, type Target } from "./target.ts";
import { is_weak, link_name } from "./weak_lang_items.ts";

export * from "./lang_items.gen.ts";

declare module "./lang_items.gen.ts" {
  interface LanguageItems extends LanguageItemsGetters {
    get(item: LangItem): DefId | undefined;
    set(item: LangItem, def_id: DefId): void;
    from_def_id(def_id: DefId): LangItem | undefined;
    iter(): IterableIterator<[LangItem, DefId]>;
    trim_missing(): void;
  }
}

/** `std::mem::variant_count::<LangItem>()` */
const LANG_ITEM_VARIANT_COUNT = language_item_table.length;

export type LanguageItems = gen.LanguageItems;
export const LanguageItems = gen.LanguageItems as typeof gen.LanguageItems & {
  new: () => LanguageItems;
};

/// Construct an empty collection of lang items and no missing ones.
// rustc: compiler/rustc_attr_ir/src/lang_items.rs:33 new
LanguageItems.new = function (): LanguageItems {
  // PORT: `reverse_items: FxIndexMap<DefId, LangItem>` is a `DefIdMap` (keyed by `DefId_key`, insertion-ordered
  // like the `IndexMap`; docs/plan-m3.md D5/D6).
  return new gen.LanguageItems(new Array<DefId | undefined>(LANG_ITEM_VARIANT_COUNT).fill(undefined), new DefIdMap<LangItem>(), []);
};

// rustc: compiler/rustc_attr_ir/src/lang_items.rs:41 get
LanguageItems.prototype.get = function (this: LanguageItems, item: LangItem): DefId | undefined {
  return this.items[LangItem_discriminant[item]];
};

// rustc: compiler/rustc_attr_ir/src/lang_items.rs:45 set
LanguageItems.prototype.set = function (this: LanguageItems, item: LangItem, def_id: DefId): void {
  this.items[LangItem_discriminant[item]] = def_id;
  // `FxIndexMap::insert` returns the previous value.
  const preexisting = this.reverse_items.get(def_id);
  this.reverse_items.set(def_id, item);

  // This needs to be a bijection.
  if (preexisting !== undefined) {
    panic(
      "For the bijection of LangItem <=> DefId to work," +
        "one item DefId may only be assigned one LangItem. " +
        `Separate the LangItem definitions for ${item} and ${preexisting}.`,
    );
  }
};

// rustc: compiler/rustc_attr_ir/src/lang_items.rs:59 from_def_id
LanguageItems.prototype.from_def_id = function (this: LanguageItems, def_id: DefId): LangItem | undefined {
  return this.reverse_items.get(def_id);
};

// rustc: compiler/rustc_attr_ir/src/lang_items.rs:63 iter
LanguageItems.prototype.iter = function* (this: LanguageItems): IterableIterator<[LangItem, DefId]> {
  for (let i = 0; i < this.items.length; i++) {
    const id = this.items[i];
    if (id !== undefined) {
      yield [unwrap(from_u32(i)), id];
    }
  }
};

/// Remove any missing items from the list that aren't actually missing
// rustc: compiler/rustc_attr_ir/src/lang_items.rs:71 trim_missing
LanguageItems.prototype.trim_missing = function (this: LanguageItems): void {
  this.missing = this.missing.filter((item) => this.items[LangItem_discriminant[item]] === undefined);
};

// ---- language_item_table! (the fns of its macro_rules! body, over the generated rows) ----

let ROW_OF: Map<LangItem, LanguageItemTableRow> | undefined;
/** The table row of `variant` (`match self { $( LangItem::$variant => .., )* }`). */
function row_of(variant: LangItem): LanguageItemTableRow {
  if (ROW_OF === undefined) {
    ROW_OF = new Map();
    for (const row of language_item_table) ROW_OF.set(row.variant, row);
  }
  return ROW_OF.get(variant)!;
}

// rustc: compiler/rustc_attr_ir/src/lang_items.rs:93 from_u32
function from_u32(u: number): LangItem | undefined {
  // This implementation is clumsy, but makes no assumptions
  // about how discriminant tags are allocated within the
  // range `0 .. std::mem::variant_count::<LangItem>()`.
  for (const { variant } of language_item_table) {
    if (u === LangItem_discriminant[variant]) {
      return variant;
    }
  }
  return undefined;
}

export type LangItem = gen.LangItem;
export const LangItem = {
  ...gen.LangItem,

  from_u32,

  /// Returns the `name` symbol in `#[lang = "$name"]`.
  /// For example, [`LangItem::PartialEq`]`.name()`
  /// would result in [`sym::eq`] since it is `#[lang = "eq"]`.
  // rustc: compiler/rustc_attr_ir/src/lang_items.rs:106 name
  name(self: LangItem): Symbol {
    return row_of(self).name;
  },

  /// Opposite of [`LangItem::name`]
  // rustc: compiler/rustc_attr_ir/src/lang_items.rs:113 from_name
  from_name(name: Symbol): LangItem | undefined {
    // `match name { $( $module::$name => Some(LangItem::$variant), )* _ => None }`: the first arm wins.
    for (const row of language_item_table) {
      if (row.name === name) return row.variant;
    }
    return undefined;
  },

  /// Returns the name of the `LangItem` enum variant.
  // This method is used by Clippy for internal lints.
  // rustc: compiler/rustc_attr_ir/src/lang_items.rs:122 variant_name
  variant_name(self: LangItem): string {
    // stringify!($variant)
    return self;
  },

  // rustc: compiler/rustc_attr_ir/src/lang_items.rs:128 target
  target(self: LangItem): Target {
    return clone_Target(row_of(self).target);
  },

  // rustc: compiler/rustc_attr_ir/src/lang_items.rs:134 required_generics
  required_generics(self: LangItem): GenericRequirement {
    return row_of(self).generics;
  },

  // weak_lang_items.rs
  is_weak,
  link_name,
};

// impl LanguageItems { $( pub fn $method(&self) -> Option<DefId> { self.items[LangItem::$variant as usize] } )* }
for (const row of language_item_table) {
  const index = LangItem_discriminant[row.variant];
  Object.defineProperty(gen.LanguageItems.prototype, row.method, {
    value: function (this: LanguageItems): DefId | undefined {
      return this.items[index];
    },
    writable: true,
    configurable: true,
  });
}

// impl StableHash for LangItem
// rustc-skip: compiler/rustc_attr_ir/src/lang_items.rs:153 stable_hash HashStable (StableHash) impl of a type not reached from metadata/hygiene decoding (PORTING §3)

/// The requirement imposed on the generics of a lang item
export type { GenericRequirement };

export const FN_TRAITS: readonly LangItem[] = ["Fn", "FnMut", "FnOnce"];

export const OPERATORS: readonly LangItem[] = [
  "Add",
  "Sub",
  "Mul",
  "Div",
  "Rem",
  "Neg",
  "Not",
  "BitXor",
  "BitAnd",
  "BitOr",
  "Shl",
  "Shr",
  "AddAssign",
  "SubAssign",
  "MulAssign",
  "DivAssign",
  "RemAssign",
  "BitXorAssign",
  "BitAndAssign",
  "BitOrAssign",
  "ShlAssign",
  "ShrAssign",
  "Index",
  "IndexMut",
  "PartialEq",
  "PartialOrd",
];

export const BINARY_OPERATORS: readonly LangItem[] = [
  "Add",
  "Sub",
  "Mul",
  "Div",
  "Rem",
  "BitXor",
  "BitAnd",
  "BitOr",
  "Shl",
  "Shr",
  "AddAssign",
  "SubAssign",
  "MulAssign",
  "DivAssign",
  "RemAssign",
  "BitXorAssign",
  "BitAndAssign",
  "BitOrAssign",
  "ShlAssign",
  "ShrAssign",
  "Index",
  "IndexMut",
  "PartialEq",
  "PartialOrd",
];
