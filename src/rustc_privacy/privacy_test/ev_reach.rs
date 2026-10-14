#![feature(rustc_attrs)]
mod private {
    #[rustc_effective_visibility]
    pub struct Hidden { #[rustc_effective_visibility] pub f: u8, #[rustc_effective_visibility] g: u16 }
    #[rustc_effective_visibility]
    pub fn make() -> Hidden { Hidden { f: 0, g: 0 } }
    #[rustc_effective_visibility]
    pub trait Tr { #[rustc_effective_visibility] fn m(&self); }
    #[rustc_effective_visibility]
    pub enum E { #[rustc_effective_visibility] V(#[rustc_effective_visibility] u8), #[rustc_effective_visibility] W }
    #[rustc_effective_visibility]
    impl Tr for Hidden { #[rustc_effective_visibility] fn m(&self) {} }
    #[rustc_effective_visibility]
    impl Hidden { #[rustc_effective_visibility] pub fn new() -> E { E::W } #[rustc_effective_visibility] fn private() {} }
    #[rustc_effective_visibility]
    pub struct Unreached;
}
#[rustc_effective_visibility]
pub use private::make;
