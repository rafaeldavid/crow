#!/usr/bin/env python3
"""Writes vectors.json: test vectors for the `signature_valid` check (ADR-0045), signed in Python.

Every key here is a THROWAWAY TEST KEY. The script makes new keys in memory on each run, signs with them, and writes
only public keys. No private key reaches a file (ADR-0045, section 9). A run changes every key and signature; the
case names and the expected results stay the same.

Usage: python generate.py            (writes vectors.json beside this file)
Needs: the versions in requirements.txt. See README.md.
"""

import base64
import copy
import hashlib
import json
import os
from pathlib import Path

import cryptography
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature

OUT = Path(__file__).resolve().parent / "vectors.json"

# The group orders: P-256 (FIPS 186) and Ed25519's L (RFC 8032, section 5.1).
P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
ED25519_L = 2**252 + 27742317777372353535851937790883648493
# The one accepted DER SubjectPublicKeyInfo prefix per algorithm (ADR-0045, section 4, step 4).
P256_PREFIX = bytes.fromhex("3059301306072a8648ce3d020106082a8648ce3d030107034200")
ED25519_PREFIX = bytes.fromhex("302a300506032b6570032100")

P256 = "ecdsa-p256-sha256"
ED = "ed25519"
FAMILY = {P256: "p256", ED: "ed25519"}
OTHER = {P256: ED, ED: P256}
KEY_NAME = {P256: "not a P-256 key", ED: "not an Ed25519 key"}

PASS = {"outcome": "pass"}
REFUSED = {"outcome": "refused"}


def fail(detail):
    return {"outcome": "fail", "detail": detail}


def b64(data):
    return base64.b64encode(data).decode("ascii")


def fingerprint(der):
    return "sha256:" + hashlib.sha256(der).hexdigest()


def pem(der, label="PUBLIC KEY"):
    body = b64(der)
    lines = "".join(body[i : i + 64] + "\n" for i in range(0, len(body), 64))
    return f"-----BEGIN {label}-----\n{lines}-----END {label}-----\n"


def flip_last_byte(data):
    return data[:-1] + bytes([data[-1] ^ 1])


