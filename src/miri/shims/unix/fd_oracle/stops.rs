// The calls Miri stops on with an unsupported-operation or UB error (miri-shims-d review M2). The program's argument
// picks the call; the two Miris' stderr is compared.
#![feature(rustc_private)]
extern crate libc;
use std::ptr::null_mut;

fn main() {
    let e = unsafe { libc::eventfd(0, 0) };
    assert!(e >= 0);
    let case = std::env::args().nth(1).unwrap();
    let mut buf = [0u8; 4];
    let mut big = [0u8; 8];
    unsafe {
        match case.as_str() {
            "fcntl-command" => drop(libc::fcntl(e, 0x7777)),
            "fcntl-getfl" => drop(libc::fcntl(e, libc::F_GETFL)),
            "fcntl-setfl" => drop(libc::fcntl(e, libc::F_SETFL, 0)),
            "fcntl-varargs" => drop(libc::fcntl(e, libc::F_DUPFD)),
            "ioctl-opcode" => drop(libc::ioctl(e, 0x1234 as libc::c_ulong)),
            "flock-flags" => drop(libc::flock(e, libc::LOCK_SH | libc::LOCK_EX)),
            "flock-eventfd" => drop(libc::flock(e, libc::LOCK_EX)),
            "poll-events" => {
                let mut p = libc::pollfd { fd: e, events: 0x4000, revents: 0 };
                drop(libc::poll(&mut p, 1, 0));
            }
            "poll-twice" => {
                let mut p = [libc::pollfd { fd: e, events: libc::POLLOUT, revents: 0 }; 2];
                drop(libc::poll(p.as_mut_ptr(), 2, 0));
            }
            "pread-eventfd" => drop(libc::pread(e, buf.as_mut_ptr().cast(), 4, 0)),
            "pwrite-eventfd" => drop(libc::pwrite(e, buf.as_ptr().cast(), 4, 0)),
            "read-oob" => {
                assert_eq!(libc::write(e, 1u64.to_ne_bytes().as_ptr().cast(), 8), 8);
                drop(libc::read(e, buf.as_mut_ptr().cast(), 8));
            }
            "write-oob" => drop(libc::write(e, buf.as_ptr().cast(), 8)),
            "readv-iov" => drop(libc::readv(e, null_mut::<libc::iovec>(), 1)),
            "writev-iov" => drop(libc::writev(e, null_mut::<libc::iovec>(), 1)),
            "read-deadlock" => drop(libc::read(e, big.as_mut_ptr().cast(), 8)),
            "poll-deadlock" => {
                let mut p = libc::pollfd { fd: e, events: libc::POLLIN, revents: 0 };
                drop(libc::poll(&mut p, 1, -1));
            }
            other => panic!("unknown case {other}"),
        }
    }
}
