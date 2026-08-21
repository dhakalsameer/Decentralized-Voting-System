import { MerkleTree } from "merkletreejs";
import { ethers } from "ethers";
import { Buffer } from "buffer";

function keccak256(input) {
  return Buffer.from(ethers.keccak256(input).slice(2), "hex");
}

/**
 * Generates a Merkle Proof for a wallet given a list of all eligible wallets.
 * @param {string[]} allWallets 
 * @param {string} targetWallet 
 * @returns {string[]} The Merkle Proof
 */
export function getProof(allWallets, targetWallet) {
  if (!allWallets || allWallets.length === 0) return [];
  
  const leaves = allWallets.map((addr) =>
    keccak256(ethers.solidityPacked(["address"], [ethers.getAddress(addr)]))
  );

  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });

  const leaf = keccak256(
    ethers.solidityPacked(["address"], [ethers.getAddress(targetWallet)])
  );

  return tree.getHexProof(leaf);
}

/**
 * Validates a Merkle Root against a list of wallets.
 * @param {string[]} allWallets 
 * @returns {string} The Merkle Root
 */
export function getRoot(allWallets) {
  if (!allWallets || allWallets.length === 0) return ethers.ZeroHash;

  const leaves = allWallets.map((addr) =>
    keccak256(ethers.solidityPacked(["address"], [ethers.getAddress(addr)]))
  );

  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  return tree.getHexRoot();
}

/**
 * Computes the Identity Merkle Root from voter identities.
 * Leaf encoding must match the backend exactly:
 *   keccak256(abi.encodePacked(address, name, year, isFemale))
 */
export function getIdentityRoot(identities) {
  if (!identities || identities.length === 0) return ethers.ZeroHash;

  const leaves = identities.map((id) =>
    keccak256(
      ethers.solidityPacked(
        ["address", "string", "uint8", "bool"],
        [ethers.getAddress(id.address), id.name, id.year, Boolean(id.isFemale)]
      )
    )
  );

  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  return tree.getHexRoot();
}

/**
 * Generates an Identity Merkle Proof for a target identity.
 * @param {{address: string, name: string, year: number, isFemale: boolean}[]} identities
 * @param {{address: string, name: string, year: number, isFemale: boolean}} target
 */
export function getIdentityProof(identities, target) {
  if (!identities || identities.length === 0) return [];

  const leaves = identities.map((id) =>
    keccak256(
      ethers.solidityPacked(
        ["address", "string", "uint8", "bool"],
        [ethers.getAddress(id.address), id.name, id.year, Boolean(id.isFemale)]
      )
    )
  );

  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const leaf = keccak256(
    ethers.solidityPacked(
      ["address", "string", "uint8", "bool"],
      [ethers.getAddress(target.address), target.name, target.year, Boolean(target.isFemale)]
    )
  );
  return tree.getHexProof(leaf);
}

/**
 * Fetches the published whitelist snapshot and verifies it against the
 * on-chain roots read through the user's own wallet provider. Returns the
 * dataset only when it matches the chain — making the source (backend or
 * IPFS gateway) irrelevant for trust — or null when unavailable/mismatched.
 */
export async function fetchVerifiedSnapshot(contract, apiUrl) {
  let snap = null;
  try {
    const res = await fetch(`${apiUrl}/api/voters/snapshot`);
    if (res.ok) snap = await res.json();
  } catch {
    return null;
  }
  if (!snap || !Array.isArray(snap.wallets) || !Array.isArray(snap.identities)) return null;

  // Prefer the IPFS copy when one was pinned (decentralized availability).
  // The root comparison below is what actually establishes trust.
  if (snap.ipfsCid) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`https://ipfs.io/ipfs/${snap.ipfsCid}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const ipfsSnap = await res.json();
        if (Array.isArray(ipfsSnap.wallets) && Array.isArray(ipfsSnap.identities)) {
          snap = { ...snap, wallets: ipfsSnap.wallets, identities: ipfsSnap.identities };
        }
      }
    } catch {
      /* gateway slow/unavailable — backend copy already loaded and will be verified */
    }
  }

  try {
    const [chainVoterRoot, chainIdentityRoot] = await Promise.all([
      contract.voterMerkleRoot(),
      contract.identityMerkleRoot(),
    ]);
    if (
      getRoot(snap.wallets) === chainVoterRoot &&
      getIdentityRoot(snap.identities) === chainIdentityRoot
    ) {
      return snap;
    }
  } catch {
    /* chain read failed */
  }
  return null;
}
