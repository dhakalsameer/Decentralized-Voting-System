import { electionContractV3 } from "../blockchain/electionContract.js";
import { buildChallenge, consumeChallenge, signAdminToken } from "../utils/adminAuth.js";

// Step 1 of admin sign-in: hand back a short-lived, server-signed challenge for
// the admin to sign with MetaMask.
export const requestAdminChallenge = async (req, res) => {
  try {
    const { wallet } = req.body || {};
    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      return res.status(400).json({ error: "A valid wallet address is required" });
    }

    const onChainAdmin = await electionContractV3.admin();
    if (!onChainAdmin) {
      return res.status(503).json({ error: "Could not read the contract admin" });
    }

    return res.json({ ...buildChallenge(wallet), adminAddress: onChainAdmin });
  } catch (err) {
    console.error("Admin challenge error:", err);
    return res.status(500).json({ error: "Could not create admin challenge" });
  }
};

// Step 2: verify the signature proves control of the admin key, then mint a
// short-lived admin token. Only holders of the admin private key get past this.
export const verifyAdminSignature = async (req, res) => {
  try {
    const { message, signature, challenge } = req.body || {};
    const result = consumeChallenge({ message, signature, challenge });
    if (result.error) {
      return res.status(401).json({ error: result.error });
    }

    const onChainAdmin = await electionContractV3.admin();
    if (!onChainAdmin || result.wallet.toLowerCase() !== onChainAdmin.toLowerCase()) {
      return res.status(403).json({ error: "Unauthorized: signer is not the contract admin" });
    }

    return res.json({ token: signAdminToken(result.wallet), wallet: result.wallet });
  } catch (err) {
    console.error("Admin signature verification error:", err);
    return res.status(500).json({ error: "Admin verification failed" });
  }
};
