// Port of library/proc_macro/src/to_tokens.rs.
//
// PORT: library crate, `// std:` markers (decision 2026-10-13). The trait is a function table
// (`ToTokens<Self>`, PORTING §5 "generic trait bounds → pass function tables"): one `ToTokens_for_<Type>` const per
// impl; the provided methods live in `ToTokens_provided` (PORTING §8) and every table carries them, overridden
// where upstream overrides them. The generic impls over a `T: ToTokens` (`&T`, `&mut T`, `Box<T>`, `Rc<T>`,
// `Cow<T>`, `Option<T>`) take the inner table. Primitive receivers: `u8`..`u32`, `usize`, `isize`, `i8`..`i32`,
// `f32`, `f64`, `char` are `number`; `u64`, `u128`, `i64`, `i128` are `bigint`; `str`/`String` are `string`;
// `CStr`/`CString` are their `to_bytes()` (`Uint8Array`, no terminating NUL).

import { ConcatTreesHelper, Ident, Literal, Span, TokenStream, type TokenTree, clone_TokenTree } from "./lib.ts";
import type { Group, Punct } from "./lib.ts";

/// Types that can be interpolated inside a [`quote!`] invocation.
///
/// [`quote!`]: crate::quote!
// std-type: library/proc_macro/src/to_tokens.rs:11 ToTokens
export interface ToTokens<Self> {
  /// Write `self` to the given `TokenStream`.
  ///
  /// # Example
  ///
  /// Example implementation for a struct representing Rust paths like
  /// `std::cmp::PartialEq`:
  ///
  /// ```
  /// #![feature(proc_macro_totokens)]
  ///
  /// use std::iter;
  /// use proc_macro::{Spacing, Punct, TokenStream, TokenTree, ToTokens};
  ///
  /// pub struct Path {
  ///     pub global: bool,
  ///     pub segments: Vec<PathSegment>,
  /// }
  ///
  /// impl ToTokens for Path {
  ///     fn to_tokens(&self, tokens: &mut TokenStream) {
  ///         for (i, segment) in self.segments.iter().enumerate() {
  ///             if i > 0 || self.global {
  ///                 // Double colon `::`
  ///                 tokens.extend(iter::once(TokenTree::from(Punct::new(':', Spacing::Joint))));
  ///                 tokens.extend(iter::once(TokenTree::from(Punct::new(':', Spacing::Alone))));
  ///             }
  ///             segment.to_tokens(tokens);
  ///         }
  ///     }
  /// }
  /// #
  /// # pub struct PathSegment;
  /// #
  /// # impl ToTokens for PathSegment {
  /// #     fn to_tokens(&self, tokens: &mut TokenStream) {
  /// #         unimplemented!()
  /// #     }
  /// # }
  /// ```
  // std: library/proc_macro/src/to_tokens.rs:51 to_tokens
  to_tokens(self_: Self, tokens: TokenStream): void;

  // (provided) to_token_stream
  to_token_stream(self_: Self): TokenStream;

  // (provided) into_token_stream
  into_token_stream(self_: Self): TokenStream;
}

export const ToTokens_provided = {
  /// Convert `self` directly into a `TokenStream` object.
  ///
  /// This method is implicitly implemented using `to_tokens`, and acts as a
  /// convenience method for consumers of the `ToTokens` trait.
  // std: library/proc_macro/src/to_tokens.rs:57 to_token_stream
  to_token_stream<Self>(impl: ToTokens<Self>, self_: Self): TokenStream {
    const tokens = TokenStream.new();
    impl.to_tokens(self_, tokens);
    return tokens;
  },

  /// Convert `self` directly into a `TokenStream` object.
  ///
  /// This method is implicitly implemented using `to_tokens`, and acts as a
  /// convenience method for consumers of the `ToTokens` trait.
  // std: library/proc_macro/src/to_tokens.rs:67 into_token_stream
  into_token_stream<Self>(impl: ToTokens<Self>, self_: Self): TokenStream {
    return impl.to_token_stream(self_);
  },
};

/** Builds an impl's table: `to_tokens` plus the provided methods (or the impl's overrides). */
function impl_ToTokens<Self>(
  m: { to_tokens(self_: Self, tokens: TokenStream): void } & Partial<ToTokens<Self>>,
): ToTokens<Self> {
  const impl: ToTokens<Self> = {
    to_tokens: m.to_tokens,
    to_token_stream: m.to_token_stream ?? ((self_) => ToTokens_provided.to_token_stream(impl, self_)),
    into_token_stream: m.into_token_stream ?? ((self_) => ToTokens_provided.into_token_stream(impl, self_)),
  };
  return impl;
}

export const ToTokens_for_TokenTree: ToTokens<TokenTree> = impl_ToTokens<TokenTree>({
  // std: library/proc_macro/src/to_tokens.rs:77 to_tokens
  to_tokens(self_: TokenTree, tokens: TokenStream): void {
    tokens.extend_one_TokenTree(clone_TokenTree(self_));
  },

  // std: library/proc_macro/src/to_tokens.rs:81 into_token_stream
  into_token_stream(self_: TokenTree): TokenStream {
    const builder = ConcatTreesHelper.new(1);
    builder.push(self_);
    return builder.build();
  },
});

