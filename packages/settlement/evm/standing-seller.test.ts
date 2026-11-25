// T-549 PR 4 (ADR-0040 §4): the seller contract's creation code the node pins is the build's, and the address it
// derives for a key is the one the deterministic deployer creates (StandingSellerBase.sol deploys the same way).
// The comparison with the build needs `forge build` output in contracts/out; the rest runs without it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getContractAddress, keccak256, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { CREATE2_DEPLOYER, STANDING_SALT, STANDING_SELLER_CREATION_CODE_HASH, standingDeployment, standingInitCode, standingSellerAddress } from './standing-seller.js';
import { STANDING_SELLER_CREATION_CODE } from './standing-seller-code.js';

const artifact = join(import.meta.dirname, '..', '..', '..', 'contracts', 'out', 'HoldbackStandingSeller.sol', 'HoldbackStandingSeller.json');
const KEY = '0x00000000000000000000000000000000000005e1';

describe('the pinned standing seller (T-549)', () => {
  it.skipIf(!existsSync(artifact))(`the pinned creation code is the build's${existsSync(artifact) ? '' : ' (SKIPPED: needs forge build output in contracts/out)'}`, () => {
    const built = (JSON.parse(readFileSync(artifact, 'utf8')) as { bytecode: { object: Hex } }).bytecode.object;
    // If this fails, the contract changed: run `node packages/settlement/evm/pin-standing-seller.mjs`, and know that
    // every seller contract's address moves with it.
    expect(keccak256(built)).toBe(STANDING_SELLER_CREATION_CODE_HASH);
  });

  it('the address is CREATE2 through the deterministic deployer at salt 0 over the code and the key, and the deployment carries exactly that', () => {
    expect(standingSellerAddress(KEY)).toBe(getContractAddress({ opcode: 'CREATE2', from: CREATE2_DEPLOYER, salt: STANDING_SALT, bytecode: `${STANDING_SELLER_CREATION_CODE}${KEY.slice(2).padStart(64, '0')}` }));
    expect(standingDeployment(KEY)).toEqual({ to: CREATE2_DEPLOYER, data: `${STANDING_SALT}${standingInitCode(KEY).slice(2)}` });
    expect(standingSellerAddress('0x00000000000000000000000000000000000005e2')).not.toBe(standingSellerAddress(KEY));
  });
});