def signed_text(value, ensure_ascii=True):
    """What a Python signer typically signs: sorted keys, no spaces. The check never re-creates this text."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=ensure_ascii)


class TestKey:
    """A throwaway key pair. The private half lives only in this process."""

    def __init__(self, alg):
        self.alg = alg
        self._private = ec.generate_private_key(ec.SECP256R1()) if alg == P256 else ed25519.Ed25519PrivateKey.generate()
        self.der = self._private.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        prefix, length = (P256_PREFIX, 91) if alg == P256 else (ED25519_PREFIX, 44)
        assert self.der.startswith(prefix) and len(self.der) == length, "unexpected SubjectPublicKeyInfo shape"
        self.pem = self._private.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode("ascii")

    def ed25519_scalar(self):
        """The secret scalar of RFC 8032, section 5.1.5. It stays in memory."""
        seed = self._private.private_bytes(
            serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()
        )
        clamped = bytearray(hashlib.sha512(seed).digest()[:32])
        clamped[0] &= 248
        clamped[31] = (clamped[31] & 127) | 64
        return int.from_bytes(clamped, "little")

    def sign(self, message, fmt=None, high_s=False):
        """A signature over `message`. P-256: `der` or `raw`, low s unless `high_s`. Ed25519: 64 raw bytes."""
        if self.alg == ED:
            return self._private.sign(message)
        r, s = decode_dss_signature(self._private.sign(message, ec.ECDSA(hashes.SHA256())))
        s = min(s, P256_N - s)
        if high_s:
            s = P256_N - s
        if fmt == "raw":
            return r.to_bytes(32, "big") + s.to_bytes(32, "big")
        return encode_dss_signature(r, s)


# A manifest with integers only, and one with the decimals a robot kit writes. Python prints 1.0 and 1e-07;
# ECMAScript would print 1 and 1e-7. The check hashes the signed text as it is, so both verify.
INTEGERS = {
    "layout": "signature-vector/1",
    "order_id": "test-order-0001",
    "buyer_nonce": "00112233445566778899aabbccddeeff",
    "status": "completed",
    "sample_count": 3,
    "t_ms": [0, 8, 16],
}
DECIMALS = {
    **INTEGERS,
    "speed_factor": 1.0,
    "joint_deg": [0.0, -45.5, 1e-07, 12.345678],
    "note": "45° é \U0001f916",
}


class Family:
    """The vectors for one algorithm."""

    def __init__(self, alg, out):
        self.alg = alg
        self.out = out
        self.key = TestKey(alg)
        self.other_key = TestKey(alg)
        self.sig_format = "der" if alg == P256 else "raw"

    def check(self, *, key_format="spki-pem", encoding="utf8", sig_format=None, json_equals="/manifest", der=None):
        message = {"pointer": "/manifest_text", "encoding": encoding}
        if json_equals is not None:
            message["jsonEquals"] = json_equals
        return {
            "id": "manifest-signature",
            "type": "signature_valid",
            "required": True,
            "alg": self.alg,
            "publicKey": {
                "pointer": "/pubkey",
                "format": key_format,
                "spkiSha256": fingerprint(self.key.der if der is None else der),
            },
            "message": message,
            "signature": {
                "pointer": "/manifest_sig",
                "encoding": "base64",
                "format": sig_format or self.sig_format,
            },
        }

    def document(self, *, manifest=INTEGERS, text=None, signature=None, signature_text=None, key_text=None):
        """The delivered document, as a dict. By default: `manifest`, its signed text, a good signature, the PEM key."""
        if text is None:
            text = signed_text(manifest)
        if signature is None:
            signature = self.key.sign(text.encode("utf-8", "surrogatepass"), self.sig_format)
        return {
            "manifest": manifest,
            "manifest_text": text,
            "manifest_sig": b64(signature) if signature_text is None else signature_text,
            "pubkey": self.key.pem if key_text is None else key_text,
        }

    def add(self, name, case, why, expect, check=None, document=None, delivery=None):
        if delivery is None:
            delivery = json.dumps(self.document() if document is None else document)
        self.out.append(
            {
                "name": f"{FAMILY[self.alg]}/{name}",
                "alg": FAMILY[self.alg],
                "case": case,
                "why": why,
                "check": self.check() if check is None else check,
                # A string, so that spellings such as 1.0 and 1 survive. Its UTF-8 bytes are the delivered file.
                "delivery": delivery,
                "expect": expect,
            }
        )


def sixty_four_byte_der(message):
    """A valid DER signature that is exactly 64 bytes long, with the public key (DER) it verifies under.

    Random signing does not produce one, so this builds it: pick the nonce k, pick a short s, then solve for the
    private key d = (s*k - hash) / r. All of it is throwaway.
    """
    digest = int.from_bytes(hashlib.sha256(message).digest(), "big")
    k = 1 + int.from_bytes(os.urandom(32), "big") % (P256_N - 1)
    r = ec.derive_private_key(k, ec.SECP256R1()).public_key().public_numbers().x % P256_N
    r_length = r.bit_length() // 8 + 1  # the DER INTEGER, with its 00 when the top bit is set
    s_length = 64 - 6 - r_length
    first = 1 + os.urandom(1)[0] % 127
    s = int.from_bytes(bytes([first]) + os.urandom(s_length - 1), "big")
    d = (s * k - digest) * pow(r, -1, P256_N) % P256_N
    public = ec.derive_private_key(d, ec.SECP256R1()).public_key()
    signature = encode_dss_signature(r, s)
    assert len(signature) == 64, "the DER signature is not 64 bytes"
    public.verify(signature, message, ec.ECDSA(hashes.SHA256()))
    der = public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return signature, der


def shared_cases(f):
    """The cases both algorithms carry."""
    good_text = signed_text(INTEGERS)
    good_sig = f.key.sign(good_text.encode(), f.sig_format)
    no_verify = fail("signature does not verify")

    # Good signatures.
    f.add("good", "good", "Signed in Python; PEM key, UTF-8 message, jsonEquals.", PASS)
    decimal_text = signed_text(DECIMALS, ensure_ascii=False)
    f.add(
        "good-decimals-in-signed-bytes",
        "float",
        "The signed text holds decimals as Python prints them (1.0, 1e-07). ADR-0045 section 2 allows them.",
        PASS,
        document=f.document(manifest=DECIMALS, text=decimal_text),
    )
    log = b"t_ms,q1_deg\r\n0,0.0\n8,12.50\n" + bytes([0x00, 0xFF, 0xFE])
    f.add(
        "good-binary-message-spki-base64",
        "good",
        "A base64 message that is not UTF-8, a base64 key, no jsonEquals.",
        PASS,
        check=f.check(key_format="spki-base64", encoding="base64", json_equals=None),
        document=f.document(text=b64(log), signature=f.key.sign(log, f.sig_format), key_text=b64(f.key.der)),
    )
    f.add(
        "good-base64-message-jsonequals",
        "good",
        "A base64 message whose bytes are the JSON of the object.",
        PASS,
        check=f.check(encoding="base64"),
        document=f.document(text=b64(good_text.encode()), signature=good_sig),
    )
    reordered = dict(reversed(list(INTEGERS.items())))
    f.add(
        "good-object-keys-in-another-order",
        "good",
        "jsonEquals ignores the order of object keys.",
        PASS,
        document=f.document(manifest=reordered, text=good_text, signature=good_sig),
    )
    f.add(
        "good-pem-crlf-no-final-line-end",
        "good",
        "PEM lines may end in CRLF, and the final line end is optional.",
        PASS,
        document=f.document(key_text=f.key.pem.rstrip("\n").replace("\n", "\r\n")),
    )

    # Wrong key.
    f.add(
        "wrong-key-in-delivery",
        "wrong-key",
        "Another key and its own valid signature. The terms pin a different fingerprint.",
        fail("publicKey: fingerprint differs from the terms"),
        document=f.document(
            signature=f.other_key.sign(good_text.encode(), f.sig_format), key_text=f.other_key.pem
        ),
    )
    f.add(
        "wrong-key-signed",
        "wrong-key",
        "The pinned key is delivered, but another key signed.",
        no_verify,
        document=f.document(signature=f.other_key.sign(good_text.encode(), f.sig_format)),
    )

    # One flipped byte.
    changed = good_text.replace("00112233", "10112233")
    assert changed != good_text
    f.add(
        "flipped-byte-message",
        "flipped-byte",
        "One byte of the signed text changed after signing.",
        no_verify,
        document=f.document(text=changed, signature=good_sig),
    )
    f.add(
        "flipped-byte-signature",
        "flipped-byte",
        "One bit of the signature's last byte changed.",
        no_verify,
        document=f.document(signature=flip_last_byte(good_sig)),
    )
    f.add(
        "flipped-byte-public-key",
        "flipped-byte",
        "One bit of the delivered key changed. The fingerprint is compared before any curve arithmetic.",
        fail("publicKey: fingerprint differs from the terms"),
        document=f.document(key_text=pem(flip_last_byte(f.key.der))),
    )

    # Random bytes in place of the signature. A DER check must not see a SEQUENCE tag by chance.
    noise = os.urandom(64)
    if noise[0] == 0x30:
        noise = b"\x00" + noise[1:]
    f.add(
        "random-signature-bytes",
        "random-signature",
        "64 random bytes in place of the signature, in the check's usual format.",
        fail("signature: not valid DER") if f.sig_format == "der" else no_verify,
        document=f.document(signature=noise),
    )

    # Floats.
    one_point_oh = {**INTEGERS, "speed_factor": 1.0}
    one = {**INTEGERS, "speed_factor": 1}
    f.add(
        "float-respelled-after-signing",
        "float",
        "Signed 1.0, delivered as 1 (what a JavaScript re-serialization writes). The bytes differ.",
        no_verify,
        document=f.document(
            manifest=one, text=signed_text(one), signature=f.key.sign(signed_text(one_point_oh).encode(), f.sig_format)
        ),
    )
    f.add(
        "float-introduced-after-signing",
        "float",
        "Signed the integer 3, delivered as 3.0. The bytes differ.",
        no_verify,
        document=f.document(text=good_text.replace('"sample_count":3', '"sample_count":3.0'), signature=good_sig),
    )
    f.add(
        "float-in-object-signed-integer",
        "float",
        "The signed text says 3; the object the other checks read says 3.5.",
        fail("message: differs from the value at jsonEquals"),
        document=f.document(manifest={**INTEGERS, "sample_count": 3.5}, text=good_text, signature=good_sig),
    )
    f.add(
        "float-spelling-equal-under-jsonequals",
        "float",
        "Signed 1.0, object 1: the same number, so jsonEquals holds (ADR-0045 section 3).",
        PASS,
        document=f.document(manifest=one, text=signed_text(one_point_oh)),
    )
    float_check = f.check()
    float_check["message"]["jsonEquals"] = 0.5
    f.add(
        "float-in-check-parameters",
        "float",
        "A float in place of a pointer. The check is part of the hashed terms, so no number enters it (ADR-0022).",
        REFUSED,
        check=float_check,
    )

    # Oversized input.
    f.add(
        "oversize-public-key",
        "oversize",
        "A key string of 1,025 characters.",
        fail("publicKey: too long"),
        document=f.document(key_text="A" * 1025),
    )
    f.add(
        "oversize-public-key-boundary",
        "oversize",
        "A key string of 1,024 characters passes the length limit and fails to decode.",
        fail("publicKey: not a PEM public key"),
        document=f.document(key_text="A" * 1024),
    )
    f.add(
        "oversize-signature",
        "oversize",
        "A signature string of 257 characters.",
        fail("signature: too long"),
        document=f.document(signature_text="A" * 257),
    )
    f.add(
        "oversize-signature-boundary",
        "oversize",
        "A signature string of 256 characters passes the length limit and decodes to too many bytes.",
        fail("signature: wrong length"),
        document=f.document(signature_text="A" * 256),
    )
    long_pointer = f.check()
    long_pointer["signature"]["pointer"] = "/" + "a" * 512
    f.add("oversize-pointer", "oversize", "A pointer of 513 characters in the check.", REFUSED, check=long_pointer)

    # Unknown or mismatched algorithm.
    unknown = f.check()
    unknown["alg"] = "ecdsa-p384-sha384" if f.alg == P256 else "ed448"
    f.add(
        "unknown-algorithm",
        "unknown-algorithm",
        "An algorithm outside the closed list. Refused at offer time; it never passes.",
        REFUSED,
        check=unknown,
    )
    swapped = f.check()
    swapped["alg"] = OTHER[f.alg]
    swapped["signature"]["format"] = "raw"
    f.add(
        "wrong-algorithm-for-the-key",
        "unknown-algorithm",
        "The check names the other algorithm, with this key pinned.",
        fail(f"publicKey: {KEY_NAME[OTHER[f.alg]]}"),
        check=swapped,
    )


def p256_cases(f):
    """Strictness cases for ECDSA, and the cases that do not depend on the algorithm."""
    text = signed_text(INTEGERS)
    message = text.encode()
    der = f.key.sign(message, "der")
    raw = f.key.sign(message, "raw")
    raw_check = f.check(sig_format="raw")
    no_verify = fail("signature does not verify")

    f.add("good-raw-signature", "good", "r then s in 64 bytes.", PASS, check=raw_check, document=f.document(signature=raw))
    f.add(
        "good-high-s",
        "good",
        "A high s is accepted. A verifier that requires a low s fails this vector.",
        PASS,
        document=f.document(signature=f.key.sign(message, "der", high_s=True)),
    )
    f.add(
        "good-raw-high-s",
        "good",
        "A high s in the raw form.",
        PASS,
        check=raw_check,
        document=f.document(signature=f.key.sign(message, "raw", high_s=True)),
    )
    f.add(
        "random-signature-bytes-raw",
        "random-signature",
        "64 random bytes in the raw form.",
        no_verify,
        check=raw_check,
        document=f.document(signature=os.urandom(64)),
    )

    f.add(
        "raw-signature-in-der-check",
        "strictness",
        "A valid raw signature in a `der` check. A verifier that guesses the format passes it by mistake.",
        fail("signature: not valid DER"),
        document=f.document(signature=raw),
    )
    f.add(
        "der-signature-in-raw-check",
        "strictness",
        "A DER signature in a `raw` check.",
        fail("signature: wrong length"),
        check=raw_check,
        document=f.document(signature=der),
    )
    short, short_key = sixty_four_byte_der(message)
    short_document = f.document(signature=short, key_text=pem(short_key))
    f.add(
        "good-64-byte-der",
        "good",
        "A valid DER signature of exactly 64 bytes, under a key built for it. The control for the next vector.",
        PASS,
        check=f.check(der=short_key),
        document=short_document,
    )
    f.add(
        "64-byte-der-in-raw-check",
        "strictness",
        "The same signature in a `raw` check is r then s, and does not verify. A verifier that names no format passes it.",
        no_verify,
        check=f.check(sig_format="raw", der=short_key),
        document=short_document,
    )
    f.add(
        "der-empty-integers",
        "strictness",
        "A DER SEQUENCE of two empty INTEGERs. DER has no empty INTEGER.",
        fail("signature: not valid DER"),
        document=f.document(signature=bytes.fromhex("300402000200")),
    )
    f.add(
        "der-trailing-byte",
        "strictness",
        "One byte after the DER signature (at most 72 bytes in all).",
        fail("signature: not valid DER"),
        document=f.document(signature=der + b"\x00"),
    )
    f.add(
        "der-over-72-bytes",
        "strictness",
        "73 bytes in a `der` check.",
        fail("signature: wrong length"),
        document=f.document(signature=der + bytes(73 - len(der))),
    )
    r, s = raw[:32], raw[32:]
    zero = bytes(32)
    for name, why, value in [
        ("r-zero", "r is 0.", zero + s),
        ("s-zero", "s is 0.", r + zero),
        ("r-is-the-order", "r is the curve order.", P256_N.to_bytes(32, "big") + s),
        ("s-is-the-order", "s is the curve order.", r + P256_N.to_bytes(32, "big")),
    ]:
        f.add(name, "strictness", why, no_verify, check=raw_check, document=f.document(signature=value))

    point = f.key.der[len(P256_PREFIX) :]
    compressed_point = bytes([2 + (point[-1] & 1)]) + point[1:33]
    compressed = bytes.fromhex("3039301306072a8648ce3d020106082a8648ce3d030107032200") + compressed_point
    f.add(
        "compressed-point",
        "strictness",
        "The same key with a compressed point, pinned by its own fingerprint.",
        fail("publicKey: not a P-256 key"),
        check=f.check(der=compressed),
        document=f.document(key_text=pem(compressed)),
    )
    off_curve = flip_last_byte(f.key.der)
    f.add(
        "point-not-on-the-curve",
        "strictness",
        "The right shape and the pinned fingerprint, with a point that is not on P-256.",
        fail("publicKey: not a P-256 key"),
        check=f.check(der=off_curve),
        document=f.document(key_text=pem(off_curve)),
    )

    hostile_cases(f, text, raw)


def hostile_cases(f, text, raw):
    """Malformed documents and encodings. The code is the same for both algorithms, so P-256 alone carries them."""
    message = text.encode()

    f.add(
        "delivery-not-json",
        "hostile",
        "A CSV delivery.",
        fail("not a JSON document"),
        delivery="t_ms,q1_deg\n0,0.0\n8,12.50\n",
    )
    for field, pointer_owner in [("pubkey", "publicKey"), ("manifest_text", "message"), ("manifest_sig", "signature")]:
        missing = f.document()
        del missing[field]
        f.add(
            f"{pointer_owner}-pointer-to-nothing",
            "hostile",
            f"The document has no `{field}`.",
            fail(f"{pointer_owner}: nothing at the pointer"),
            document=missing,
        )
        number = f.document()
        number[field] = 7
        f.add(
            f"{pointer_owner}-not-a-string",
            "hostile",
            f"`{field}` is a number.",
            fail(f"{pointer_owner}: not a string"),
            document=number,
        )
    prototype = f.check()
    prototype["publicKey"]["pointer"] = "/constructor"
    f.add(
        "pointer-to-an-inherited-property",
        "hostile",
        "A pointer reads the document's own members only.",
        fail("publicKey: nothing at the pointer"),
        check=prototype,
    )
    bad_syntax = f.check()
    bad_syntax["message"]["pointer"] = "manifest_text"
    f.add("pointer-not-rfc6901", "hostile", "A pointer with no leading slash.", REFUSED, check=bad_syntax)
    der_ed = f.check()
    der_ed["alg"] = ED
    f.add("ed25519-with-der", "hostile", "`ed25519` takes the `raw` format only.", REFUSED, check=der_ed)
    extra = f.check()
    extra["publicKey"]["key"] = "x"
    f.add("extra-property", "hostile", "The check's objects are closed.", REFUSED, check=extra)
    bad_id = f.check()
    bad_id["id"] = "Manifest Signature"
    f.add("check-id-outside-the-pattern", "hostile", "A check id follows the schema's pattern.", REFUSED, check=bad_id)

    for name, why, key_text in [
        ("pem-second-block", "Two PEM blocks.", f.key.pem + f.other_key.pem),
        ("pem-other-label", "A PEM block with another label.", pem(f.key.der, "CERTIFICATE")),
        ("pem-leading-text", "Text before the PEM block.", "key:\n" + f.key.pem),
    ]:
        f.add(name, "hostile", why, fail("publicKey: not a PEM public key"), document=f.document(key_text=key_text))
    f.add(
        "key-base64-with-a-line-end",
        "hostile",
        "A base64 key with a final line end.",
        fail("publicKey: not valid base64"),
        check=f.check(key_format="spki-base64"),
        document=f.document(key_text=b64(f.key.der) + "\n"),
    )

    # Each of these breaks one part of the base64 rule. The raw form is 64 bytes: 86 characters and "==".
    canonical = b64(raw)
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    last = canonical[-3]
    trailing_bits = canonical[:-3] + alphabet[alphabet.index(last) | 1] + "=="
    assert trailing_bits != canonical and base64.b64decode(trailing_bits) == raw
    # A real signature whose base64 uses '+' or '/', so the URL form is the same bytes in another alphabet.
    spelled = canonical
    while "+" not in spelled and "/" not in spelled:
        spelled = b64(f.key.sign(message, "raw"))
    url_alphabet = spelled.replace("+", "-").replace("/", "_")
    for name, why, value in [
        ("signature-base64-whitespace", "Base64 with a space.", canonical[:10] + " " + canonical[10:]),
        ("signature-base64-no-padding", "Base64 without padding.", canonical.rstrip("=")),
        ("signature-base64-url-alphabet", "The URL alphabet.", url_alphabet),
        ("signature-base64-trailing-bits", "Non-zero trailing bits: a second spelling of the same bytes.", trailing_bits),
    ]:
        f.add(
            name,
            "hostile",
            why,
            fail("signature: not valid base64"),
            check=f.check(sig_format="raw"),
            document=f.document(signature_text=value),
        )
    f.add(
        "message-base64-no-padding",
        "hostile",
        "A base64 message without padding.",
        fail("message: not valid base64"),
        check=f.check(encoding="base64", json_equals=None),
        document=f.document(text="YWI", signature=f.key.sign(b"ab", "der")),
    )
    f.add(
        "message-lone-surrogate",
        "hostile",
        "A lone surrogate has no UTF-8 encoding. The signature covers U+FFFD, which a lenient encoder puts in its place.",
        fail("message: not well-formed text"),
        check=f.check(json_equals=None),
        document=f.document(text="a\ud800b", signature=f.key.sign("a\ufffdb".encode(), "der")),
    )
    f.add(
        "signed-bytes-not-json",
        "hostile",
        "A good signature over text that is not JSON, in a check with jsonEquals.",
        fail("message: not JSON"),
        document=f.document(text="not json", signature=f.key.sign(b"not json", "der")),
    )
    with_bom = "﻿" + text
    f.add(
        "signed-bytes-with-a-byte-order-mark",
        "hostile",
        "A good signature over JSON after a byte order mark, with jsonEquals. See README, open questions.",
        fail("message: not JSON"),
        document=f.document(text=with_bom, signature=f.key.sign(with_bom.encode(), "der")),
    )
    nowhere = f.check(json_equals="/nowhere")
    f.add(
        "jsonequals-pointer-to-nothing",
        "hostile",
        "Nothing sits at the jsonEquals pointer. See README, open questions.",
        fail("message: differs from the value at jsonEquals"),
        check=nowhere,
    )


def ed25519_cases(f):
    """Strictness cases for Ed25519."""
    text = signed_text(INTEGERS)
    sig = f.key.sign(text.encode())
    no_verify = fail("signature does not verify")

    # S + L satisfies the curve equation, and RFC 8032 refuses it.
    s = int.from_bytes(sig[32:], "little")
    f.add(
        "s-plus-the-group-order",
        "strictness",
        "A second encoding of a valid signature: S + L.",
        no_verify,
        document=f.document(signature=sig[:32] + (s + ED25519_L).to_bytes(32, "little")),
    )
    # The identity point as the key, the identity point as R, S = 0. It satisfies the equation for every message.
    identity = (1).to_bytes(32, "little")
    weak = ED25519_PREFIX + identity
    check = f.check(der=weak)
    f.add(
        "small-order-key",
        "strictness",
        "A signature that fits any message. A verifier left on the lenient zip215 default fails this vector.",
        no_verify,
        check=check,
        document=f.document(signature=identity + bytes(32), key_text=pem(weak)),
    )
    # R is the identity, spelled y = p + 1. With S = k*a, the lenient rule accepts it under an ordinary key: it
    # re-encodes R before it hashes, so k is computed over the canonical spelling.
    message = text.encode()
    k = int.from_bytes(hashlib.sha512(identity + f.key.der[len(ED25519_PREFIX) :] + message).digest(), "little")
    noncanonical = (2**255 - 19 + 1).to_bytes(32, "little")
    f.add(
        "non-canonical-r",
        "strictness",
        "An ordinary key and an R that is not canonically encoded. The lenient zip215 rule accepts it.",
        no_verify,
        document=f.document(
            signature=noncanonical + (k * f.key.ed25519_scalar() % ED25519_L).to_bytes(32, "little")
        ),
    )
    f.add(
        "short-signature",
        "strictness",
        "63 bytes.",
        fail("signature: wrong length"),
        document=f.document(signature=sig[:63]),
    )
    der = f.check()
    der["signature"]["format"] = "der"
    f.add("der-format", "unknown-algorithm", "`ed25519` with `der` is refused at offer time.", REFUSED, check=der)


def main():
    vectors = []
    p256 = Family(P256, vectors)
    shared_cases(p256)
    p256_cases(p256)
    ed = Family(ED, vectors)
    shared_cases(ed)
    ed25519_cases(ed)

    names = [v["name"] for v in vectors]
    assert len(names) == len(set(names)), "a vector name is used twice"

    out = {
        "format": "crow-signature-valid-vectors/1",
        "adr": "ADR-0045",
        "keys": "THROWAWAY TEST KEYS, made for these vectors only. No private key is stored. Never trust one.",
        "signedWith": {"language": "Python", "library": "cryptography", "version": cryptography.__version__},
        "vectors": copy.deepcopy(vectors),
    }
    OUT.write_text(json.dumps(out, indent=2) + "\n", encoding="ascii")
    print(f"wrote {OUT.name}: {len(vectors)} vectors")


if __name__ == "__main__":
    main()