export const ToTokens_for_TokenStream: ToTokens<TokenStream> = impl_ToTokens<TokenStream>({
  // std: library/proc_macro/src/to_tokens.rs:90 to_tokens
  // PORT: `tokens.extend(self.clone())` resolves to `Extend<TokenTree>` (a `TokenStream` is an
  // `IntoIterator<Item = TokenTree>`), so the clone is split into its trees (`ts_into_trees`) and re-joined.
  to_tokens(self_: TokenStream, tokens: TokenStream): void {
    tokens.extend_TokenTree(self_.clone().into_iter());
  },

  // std: library/proc_macro/src/to_tokens.rs:94 into_token_stream
  into_token_stream(self_: TokenStream): TokenStream {
    return self_;
  },
});

export const ToTokens_for_Literal: ToTokens<Literal> = impl_ToTokens<Literal>({
  // std: library/proc_macro/src/to_tokens.rs:101 to_tokens
  to_tokens(self_: Literal, tokens: TokenStream): void {
    tokens.extend_one_TokenTree({ $: "Literal", _0: self_.clone() });
  },
});

export const ToTokens_for_Ident: ToTokens<Ident> = impl_ToTokens<Ident>({
  // std: library/proc_macro/src/to_tokens.rs:108 to_tokens
  to_tokens(self_: Ident, tokens: TokenStream): void {
    tokens.extend_one_TokenTree({ $: "Ident", _0: self_.clone() });
  },
});

export const ToTokens_for_Punct: ToTokens<Punct> = impl_ToTokens<Punct>({
  // std: library/proc_macro/src/to_tokens.rs:115 to_tokens
  to_tokens(self_: Punct, tokens: TokenStream): void {
    tokens.extend_one_TokenTree({ $: "Punct", _0: self_.clone() });
  },
});

export const ToTokens_for_Group: ToTokens<Group> = impl_ToTokens<Group>({
  // std: library/proc_macro/src/to_tokens.rs:122 to_tokens
  to_tokens(self_: Group, tokens: TokenStream): void {
    tokens.extend_one_TokenTree({ $: "Group", _0: self_.clone() });
  },
});

/** `impl<T: ToTokens + ?Sized> ToTokens for &T` */
export function ToTokens_for_ref<T>(inner: ToTokens<T>): ToTokens<T> {
  return impl_ToTokens<T>({
    // std: library/proc_macro/src/to_tokens.rs:129 to_tokens
    to_tokens(self_: T, tokens: TokenStream): void {
      inner.to_tokens(self_, tokens);
    },
  });
}

/** `impl<T: ToTokens + ?Sized> ToTokens for &mut T` */
export function ToTokens_for_ref_mut<T>(inner: ToTokens<T>): ToTokens<T> {
  return impl_ToTokens<T>({
    // std: library/proc_macro/src/to_tokens.rs:136 to_tokens
    to_tokens(self_: T, tokens: TokenStream): void {
      inner.to_tokens(self_, tokens);
    },
  });
}

/** `impl<T: ToTokens + ?Sized> ToTokens for Box<T>` */
export function ToTokens_for_Box<T>(inner: ToTokens<T>): ToTokens<T> {
  return impl_ToTokens<T>({
    // std: library/proc_macro/src/to_tokens.rs:143 to_tokens
    to_tokens(self_: T, tokens: TokenStream): void {
      inner.to_tokens(self_, tokens);
    },
  });
}

/** `impl<T: ToTokens + ?Sized> ToTokens for Rc<T>` */
export function ToTokens_for_Rc<T>(inner: ToTokens<T>): ToTokens<T> {
  return impl_ToTokens<T>({
    // std: library/proc_macro/src/to_tokens.rs:150 to_tokens
    to_tokens(self_: T, tokens: TokenStream): void {
      inner.to_tokens(self_, tokens);
    },
  });
}

/** `impl<T: ToTokens + ToOwned + ?Sized> ToTokens for Cow<'_, T>` */
export function ToTokens_for_Cow<T>(inner: ToTokens<T>): ToTokens<T> {
  return impl_ToTokens<T>({
    // std: library/proc_macro/src/to_tokens.rs:157 to_tokens
    to_tokens(self_: T, tokens: TokenStream): void {
      inner.to_tokens(self_, tokens);
    },
  });
}

/** `impl<T: ToTokens> ToTokens for Option<T>` */
export function ToTokens_for_Option<T>(inner: ToTokens<T>): ToTokens<T | undefined> {
  return impl_ToTokens<T | undefined>({
    // std: library/proc_macro/src/to_tokens.rs:164 to_tokens
    to_tokens(self_: T | undefined, tokens: TokenStream): void {
      if (self_ !== undefined) {
        inner.to_tokens(self_, tokens);
      }
    },
  });
}

export const ToTokens_for_u8: ToTokens<number> = impl_ToTokens<number>({
  // std: library/proc_macro/src/to_tokens.rs:173 to_tokens
  to_tokens(self_: number, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.u8_suffixed(self_), tokens);
  },
});

