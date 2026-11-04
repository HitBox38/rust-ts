// lane mono-partition: a binary through std: `lang_start`, closures, drop glue and inlined generics from other crates
// in more than one CGU.
mod a {
    pub fn numbers() -> Vec<u32> {
        (0..3).collect()
    }
}

mod b {
    pub fn show(v: &[u32]) -> String {
        format!("{v:?}")
    }
    pub fn more() -> Vec<String> {
        vec![String::new()]
    }
}

fn main() {
    let v = a::numbers();
    println!("{} {}", b::show(&v), b::more().len());
}
