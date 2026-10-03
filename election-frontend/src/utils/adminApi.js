import { ethers } from "ethers";
import { API_URL } from "../config";

const TOKEN_KEY = "election_admin_token";
let inFlight = null;

export const getAdminToken = () => sessionStorage.getItem(TOKEN_KEY);

export const clearAdminToken = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  inFlight = null;
};

const tokenExpired = (token) => {
  if (!token) return true;
  try {
    const claims = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
    return !claims.exp || claims.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
};

const tokenWallet = (token) => {
  try {
    return JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    ).wallet;
  } catch {
    return null;
  }
};

// Proves control of the contract admin key. The server issues a challenge, the
// admin signs it with MetaMask, and only a holder of the private key gets a
// token back. A connected address is not treated as proof on its own.
export async function ensureAdminToken() {
  if (!window.ethereum) throw new Error("MetaMask or wallet provider not found");

  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const wallet = await signer.getAddress();

  // A cached token is only reused while the same account is connected, so
  // switching accounts in MetaMask cannot silently keep admin access.
  const cached = getAdminToken();
  if (
    !tokenExpired(cached) &&
    wallet &&
    tokenWallet(cached)?.toLowerCase() === wallet.toLowerCase()
  ) {
    return cached;
  }
  if (cached) clearAdminToken();
  if (inFlight) return inFlight;

    inFlight = (async () => {
      const challengeRes = await fetch(`${API_URL}/api/auth/admin/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet }),
    });
    const challengeBody = await challengeRes.json();
    if (!challengeRes.ok) {
      throw new Error(challengeBody.error || "Could not start admin sign-in");
    }

    const signature = await signer.signMessage(challengeBody.message);

    const verifyRes = await fetch(`${API_URL}/api/auth/admin/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: challengeBody.message,
        signature,
        challenge: challengeBody.challenge,
      }),
    });
    const verifyBody = await verifyRes.json();
    if (!verifyRes.ok) {
      throw new Error(verifyBody.error || "Admin verification failed");
    }

    sessionStorage.setItem(TOKEN_KEY, verifyBody.token);
    return verifyBody.token;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

// Drop-in replacement for fetch on admin routes. Attaches the bearer token and
// strips the old adminWallet field, which proved nothing.
const stripAdminWallet = (input, init = {}) => {
  let url = typeof input === "string" ? input : input.url;
  if (url.includes("adminWallet")) {
    const [base, query] = url.split("?");
    if (query) {
      const params = new URLSearchParams(query);
      params.delete("adminWallet");
      const rest = params.toString();
      url = rest ? `${base}?${rest}` : base;
    }
  }

  const next = { ...init };
  if (typeof next.body === "string" && next.body.includes("adminWallet")) {
    try {
      const parsed = JSON.parse(next.body);
      delete parsed.adminWallet;
      next.body = JSON.stringify(parsed);
    } catch {
      /* leave non-JSON bodies untouched */
    }
  } else if (typeof FormData !== "undefined" && next.body instanceof FormData) {
    next.body.delete("adminWallet");
  }

  return { url, init: next };
};

export async function adminFetch(input, init = {}) {
  const { url, init: nextInit } = stripAdminWallet(input, init);
  const token = await ensureAdminToken();

  const res = await fetch(url, {
    ...nextInit,
    headers: {
      ...(nextInit.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  // An expired or rejected token is retried once with a fresh signature.
  if (res.status === 401) {
    clearAdminToken();
    const retryToken = await ensureAdminToken();
    return fetch(url, {
      ...nextInit,
      headers: {
        ...(nextInit.headers || {}),
        Authorization: `Bearer ${retryToken}`,
      },
    });
  }

  return res;
}
