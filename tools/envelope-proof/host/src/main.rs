//! T-541 host: the seller's prover and the buyer's verifier for the envelope proof. Optional and not wired into any
//! Crow tool (README.md).
//!
//!   envelope-proof prove <input.json> <receipt.bin>    the seller: proves its held delivery's buyer envelope opens
//!   envelope-proof verify <receipt.bin> <expect.json>  the buyer: checks the proof against what the waiver offer shows
//!   envelope-proof image-id                            the guest's image ID, which a verifier pins
//!
//! input.json (the seller's, secret: it holds the envelope's one-time secret):
//!   {"ephemeralSecret": "<64 hex>", "buyerPublicKey": "<base64url>", "recipient": "0x<40 hex>",
//!    "scheme": "x25519-xsalsa20poly1305", "envelope": "<base64url>", "ciphertextFile": "<path>"}
//! expect.json (the buyer's, all public: from its terms and the waiver offer):
//!   {"recipient": "0x<40 hex>", "buyerPublicKey": "<base64url>", "envelopeHash": "0x<64 hex>",
//!    "ciphertextSha256": "sha256:<64 hex>", "plaintextSha256": "sha256:<64 hex>"}
//! Exit 0 done or passed, 1 a check failed or no proof could be made, 2 bad usage or input.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use envelope_methods::{ENVELOPE_GUEST_ELF, ENVELOPE_GUEST_ID};
use envelope_statement::{Input, Statement};
use risc0_zkvm::{default_prover, Digest, ExecutorEnv, InnerReceipt, ProverOpts, Receipt};
use serde::Deserialize;
use std::{fs, process::exit, time::Instant};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProveFile {
    ephemeral_secret: String,
    buyer_public_key: String,
    recipient: String,
    scheme: String,
    envelope: String,
    ciphertext_file: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectFile {
    recipient: String,
    buyer_public_key: String,
    envelope_hash: String,
    ciphertext_sha256: String,
    plaintext_sha256: String,
    /// How many envelopes the waiver offer lists for the buyer. The contract releases any envelope addressed to the
    /// buyer that the submitter names, so the proof means something only when there is exactly one.
    envelopes_for_buyer: u32,
}

fn fail(code: i32, why: &str) -> ! {
    eprintln!("envelope-proof: {why}");
    exit(code)
}

fn hex_n<const N: usize>(s: &str, what: &str) -> [u8; N] {
    let s = s.strip_prefix("0x").or_else(|| s.strip_prefix("sha256:")).unwrap_or(s);
    let v = hex::decode(s).unwrap_or_else(|_| fail(2, &format!("{what} is not hex")));
    v.try_into().unwrap_or_else(|_| fail(2, &format!("{what} is not {N} bytes")))
}

fn b64_n<const N: usize>(s: &str, what: &str) -> [u8; N] {
    let v = URL_SAFE_NO_PAD.decode(s).unwrap_or_else(|_| fail(2, &format!("{what} is not base64url")));
    v.try_into().unwrap_or_else(|_| fail(2, &format!("{what} is not {N} bytes")))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &str) -> T {
    let text = fs::read_to_string(path).unwrap_or_else(|e| fail(2, &format!("cannot read {path}: {e}")));
    serde_json::from_str(&text).unwrap_or_else(|e| fail(2, &format!("{path}: {e}")))
}

fn image_id() -> String {
    hex::encode(Digest::from(ENVELOPE_GUEST_ID).as_bytes())
}

fn prove(input_path: &str, out: &str) {
    let f: ProveFile = read_json(input_path);
    let ciphertext = fs::read(&f.ciphertext_file).unwrap_or_else(|e| fail(2, &format!("cannot read {}: {e}", f.ciphertext_file)));
    let input = Input {
        ephemeral_secret: hex_n::<32>(&f.ephemeral_secret, "ephemeralSecret"),
        buyer_public_key: b64_n::<32>(&f.buyer_public_key, "buyerPublicKey"),
        recipient: hex_n::<20>(&f.recipient, "recipient"),
        scheme: f.scheme.into_bytes(),
        envelope: URL_SAFE_NO_PAD.decode(&f.envelope).unwrap_or_else(|_| fail(2, "envelope is not base64url")),
        ciphertext,
    };
    let env = ExecutorEnv::builder().write(&input).and_then(|b| b.build()).unwrap_or_else(|e| fail(2, &format!("{e}")));
    let started = Instant::now();
    // Succinct: one recursion-compressed receipt, a fixed size whatever the cycle count.
    let info = default_prover()
        .prove_with_opts(env, ENVELOPE_GUEST_ELF, &ProverOpts::succinct())
        .unwrap_or_else(|e| fail(1, &format!("no proof: {e}")));
    let secs = started.elapsed().as_secs_f64();
    let bytes = bincode::serialize(&info.receipt).unwrap_or_else(|e| fail(1, &format!("{e}")));
    fs::write(out, &bytes).unwrap_or_else(|e| fail(2, &format!("cannot write {out}: {e}")));
    let s: Statement = info.receipt.journal.decode().unwrap_or_else(|e| fail(1, &format!("{e}")));
    println!("proved in {secs:.1} s: {} cycles in {} segments; receipt {} bytes at {out}", info.stats.total_cycles, info.stats.segments, bytes.len());
    println!("image ID {}", image_id());
    println!("statement: recipient 0x{}, envelope hash 0x{}, ciphertext sha256:{}, plaintext sha256:{}", hex::encode(s.recipient), hex::encode(s.envelope_hash), hex::encode(s.ciphertext_sha256), hex::encode(s.plaintext_sha256));
}

fn verify(receipt_path: &str, expect_path: &str) {
    let bytes = fs::read(receipt_path).unwrap_or_else(|e| fail(2, &format!("cannot read {receipt_path}: {e}")));
    let receipt: Receipt = bincode::deserialize(&bytes).unwrap_or_else(|e| fail(2, &format!("{receipt_path} is not a receipt: {e}")));
    let e: ExpectFile = read_json(expect_path);
    let started = Instant::now();
    // Only a succinct receipt counts. A fake (dev-mode) receipt has no cryptographic integrity, and risc0 accepts one
    // in verify() when RISC0_DEV_MODE is set in this process's environment, so the kind is checked first, whatever the
    // environment says.
    let succinct = matches!(receipt.inner, InnerReceipt::Succinct(_));
    let proof_ok = succinct && receipt.verify(ENVELOPE_GUEST_ID).is_ok();
    let ms = started.elapsed().as_millis();
    let mut failed = 0;
    let mut check = |ok: bool, line: String| {
        println!("{}  {line}", if ok { "pass" } else { "FAIL" });
        if !ok {
            failed += 1;
        }
    };
    check(proof_ok, format!("the receipt is a valid succinct proof of the guest with image ID {} (verified in {ms} ms){}", image_id(), if succinct { "" } else { "; it is not a succinct receipt" }));
    check(e.envelopes_for_buyer == 1, format!("the waiver offer lists exactly one envelope for the buyer ({}), so the settlement can release no other", e.envelopes_for_buyer));
    let s: Statement = match receipt.journal.decode() {
        Ok(s) => s,
        Err(_) => fail(1, "the receipt's journal is not a statement"),
    };
    check(s.recipient == hex_n::<20>(&e.recipient, "recipient"), format!("the envelope's recipient is the buyer 0x{}", hex::encode(s.recipient)));
    check(s.buyer_public_key == b64_n::<32>(&e.buyer_public_key, "buyerPublicKey"), "it was opened under the buyer's encryption public key in the terms".to_string());
    check(s.envelope_hash == hex_n::<32>(&e.envelope_hash, "envelopeHash"), format!("the envelope is the one the waiver offer names, hash 0x{}", hex::encode(s.envelope_hash)));
    check(s.ciphertext_sha256 == hex_n::<32>(&e.ciphertext_sha256, "ciphertextSha256"), format!("its key decrypts the delivery's ciphertext, sha256:{}", hex::encode(s.ciphertext_sha256)));
    check(s.plaintext_sha256 == hex_n::<32>(&e.plaintext_sha256, "plaintextSha256"), format!("to the signed plaintext, sha256:{}", hex::encode(s.plaintext_sha256)));
    println!("{}", if failed == 0 { "PASSED  the envelope the offer names opens the held work; countersign only a settlement that releases that envelope" } else { "FAILED  do not countersign" });
    exit(if failed == 0 { 0 } else { 1 });
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["prove", input, out] => prove(input, out),
        ["verify", receipt, expect] => verify(receipt, expect),
        ["image-id"] => println!("{}", image_id()),
        _ => fail(2, "usage: envelope-proof prove <input.json> <receipt.bin> | verify <receipt.bin> <expect.json> | image-id"),
    }
}
