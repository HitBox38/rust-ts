// late/diagnostics.test.ts: unresolved `Self` (E0411) and `self` (E0424), `this` for `self`,
// `True`/`printf` replacements.
pub struct S { pub field: u8 }
pub fn free() -> Self { loop {} }
impl S {
    pub fn assoc() { let _ = self; }
    pub fn method(&self) {}
    pub fn uses_this(&self) { let _ = this; }
    pub fn calls() { method(); }
    pub fn reads(&self) { let _ = field; }
}
pub fn bools() { let _ = True; printf(); }
