// Fixture of src/rustc_codegen_ssa/back/write.test.ts: a library whose items fall into two CGUs at -Ccodegen-units=2.
pub mod a {
    pub fn one() -> u32 { 1 }
    pub fn two() -> u32 { super::b::three() - 1 }
}
pub mod b {
    pub fn three() -> u32 { 3 }
    pub fn four() -> u32 { 4 }
}
pub fn five() -> u32 { a::one() + b::four() }
