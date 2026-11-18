//! T-541 guest: runs inside the RISC Zero zkVM. From the seller's one-time envelope secret and public data only, it
//! shows that the buyer's envelope opens to a content key that decrypts the delivery's ciphertext, and commits the
//! public statement a buyer checks before it countersigns a waiver (ADR-0039 section 2). It panics, so no proof
//! exists, when any step fails.
//!
//! The formats are today's, unchanged (spec/schemas/common.schema.json, EncryptedKey; examples/agent.ts,
//! prepareDelivery):
//!   envelope   = ephemeral public key (32) || nonce (24) || NaCl box of the content key (48), scheme
//!                `x25519-xsalsa20poly1305`, sealed with the ephemeral secret to the buyer's encryption public key;
//!   ciphertext = AES-GCM nonce (12) || AES-256-GCM ciphertext and tag, under the content key.
use aes_gcm::{Aes256Gcm, KeyInit};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use crypto_box::aead::{generic_array::GenericArray, Aead};
use crypto_box::{PublicKey, SalsaBox, SecretKey};
use envelope_statement::{Input, Statement};
use risc0_zkvm::guest::env;
use sha2::{Digest, Sha256};
use tiny_keccak::{Hasher, Keccak};

fn keccak(parts: &[&[u8]]) -> [u8; 32] {
    let mut k = Keccak::v256();
    for p in parts {
        k.update(p);
    }
    let mut out = [0u8; 32];
    k.finalize(&mut out);
    out
}

/// The envelope's EIP-712 struct hash, as examples/verify.ts TYPES define EncryptedKey and as a waiver offer shows it
/// (docs/research/2026-11-18-case-study-3/waiver.ts, envelopeHash): recipient, scheme, the envelope as base64url text,
/// and an empty unlock (kind "", round 0).
fn envelope_struct_hash(recipient: &[u8; 20], scheme: &[u8], envelope: &[u8]) -> [u8; 32] {
    let unlock_type = keccak(&[b"KeyUnlock(string kind,uint64 round)"]);
    let unlock = keccak(&[&unlock_type, &keccak(&[b""]), &[0u8; 32]]);
    let key_type = keccak(&[b"EncryptedKey(address recipient,string scheme,string ciphertext,KeyUnlock unlock)KeyUnlock(string kind,uint64 round)"]);
    let mut address = [0u8; 32];
    address[12..].copy_from_slice(recipient);
    let text = URL_SAFE_NO_PAD.encode(envelope);
    keccak(&[&key_type, &address, &keccak(&[scheme]), &keccak(&[text.as_bytes()]), &unlock])
}

fn main() {
    let input: Input = env::read();
    assert_eq!(input.scheme.as_slice(), b"x25519-xsalsa20poly1305", "the envelope's scheme is not the one this guest opens");
    assert_eq!(input.envelope.len(), 104, "an envelope is 32 + 24 + 48 bytes");
    assert!(input.ciphertext.len() > 12 + 16, "a ciphertext is a 12-byte nonce, the data and a 16-byte tag");

    // 1. The envelope's ephemeral public key is the public half of the secret the seller holds.
    let ephemeral = SecretKey::from(input.ephemeral_secret);
    assert_eq!(ephemeral.public_key().as_bytes(), &input.envelope[0..32], "the secret is not the envelope's ephemeral key");

    // 2. The envelope opens to the content key. X25519 is symmetric, so the seller's secret with the buyer's public key
    //    gives the box key the buyer's secret with the ephemeral public key gives: what opens here opens for the buyer.
    let sealed = SalsaBox::new(&PublicKey::from(input.buyer_public_key), &ephemeral);
    let content_key = sealed
        .decrypt(GenericArray::from_slice(&input.envelope[32..56]), &input.envelope[56..])
        .expect("the envelope does not open under the buyer's key");
    assert_eq!(content_key.len(), 32, "the envelope holds no 32-byte key");

    // 3. The content key decrypts the ciphertext, and its tag holds.
    let aes = Aes256Gcm::new_from_slice(&content_key).expect("a 32-byte key");
    let plaintext = aes
        .decrypt(GenericArray::from_slice(&input.ciphertext[0..12]), &input.ciphertext[12..])
        .expect("the content key does not decrypt the ciphertext");

    // 4. The public statement: what the buyer compares with the waiver offer and the terms.
    let statement = Statement {
        recipient: input.recipient,
        buyer_public_key: input.buyer_public_key,
        envelope_hash: envelope_struct_hash(&input.recipient, &input.scheme, &input.envelope),
        ciphertext_sha256: Sha256::digest(&input.ciphertext).into(),
        plaintext_sha256: Sha256::digest(&plaintext).into(),
    };
    env::commit(&statement);
}
