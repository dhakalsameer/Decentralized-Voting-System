import { useState, useEffect, useContext, useRef } from "react";
import { ethers } from "ethers";
import { AuthContext } from "../context/AuthContextValue";
import { getContractV3 } from "../contract";
import { API_URL } from "../config";
import { useToast } from "./ui/Toast";
import BlockExplorerLink from "./ui/BlockExplorerLink";
import { formatContractError } from "../utils/errors";
import { getImageUrl } from "../utils/ipfs";

const POSITIONS = [
  { value: 0, label: "President", icon: "👤", description: "Lead the IT Club", minYear: 4, maxYear: 4 },
  { value: 1, label: "Secretary", icon: "📝", description: "Manage records & communication", minYear: 3, maxYear: 4 },
  { value: 2, label: "General Member", icon: "🤝", description: "Participate in club activities", minYear: 1, maxYear: 4 },
];

/*
 * Called when the admin has approved the student's candidate application AND
 * the Registration phase is open on-chain. This component:
 *   1. Loads the current contract phase + checks if already registered
 *   2. Fetches the student's identity Merkle proof from the backend
 *   3. Lets the student pick a position and submit registerCandidate() on-chain
 *   4. On success, shows a confirmation with the transaction link
 */
export default function CandidateSelfRegister({ student, regEnd }) {
  const { wallet } = useContext(AuthContext);
  const { success, error: showError } = useToast();

  const [phase, setPhase] = useState(null);
  const [regEndLocal, setRegEndLocal] = useState(regEnd || null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [identity, setIdentity] = useState(null);
  const [proof, setProof] = useState(null);
  const [guid, setGuid] = useState(student?.student_id || "");
  const [position, setPosition] = useState(0);
  const [imageCID, setImageCID] = useState(student?.image_cid || "");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(
    student?.image_cid ? getImageUrl(student.image_cid) : null
  );
  const fileInputRef = useRef(null);
  const [loadingPhase, setLoadingPhase] = useState(false);
  const [loadingProof, setLoadingProof] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [txHash, setTxHash] = useState(null);

  const loadPhase = async () => {
    setLoadingPhase(true);
    try {
      const contract = await getContractV3();
      const p = await contract.getPhase();
      setPhase(Number(p));

      if (!regEndLocal) {
        const re = await contract.registrationEnd();
        setRegEndLocal(Number(re));
      }

      if (wallet) {
        const reg = await contract.candidateRegisteredInElection(wallet);
        const electionId = await contract.currentElectionId();
        setIsRegistered(Number(reg) === Number(electionId));
      }
    } catch (err) {
      console.error("loadPhase error:", err);
    } finally {
      setLoadingPhase(false);
    }
  };

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const loadIdentityProof = async () => {
    if (!wallet) return;
    setLoadingProof(true);
    try {
      const res = await fetch(`${API_URL}/api/voters/identity-proof?wallet=${wallet}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get identity proof");
      setProof(data.proof);
      setIdentity(data.identity);
    } catch (err) {
      console.error("loadIdentityProof error:", err);
      showError(err.message || "Could not fetch identity proof");
    } finally {
      setLoadingProof(false);
    }
  };

  useEffect(() => {
    loadPhase();
  }, [wallet]);

  useEffect(() => {
    if (phase === 1 && wallet) {
      loadIdentityProof();
    }
  }, [phase, wallet]);

  const handleUploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      return showError("Only PNG/JPEG/WEBP/GIF images are allowed");
    }
    if (file.size > 5 * 1024 * 1024) {
      return showError("Image must be under 5 MB");
    }

    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);

      const res = await fetch(`${API_URL}/api/candidates/upload-photo`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setImageCID(data.url);
      setPhotoPreview(URL.createObjectURL(file));
    } catch (err) {
      showError(err.message || "Photo upload failed");
    } finally {
      setUploadingPhoto(false);
      if (e.target) e.target.value = "";
    }
  };

  const handleRegister = async () => {
    if (!wallet) return showError("Connect your wallet first");
    if (!guid.trim()) return showError("Enter your GUID / Student ID");
    if (!proof || proof.length === 0) return showError("Identity proof not available");
    if (!identity) return showError("Identity data not loaded");

    setRegistering(true);
    try {
      if (!Number.isFinite(identity.year)) throw new Error("Invalid year from identity proof");
      const contract = await getContractV3();
      const tx = await contract.registerCandidate(
        guid.trim(),
        identity.name,
        identity.year,
        identity.isFemale,
        imageCID.trim() || "",
        position,
        proof
      );
      setTxHash(tx.hash);
      await tx.wait();
      success("Successfully registered as candidate!", { txHash: tx.hash });
      setIsRegistered(true);
    } catch (err) {
      console.error(err);
      showError(formatContractError(err, "Registration failed"));
    } finally {
      setRegistering(false);
    }
  };

  const remaining = regEndLocal ? regEndLocal - now : 0;
  const effectivelyOpen = phase === 1 && remaining > 0;

  if (loadingPhase) {
    return (
      <div className="rounded-xl border border-app bg-app-surface p-6 animate-pulse">
        <div className="flex items-center gap-3">
          <span className="h-5 w-5 border-2 border-app-accent/30 border-t-app-accent rounded-full animate-spin" />
          <p className="text-base text-app-muted-text font-medium">Checking election phase…</p>
        </div>
      </div>
    );
  }

  if (isRegistered) {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.06] to-emerald-500/[0.02] shadow-lg shadow-emerald-500/5 overflow-hidden">
        <div className="px-6 sm:px-10 py-8 sm:py-12 text-center space-y-5 sm:space-y-6">
          <div className="mx-auto h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 flex items-center justify-center shadow-lg shadow-emerald-500/10">
            <span className="text-emerald-400 text-2xl sm:text-3xl font-bold">✓</span>
          </div>
          <div className="space-y-2">
            <p className="text-xl sm:text-2xl md:text-3xl font-extrabold text-emerald-400">Already Registered On-Chain</p>
            <p className="text-sm sm:text-base text-app-body max-w-lg mx-auto">
              You have successfully registered as a candidate for this election. Your candidacy is recorded on the blockchain.
            </p>
          </div>
          {txHash && (
            <div className="pt-2 sm:pt-3">
              <div className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-app-surface/80 border border-app-border/50 shadow-sm">
                <span className="text-xs sm:text-sm text-app-muted-text font-medium">Tx:</span>
                <BlockExplorerLink hash={txHash} className="text-sm sm:text-base font-bold" />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const expired = phase === 1 && remaining <= 0;

  if (phase !== 1) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-6 text-center space-y-3">
        <div className="mx-auto h-12 w-12 rounded-full bg-amber-500/10 border-2 border-amber-500/20 flex items-center justify-center">
          <span className="text-2xl">📋</span>
        </div>
        <p className="text-lg font-bold text-amber-400">Registration Not Open</p>
        <p className="text-base text-app-body max-w-md mx-auto">
          The {expired ? "registration window has expired" : "Registration phase has not started yet"}. {expired ? "Contact the admin." : "The admin must open it before you can register on-chain."}
        </p>
      </div>
    );
  }

  if (!effectivelyOpen) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-6 text-center space-y-3">
        <div className="mx-auto h-12 w-12 rounded-full bg-amber-500/10 border-2 border-amber-500/20 flex items-center justify-center">
          <span className="text-2xl">⏰</span>
        </div>
        <p className="text-lg font-bold text-amber-400">Registration Ended</p>
        <p className="text-base text-app-body max-w-md mx-auto">
          The registration window has expired. Contact the admin if you need an extension.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-app/80 bg-app-surface shadow-card overflow-hidden">
      <div className="p-6 pb-0">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 shrink-0 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 border border-emerald-500/20 flex items-center justify-center shadow-lg shadow-emerald-500/5">
            <span className="text-2xl">📝</span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-app-heading">Register as Candidate</h2>
            <p className="text-sm text-app-muted-text mt-1">Submit your candidacy on-chain with your verified identity</p>
          </div>
          {remaining > 0 && (
            <div className="text-right shrink-0">
              <p className="text-xs uppercase tracking-wider text-app-muted-text mb-1">Closes in</p>
              <p className="text-lg font-mono font-bold text-emerald-400 tabular-nums">
                {remaining > 3600
                  ? `${Math.floor(remaining / 3600)}h ${String(Math.floor((remaining % 3600) / 60)).padStart(2, "0")}m`
                  : `${Math.floor(remaining / 60)}m ${String(remaining % 60).padStart(2, "0")}s`}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="p-6 pb-0">
        <div className="flex items-center gap-3 mb-5">
          <span className="h-3 w-3 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/20" />
          <span className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Verified Identity</span>
        </div>
        {identity ? (
          <div className="bg-gradient-to-br from-emerald-500/[0.06] to-emerald-500/[0.02] rounded-xl border border-emerald-500/15 p-5">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 shrink-0 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white font-bold text-lg">
                {identity.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-app-heading truncate">{identity.name}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-sm text-app-muted-text">Year {identity.year}</span>
                  <span className="h-1 w-1 rounded-full bg-app-border shrink-0" />
                  <span className="text-sm text-app-muted-text capitalize">{identity.isFemale ? "Female" : "Male"}</span>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Verified</span>
              </div>
            </div>
          </div>
        ) : loadingProof ? (
          <div className="rounded-xl border border-app bg-app-muted/50 p-5">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 shrink-0 rounded-full bg-app-muted animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-48 bg-app-muted rounded animate-pulse" />
                <div className="h-4 w-32 bg-app-muted rounded animate-pulse" />
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-5">
            <div className="flex items-center gap-3">
              <span className="text-lg shrink-0">⚠️</span>
              <p className="text-sm text-rose-400 font-medium">
                Could not load your verified identity. Make sure your wallet is connected and you&apos;re whitelisted as a voter.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="text-sm font-bold uppercase tracking-wider text-app-muted-text flex items-center gap-2">
              <span className="text-base">🎓</span>
              Student ID
            </label>
            <input
              type="text"
              value={guid}
              disabled
              className="input-field mt-2.5 text-base font-mono opacity-60 cursor-not-allowed bg-app-muted/50 px-4 py-3"
            />
          </div>

          <div>
            <label className="text-sm font-bold uppercase tracking-wider text-app-muted-text flex items-center gap-2">
              <span className="text-base">📸</span>
              Photo
            </label>
            <div className="mt-2.5">
              {photoPreview ? (
                <div className="rounded-xl border-2 border-dashed border-app-border bg-app-muted/30 p-4">
                  <div className="flex items-center gap-4">
                    <div className="relative shrink-0">
                      <img
                        src={photoPreview}
                        alt="Preview"
                        className="h-16 w-16 rounded-lg object-cover border border-app shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={() => { setPhotoPreview(null); setImageCID(""); }}
                        className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center hover:bg-rose-400 transition-colors cursor-pointer shadow-lg"
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-app-heading truncate">Photo uploaded</p>
                      <p className="text-xs text-app-muted-text mt-0.5">Click &ldquo;Change&rdquo; to replace</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingPhoto}
                      className="btn-secondary text-sm shrink-0"
                    >
                      Change
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  className="w-full rounded-xl border-2 border-dashed border-app-border bg-app-muted/30 hover:bg-app-elevated hover:border-app-accent/50 transition-all p-6 flex flex-col items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
                >
                  {uploadingPhoto ? (
                    <>
                      <span className="h-8 w-8 border-2 border-app-accent/30 border-t-app-accent rounded-full animate-spin" />
                      <span className="text-sm text-app-muted-text font-medium">Uploading&hellip;</span>
                    </>
                  ) : (
                    <>
                      <span className="text-3xl">📷</span>
                      <span className="text-sm font-bold text-app-muted-text">Upload your photo</span>
                      <span className="text-xs text-app-muted-text/60">PNG, JPEG, WEBP or GIF (max 5 MB)</span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleUploadPhoto}
                className="hidden"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="text-sm font-bold uppercase tracking-wider text-app-muted-text flex items-center gap-2 mb-4">
            <span className="text-base">📋</span>
            Choose Position
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {POSITIONS.map((pos) => {
              const year = identity?.year;
              const allowed = year >= pos.minYear && year <= pos.maxYear;
              return (
                <button
                  key={pos.value}
                  type="button"
                  onClick={() => allowed && setPosition(pos.value)}
                  disabled={!allowed}
                  className={`relative group text-left rounded-xl border-2 px-5 py-4 transition-all ${
                    !allowed
                      ? "border-app-border/30 bg-app-muted/20 text-app-muted-text/40 cursor-not-allowed"
                      : position === pos.value
                        ? "border-app-accent bg-app-accent-soft ring-2 ring-app-accent/30 shadow-lg shadow-app-accent/5 cursor-pointer"
                        : "border-app-border bg-app-elevated/50 hover:border-app-border-soft hover:bg-app-elevated cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center text-lg shrink-0 ${
                      !allowed
                        ? "bg-app-muted/30"
                        : position === pos.value
                          ? "bg-app-accent/20"
                          : "bg-app-muted/40 group-hover:bg-app-muted/60 transition-colors"
                    }`}>
                      {pos.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold truncate ${
                        !allowed ? "text-app-muted-text/40" : position === pos.value ? "text-app-accent" : "text-app-heading"
                      }`}>
                        {pos.label}
                      </p>
                      <p className={`text-xs mt-0.5 truncate ${
                        !allowed ? "text-app-muted-text/30" : "text-app-muted-text"
                      }`}>
                        {!allowed
                          ? (pos.label === "President" ? "4th year only" : "3rd\u20134th year")
                          : pos.description}
                      </p>
                    </div>
                    {allowed && position === pos.value && (
                      <div className="h-5 w-5 rounded-full bg-app-accent flex items-center justify-center shrink-0 shadow-lg shadow-app-accent/30">
                        <span className="text-[10px] text-white font-bold">✓</span>
                      </div>
                    )}
                  </div>
                  {!allowed && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                      <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-1.5 whitespace-nowrap shadow-lg border border-slate-700">
                        {pos.label === "President"
                          ? "Only 4th-year students can run for President"
                          : "Only 3rd or 4th-year students can run for Secretary"}
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-2">
          <button
            onClick={handleRegister}
            disabled={registering || loadingProof || !identity}
            className="btn-primary w-full text-base py-3.5 rounded-xl shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 transition-all"
          >
            {registering ? (
              <span className="flex items-center justify-center gap-2.5">
                <span className="h-5 w-5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                Registering on-chain&hellip;
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2.5">
                <span className="text-lg">📜</span>
                Register as Candidate
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
