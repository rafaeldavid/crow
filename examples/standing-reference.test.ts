// T-605: site/ref/standing.txt is all an outside client has to publish or take a standing offer, so every value and
// encoding it states is read back from the page and compared with the code Crow runs. No network.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitmentId, deliveryHash, encodeStandingSignature, FILL_ABI, recoversFrom, standingDeliveryFor, STANDING_DELIVERY, STANDING_OFFER_ABI, STANDING_SELLER_DOMAIN, standingTypes, TAKE, takeTerms, templateDigest, templateHash, type StandingOffer, type TakeFill } from '@holdback/core';
import { keccak256, parseAbiParameters, size, type Hex } from 'viem';
// @ts-expect-error plain JavaScript module with no declarations
import { standingCodeText } from '../site/build.mjs';
import { STANDING_SELLER_CREATION_CODE } from './standing-seller-code.ts';
import { BLOCK_BACK_SEC, DETERMINISTIC_DEPLOYER, sellerAddressOf } from './take.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const page = read('../site/ref/standing.txt');
const seller = read('../site/ref/http-seller.txt');
const block = (lang: string, after: string) => {
  const at = page.indexOf(after);
  const start = page.indexOf(`\`\`\`${lang}\n`, at) + lang.length + 4;
  return page.slice(start, page.indexOf('\n```', start));
};
/** The value the page gives right after `label`, in backticks. */
const stated = (label: string, from = 0) => {
  const at = page.indexOf(label, from);
  expect(at, `the page no longer says "${label}"`).toBeGreaterThanOrEqual(0);
  return /`(0x[0-9a-f]{64})`/.exec(page.slice(at))![1]!;
};

describe('ref/standing.txt against the code (T-605)', () => {
  it('pins the creation code the tools carry, served as its own file', () => {
    expect(stated('keccak256 of the decoded bytes is')).toBe(keccak256(STANDING_SELLER_CREATION_CODE));
    expect(standingCodeText()).toBe(`${STANDING_SELLER_CREATION_CODE}\n`);
    expect(page.toLowerCase()).toContain(DETERMINISTIC_DEPLOYER);
    expect(page).toContain(`settlement time minus ${BLOCK_BACK_SEC} s`);
    expect(page).toContain(`{"name": "${STANDING_SELLER_DOMAIN.name}", "version": "${STANDING_SELLER_DOMAIN.version}",`);
  });

  it("states the contract's EIP-712 types, and names every one signing.txt must supply", () => {
    const types = JSON.parse(block('json', '### Types and hash')) as Record<string, unknown>;
    const { Revoke, ...own } = types;
    const all = standingTypes() as Record<string, unknown>;
    for (const [name, fields] of Object.entries(own)) expect(fields, name).toEqual(all[name]);
    expect(Revoke).toEqual([{ name: 'templateHash', type: 'bytes32' }]);
    const signing = read('../site/ref/signing.txt');
    const shared = JSON.parse(/## EIP-712 types[\s\S]*?```json\n([\s\S]*?)\n```/.exec(signing)![1]!) as Record<string, unknown>;
    for (const name of Object.keys(all).filter((n) => !(n in own))) expect(shared[name], `${name} must come from ref/signing.txt`).toEqual(all[name]);
  });

  it('declares the structs the contract decodes', () => {
    const structs = block('solidity', '## Contract signature').split('\n');
    const [, offer, , fill] = parseAbiParameters(['uint8, StandingOffer, bytes, Fill', ...structs] as never) as unknown as { type: string; components?: unknown[] }[];
    const bare = (c: unknown): unknown => (Array.isArray(c) ? c.map(bare) : { name: (c as { name: string }).name, type: (c as { type: string }).type, ...((c as { components?: unknown[] }).components ? { components: bare((c as { components: unknown[] }).components) } : {}) });
    expect(bare(offer!.components)).toEqual(bare([...STANDING_OFFER_ABI.components]));
    expect(bare(fill!.components)).toEqual(bare([...FILL_ABI.components]));
  });

  it("gives vectors that follow from the card schema's example", async () => {
    const ex = JSON.parse(read('../site/card.schema.json')).$defs.standing.examples[0] as { chainId: number; seller: Hex; key: Hex; salt: Hex; template: StandingOffer; signature: Hex };
    expect(sellerAddressOf(ex.key, ex.salt)).toBe(ex.seller);
    expect(stated('`templateHash` `')).toBe(templateHash(ex.template));
    const digest = templateDigest(ex.template, ex.seller, ex.chainId);
    expect(stated("digest under the contract's domain")).toBe(digest);
    expect(await recoversFrom(digest, ex.signature, ex.key)).toBe(true);

    const buyer = /Fill it with `buyer` and `buyerPaymentAddress` `(0x[0-9a-f]{40})`/.exec(page)![1] as Hex;
    const key = /`buyerEncryptionPublicKey` `([A-Za-z0-9_-]{43})`, `nonceSeed` 32 bytes of `0x07`, `createdAt` `([0-9TZ:-]+)`/.exec(page)!;
    const fill = { buyer, buyerPaymentAddress: buyer, buyerEncryptionPublicKey: key[1]!, nonceSeed: `0x${'07'.repeat(32)}` as Hex, createdAt: key[2]! } as TakeFill;
    expect(stated('- commitment ID')).toBe(commitmentId(takeTerms(ex.template, fill, ex.seller)));
    const take = encodeStandingSignature(TAKE, ex.template, ex.signature, fill);
    expect(page).toContain(`the kind 1 blob is ${size(take)} bytes`);
    expect(stated('the kind 1 blob is')).toBe(keccak256(take));

    // The delivery vector: the values the page takes from ref/http-seller.txt's table.
    const row = (name: string) => new RegExp(`^\\| ${name} \\| \`([^\`]+)\` \\|$`, 'm').exec(seller)![1]!;
    const sha = row('ciphertext sha256');
    const a = ex.template.terms.adjudication;
    const withDelivery = {
      ...ex.template,
      delivery: {
        ciphertext: { uri: `https://api.example/v1/ciphertext/${sha}`, sha256: sha, bytes: 43, cipher: 'aes-256-gcm' },
        plaintextSha256: row('plaintextSha256'),
        plaintextMime: 'text/csv',
        encryptedKeys: [a.adjudicator, a.fallbackAdjudicator, a.appealAdjudicator].map((recipient) => ({ recipient, scheme: 'x25519-xsalsa20poly1305', ciphertext: row('envelope') })),
        submittedAt: '2026-11-30T00:00:00Z',
      },
    } as unknown as StandingOffer;
    const at = page.indexOf('For the delivery encodings');
    expect(stated('`templateHash` is then', at)).toBe(templateHash(withDelivery));
    const blob = encodeStandingSignature(STANDING_DELIVERY, withDelivery, ex.signature, fill);
    expect(page).toContain(`a kind 2 blob of ${size(blob)} bytes`);
    expect(stated('a kind 2 blob of', at)).toBe(keccak256(blob));
    // The posted delivery is the template's five fields with the take's ID and attempt 1.
    const d = standingDeliveryFor(withDelivery, commitmentId(takeTerms(withDelivery, fill, ex.seller)))!;
    expect(Object.keys(d).sort()).toEqual(['attempt', 'ciphertext', 'commitmentId', 'encryptedKeys', 'plaintextMime', 'plaintextSha256', 'submittedAt']);
    expect(deliveryHash({ ...d, signature: '0x00' } as never)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
