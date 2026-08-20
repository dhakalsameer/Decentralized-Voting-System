import { API_URL } from "../config";

export const IPFS_GATEWAYS = [
  "https://ipfs.filebase.io",
  "https://ipfs.io",
  "https://cloudflare-ipfs.com",
];

export function getImageUrl(imageCid, gatewayIndex = 0) {
  if (!imageCid) return null;
  if (imageCid.startsWith("local:")) return `${API_URL}/uploads/${imageCid.slice(6)}`;
  if (imageCid.startsWith("http")) return imageCid;
  const gateway = IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length];
  return `${gateway}/ipfs/${imageCid}`;
}