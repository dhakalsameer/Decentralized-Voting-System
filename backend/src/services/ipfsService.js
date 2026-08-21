import axios from "axios";
import { config } from "../config/env.js";

/**
 * Pins a JSON document to IPFS via Pinata. Returns the CID, or null when
 * Pinata is not configured (PINATA_KEY / PINATA_SECRET) or the upload fails.
 *
 * Used to publish Merkle whitelist snapshots so voters can fetch the exact
 * dataset behind the on-chain root from a decentralized source and verify
 * it client-side instead of trusting the backend.
 */
export async function pinJSON(data, name = "merkle-snapshot.json") {
  if (!config.pinataKey || !config.pinataSecret) return null;
  try {
    const res = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      { pinataContent: data, pinataMetadata: { name } },
      {
        headers: {
          pinata_api_key: config.pinataKey,
          pinata_secret_api_key: config.pinataSecret,
        },
        timeout: 30_000,
      }
    );
    return res.data.IpfsHash || null;
  } catch (err) {
    console.error("pinJSON failed:", err.message);
    return null;
  }
}
