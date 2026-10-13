// E0428 in the type namespace: modules, traits, types (a unit struct also conflicts in the value
// namespace, reported once per name and span).
#![crate_type = "lib"]
mod m {}
mod m {}
trait T {}
struct T;
struct S;
struct S;
type A = S;
enum A {}
