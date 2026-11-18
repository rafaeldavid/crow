//! The two shapes the guest and the host share: what the seller hands the prover, and the public statement the proof
//! commits to (the journal). Everything in `Statement` is something the buyer already holds before it countersigns a
//! waiver, so the buyer compares it field by field and learns nothing new.
#![no_std]
extern crate alloc;

use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// What the prover reads. Only `ephemeral_secret` is secret: the one-time key the seller sealed the buyer's envelope
/// with. With it and the buyer's public key the guest recomputes the key the buyer would open. Everything else is in
/// the delivery or the terms.
#[derive(Serialize, Deserialize, Clone)]
pub struct Input {
    /// The seller's one-time X25519 secret for the buyer's envelope (secret).
    pub ephemeral_secret: [u8; 32],
    /// The buyer's X25519 encryption public key, `buyerEncryptionPublicKey` in the terms.
    pub buyer_public_key: [u8; 32],
    /// The envelope's recipient, the terms' buyer address, 20 bytes.
    pub recipient: [u8; 20],
    /// The envelope's scheme as the delivery names it: `x25519-xsalsa20poly1305`.
    pub scheme: Vec<u8>,
    /// The envelope as sealed: the ephemeral public key (32 bytes), the nonce (24) and the box (48).
    pub envelope: Vec<u8>,
    /// The public ciphertext: a 12-byte AES-GCM nonce, then the AES-256-GCM ciphertext and its 16-byte tag.
    pub ciphertext: Vec<u8>,
}

/// The public statement. The proof says: there is a secret such that the envelope these fields name opens, under the
/// buyer's key, to a content key that decrypts this ciphertext to a plaintext with this SHA-256.
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct Statement {
    pub recipient: [u8; 20],
    pub buyer_public_key: [u8; 32],
    /// The EIP-712 struct hash of the envelope (`EncryptedKey`, with an empty unlock), the hash a waiver offer shows.
    pub envelope_hash: [u8; 32],
    /// SHA-256 of the ciphertext bytes: the delivery's `ciphertext.sha256`.
    pub ciphertext_sha256: [u8; 32],
    /// SHA-256 of the plaintext: the delivery's signed `plaintextSha256`.
    pub plaintext_sha256: [u8; 32],
}
