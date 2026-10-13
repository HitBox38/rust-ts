// E0428 in the value namespace (no `raise_fatal_after_resolve`): foreign fns, a unit struct's constructor.
#![crate_type = "lib"]
extern "C" {
    fn x();
    fn x();
}
struct U;
extern "C" {
    fn U();
}
