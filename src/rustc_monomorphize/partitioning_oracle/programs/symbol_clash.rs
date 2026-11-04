// lane mono-partition: `assert_symbols_are_distinct`: two items with one symbol.
#![crate_type = "lib"]

pub mod a {
    #[export_name = "clashing_symbol"]
    pub fn x() {}
}

pub mod b {
    #[export_name = "clashing_symbol"]
    pub fn y() {}
}
