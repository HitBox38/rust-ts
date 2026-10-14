// Port of compiler/rustc_ast_lowering/src/format.rs
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker; the free fns
// have their final signatures in decls.ts `FreeFns`.
// Init order: top-level code here may touch only `./decls.ts` and other crates; every other
// rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
import { format, LitKind, type IntTy, type UintTy, type token } from "../rustc_ast/lib.ts";
import { LangItem } from "../rustc_attr_ir/lib.ts";
import { Block } from "../rustc_hir/lib.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { SyntaxContext } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { ByteSymbol, Ident, Symbol, sym } from "../rustc_span/symbol.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { assert, unported, unreachable } from "../std/panic.ts";
import { Ok } from "../std/result.ts";
import { Str, str_floor_char_boundary } from "../std/str.ts";
import { LoweringContext } from "./decls.ts";
import type * as hir from "./hir_shim.ts";
export * from "./format.gen.ts";
import { ArgumentType } from "./format.gen.ts";

/**
 * PORT: `std::borrow::Cow<'_, FormatArgs>` (format.rs `inline_literals` / `flatten_format_args`). The AST must
 * not be mutated through a borrowed value, so `Cow::to_mut` on `Borrowed` clones (`clone_FormatArgs`) and
 * yields `Owned`. Contract choice of lane lowering-contract.
 */
export type Cow<T> = { readonly $: "Borrowed"; readonly _0: T } | { readonly $: "Owned"; readonly _0: T };

/**
 * PORT: `Cow::to_mut` for `Cow<FormatArgs>`: a `Borrowed` value is cloned (`FormatArgs: Clone`, a deep clone like
 * the derived `Clone` of the AST) and becomes `Owned`. Returns the (possibly new) `Cow`; its `_0` is the `&mut`.
 */
function cow_to_mut(c: Cow<format.FormatArgs>): Cow<format.FormatArgs> {
  return c.$ === "Owned" ? c : { $: "Owned", _0: format.clone_FormatArgs(c._0) };
}

/**
 * PORT: `*f == FormatOptions::default()` (derived `PartialEq` and `Default`: every field `None`/`false`).
 * Same helper as rustc_builtin_macros/format.ts and rustc_ast_pretty's.
 */
function format_options_is_default(f: format.FormatOptions): boolean {
  return (
    f.width === undefined &&
    f.precision === undefined &&
    f.alignment === undefined &&
    f.fill === undefined &&
    f.sign === undefined &&
    !f.alternate &&
    !f.zero_pad &&
    f.debug_hex === undefined
  );
}

/**
 * PORT: `usize::MAX`, the "argument that doesn't exist" index. Only compared and used as a key; any value above
 * every valid argument index behaves the same (`arguments.get(usize::MAX)` is `None`).
 */
const USIZE_MAX = 2 ** 64 - 1;

/** PORT: `IndexMap::insert_full` on a JS `Map` (insertion-ordered): returns `(index, old_value)`; an existing
 *  key keeps its position and gets the new value. */
function insert_full<K, V>(map: Map<K, V>, k: K, v: V): [number, V | undefined] {
  const stored = map instanceof KeyedMap ? (map as KeyedMap<K, V>).stored_key(k) : map.has(k) ? k : undefined;
  if (stored === undefined) {
    const index = map.size;
    map.set(k, v);
    return [index, undefined];
  }
  let index = 0;
  for (const key of map.keys()) {
    if (key === stored) break;
    index++;
  }
  const old = map.get(stored);
  map.set(stored, v);
  return [index, old];
}

/** u16 little-endian bytes (`u16::to_le_bytes`) */
function push_u16_le(bytecode: number[], v: number): void {
  bytecode.push(v & 0xff, (v >>> 8) & 0xff);
}

