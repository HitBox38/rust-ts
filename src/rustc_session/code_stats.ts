// Port of compiler/rustc_session/src/code_stats.rs (lane fixers-49: `-Zprint-type-sizes`).
// PORT (fixers-49):
// - The `u64` byte counts (`size`, `offset`, `overall_size`, `opt_discr_size`) are `bigint`: a layout can be as large as
//   `obj_size_bound` (2^61 - 1 on 64-bit targets), past 2^53 (PORTING §5). The `align`s stay `number`s: an `Align` is at
//   most 2^29 bytes (`Align::MAX`), and `Align::bytes()` is already a `number`.
// - `Lock<FxHashSet<TypeSizeInfo>>` is a `Map` keyed by the derived `Hash`/`Eq` of `TypeSizeInfo` as a string
//   (`key_TypeSizeInfo`), so an equal `TypeSizeInfo` is inserted once, as `HashSet::insert` does.
// - `println!`/`print!` are `write_stdout` (src/std/io.ts).
import type { Align, Size } from "../rustc_abi/lib.ts";
import { display_Symbol, type Symbol } from "../rustc_span/symbol.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { write_stdout } from "../std/io.ts";
import { str_cmp } from "./options.ts";

// #[derive(Clone, PartialEq, Eq, Hash, Debug)]
export interface VariantInfo {
  name: Symbol | undefined;
  kind: SizeKind;
  size: bigint;
  align: number;
  fields: FieldInfo[];
}

// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
export type SizeKind = "Exact" | "Min";
export const SizeKind = { Exact: "Exact", Min: "Min" } as const;

// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
export type FieldKind = "AdtField" | "Upvar" | "CoroutineLocal";
export const FieldKind = {
  AdtField: "AdtField",
  Upvar: "Upvar",
  CoroutineLocal: "CoroutineLocal",
} as const;

// `impl std::fmt::Display for FieldKind`
// rustc: compiler/rustc_session/src/code_stats.rs:31 fmt
export function display_FieldKind(self: FieldKind): string {
  switch (self) {
    case "AdtField":
      return "field";
    case "Upvar":
      return "upvar";
    case "CoroutineLocal":
      return "local";
  }
}

// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
export interface FieldInfo {
  kind: FieldKind;
  name: Symbol;
  offset: bigint;
  size: bigint;
  align: number;
  /// Name of the type of this field.
  /// Present only if the creator thought that this would be important for identifying the field,
  /// typically because the field name is uninformative.
  type_name: Symbol | undefined;
}

// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
export type DataTypeKind = "Struct" | "Union" | "Enum" | "Closure" | "Coroutine";
export const DataTypeKind = {
  Struct: "Struct",
  Union: "Union",
  Enum: "Enum",
  Closure: "Closure",
  Coroutine: "Coroutine",
} as const;

// #[derive(PartialEq, Eq, Hash, Debug)]
export interface TypeSizeInfo {
  kind: DataTypeKind;
  type_description: string;
  align: number;
  overall_size: bigint;
  packed: boolean;
  opt_discr_size: bigint | undefined;
  variants: VariantInfo[];
}

/** PORT: the derived `PartialEq`/`Eq` of `TypeSizeInfo` as a key: every field, in declaration order (`Symbol`s by index). */
function key_TypeSizeInfo(v: TypeSizeInfo): string {
  const field = (f: FieldInfo): unknown[] => [f.kind, f.name, String(f.offset), String(f.size), f.align, f.type_name ?? null];
  const variant = (x: VariantInfo): unknown[] => [x.name ?? null, x.kind, String(x.size), x.align, x.fields.map(field)];
  return JSON.stringify([
    v.kind,
    v.type_description,
    v.align,
    String(v.overall_size),
    v.packed,
    v.opt_discr_size === undefined ? null : String(v.opt_discr_size),
    v.variants.map(variant),
  ]);
}

/** PORT: `u64` subtraction as rustc is built (no overflow checks): wrapping. */
function u64_wrapping_sub(a: bigint, b: bigint): bigint {
  return BigInt.asUintN(64, a - b);
}

// #[derive(Default)]
export class CodeStats {
  constructor(
    /// The hash set that actually holds all the type size information.
    /// The field is public for use in external tools. See #139876.
    public type_sizes: Map<string, TypeSizeInfo>,
  ) {}

  /** `CodeStats::default()` */
  static default(): CodeStats {
    return new CodeStats(new Map());
  }

  // PORT: `type_desc: S` where `S: ToString` is the `String` the one caller formats.
  // rustc: compiler/rustc_session/src/code_stats.rs:81 record_type_size
  record_type_size(
    kind: DataTypeKind,
    type_desc: string,
    align: Align,
    overall_size: Size,
    packed: boolean,
    opt_discr_size: Size | undefined,
    variants: VariantInfo[],
  ): void {
    // Sort variants so the largest ones are shown first. A stable sort is
    // used here so that source code order is preserved for all variants
    // that have the same size.
    // Except for Coroutines, whose variants are already sorted according to
    // their yield points in `variant_info_for_coroutine`.
    if (kind !== "Coroutine") {
      // `sort_by_key(|info| cmp::Reverse(info.size))`; `Array.prototype.sort` is stable.
      variants.sort((a, b) => (a.size === b.size ? 0 : a.size > b.size ? -1 : 1));
    }
    const info: TypeSizeInfo = {
      kind,
      type_description: type_desc,
      align: align.bytes(),
      overall_size: overall_size.bytes_u64(),
      packed,
      opt_discr_size: opt_discr_size === undefined ? undefined : opt_discr_size.bytes_u64(),
      variants,
    };
    const key = key_TypeSizeInfo(info);
    if (!this.type_sizes.has(key)) this.type_sizes.set(key, info);
  }

