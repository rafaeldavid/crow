//! The guest program's ELF and image ID, built by risc0-build. The image ID is what a verifier pins.
include!(concat!(env!("OUT_DIR"), "/methods.rs"));
