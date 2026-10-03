import crypto from "crypto";
import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";

const CHALLENGE_TTL_SECONDS = 300;
const ADMIN_TOKEN_TTL = "2h";

// Challenges are consumed by the signature check, so a captured signature
// cannot be replayed to mint a fresh admin token. Held in memory: losing them
// on restart only means the admin re-requests a challenge.
const spentNonces = new Map();

const sweep = () => {
  const now = Date.now();
  for (const [nonce, expiry] of spentNonces) {
    if (expiry < now) spentNonces.delete(nonce);
  }
};

// Single source of truth for the signed text. The challenge is built from it and
// the verification rebuilds it from server-held claims, so the two can never
// drift apart.
const buildMessage = (wallet, nonce, issuedAtMs) =>
  "Gandaki University Election Admin Authentication\n\n" +
  `Wallet: ${wallet}\n` +
  `Nonce: ${nonce}\n` +
  `Issued: ${new Date(issuedAtMs).toISOString()}\n\n` +
  "Signing proves control of this wallet. It grants no other authority.";

export const buildChallenge = (wallet) => {
  const address = wallet.toLowerCase();
  const nonce = crypto.randomBytes(16).toString("hex");
  // Stored verbatim rather than reusing the JWT `iat`, which has whole-second
  // resolution and would not reproduce the exact millisecond string signed.
  const issuedAt = Date.now();
  const challenge = jwt.sign(
    { purpose: "admin-challenge", wallet: address, nonce, issuedAt },
    config.jwtSecret,
    { expiresIn: CHALLENGE_TTL_SECONDS }
  );
  return { message: buildMessage(address, nonce, issuedAt), challenge };
};

// The client signs `message` and returns it with the signature, but the message
// is rebuilt here from the server-signed challenge rather than trusted from the
// request. That is what binds the nonce and wallet into the signature.
export const consumeChallenge = ({ message, signature, challenge }) => {
  if (!message || !signature || !challenge) {
    return { error: "message, signature and challenge are required" };
  }

  let claims;
  try {
    claims = jwt.verify(challenge, config.jwtSecret);
  } catch {
    return { error: "Challenge is invalid or expired. Request a new one." };
  }

  const { purpose, wallet, nonce, issuedAt } = claims;
  if (purpose !== "admin-challenge" || !wallet || !nonce || !issuedAt) {
    return { error: "Challenge is not an admin challenge" };
  }

  const expected = buildMessage(wallet, nonce, issuedAt);
  if (typeof message !== "string" || message.trim() !== expected) {
    return { error: "Challenge message does not match the issued challenge" };
  }

  if (spentNonces.has(nonce)) {
    return { error: "Challenge already used. Request a new one." };
  }

  let recovered;
  try {
    recovered = ethers.verifyMessage(expected, signature);
  } catch {
    return { error: "Signature could not be verified" };
  }

  if (recovered.toLowerCase() !== wallet) {
    return { error: "Signature does not match the requesting wallet" };
  }

  spentNonces.set(nonce, Date.now() + CHALLENGE_TTL_SECONDS * 1000);
  sweep();

  return { wallet: recovered };
};

export const signAdminToken = (wallet) =>
  jwt.sign({ role: "admin", wallet: wallet.toLowerCase() }, config.jwtSecret, {
    expiresIn: ADMIN_TOKEN_TTL,
  });

export const verifyAdminToken = (token) => {
  try {
    const claims = jwt.verify(token, config.jwtSecret);
    if (claims.role !== "admin" || !claims.wallet) return null;
    return claims;
  } catch {
    return null;
  }
};
