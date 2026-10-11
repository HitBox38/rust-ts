// Fixture for tools/codegen/oracle.test.ts: derive(Debug) shapes, checked against rustc's output.
// The test compiles this with `rustc +nightly -C debug-assertions=off` and compares `{:?}` / `{:#?}`
// of the values built in `main` with the generated TS Debug fns on the same values.
#![allow(dead_code)]
use std::fmt;
use std::ops::Range;

#[derive(Debug)]
pub struct Unit;

#[derive(Debug)]
pub struct Tup(pub u32, pub bool);

#[derive(Debug)]
pub struct Empty {}

#[derive(Debug)]
pub struct Gen<T, U = u8> {
    pub t: T,
    pub u: Option<U>,
    pub v: Vec<T>,
}

#[derive(Debug)]
pub enum E<T> {
    A,
    B(T, char),
    C { x: Option<Option<u32>>, s: String },
    D {},
    F(Box<E<T>>),
}

#[derive(Debug, Clone, Copy)]
pub enum Fieldless {
    X = 1,
    Y,
    Z = 0x10,
}

pub type Alias<T> = Vec<(T, Fieldless)>;

#[derive(Debug)]
pub struct UsesAlias {
    pub a: Alias<i32>,
    pub r: Range<u32>,
    pub unit: (),
    pub one: (u8,),
    pub nested: Gen<Gen<bool>, Tup>,
}

#[cfg_attr(not(test), derive(Debug))]
pub struct CfgAttr {
    #[cfg(debug_assertions)]
    pub dbg: u32,
    pub kept: u32,
}

pub struct Manual(pub u32);

impl fmt::Debug for Manual {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "M<{}>", self.0)
    }
}

#[derive(Debug)]
pub struct HasManual {
    pub m: Manual,
    pub r#type: u8,
}

fn main() {
    let vals: Vec<Box<dyn fmt::Debug>> = vec![
        Box::new(Unit),
        Box::new(Tup(7, true)),
        Box::new(Empty {}),
        Box::new(Gen::<String> { t: "a\"b".into(), u: None, v: vec!["c".into(), "\u{301}".into()] }),
        Box::new(Gen::<u32, char> { t: 1, u: Some('\n'), v: vec![] }),
        Box::new(E::<u32>::A),
        Box::new(E::<u32>::B(5, 'x')),
        Box::new(E::<u32>::C { x: Some(None), s: "hi\n".into() }),
        Box::new(E::<u32>::C { x: Some(Some(3)), s: String::new() }),
        Box::new(E::<u32>::C { x: None, s: "q".into() }),
        Box::new(E::<u32>::D {}),
        Box::new(E::<u32>::F(Box::new(E::B(1, '\'')))),
        Box::new(Fieldless::Y),
        Box::new(UsesAlias {
            a: vec![(1, Fieldless::X), (-2, Fieldless::Z)],
            r: 3..9,
            unit: (),
            one: (4,),
            nested: Gen { t: Gen { t: false, u: Some(2), v: vec![true] }, u: Some(Tup(0, false)), v: vec![] },
        }),
        Box::new(CfgAttr { kept: 5 }),
        Box::new(HasManual { m: Manual(3), r#type: 1 }),
    ];
    for v in vals {
        println!("{v:?}");
        println!("{v:#?}");
    }
}
