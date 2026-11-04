// read, write, readv, writev, fcntl and ioctl (miri-shims-d review M2), on an eventfd and the standard streams, each call
// printed so the two Miris are compared call by call. The epoll at the end proves no shim leaks a handle: a description
// stays registered until its last descriptor is gone, so a leaked handle would keep reporting it after the closes.
// (Isolation stays on: pipes and socketpairs are not ported yet, plan-m6 D2, and host files need isolation off, D14.
// fd.test.ts has flock's lock path and F_GETFL / F_SETFL's success path on a stand-in description.)
#![feature(rustc_private)]
extern crate libc;
use std::io::Error;
use std::ptr::{null, null_mut};

fn errno() -> i32 {
    Error::last_os_error().raw_os_error().unwrap()
}
fn show(name: &str, r: isize) {
    if r < 0 {
        println!("{name}: {r} errno {}", errno());
    } else {
        println!("{name}: {r}");
    }
}
fn iov(p: *mut u8, n: usize) -> libc::iovec {
    libc::iovec { iov_base: p.cast(), iov_len: n }
}

fn main() {
    unsafe {
        let e = libc::eventfd(0, libc::EFD_NONBLOCK);
        println!("eventfd {e}");
        let ep = libc::epoll_create1(0);
        println!("epoll {ep}");
        let mut ev = libc::epoll_event { events: (libc::EPOLLIN | libc::EPOLLOUT) as u32, u64: 7 };
        show("epoll_ctl", libc::epoll_ctl(ep, libc::EPOLL_CTL_ADD, e, &mut ev) as isize);
        let mut got = [libc::epoll_event { events: 0, u64: 0 }; 2];
        show("epoll_wait", libc::epoll_wait(ep, got.as_mut_ptr(), 2, 0) as isize);

        // write / read: an eventfd takes exactly 8 bytes, and zero counts and closed descriptors go through the same path
        let one = 1u64.to_ne_bytes();
        let mut buf = [0u8; 16];
        show("read would block", libc::read(e, buf.as_mut_ptr().cast(), 8));
        show("write", libc::write(e, one.as_ptr().cast(), 8));
        show("write short", libc::write(e, one.as_ptr().cast(), 7));
        show("read short", libc::read(e, buf.as_mut_ptr().cast(), 7));
        show("write 0", libc::write(e, null(), 0));
        show("read 0", libc::read(e, null_mut(), 0));
        show("read", libc::read(e, buf.as_mut_ptr().cast(), 16));
        println!("{:?}", &buf[..8]);
        show("read bad", libc::read(42, buf.as_mut_ptr().cast(), 1));
        show("write bad", libc::write(42, buf.as_ptr().cast(), 1));
        show("pread bad", libc::pread(42, buf.as_mut_ptr().cast(), 4, 0));
        show("pwrite bad", libc::pwrite(42, buf.as_ptr().cast(), 4, 0));
        show("write stdout", libc::write(1, b"bye\n".as_ptr().cast(), 4));
        show("write stderr", libc::write(2, b"err\n".as_ptr().cast(), 4));
        show("read stdout", libc::read(1, buf.as_mut_ptr().cast(), 0));

        // writev / readv: several buffers, an empty one, partial ones, and the first buffer short of the total
        let mut hi = *b"hello\n";
        let mut none = *b"";
        let p = hi.as_mut_ptr();
        let parts = [iov(p, 3), iov(none.as_mut_ptr(), 0), iov(p.add(3), 3)];
        show("writev stdout", libc::writev(1, parts.as_ptr(), 3));
        show("writev 0", libc::writev(1, parts.as_ptr(), 0));
        show("writev bad", libc::writev(42, parts.as_ptr(), 3));
        let mut w = one;
        let single = [iov(w.as_mut_ptr(), 8)];
        show("writev", libc::writev(e, single.as_ptr(), 1));
        let (mut x, mut y, mut z) = ([9u8; 2], [9u8; 4], [9u8; 16]);
        let inn = [iov(x.as_mut_ptr(), 2), iov(y.as_mut_ptr(), 4), iov(z.as_mut_ptr(), 16)];
        show("readv", libc::readv(e, inn.as_ptr(), 3));
        println!("{x:?} {y:?} {:?}", &z[..2]);
        show("readv 0", libc::readv(e, inn.as_ptr(), 0));
        show("readv bad", libc::readv(42, inn.as_ptr(), 3));
        show("readv would block", libc::readv(e, inn.as_ptr(), 3));

        // fcntl
        show("F_GETFD", libc::fcntl(e, libc::F_GETFD) as isize);
        show("F_GETFD bad", libc::fcntl(42, libc::F_GETFD) as isize);
        show("F_GETFL bad", libc::fcntl(42, libc::F_GETFL) as isize);
        show("F_SETFL bad", libc::fcntl(42, libc::F_SETFL, 0) as isize);
        let dup = libc::fcntl(e, libc::F_DUPFD, 20);
        println!("F_DUPFD {dup}");
        let dup2 = libc::fcntl(e, libc::F_DUPFD_CLOEXEC, 20);
        println!("F_DUPFD_CLOEXEC {dup2}");
        show("F_DUPFD bad", libc::fcntl(42, libc::F_DUPFD, 20) as isize);
        show("F_DUPFD neg", libc::fcntl(e, libc::F_DUPFD, -1) as isize);
        // The duplicates share the counter.
        show("write dup", libc::write(dup, one.as_ptr().cast(), 8));
        show("read dup2", libc::read(dup2, buf.as_mut_ptr().cast(), 8));
        println!("{:?}", &buf[..8]);

        // ioctl: the common opcodes
        show("FIOCLEX", libc::ioctl(e, libc::FIOCLEX) as isize);
        show("FIONCLEX", libc::ioctl(e, libc::FIONCLEX) as isize);
        show("FIOCLEX bad", libc::ioctl(42, libc::FIOCLEX) as isize);

        // flock: a closed descriptor
        show("flock bad", libc::flock(42, libc::LOCK_EX) as isize);

        // The description stays registered while any descriptor is open, and not one call longer.
        show("close e", libc::close(e) as isize);
        show("epoll_wait dups open", libc::epoll_wait(ep, got.as_mut_ptr(), 2, 0) as isize);
        show("close dup", libc::close(dup) as isize);
        show("close dup2", libc::close(dup2) as isize);
        // Miri's F_DUPFD with a negative minimum puts the duplicate at that number, so this one is open too.
        show("epoll_wait neg open", libc::epoll_wait(ep, got.as_mut_ptr(), 2, 0) as isize);
        show("close neg", libc::close(-1) as isize);
        show("epoll_wait closed", libc::epoll_wait(ep, got.as_mut_ptr(), 2, 0) as isize);
        show("read closed", libc::read(e, buf.as_mut_ptr().cast(), 1));
        show("close ep", libc::close(ep) as isize);
    }
    println!("done");
}