/** u32 little-endian bytes (`u32::to_le_bytes`) */
function push_u32_le(bytecode: number[], v: number): void {
  bytecode.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

// rustc: compiler/rustc_ast_lowering/src/format.rs:13 lower_format_args
LoweringContext.prototype.lower_format_args = function (
  this: LoweringContext,
  sp_: Span,
  fmt_: format.FormatArgs,
): hir.ExprKind {
  // Never call the const constructor of `fmt::Arguments` if the
  // format_args!() had any arguments _before_ flattening/inlining.
  const allow_const = fmt_.arguments.all_args().length === 0;
  let fmt: Cow<format.FormatArgs> = { $: "Borrowed", _0: fmt_ };

  const sp = this.mark_span_with_reason(
    { $: "FormatLiteral", source: fmt._0.is_source_literal },
    sp_,
    SyntaxContext.outer_expn_data(Span.ctxt(sp_)).allow_internal_unstable,
  );

  if (this.tcx.sess.opts.unstable_opts.flatten_format_args) {
    fmt = flatten_format_args(fmt);
    fmt = this.inline_literals(fmt);
  }
  return expand_format_args(this, sp, fmt._0, allow_const);
};

/// Try to convert a literal into an interned string
// rustc: compiler/rustc_ast_lowering/src/format.rs:33 try_inline_lit
LoweringContext.prototype.try_inline_lit = function (this: LoweringContext, lit: token.Lit): Symbol | undefined {
  const r = LitKind.from_token_lit(lit);
  if (r.$ === "Ok" && r._0.$ === "Str") {
    return r._0._0;
  } else if (r.$ === "Ok" && r._0.$ === "Int") {
    const n = r._0._0;
    const ty = r._0._1;
    // PORT: `cond.then_some(Symbol::intern(..))` interns eagerly, whatever `cond` is; kept, since interning
    // assigns symbol indices.
    switch (ty.$) {
      // unsuffixed integer literals are assumed to be i32's
      case "Unsuffixed": {
        const s = Symbol.intern(n.toString());
        return n <= 2147483647n ? s : undefined;
      }
      case "Signed": {
        const int_ty = ty._0;
        const max_literal = this.int_ty_max(int_ty);
        const s = Symbol.intern(n.toString());
        return n <= max_literal ? s : undefined;
      }
      case "Unsigned": {
        const uint_ty = ty._0;
        const max_literal = this.uint_ty_max(uint_ty);
        const s = Symbol.intern(n.toString());
        return n <= max_literal ? s : undefined;
      }
    }
  } else {
    return undefined;
  }
};

/// Get the maximum value of int_ty. It is platform-dependent due to the byte size of isize
// rustc: compiler/rustc_ast_lowering/src/format.rs:57 int_ty_max
LoweringContext.prototype.int_ty_max = function (this: LoweringContext, int_ty: IntTy): bigint {
  switch (int_ty) {
    case "Isize":
      // PORT: `self.tcx.data_layout.pointer_size().signed_int_max() as u128`: `GlobalCtxt::data_layout` is unported
      // (rustc_middle ty/context.ts) and so is `Size::signed_int_max` (rustc_abi lib.rs:990).
      return unported("rustc_abi::Size::signed_int_max (format.rs int_ty_max: tcx.data_layout.pointer_size())");
    case "I8":
      return 127n;
    case "I16":
      return 32767n;
    case "I32":
      return 2147483647n;
    case "I64":
      return 9223372036854775807n;
    case "I128":
      return 170141183460469231731687303715884105727n;
  }
};

/// Get the maximum value of uint_ty. It is platform-dependent due to the byte size of usize
// rustc: compiler/rustc_ast_lowering/src/format.rs:69 uint_ty_max
LoweringContext.prototype.uint_ty_max = function (this: LoweringContext, uint_ty: UintTy): bigint {
  switch (uint_ty) {
    case "Usize":
      // PORT: `self.tcx.data_layout.pointer_size().unsigned_int_max()`: `GlobalCtxt::data_layout` is unported
      // (rustc_middle ty/context.ts) and so is `Size::unsigned_int_max` (rustc_abi lib.rs:995).
      return unported("rustc_abi::Size::unsigned_int_max (format.rs uint_ty_max: tcx.data_layout.pointer_size())");
    case "U8":
      return 255n;
    case "U16":
      return 65535n;
    case "U32":
      return 4294967295n;
    case "U64":
      return 18446744073709551615n;
    case "U128":
      return 340282366920938463463374607431768211455n;
  }
};

/// Inline literals into the format string.
///
/// Turns
///
/// `format_args!("Hello, {}! {} {}", "World", 123, x)`
///
/// into
///
/// `format_args!("Hello, World! 123 {}", x)`.
// rustc: compiler/rustc_ast_lowering/src/format.rs:89 inline_literals
LoweringContext.prototype.inline_literals = function (
  this: LoweringContext,
  fmt_: Cow<format.FormatArgs>,
): Cow<format.FormatArgs> {
  let fmt = fmt_;
  const was_inlined: boolean[] = new Array<boolean>(fmt._0.arguments.all_args().length).fill(false);
  let inlined_anything = false;

  for (let i = 0; i < fmt._0.template.length; i++) {
    const piece = fmt._0.template[i]!;
    if (piece.$ !== "Placeholder") continue;
    const placeholder = piece._0;
    if (placeholder.argument.index.$ !== "Ok") continue;
    const arg_index = placeholder.argument.index._0;
    if (placeholder.format_trait !== "Display") continue;
    if (!format_options_is_default(placeholder.format_options)) continue;
    const arg = fmt._0.arguments.all_args()[arg_index]!.expr.peel_parens_and_refs();
    if (arg.kind.$ !== "Lit") continue;
    const literal = this.try_inline_lit(arg.kind._0);
    if (literal === undefined) continue;
    {
      // Now we need to mutate the outer FormatArgs.
      // If this is the first time, this clones the outer FormatArgs.
      fmt = cow_to_mut(fmt);
      // Replace the placeholder with the literal.
      fmt._0.template[i] = { $: "Literal", _0: literal };
      was_inlined[arg_index] = true;
      inlined_anything = true;
    }
  }

  // Remove the arguments that were inlined.
  if (inlined_anything) {
    fmt = cow_to_mut(fmt);
    const fmt_mut = fmt._0;

    const remove = was_inlined;

    // Don't remove anything that's still used.
    for_all_argument_indexes(fmt_mut.template, (index) => {
      remove[index.value] = false;
    });

    // Drop all the arguments that are marked for removal.
    // PORT: `Vec::retain` with `remove_it.next() != Some(&true)`, in place.
    const args = fmt_mut.arguments.all_args_mut();
    let w = 0;
    for (let r = 0; r < args.length; r++) {
      if (remove[r] !== true) args[w++] = args[r]!;
    }
    args.length = w;

    // Calculate the mapping of old to new indexes for the remaining arguments.
    const index_map: number[] = [];
    {
      let i = 0;
      for (const remove_ of remove) {
        const mapped = i;
        i += !remove_ ? 1 : 0;
        index_map.push(mapped);
      }
    }

    // Correct the indexes that refer to arguments that have shifted position.
    for_all_argument_indexes(fmt_mut.template, (index) => {
      index.value = index_map[index.value]!;
    });
  }

  return fmt;
};

/// Flattens nested `format_args!()` into one.
///
/// Turns
///
/// `format_args!("a {} {} {}.", 1, format_args!("b{}!", 2), 3)`
///
/// into
///
/// `format_args!("a {} b{}! {}.", 1, 2, 3)`.
// rustc: compiler/rustc_ast_lowering/src/format.rs:152 flatten_format_args
export function flatten_format_args(fmt_: Cow<format.FormatArgs>): Cow<format.FormatArgs> {
  let fmt = fmt_;
  let i = 0;
  while (i < fmt._0.template.length) {
    // PORT: the `if let .. && ..` chain; `arg_index` is set exactly when the chain holds.
    let arg_index: number | undefined;
    const piece = fmt._0.template[i]!;
    if (piece.$ === "Placeholder") {
      const placeholder = piece._0;
      if (
        (placeholder.format_trait === "Display" || placeholder.format_trait === "Debug") &&
        placeholder.argument.index.$ === "Ok"
      ) {
        const idx = placeholder.argument.index._0;
        const arg = fmt._0.arguments.all_args()[idx]!.expr.peel_parens_and_refs();
        if (
          arg.kind.$ === "FormatArgs" &&
          // Check that this argument is not used by any other placeholders.
          fmt._0.template.every(
            (p, j) =>
              i === j ||
              !(p.$ === "Placeholder" && p._0.argument.index.$ === "Ok" && p._0.argument.index._0 === idx),
          )
        ) {
          arg_index = idx;
        }
      }
    }
    if (arg_index !== undefined) {
      // Now we need to mutate the outer FormatArgs.
      // If this is the first time, this clones the outer FormatArgs.
      fmt = cow_to_mut(fmt);
      const fmt_mut = fmt._0;

      // Take the inner FormatArgs out of the outer arguments, and
      // replace it by the inner arguments. (We can't just put those at
      // the end, because we need to preserve the order of evaluation.)

      const args = fmt_mut.arguments.all_args_mut();
      const remaining_args = args.splice(arg_index + 1);
      const old_arg_offset = args.length;
      let fmt2_expr = args.pop()!.expr; // The inner FormatArgs.
      let fmt2: format.FormatArgs;
      for (;;) {
        // Unwrap the Expr to get to the FormatArgs.
        const kind = fmt2_expr.kind;
        if (kind.$ === "Paren") {
          fmt2_expr = kind._0;
        } else if (kind.$ === "AddrOf" && kind._0 === "Ref") {
          fmt2_expr = kind._2;
        } else if (kind.$ === "FormatArgs") {
          fmt2 = kind._0;
          break;
        } else {
          return unreachable();
        }
      }

      // `args.append(fmt2.arguments.all_args_mut())`: moves (drains) the inner arguments.
      args.push(...fmt2.arguments.all_args_mut().splice(0));
      const new_arg_offset = args.length;
      args.push(...remaining_args);

      // Correct the indexes that refer to the arguments after the newly inserted arguments.
      for_all_argument_indexes(fmt_mut.template, (index) => {
        if (index.value >= old_arg_offset) {
          index.value -= old_arg_offset;
          index.value += new_arg_offset;
        }
      });

      // Now merge the placeholders:

      const rest = fmt_mut.template.splice(i + 1);
      fmt_mut.template.pop(); // remove the placeholder for the nested fmt args.
      // Insert the pieces from the nested format args, but correct any
      // placeholders to point to the correct argument index.
      const arg_index_ = arg_index;
      for_all_argument_indexes(fmt2.template, (index) => {
        index.value += arg_index_;
      });
      fmt_mut.template.push(...fmt2.template.splice(0));
      fmt_mut.template.push(...rest);

      // Don't increment `i` here, so we recurse into the newly added pieces.
    } else {
      i += 1;
    }
  }
  return fmt;
}

// (format.rs:221 `ArgumentType`: format.gen.ts. `#[derive(Hash, PartialEq, Eq)]` is the `argmap` key, `key_argmap`.)
/** Canonical key of the derived `Hash + Eq` of `(usize, ArgumentType)` (the `argmap` key). */
function key_argmap(k: readonly [number, ArgumentType]): string {
  const ty = k[1];
  return `${k[0]}:${ty.$ === "Format" ? ty._0 : ty.$}`;
}

/// Generate a hir expression representing an argument to a format_args invocation.
///
/// Generates:
///
/// ```text
///     <core::fmt::Argument>::new_…(arg)
/// ```
// rustc: compiler/rustc_ast_lowering/src/format.rs:233 make_argument
export function make_argument(ctx: LoweringContext, sp: Span, arg: hir.Expr, ty: ArgumentType): hir.Expr {
  let name: Symbol;
  if (ty.$ === "Format") {
    switch (ty._0) {
      case "Display":
        name = sym.new_display;
        break;
      case "Debug":
        switch (ctx.tcx.sess.opts.unstable_opts.fmt_debug) {
          case "Full":
          case "Shallow":
            name = sym.new_debug;
            break;
          case "None":
            name = sym.new_debug_noop;
            break;
        }
        break;
      case "LowerExp":
        name = sym.new_lower_exp;
        break;
      case "UpperExp":
        name = sym.new_upper_exp;
        break;
      case "Octal":
        name = sym.new_octal;
        break;
      case "Pointer":
        name = sym.new_pointer;
        break;
      case "Binary":
        name = sym.new_binary;
        break;
      case "LowerHex":
        name = sym.new_lower_hex;
        break;
      case "UpperHex":
        name = sym.new_upper_hex;
        break;
    }
  } else {
    name = sym.from_usize;
  }
  const new_fn = ctx.arena.alloc(ctx.expr_lang_item_type_relative(sp, LangItem.FormatArgument, name));
  return ctx.expr_call_mut(sp, new_fn, [arg]);
}

/// Get the value for a `width` or `precision` field.
///
/// Returns the value and whether it is indirect (an indexed argument) or not.
// rustc: compiler/rustc_ast_lowering/src/format.rs:266 make_count
export function make_count(
  count: format.FormatCount,
  argmap: Map<[number, ArgumentType], Span | undefined>,
): [boolean, number] {
  switch (count.$) {
    case "Literal":
      return [false, count._0];
    case "Argument": {
      const arg = count._0;
      return [
        true,
        insert_full(argmap, [arg.index.$ === "Ok" ? arg.index._0 : USIZE_MAX, ArgumentType.Usize], arg.span)[0] & 0xffff,
      ];
    }
  }
}

// rustc: compiler/rustc_ast_lowering/src/format.rs:280 expand_format_args
export function expand_format_args(
  ctx: LoweringContext,
  macsp_: Span,
  fmt: format.FormatArgs,
  allow_const: boolean,
): hir.ExprKind {
  const macsp = ctx.lower_span(macsp_);

  // Create a list of all _unique_ (argument, format trait) combinations.
  // E.g. "{0} {0:x} {0} {1}" -> [(0, Display), (0, LowerHex), (1, Display)]
  //
  // We use usize::MAX for arguments that don't exist, because that can never be a valid index
  // into the arguments array.
  // PORT: `FxIndexMap<(usize, ArgumentType), Option<Span>>`: a `KeyedMap` (insertion-ordered) keyed by value.
  const argmap = new KeyedMap<[number, ArgumentType], Span | undefined>(key_argmap);

  let incomplete_lit = "";

  let implicit_arg_index = 0;

  const bytecode: number[] = [];

  const template: readonly format.FormatArgsPiece[] =
    fmt.template.length === 0
      ? // Treat empty templates as a single literal piece (with an empty string),
        // so we produce `from_str("")` for those.
        [{ $: "Literal", _0: sym.empty }]
      : fmt.template;

  // See library/core/src/fmt/mod.rs for the format string encoding format.

  for (let i = 0; i < template.length; i++) {
    const piece = template[i]!;
    switch (piece.$) {
      case "Literal": {
        const sym_ = piece._0;
        // Coalesce adjacent literal pieces.
        const next = template[i + 1];
        if (next !== undefined && next.$ === "Literal") {
          incomplete_lit += Symbol.as_str(sym_);
          continue;
        }
        let s_: string;
        if (incomplete_lit.length === 0) {
          s_ = Symbol.as_str(sym_);
        } else {
          incomplete_lit += Symbol.as_str(sym_);
          s_ = incomplete_lit;
        }

        // If this is the last piece and was the only piece, that means
        // there are no placeholders and the entire format string is just a literal.
        //
        // In that case, we can just use `from_str`.
        if (i + 1 === template.length && bytecode.length === 0) {
          // Generate:
          //     <core::fmt::Arguments>::from_str("meow")
          const from_str = ctx.arena.alloc(
            ctx.expr_lang_item_type_relative(
              macsp,
              LangItem.FormatArguments,
              allow_const ? sym.from_str : sym.from_str_nonconst,
            ),
          );
          const sym2 = incomplete_lit.length === 0 ? sym_ : Symbol.intern(s_);
          const s2 = ctx.expr_str(fmt.span, sym2);
          const args = ctx.arena.alloc_from_iter([s2]);
          return { $: "Call", _0: from_str, _1: args };
        }

        // Encode the literal in chunks of up to u16::MAX bytes, split at utf-8 boundaries.
        let s = Str.from(s_);
        while (!s.is_empty()) {
          const len = str_floor_char_boundary(s, 0xffff);
          if (len < 0x80) {
            bytecode.push(len);
          } else {
            bytecode.push(0x80);
            push_u16_le(bytecode, len);
          }
          for (let k = 0; k < len; k++) bytecode.push(s.byte(k));
          s = s.slice(len);
        }

        incomplete_lit = "";
        break;
      }
      case "Placeholder": {
        const p = piece._0;
        // Push the start byte and remember its index so we can set the option bits later.
        const i = bytecode.length;
        bytecode.push(0xc0);

        // PORT: `.0 as u64`: positions stay far below 2^53.
        const position = insert_full<[number, ArgumentType], Span | undefined>(
          argmap,
          [p.argument.index.$ === "Ok" ? p.argument.index._0 : USIZE_MAX, { $: "Format", _0: p.format_trait }],
          p.span,
        )[0];

        // This needs to match the constants in library/core/src/fmt/mod.rs.
        const o = p.format_options;
        let align: number;
        switch (o.alignment) {
          case "Left":
            align = 0;
            break;
          case "Right":
            align = 1;
            break;
          case "Center":
            align = 2;
            break;
          case undefined:
            align = 3;
            break;
        }
        const default_flags = 0x6000_0020;
        const flags: number =
          ((o.fill ?? 0x20) |
            ((o.sign === "Plus" ? 1 : 0) << 21) |
            ((o.sign === "Minus" ? 1 : 0) << 22) |
            ((o.alternate ? 1 : 0) << 23) |
            ((o.zero_pad ? 1 : 0) << 24) |
            ((o.debug_hex === "Lower" ? 1 : 0) << 25) |
            ((o.debug_hex === "Upper" ? 1 : 0) << 26) |
            ((o.width !== undefined ? 1 : 0) << 27) |
            ((o.precision !== undefined ? 1 : 0) << 28) |
            (align << 29)) >>>
          0;
        if (flags !== default_flags) {
          bytecode[i] = bytecode[i]! | 1;
          push_u32_le(bytecode, flags);
          if (o.width !== undefined) {
            const val_ = o.width;
            const [indirect, val] = make_count(val_, argmap);
            // Only encode if nonzero; zero is the default.
            if (indirect || val !== 0) {
              bytecode[i] = bytecode[i]! | (1 << 1) | ((indirect ? 1 : 0) << 4);
              push_u16_le(bytecode, val);
            }
          }
          if (o.precision !== undefined) {
            const val_ = o.precision;
            const [indirect, val] = make_count(val_, argmap);
            // Only encode if nonzero; zero is the default.
            if (indirect || val !== 0) {
              bytecode[i] = bytecode[i]! | (1 << 2) | ((indirect ? 1 : 0) << 5);
              push_u16_le(bytecode, val);
            }
          }
        }
        if (implicit_arg_index !== position) {
          bytecode[i] = bytecode[i]! | (1 << 3);
          push_u16_le(bytecode, position & 0xffff);
        }
        implicit_arg_index = position + 1;
        break;
      }
    }
  }

  assert(incomplete_lit.length === 0, "assertion failed: incomplete_lit.is_empty()");

  // Zero terminator.
  bytecode.push(0);

  // Ensure all argument indexes actually fit in 16 bits, as we truncated them to 16 bits before.
  if (argmap.size > 0xffff) {
    ctx.dcx().span_err(macsp, "too many format arguments");
  }

  const arguments_ = fmt.arguments.all_args();

  let let_statements: hir.Stmt[];
  let args: hir.Expr;
  if (arguments_.length === 0) {
    // Generate:
    //     []
    let_statements = [];
    args = ctx.arena.alloc(ctx.expr(macsp, { $: "Array", _0: [] }));
  } else {
    // Generate:
    //     super let args = (&arg0, &arg1, &…);
    const args_ident = Ident.new(sym.args, macsp);
    const [args_pat, args_hir_id] = ctx.pat_ident(macsp, args_ident);
    const elements = ctx.arena.alloc_from_iter(
      arguments_.map((arg) => {
        const arg_expr = ctx.lower_expr(arg.expr);
        return ctx.expr(Span.with_ctxt(arg.expr.span, Span.ctxt(macsp)), {
          $: "AddrOf",
          _0: "Ref",
          _1: "Not",
          _2: arg_expr,
        });
      }),
    );
    const args_tuple = ctx.arena.alloc(ctx.expr(macsp, { $: "Tup", _0: elements }));
    const let_statement_1 = ctx.stmt_super_let_pat(macsp, args_pat, args_tuple);

    // Generate:
    //     super let args = [
    //         <core::fmt::Argument>::new_display(args.0),
    //         <core::fmt::Argument>::new_lower_hex(args.1),
    //         <core::fmt::Argument>::new_debug(args.0),
    //         …
    //     ];
    const args_ = ctx.arena.alloc_from_iter(
      [...argmap].map(([[arg_index, ty], placeholder_span_]) => {
        const arg = arg_index < arguments_.length ? arguments_[arg_index] : undefined;
        if (arg !== undefined) {
          const placeholder_span = Span.with_ctxt(placeholder_span_ ?? arg.expr.span, Span.ctxt(macsp));
          const arg_span =
            arg.kind.$ === "Captured" ? placeholder_span : Span.with_ctxt(arg.expr.span, Span.ctxt(macsp));
          const args_ident_expr = ctx.expr_ident(macsp, args_ident, args_hir_id);
          const arg_ = ctx.arena.alloc(
            ctx.expr(arg_span, { $: "Field", _0: args_ident_expr, _1: Ident.new(sym.integer(arg_index), macsp) }),
          );
          return make_argument(ctx, placeholder_span, arg_, ty);
        } else {
          return ctx.expr(macsp, {
            $: "Err",
            _0: ctx.dcx().span_delayed_bug(macsp, "missing format_args argument"),
          });
        }
      }),
    );
    const args_array = ctx.arena.alloc(ctx.expr(macsp, { $: "Array", _0: args_ }));
    const [args_pat2, args_hir_id2] = ctx.pat_ident(macsp, args_ident);
    const let_statement_2 = ctx.stmt_super_let_pat(macsp, args_pat2, args_array);
    let_statements = [let_statement_1, let_statement_2];
    args = ctx.arena.alloc(ctx.expr_ident_mut(macsp, args_ident, args_hir_id2));
  }

  // Generate:
  //     unsafe {
  //         <core::fmt::Arguments>::new(b"…", &args)
  //     }
  const template_ = ctx.expr_byte_str(macsp, ByteSymbol.intern(Uint8Array.from(bytecode)));
  let call_: hir.Expr;
  {
    const new_ = ctx.arena.alloc(ctx.expr_lang_item_type_relative(macsp, LangItem.FormatArguments, sym.new));
    const args_ref = ctx.expr_ref(macsp, args);
    const new_args = ctx.arena.alloc_from_iter([template_, args_ref]);
    call_ = ctx.expr_call(macsp, new_, new_args);
  }
  const call: hir.ExprKind = {
    $: "Block",
    _0: ctx.arena.alloc(
      new Block([], call_, ctx.next_id(), { $: "UnsafeBlock", _0: "CompilerGenerated" }, macsp, false),
    ),
    _1: undefined,
  };

  if (let_statements.length !== 0) {
    // Generate:
    //     {
    //         super let …
    //         super let …
    //         <core::fmt::Arguments>::new(…)
    //     }
    const call_expr = ctx.arena.alloc(ctx.expr(macsp, call));
    const block = ctx.block_all(macsp, ctx.arena.alloc_from_iter(let_statements), call_expr);
    return { $: "Block", _0: block, _1: undefined };
  } else {
    return call;
  }
}

// rustc: compiler/rustc_ast_lowering/src/format.rs:539 for_all_argument_indexes
export function for_all_argument_indexes(template: format.FormatArgsPiece[], f: (_1: MutRef<number>) => void): void {
  // PORT: `&mut usize` into `Ok(index)`: `Result` objects are immutable here, so the slot is read into a `MutRef`
  // and written back as a fresh `Ok(..)`.
  for (const piece of template) {
    if (piece.$ !== "Placeholder") continue;
    const placeholder = piece._0;
    if (placeholder.argument.index.$ === "Ok") {
      const index = { value: placeholder.argument.index._0 };
      f(index);
      placeholder.argument.index = Ok(index.value);
    }
    const width = placeholder.format_options.width;
    if (width !== undefined && width.$ === "Argument" && width._0.index.$ === "Ok") {
      const index = { value: width._0.index._0 };
      f(index);
      width._0.index = Ok(index.value);
    }
    const precision = placeholder.format_options.precision;
    if (precision !== undefined && precision.$ === "Argument" && precision._0.index.$ === "Ok") {
      const index = { value: precision._0.index._0 };
      f(index);
      precision._0.index = Ok(index.value);
    }
  }
}
