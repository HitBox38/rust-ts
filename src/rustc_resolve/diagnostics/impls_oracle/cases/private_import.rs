// E0603: importing a private item (`report_privacy_error`).
#![crate_type = "lib"]
#![allow(unused)]
mod a {
    struct P;
}
use a::P;
