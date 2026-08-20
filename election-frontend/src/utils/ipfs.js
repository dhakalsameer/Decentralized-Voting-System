import { API_URL } from "../config";

export const IPFS_GATEWAYS = [
  "https://ipfs.filebase.io",
  "https://ipfs.io",
  "https://cloudflare-ipfs.com",
];

export function getImageUrl(imageCid, gatewayIndex = 0) {
  if (!imageCid) return null;
  if (imageCid.startsWith("db:student:")) {
    return `${API_URL}/api/students/${encodeURIComponent(imageCid.slice(11))}/photo`;
  }
  if (imageCid.startsWith("db:candidate:")) {
    return `${API_URL}/api/candidates/${encodeURIComponent(imageCid.slice(13))}/photo`;
  }
  if (imageCid.startsWith("local:")) return `${API_URL}/uploads/${imageCid.slice(6)}`;
  if (imageCid.startsWith("http")) return imageCid;
  const gateway = IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length];
  return `${gateway}/ipfs/${imageCid}`;
}