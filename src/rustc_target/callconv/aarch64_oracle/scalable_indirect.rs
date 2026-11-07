// A scalable vector that is also `#[rustc_pass_indirectly_in_non_rustic_abis]`: callconv/aarch64.rs's `classify_arg` returns at
// `is_scalable_vector` before `pass_indirectly_in_non_rustic_abis`, so the argument stays `Direct` and the oracle ICEs on the
// assertion at rustc_ty_utils/src/abi.rs:456 (docs/reviews/fixers-44.md F2, lane fixers-46). Without that early return
// the port makes it indirect and prints a dump. The test compares the exit code and the assertion's message, as the two
// ICE reports differ in form. See regen.ts.
#![feature(no_core, lang_items, rustc_attrs, auto_traits)]
#![crate_type = "lib"]
#![no_core]
#![allow(improper_ctypes_definitions, dead_code, internal_features)]

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
impl Copy for f32 {}

#[rustc_scalable_vector(4)]
#[rustc_pass_indirectly_in_non_rustic_abis]
pub struct ScalableIndirect(f32);

#[rustc_abi(debug)]
pub type C = extern "C" fn(ScalableIndirect);