export const ToTokens_for_u16: ToTokens<number> = impl_ToTokens<number>({
  // std: library/proc_macro/src/to_tokens.rs:180 to_tokens
  to_tokens(self_: number, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.u16_suffixed(self_), tokens);
  },
});

export const ToTokens_for_u32: ToTokens<number> = impl_ToTokens<number>({
  // std: library/proc_macro/src/to_tokens.rs:187 to_tokens
  to_tokens(self_: number, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.u32_suffixed(self_), tokens);
  },
});

export const ToTokens_for_u64: ToTokens<bigint> = impl_ToTokens<bigint>({
  // std: library/proc_macro/src/to_tokens.rs:194 to_tokens
  to_tokens(self_: bigint, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.u64_suffixed(self_), tokens);
  },
});

export const ToTokens_for_u128: ToTokens<bigint> = impl_ToTokens<bigint>({
  // std: library/proc_macro/src/to_tokens.rs:201 to_tokens
  to_tokens(self_: bigint, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.u128_suffixed(self_), tokens);
  },
});

export const ToTokens_for_i8: ToTokens<number> = impl_ToTokens<number>({
  // std: library/proc_macro/src/to_tokens.rs:208 to_tokens
  to_tokens(self_: number, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.i8_suffixed(self_), tokens);
  },
});

export const ToTokens_for_i16: ToTokens<number> = impl_ToTokens<number>({
  // std: library/proc_macro/src/to_tokens.rs:215 to_tokens
  to_tokens(self_: number, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.i16_suffixed(self_), tokens);
  },
});

export const ToTokens_for_i32: ToTokens<number> = impl_ToTokens<number>({
  // std: library/proc_macro/src/to_tokens.rs:222 to_tokens
  to_tokens(self_: number, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.i32_suffixed(self_), tokens);
  },
});

export const ToTokens_for_i64: ToTokens<bigint> = impl_ToTokens<bigint>({
  // std: library/proc_macro/src/to_tokens.rs:229 to_tokens
  to_tokens(self_: bigint, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.i64_suffixed(self_), tokens);
  },
});

export const ToTokens_for_i128: ToTokens<bigint> = impl_ToTokens<bigint>({
  // std: library/proc_macro/src/to_tokens.rs:236 to_tokens
  to_tokens(self_: bigint, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.i128_suffixed(self_), tokens);
  },
});

export const ToTokens_for_f32: ToTokens<number> = impl_ToTokens<number>({
  // std: library/proc_macro/src/to_tokens.rs:243 to_tokens
  to_tokens(self_: number, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.f32_suffixed(self_), tokens);
  },
});

export const ToTokens_for_f64: ToTokens<number> = impl_ToTokens<number>({
  // std: library/proc_macro/src/to_tokens.rs:250 to_tokens
  to_tokens(self_: number, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.f64_suffixed(self_), tokens);
  },
});

export const ToTokens_for_usize: ToTokens<number> = impl_ToTokens<number>({
  // std: library/proc_macro/src/to_tokens.rs:257 to_tokens
  to_tokens(self_: number, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.usize_suffixed(self_), tokens);
  },
});

export const ToTokens_for_isize: ToTokens<number> = impl_ToTokens<number>({
  // std: library/proc_macro/src/to_tokens.rs:264 to_tokens
  to_tokens(self_: number, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.isize_suffixed(self_), tokens);
  },
});

export const ToTokens_for_bool: ToTokens<boolean> = impl_ToTokens<boolean>({
  // std: library/proc_macro/src/to_tokens.rs:271 to_tokens
  to_tokens(self_: boolean, tokens: TokenStream): void {
    const word = self_ ? "true" : "false";
    ToTokens_for_Ident.to_tokens(Ident.new(word, Span.call_site()), tokens);
  },
});

export const ToTokens_for_char: ToTokens<number> = impl_ToTokens<number>({
  // std: library/proc_macro/src/to_tokens.rs:279 to_tokens
  to_tokens(self_: number, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.character(self_), tokens);
  },
});

export const ToTokens_for_str: ToTokens<string> = impl_ToTokens<string>({
  // std: library/proc_macro/src/to_tokens.rs:286 to_tokens
  to_tokens(self_: string, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.string(self_), tokens);
  },
});

export const ToTokens_for_String: ToTokens<string> = impl_ToTokens<string>({
  // std: library/proc_macro/src/to_tokens.rs:293 to_tokens
  to_tokens(self_: string, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.string(self_), tokens);
  },
});

export const ToTokens_for_CStr: ToTokens<Uint8Array> = impl_ToTokens<Uint8Array>({
  // std: library/proc_macro/src/to_tokens.rs:300 to_tokens
  to_tokens(self_: Uint8Array, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.c_string(self_), tokens);
  },
});

export const ToTokens_for_CString: ToTokens<Uint8Array> = impl_ToTokens<Uint8Array>({
  // std: library/proc_macro/src/to_tokens.rs:307 to_tokens
  to_tokens(self_: Uint8Array, tokens: TokenStream): void {
    ToTokens_for_Literal.to_tokens(Literal.c_string(self_), tokens);
  },
});
