// lane mono-partition: CGU names over `MAX_CGU_NAME_LENGTH` (200 bytes), `shorten_name` truncating at an ASCII byte and in
// the middle of a two-byte character (the prefix `long_names.<15 hex digits>-yz` is 29 bytes, the cut falls at 168).
#![crate_type = "lib"]

pub mod mxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx {
    pub fn f() {}
}

pub mod yzéééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé {
    pub fn f() {}
}

pub mod short {
    pub fn f() {}
}
