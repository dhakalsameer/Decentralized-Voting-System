import { electionContractV3 } from "../blockchain/electionContract.js";
import { verifyAdminToken } from "../utils/adminAuth.js";

export async function verifyAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: "Admin authentication required" });
  }

  const claims = verifyAdminToken(token);
  if (!claims) {
    return res.status(401).json({ error: "Admin session is invalid or expired" });
  }

  try {
    // Re-read the admin from the chain on every request so a token stops
    // working the moment the contract admin changes.
    const onChainAdmin = await electionContractV3.admin();
    if (!onChainAdmin || claims.wallet.toLowerCase() !== onChainAdmin.toLowerCase()) {
      return res.status(403).json({ error: "Unauthorized: caller is not the contract admin" });
    }
    req.admin = { wallet: claims.wallet };
    next();
  } catch (err) {
    console.error("Admin verification error:", err);
    return res.status(500).json({ error: "Admin verification failed" });
  }
}
