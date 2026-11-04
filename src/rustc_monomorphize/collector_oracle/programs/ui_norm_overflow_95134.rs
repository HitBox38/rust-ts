//@ compile-flags: -Zwrite-long-types-to-disk=no
// Copied from tests/ui/codegen/normalization-overflow/recursion-issue-95134.rs at the pin: `items_of_instance` fails with
// NormalizationErrorInMono, reported as RecursionLimit. The flag is one compiletest passes.
//@ build-fail
//@ compile-flags: -Copt-level=0

pub fn encode_num<Writer: ExampleWriter>(n: u32, mut writer: Writer) -> Result<(), Writer::Error> {
    if n > 15 {
        encode_num(n / 16, &mut writer)?;
        //~^ ERROR: reached the recursion limit while instantiating
    }
    Ok(())
}

pub trait ExampleWriter {
    type Error;
}

impl<'a, T: ExampleWriter> ExampleWriter for &'a mut T {
    type Error = T::Error;
}

struct EmptyWriter;

impl ExampleWriter for EmptyWriter {
    type Error = ();
}

fn main() {
    encode_num(69, &mut EmptyWriter).unwrap();
}
