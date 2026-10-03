import { electionContractV3 } from "../blockchain/electionContract.js";

export async function verifyAdmin(req, res, next) {
  const adminWallet = req.body?.adminWallet || req.query?.adminWallet;

  if (!adminWallet) {
    return res.status(401).json({ error: "Admin wallet address is required" });
  }

  try {
    const onChainAdmin = await electionContractV3.admin();
    if (adminWallet.toLowerCase() !== onChainAdmin.toLowerCase()) {
      return res.status(403).json({ error: "Unauthorized: caller is not the contract admin" });
    }
    next();
  } catch (err) {
    console.error("Admin verification error:", err);
    return res.status(500).json({ error: "Admin verification failed" });
  }
}
