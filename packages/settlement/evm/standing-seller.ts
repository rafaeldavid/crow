// A standing seller's contract at its one address (ADR-0040 §4): HoldbackStandingSeller deployed through the public
// deterministic deployment proxy at salt 0, its init code the pinned creation code followed by the seller's key. So
// the address follows from the key alone, anyone can deploy it, and a second deployment fails and changes nothing.
// The node uses this module twice: to check a take of a contract not deployed yet against the code it will have, and
// to send the deployment, alone, before the first funding (evm-settlement.ts, `deployFor`).
import { standingKeyOf } from '@holdback/core';
import { concat, encodeAbiParameters, getContractAddress, isAddressEqual, keccak256, type Address, type Hex } from 'viem';
import { STANDING_SELLER_CREATION_CODE } from './standing-seller-code.js';

/** Arachnid's deterministic deployment proxy: the same address and code on anvil, Sepolia and most chains. */
export const CREATE2_DEPLOYER: Address = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
/** The salt a standing seller deploys at: 0, the seller tools' default (ADR-0040 §4). */
export const STANDING_SALT: Hex = `0x${'00'.repeat(32)}`;
/** keccak256 of the pinned creation code: what a buyer's tool can pin to compute the same address before deployment. */
export const STANDING_SELLER_CREATION_CODE_HASH: Hex = keccak256(STANDING_SELLER_CREATION_CODE);

/** The init code for `key`: the creation code and the constructor's one argument. */
export function standingInitCode(key: Address): Hex {
  return concat([STANDING_SELLER_CREATION_CODE, encodeAbiParameters([{ type: 'address' }], [key])]);
}

/** The seller contract's address for `key`, at salt 0 through the deterministic deployer. */
export function standingSellerAddress(key: Address): Address {
  return getContractAddress({ opcode: 'CREATE2', from: CREATE2_DEPLOYER, salt: STANDING_SALT, bytecode: standingInitCode(key) });
}

/** The deployment as a call: the proxy takes the salt, then the init code, and creates the contract. */
export function standingDeployment(key: Address): { to: Address; data: Hex } {
  return { to: CREATE2_DEPLOYER, data: concat([STANDING_SALT, standingInitCode(key)]) };
}

/**
 * The key a take's or a standing delivery's signature names for `address`, when `address` is that key's seller contract
 * (the CREATE2 address checks out); null otherwise. The key comes from the template's signature under the seller
 * contract's domain, so a blob made for another contract or chain names no key here.
 */
export async function standingKeyFor(address: Address, signature: Hex, chainId: number): Promise<Address | null> {
  const key = await standingKeyOf(signature, address, chainId);
  return key && isAddressEqual(standingSellerAddress(key), address) ? key : null;
}
