// T-541 fixture: seals one report the way examples/agent.ts prepareDelivery seals a delivery (AES-256-GCM content,
// one x25519-xsalsa20poly1305 envelope for the buyer), with a fresh buyer key. Unlike prepareDelivery it keeps the
// envelope's one-time secret, which the prover needs and today's tools throw away. Offline: it calls no operator.
//
//   node tools/envelope-proof/fixture.ts --report <file> --out <dir> [--tamper wrong-key | wrong-secret]
//
// Writes, in <dir>:
//   ciphertext.bin   the public ciphertext
//   input.json       the seller's prover input, with the one-time secret (keep it private)
//   expect.json      what the buyer holds before it countersigns: its terms' key and address, and the waiver offer's
//                    envelope hash, ciphertext hash and plaintext hash
//   buyer.json       the buyer's secret key, so the fixture's own check can open the envelope (a test only)
// --tamper wrong-key seals a different key in the envelope; --tamper wrong-secret gives the prover another secret.
// Either must leave the prover with no proof.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nacl from '../../examples/node_modules/tweetnacl/nacl-fast.js';
import { hashStruct, type Hex } from '../../examples/node_modules/viem/_esm/index.js';
import { TYPES } from '../../examples/verify.ts';

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const [reportFile, out, tamper] = [arg('--report'), arg('--out'), arg('--tamper')];
if (!reportFile || !out || (tamper !== undefined && !['wrong-key', 'wrong-secret'].includes(tamper))) {
  console.error('usage: node tools/envelope-proof/fixture.ts --report <file> --out <dir> [--tamper wrong-key | wrong-secret]');
  process.exit(2);
}
const SCHEME = 'x25519-xsalsa20poly1305';
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sha = async (b: Uint8Array) => `sha256:${Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(b))).toString('hex')}`;
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const plaintext = new Uint8Array(readFileSync(reportFile));
const buyer = nacl.box.keyPair();
const recipient = `0x${hex(random(20))}`;

// The content, as prepareDelivery encrypts it: a 12-byte nonce, then AES-256-GCM.
const key = random(32);
const iv = random(12);
const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
const ciphertext = new Uint8Array([...iv, ...new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, plaintext))]);

// The buyer's envelope, as prepareDelivery seals it: ephemeral public key, nonce, box. The one-time secret is kept.
const eph = nacl.box.keyPair();
const nonce = nacl.randomBytes(24);
const sealedKey = tamper === 'wrong-key' ? random(32) : key;
const box = nacl.box(sealedKey, nonce, buyer.publicKey, eph.secretKey);
const envelope = new Uint8Array([...eph.publicKey, ...nonce, ...box]);
const envelopeText = b64(envelope);
const envelopeHash: Hex = hashStruct({ types: TYPES, primaryType: 'EncryptedKey', data: { recipient, scheme: SCHEME, ciphertext: envelopeText, unlock: { kind: '', round: 0n } } } as never);

// The fixture's own check: the buyer, with its secret, opens the envelope and the content.
const opened = nacl.box.open(box, nonce, eph.publicKey, buyer.secretKey);
if (tamper === undefined) {
  if (!opened || hex(opened) !== hex(key)) throw new Error('the envelope does not open to the content key');
  const back = await crypto.subtle.importKey('raw', opened, 'AES-GCM', false, ['decrypt']);
  const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, back, ciphertext.slice(12)));
  if ((await sha(decrypted)) !== (await sha(plaintext))) throw new Error('the content does not decrypt to the report');
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'ciphertext.bin'), ciphertext);
writeFileSync(join(out, 'input.json'), `${JSON.stringify({
  ephemeralSecret: hex(tamper === 'wrong-secret' ? random(32) : eph.secretKey),
  buyerPublicKey: b64(buyer.publicKey), recipient, scheme: SCHEME, envelope: envelopeText, ciphertextFile: join(out, 'ciphertext.bin'),
}, null, 2)}\n`);
writeFileSync(join(out, 'expect.json'), `${JSON.stringify({
  recipient, buyerPublicKey: b64(buyer.publicKey), envelopeHash, ciphertextSha256: await sha(ciphertext), plaintextSha256: await sha(plaintext),
}, null, 2)}\n`);
writeFileSync(join(out, 'buyer.json'), `${JSON.stringify({ secretKey: b64(buyer.secretKey) })}\n`);
console.log(`${out}: ${plaintext.length} bytes of report, ${ciphertext.length} bytes of ciphertext, envelope hash ${envelopeHash}${tamper ? `, tampered: ${tamper}` : ''}`);
