// T-549 PR 4 (ADR-0040 §4): the seller contract's creation code the node pins is the build's, and the address it
// derives for a key is the one the deterministic deployer creates (StandingSellerBase.sol deploys the same way).
// The comparison with the build needs `forge build` output in contracts/out; the rest runs without it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getContractAddress, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { CREATE2_DEPLOYER, STANDING_SALT, STANDING_SELLER_CREATION_CODE_HASH, standingDeployment, standingInitCode, standingSellerAddress } from './standing-seller.js';
import { STANDING_SELLER_CREATION_CODE } from './standing-seller-code.js';

const artifact = join(import.meta.dirname, '..', '..', '..', 'contracts', 'out', 'HoldbackStandingSeller.sol', 'HoldbackStandingSeller.json');
const KEY = '0x00000000000000000000000000000000000005e1';

describe('the pinned standing seller (T-549)', () => {
  it.skipIf(!existsSync(artifact))(`the pinned creation code is the build's, but for the metadata hash${existsSync(artifact) ? '' : ' (SKIPPED: needs forge build output in contracts/out)'}`, () => {
    const built = (JSON.parse(readFileSync(artifact, 'utf8')) as { bytecode: { object: Hex } }).bytecode.object;
    // The code without the metadata hash at its end (its CBOR length is the last two bytes): forge hashes the remappings
    // it finds under contracts/lib into it, so a checkout with more submodules than CI's builds the same code with
    // another hash (CI run 45551293886, measured). If this fails, the contract changed: pin it again from a clean
    // checkout (pin-standing-seller.mjs), and know that every seller contract's address moves with it.
    const code = (c: Hex) => c.slice(0, c.length - (parseInt(c.slice(-4), 16) + 2) * 2);
    expect(code(built)).toBe(code(STANDING_SELLER_CREATION_CODE));
    // The pin itself: a new one moves every seller contract's address, so it changes only with this line.
    expect(STANDING_SELLER_CREATION_CODE_HASH).toBe('0x0366811eb16ccee06c5c7ad013a8f23dd1086d0378ee50ade9e1c2ab7d2537c9');
  });

  it('the address is CREATE2 through the deterministic deployer at salt 0 over the code and the key, and the deployment carries exactly that', () => {
    expect(standingSellerAddress(KEY)).toBe(getContractAddress({ opcode: 'CREATE2', from: CREATE2_DEPLOYER, salt: STANDING_SALT, bytecode: `${STANDING_SELLER_CREATION_CODE}${KEY.slice(2).padStart(64, '0')}` }));
    expect(standingDeployment(KEY)).toEqual({ to: CREATE2_DEPLOYER, data: `${STANDING_SALT}${standingInitCode(KEY).slice(2)}` });
    expect(standingSellerAddress('0x00000000000000000000000000000000000005e2')).not.toBe(standingSellerAddress(KEY));
  });
});
