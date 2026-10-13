macro_rules! a1 { attr() () => {} }
macro_rules! ext_a2 { attr() ($($t:tt)*) => { $($t)* } }
#[ext_a2]
struct S;
