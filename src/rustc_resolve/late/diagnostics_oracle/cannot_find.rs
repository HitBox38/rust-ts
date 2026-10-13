// late/diagnostics.test.ts: "cannot find X in this scope" (E0412, E0425, E0433) with typo
// suggestions, similar names and "consider importing".
pub mod shapes {
    pub struct Circle;
    pub fn area() {}
    pub mod deep { pub struct Square; }
}
pub struct Widget;
pub fn compute() {}
const LIMIT: u8 = 3;

pub fn uses_type(_w: Widgt) {}
pub fn uses_value() {
    computee();
    let _x = LIMT;
    area();
    let _c: Circle;
    let _y = undefined_thing;
}
pub fn uses_path() {
    let _s = shapes::deep::Sqare;
    let _t = shapez::Circle;
    let _u = missing::Thing;
}