  // rustc: compiler/rustc_session/src/code_stats.rs:111 print_type_sizes
  print_type_sizes(): void {
    const type_sizes = this.type_sizes;
    // We will soon sort, so the initial order does not matter.
    // #[allow(rustc::potential_query_instability)]
    const sorted: TypeSizeInfo[] = [...type_sizes.values()];

    // Primary sort: large-to-small.
    // Secondary sort: description (dictionary order)
    // PORT: two different infos with the same key keep the order of the `FxHashSet`'s iteration (the sort is stable), which
    // the `Map` does not reproduce: such a tie stops UNPORTED rather than print an order the oracle may not.
    sorted.sort((a, b) => {
      if (a.overall_size !== b.overall_size) return a.overall_size > b.overall_size ? -1 : 1;
      const c = str_cmp(a.type_description, b.type_description);
      if (c === 0) unported("rustc_session::code_stats::CodeStats::print_type_sizes: two types with the same size and description (FxHashSet order)");
      return c;
    });

    for (const info of sorted) {
      const { type_description, overall_size, align, kind, variants } = info;
      write_stdout(`print-type-size type: \`${type_description}\`: ${overall_size} bytes, alignment: ${align} bytes\n`);
      const indent = "    ";

      let discr_size: bigint;
      if (info.opt_discr_size !== undefined) {
        discr_size = info.opt_discr_size;
        write_stdout(`print-type-size ${indent}discriminant: ${discr_size} bytes\n`);
      } else {
        discr_size = 0n;
      }

      // We start this at discr_size (rather than 0) because
      // things like C-enums do not have variants but we still
      // want the max_variant_size at the end of the loop below
      // to reflect the presence of the discriminant.
      let max_variant_size = discr_size;

      let struct_like: boolean;
      switch (kind) {
        case "Struct":
        case "Closure":
          struct_like = true;
          break;
        case "Enum":
        case "Union":
        case "Coroutine":
          struct_like = false;
          break;
      }
      for (let i = 0; i < variants.length; i++) {
        const variant_info = variants[i]!;
        const { name, size, fields: fields_ } = variant_info;
        // PORT: the inner `indent`, which shadows the outer one after this `if`, is `indent_`.
        let indent_: string;
        if (!struct_like) {
          const name_ = name !== undefined ? display_Symbol(name) : String(i);
          write_stdout(`print-type-size ${indent}variant \`${name_}\`: ${u64_wrapping_sub(size, discr_size)} bytes\n`);
          indent_ = "        ";
        } else {
          assert(i < 1, "assertion failed: i < 1");
          indent_ = "    ";
        }
        // `cmp::max`
        max_variant_size = size >= max_variant_size ? size : max_variant_size;

        let min_offset = discr_size;

        // We want to print fields by increasing offset. We also want
        // zero-sized fields before non-zero-sized fields, otherwise
        // the loop below goes wrong; hence the `f.size` in the sort
        // key.
        const fields = [...fields_];
        // `sort_by_key(|f| (f.offset, f.size))`, stable.
        fields.sort((a, b) => (a.offset !== b.offset ? (a.offset < b.offset ? -1 : 1) : a.size === b.size ? 0 : a.size < b.size ? -1 : 1));

        for (const field of fields) {
          const { kind, name, offset, size, align, type_name } = field;

          if (offset > min_offset) {
            const pad = offset - min_offset;
            write_stdout(`print-type-size ${indent_}padding: ${pad} bytes\n`);
          }

          if (offset < min_offset) {
            // If this happens it's probably a union.
            write_stdout(
              `print-type-size ${indent_}${display_FieldKind(kind)} \`.${display_Symbol(name)}\`: ${size} bytes, ` +
                `offset: ${offset} bytes, ` +
                `alignment: ${align} bytes`,
            );
          } else if (info.packed || offset === min_offset) {
            write_stdout(`print-type-size ${indent_}${display_FieldKind(kind)} \`.${display_Symbol(name)}\`: ${size} bytes`);
          } else {
            // Include field alignment in output only if it caused padding injection
            write_stdout(
              `print-type-size ${indent_}${display_FieldKind(kind)} \`.${display_Symbol(name)}\`: ${size} bytes, ` +
                `alignment: ${align} bytes`,
            );
          }

          if (type_name !== undefined) {
            write_stdout(`, type: ${display_Symbol(type_name)}\n`);
          } else {
            write_stdout("\n");
          }

          // PORT: `u64` addition without overflow checks (rustc's release build): wrapping.
          min_offset = BigInt.asUintN(64, offset + size);
        }
      }

      // `overall_size.checked_sub(max_variant_size)`
      if (overall_size < max_variant_size) {
        panic(`max_variant_size ${max_variant_size} > ${overall_size} overall_size`);
      } else {
        const diff = overall_size - max_variant_size;
        if (diff >= 1n) write_stdout(`print-type-size ${indent}end padding: ${diff} bytes\n`);
      }
    }
  }
}
