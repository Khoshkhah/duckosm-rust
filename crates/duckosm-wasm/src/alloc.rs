//! The allocator of the build with threads. The allocator of the standard library in WebAssembly has one global
//! lock, and a thread that waits for it spins. The decode of a block of ways makes millions of small allocations,
//! so with 4 threads, pass 2 of the cut took 2.2 s instead of 1.2 s with one thread. Here each thread keeps its
//! own lists of free small blocks (up to 256 bytes) and takes the global lock only to get 64 new blocks at a time.
//! A small block goes back to the list of the thread that frees it, never to the system allocator.
//! ponytail: no limit on the cached blocks; WebAssembly memory never gets smaller anyway.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::ptr::null_mut;

const STEP: usize = 16;
const CLASSES: usize = 16; // 16, 32, ... 256 bytes
const REFILL: usize = 64;

thread_local! {
    static FREE: [Cell<*mut u8>; CLASSES] = const { [const { Cell::new(null_mut()) }; CLASSES] };
}

pub struct Cached;

fn class(l: &Layout) -> Option<usize> {
    (l.size() <= STEP * CLASSES && l.align() <= STEP).then(|| l.size().max(1).div_ceil(STEP) - 1)
}

unsafe impl GlobalAlloc for Cached {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let Some(c) = class(&l) else {
            return unsafe { System.alloc(l) };
        };
        FREE.with(|f| {
            let mut p = f[c].get();
            if p.is_null() {
                // a chunk of REFILL blocks, linked into the free list
                let size = (c + 1) * STEP;
                let chunk =
                    unsafe { System.alloc(Layout::from_size_align_unchecked(size * REFILL, STEP)) };
                if chunk.is_null() {
                    return null_mut();
                }
                for i in 0..REFILL {
                    let b = unsafe { chunk.add(i * size) };
                    let next = if i + 1 < REFILL {
                        unsafe { b.add(size) }
                    } else {
                        null_mut()
                    };
                    unsafe { (b as *mut *mut u8).write(next) };
                }
                p = chunk;
            }
            f[c].set(unsafe { (p as *mut *mut u8).read() });
            p
        })
    }

    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        match class(&l) {
            Some(c) => FREE.with(|f| {
                unsafe { (p as *mut *mut u8).write(f[c].get()) };
                f[c].set(p);
            }),
            None => unsafe { System.dealloc(p, l) },
        }
    }

    unsafe fn realloc(&self, p: *mut u8, l: Layout, new_size: usize) -> *mut u8 {
        let new = unsafe { Layout::from_size_align_unchecked(new_size, l.align()) };
        if class(&l).is_none() && class(&new).is_none() {
            return unsafe { System.realloc(p, l, new_size) };
        }
        let q = unsafe { self.alloc(new) };
        if !q.is_null() {
            unsafe {
                std::ptr::copy_nonoverlapping(p, q, l.size().min(new_size));
                self.dealloc(p, l);
            }
        }
        q
    }
}
