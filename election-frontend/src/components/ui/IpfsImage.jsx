import { useState } from "react";
import { getImageUrl, IPFS_GATEWAYS } from "../../utils/ipfs";

export default function IpfsImage({ cid, alt, className, onError, ...rest }) {
  const [idx, setIdx] = useState(0);

  if (!cid) return null;

  const src = getImageUrl(cid, idx);

  const handleError = (e) => {
    if (idx + 1 < IPFS_GATEWAYS.length) {
      setIdx(idx + 1);
    } else if (onError) {
      onError(e);
    }
  };

  return (
    <img
      src={src}
      alt={alt || ""}
      className={className}
      onError={handleError}
      {...rest}
    />
  );
}