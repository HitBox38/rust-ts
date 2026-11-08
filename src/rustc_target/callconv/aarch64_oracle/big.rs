// Sizes at or above 2^53 bytes in by-value code, outside `callconv/`: the sites where a `number` byte count would stop
// (docs/reviews/fixers-44.md F5, lane fixers-46). Each item names the site it reaches. A run with errors does not run the
// late lints, so the transmute error is in big_err.rs. See regen.ts.
#![feature(no_core, lang_items, rustc_attrs, auto_traits, intrinsics)]
#![crate_type = "lib"]
#![no_core]
#![allow(dead_code, internal_features)]
#![warn(variant_size_differences)]

#[lang = "pointee_sized"]
pub trait PointeeSized {}
#[lang = "meta_sized"]
pub trait MetaSized: PointeeSized {}
#[lang = "sized"]
pub trait Sized: MetaSized {}
#[lang = "copy"]
pub trait Copy {}
#[lang = "freeze"]
pub unsafe auto trait Freeze {}

#[rustc_intrinsic]
pub unsafe fn transmute<Src, Dst>(src: Src) -> Dst;

pub struct B53([u8; 9007199254740992]);
pub struct B53Too([u8; 9007199254740992]);

// rustc_mir_transform known_panics_lint `CanConstProp::check`: `layout.size < Size::from_bytes(MAX_ALLOC_LIMIT)`.
pub fn by_value(_: B53) {}

// rustc_lint types `VariantSizeDifferences`: the variant sizes and `largest` are `u64`s.
pub enum Enum {
    Big(B53),
    Small(u8),
}

// rustc_abi layout `layout_of_univariant`: the niche's head and tail space are `u64`s.
pub struct Niche(&'static u8, [u8; 9007199254740992]);
pub fn niche(_: Niche) {}

// rustc_middle ty::layout `SizeSkeleton::same_size`: `Size` equality.
pub fn same_size(x: B53) -> B53Too {
    unsafe { transmute(x) }
}

// rustc_mir_transform gvn `simplify_place_projection`: a `ConstantIndex` offset of 2^53 (review fixers-46 F4). Typeck asks for
// an `Index` impl before it uses the built-in indexing of arrays; its body is never used.
#[lang = "index"]
pub trait Index<Idx> {
    type Output;
    fn index(&self, index: Idx) -> &Self::Output;
}
impl<T, const N: usize> Index<usize> for [T; N] {
    type Output = T;
    fn index(&self, _: usize) -> &T {
        loop {}
    }
}
impl Copy for u8 {}
#[lang = "legacy_receiver"]
pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
pub fn index(x: [u8; 9007199254740993]) -> u8 {
    let i: usize = 9007199254740992;
    x[i]
}

// rustc_mir_build matches `prefix_slice_suffix`: `ConstantIndex` and `Subslice` at 2^53 - 1, `PlaceTy::projection_ty`'s array
// type for the `Subslice`, and rustc_mir_dataflow's move paths of the pattern (lane fixers-47).
pub fn pattern(x: [u8; 9007199254740993]) -> u8 {
    let [a, _rest @ .., _b] = x;
    a
}

// rustc_hir_typeck pat `check_array_pat_len`: a rest binding of 2^53 + 1 elements, so `r`'s array type is that long (review
// fixers-47 F1).
pub fn rest(x: &[u8; 9007199254740995]) -> &[u8; 9007199254740993] {
    let [_, r @ .., _] = x;
    r
}
