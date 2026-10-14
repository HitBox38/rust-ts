#![feature(associated_type_defaults)]
struct Priv;
pub(crate) struct CrateVis;
pub trait Tr {
    type A = Priv;
    type B = CrateVis;
    type C = u8;
}
