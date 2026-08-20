import { useEffect, useState, useContext, useMemo } from "react";
import { AuthContext } from "../context/AuthContextValue";
import { getContractV3 } from "../contract";
import { API_URL, SEPOLIA_CHAIN_HEX, SEPOLIA_CHAIN_ID, SEPOLIA_NETWORK } from "../config";
import { getProof } from "../utils/merkle";
import { useBalance } from "../hooks/useBalance";
import { useToast } from "./ui/Toast";
import { formatContractError } from "../utils/errors";
import { getImageUrl } from "../utils/ipfs";
import IpfsImage from "./ui/IpfsImage";

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function formatRemaining(seconds) {
  if (seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const p = (v) => String(v).padStart(2, "0");
  if (h > 0) return `${h}h ${p(m)}m ${p(s)}s`;
  if (m > 0) return `${m}m ${p(s)}s`;
  return `${s}s`;
}

const GM_MAX = 5;
const GM_MIN_FEMALE = 2;

const PHASE_NAMES = ["Created", "Registration", "Voting", "Ended"];

function CandidateCard({ candidate, selected, onToggle, disabled: forceDisabled, showVoteCount, index }) {
  const [imgErr, setImgErr] = useState(false);
  const url = getImageUrl(candidate.imageCID);
  const initials = candidate.name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  const disabled = forceDisabled;

  return (
    <button
      onClick={() => !disabled && onToggle(candidate.id)}
      disabled={disabled}
      className={`group relative flex items-center gap-4 w-full p-4 rounded-xl border-2 transition-all cursor-pointer ${
        disabled ? "opacity-35 cursor-not-allowed" : ""
      } ${
        selected
          ? "border-app-accent bg-app-accent-soft shadow-[0_0_12px_var(--app-accent-border)]"
          : "border-app-border/40 bg-app-surface hover:border-app-border-soft hover:bg-app-elevated/20"
      }`}
    >
      <div className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-bold font-mono transition-all ${
        selected
          ? "bg-app-accent/20 text-app-accent border-2 border-app-accent/30"
          : "bg-app-muted/40 text-app-muted-text border border-app-border/40"
      }`}>
        {index}
      </div>

      <div className="h-16 w-16 shrink-0 rounded-xl overflow-hidden border-2 border-app-border/20 shadow-sm">
        {url && !imgErr ? (
          <IpfsImage cid={candidate.imageCID} alt="" className="h-full w-full object-cover" onError={() => setImgErr(true)} />
        ) : (
          <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-amber-300 via-emerald-500 to-sky-500 text-base font-black text-slate-950">
            {initials}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 text-left">
        <p className={`text-base font-bold truncate leading-tight ${selected ? "text-app-accent" : "text-app-heading"}`}>
          {candidate.name}
        </p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {candidate.studentId && (
            <span className="text-xs font-mono text-app-muted-text/60">{candidate.studentId}</span>
          )}
          {candidate.year && (
            <>
              {candidate.studentId && <span className="h-1 w-1 rounded-full bg-app-border/30 shrink-0" />}
              <span className="text-xs font-mono text-app-muted-text">{candidate.year} Year</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1">
          {candidate.isFemale !== undefined && (
            <span className={`text-xs font-bold tracking-wider px-2 py-0.5 rounded ${
              candidate.isFemale ? "text-pink-500 bg-pink-500/10" : "text-app-accent bg-app-accent/10"
            }`}>
              {candidate.isFemale ? "Female" : "Male"}
            </span>
          )}
          {showVoteCount && (
            <span className="text-xs font-mono text-app-accent/80">{candidate.voteCount} vote{candidate.voteCount !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>

      <div className={`h-9 w-9 shrink-0 rounded-full border-2 flex items-center justify-center transition-all ${
        selected
          ? "border-app-accent bg-app-accent shadow-sm shadow-app-accent/30"
          : "border-app-border/60"
      }`}>
        {selected && (
          <svg className="h-5 w-5 text-slate-950" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
    </button>
  );
}

function Skeleton() {
  return (
    <div className="flex items-center gap-4 w-full p-4 rounded-xl border border-app-border/40 bg-app-surface animate-pulse">
      <div className="h-10 w-10 rounded-full bg-app-border/20" />
      <div className="h-16 w-16 rounded-xl bg-app-border/20" />
      <div className="flex-1 space-y-2.5">
        <div className="h-4 w-2/3 rounded bg-app-border/20" />
        <div className="h-3.5 w-1/3 rounded bg-app-border/10" />
      </div>
      <div className="h-9 w-9 rounded-full bg-app-border/20" />
    </div>
  );
}

export default function VotingPanelV3() {
  const { wallet, voterStatus, checkVoterStatus } = useContext(AuthContext);
  const { balance } = useBalance(wallet);
  const { success, error: showError } = useToast();
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [casting, setCasting] = useState(false);
  const [selectedPresidentId, setSelectedPresidentId] = useState(null);
  const [selectedSecretaryId, setSelectedSecretaryId] = useState(null);
  const [selectedGMIds, setSelectedGMIds] = useState([]);
  const [eligibleWallets, setEligibleWallets] = useState([]);
  const [phase, setPhase] = useState(null);
  const [votingEnd, setVotingEnd] = useState(null);
  const [regEnd, setRegEnd] = useState(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [wrongNetwork, setWrongNetwork] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handleChainChanged = () => { window.location.reload(); };
    if (window.ethereum) {
      window.ethereum.on("chainChanged", handleChainChanged);
    }
    return () => {
      if (window.ethereum && window.ethereum.removeListener) {
        window.ethereum.removeListener("chainChanged", handleChainChanged);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkNetwork = async () => {
      if (!window.ethereum) return false;
      try {
        const chainId = await window.ethereum.request({ method: "eth_chainId" });
        if (chainId !== SEPOLIA_CHAIN_HEX) {
          setWrongNetwork(true);
          return false;
        }
        setWrongNetwork(false);
        return true;
      } catch {
        setWrongNetwork(true);
        return false;
      }
    };

    async function load() {
      setLoading(true);
      try {
        const ok = await checkNetwork();
        if (!ok || cancelled) { if (!cancelled) setLoading(false); return; }

        const contract = await getContractV3();
        const p = Number(await contract.getPhase());
        if (cancelled) return;
        setPhase(p);

        const ve = Number(await contract.votingEnd());
        if (!cancelled) setVotingEnd(ve);
        const re = Number(await contract.registrationEnd());
        if (!cancelled) setRegEnd(re);

        const count = Number(await contract.candidateCount());
        const rows = [];
        for (let i = 1; i <= count; i++) {
          const c = await contract.getCandidate(i);
          if (c.exists) {
            rows.push({
              id: Number(c.id),
              name: c.name,
              studentId: c.studentId,
              imageCID: c.imageCID,
              position: Number(c.position),
              isFemale: c.isFemale,
              year: Number(c.year),
              voteCount: Number(c.voteCount),
            });
          }
        }

        // Merge DB-backed photo references (db:student:... / db:candidate:...)
        // so photos are served from the database instead of flaky IPFS gateways,
        // even for legacy candidates whose on-chain imageCID is still a Qm CID.
        try {
          const dbRes = await fetch(`${API_URL}/api/candidates`);
          if (dbRes.ok) {
            const dbCands = await dbRes.json();
            const byName = new Map();
            for (const d of dbCands) {
              if (d.image_cid) {
                byName.set((d.name || "").toLowerCase(), d.image_cid);
                if (d.student_id) byName.set(d.student_id.toLowerCase(), d.image_cid);
              }
            }
            for (const r of rows) {
              const ref = byName.get(r.name.toLowerCase()) || byName.get((r.studentId || "").toLowerCase());
              if (ref) r.imageCID = ref;
            }
          }
        } catch (_) { /* keep chain imageCID */ }
        if (!cancelled) setCandidates(rows);

        const vRes = await fetch(`${API_URL}/api/voters/pending`);
        if (!cancelled) {
          const vData = await vRes.json();
          setEligibleWallets(vData.filter(s => s.eligible_to_vote).map(s => s.wallet_address));
        }
      } catch (err) {
        if (!cancelled) showError("Failed to load candidates from chain");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    const groups = { 0: [], 1: [], 2: [] };
    for (const c of candidates) {
      if (groups[c.position] !== undefined) groups[c.position].push(c);
    }
    return groups;
  }, [candidates]);

  const totalCandidates = candidates.length;

  const votingPhaseActive = phase === 2 && votingEnd && now < votingEnd;

  const selectPresident = (id) => {
    setSelectedPresidentId(prev => prev === id ? null : id);
  };

  const selectSecretary = (id) => {
    setSelectedSecretaryId(prev => prev === id ? null : id);
  };

  const toggleGM = (id) => {
    setSelectedGMIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= GM_MAX) return prev;
      return [...prev, id];
    });
  };

  const gmFemaleSelected = useMemo(
    () => selectedGMIds.filter(id => candidates.find(c => c.id === id)?.isFemale).length,
    [selectedGMIds, candidates]
  );

  const gmFemaleRemaining = useMemo(
    () => candidates.filter(c => c.position === 2 && c.isFemale && !selectedGMIds.includes(c.id)).length,
    [selectedGMIds, candidates]
  );

  const disableFemale = selectedGMIds.length >= GM_MAX;
  const disableMale = selectedGMIds.length >= GM_MAX ||
    (selectedGMIds.length > 0 && gmFemaleSelected < GM_MIN_FEMALE && gmFemaleRemaining === 0);

  const totalSelected = (selectedPresidentId ? 1 : 0) +
    (selectedSecretaryId ? 1 : 0) +
    selectedGMIds.length;

  const canVote = votingPhaseActive && voterStatus.canVote;
  const canSubmit = canVote && totalSelected > 0 &&
    (selectedGMIds.length === 0 || gmFemaleSelected >= GM_MIN_FEMALE);

  const [showConfirm, setShowConfirm] = useState(false);

  const skippedPresident = !selectedPresidentId && grouped[0]?.length > 0;
  const skippedSecretary = !selectedSecretaryId && grouped[1]?.length > 0;
  const skippedGM = selectedGMIds.length === 0 && grouped[2]?.length > 0;

  const castVote = async () => {
    if (!wallet || !canSubmit) return;
    setShowConfirm(false);
    setCasting(true);
    try {
      let proof;
      try {
        const res = await fetch(`${API_URL}/api/voters/proof?wallet=${wallet}`);
        const data = await res.json();
        proof = data.proof;
      } catch {
        proof = getProof(eligibleWallets, wallet);
      }

      if (!proof?.length) throw new Error("Not eligible to vote");

      const contract = await getContractV3();
      const tx = await contract.castVote(
        selectedPresidentId || 0,
        selectedSecretaryId || 0,
        selectedGMIds,
        proof
      );
      const txHash = tx.hash;
      await tx.wait();

      success("Vote cast", { txHash });
      if (checkVoterStatus) checkVoterStatus(wallet);
      setSelectedPresidentId(null);
      setSelectedSecretaryId(null);
      setSelectedGMIds([]);
    } catch (err) {
      showError(formatContractError(err, "Transaction failed"));
    } finally {
      setCasting(false);
    }
  };

  const selectedName = (id) => candidates.find(c => c.id === id)?.name;
  const showVoteCount = phase === 3;

  return (
    <div className="rounded-2xl border border-app/80 bg-app-surface shadow-card overflow-hidden">
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-app/50 bg-gradient-to-r from-sky-500/[0.03] via-transparent to-transparent">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="h-10 w-10 sm:h-14 sm:w-14 shrink-0 rounded-xl sm:rounded-2xl bg-gradient-to-br from-sky-500/20 to-sky-500/5 border border-sky-500/20 flex items-center justify-center shadow-lg shadow-sky-500/10">
              <span className="text-lg sm:text-2xl">🗳️</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-extrabold tracking-tight text-app-heading">Official Ballot</h2>
              <p className="text-xs sm:text-sm text-app-muted-text mt-0.5">IT Club Election {new Date().getFullYear()}</p>
              <div className="flex items-center gap-2 mt-1 sm:mt-1.5 flex-wrap">
                {totalCandidates > 0 && (
                  <>
                    <span className="text-xs sm:text-sm text-app-muted-text">{totalCandidates} candidate{totalCandidates !== 1 ? "s" : ""}</span>
                    <span className="h-1 w-1 rounded-full bg-app-border shrink-0" />
                  </>
                )}
                {phase !== null && (
                  <span className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-wider px-2 sm:px-2.5 py-0.5 rounded-full border ${
                    phase === 2
                      ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                      : "text-app-accent bg-app-accent-soft border-app-accent-border"
                  }`}>
                    {PHASE_NAMES[phase]}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
            {(phase === 1 || phase === 2) && (
              <div className="text-left sm:text-right">
                {phase === 2 && votingEnd && (
                  <>
                    <p className="text-[9px] sm:text-[10px] uppercase tracking-widest text-app-muted-text font-medium">Voting ends</p>
                    <p className="text-[11px] sm:text-xs font-mono font-bold text-app-heading mt-0.5">{formatTime(votingEnd)}</p>
                    <p className="text-[11px] sm:text-xs font-mono font-bold text-emerald-400 mt-0.5">{formatRemaining(votingEnd - now)}</p>
                  </>
                )}
                {phase === 1 && regEnd && (
                  <>
                    <p className="text-[9px] sm:text-[10px] uppercase tracking-widest text-app-muted-text font-medium">Registration ends</p>
                    <p className="text-[11px] sm:text-xs font-mono font-bold text-app-heading mt-0.5">{formatTime(regEnd)}</p>
                    <p className="text-[11px] sm:text-xs font-mono font-bold text-emerald-400 mt-0.5">{formatRemaining(regEnd - now)}</p>
                  </>
                )}
              </div>
            )}
            {balance && (
              <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-app-muted/50 border border-app-border/40">
                <svg className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-app-muted-text shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L4 12.5l8 3.5 8-3.5L12 2z" opacity="0.6" />
                  <path d="M12 16.5l-8-3.5L12 22l8-9-8 3.5z" />
                </svg>
                <span className="text-[10px] sm:text-[11px] font-mono text-app-muted-text">{Number(balance).toFixed(4)} ETH</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-8 pb-20 lg:pb-8">
        {wrongNetwork ? (
          <div className="rounded-xl border border-rose-500/30 bg-gradient-to-br from-rose-500/[0.08] to-rose-500/[0.03] p-6 sm:p-8 text-center">
            <div className="mx-auto h-14 w-14 rounded-full bg-rose-500/10 border-2 border-rose-500/20 flex items-center justify-center mb-4">
              <span className="text-rose-400 text-2xl font-bold">!</span>
            </div>
            <p className="text-lg font-extrabold text-rose-400 mb-1">Wrong Network</p>
            <p className="text-sm text-app-muted-text mb-5">
              Please switch your wallet to <strong className="text-app-heading">{SEPOLIA_NETWORK}</strong> (Chain ID {SEPOLIA_CHAIN_ID}) to view candidates and vote.
            </p>
            <button
              onClick={async () => {
                try {
                  await window.ethereum.request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: SEPOLIA_CHAIN_HEX }],
                  });
                } catch (e) {
                  if (e.code === 4902) {
                    try {
                      await window.ethereum.request({
                        method: "wallet_addEthereumChain",
                        params: [{
                          chainId: SEPOLIA_CHAIN_HEX,
                          chainName: "Sepolia",
                          rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
                          nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
                          blockExplorerUrls: ["https://sepolia.etherscan.io"],
                        }],
                      });
                    } catch {}
                  }
                }
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 text-sm font-extrabold hover:bg-rose-500/25 transition-all cursor-pointer"
            >
              Switch to Sepolia
            </button>

            <div className="mt-6 space-y-3">
              <p className="text-[11px] font-semibold text-app-muted-text text-center uppercase tracking-wider">
                Watch: MetaMask Mobile Setup
              </p>
              <div className="rounded-lg overflow-hidden border border-app-border/30">
                <iframe
                  src="https://www.youtube.com/embed/u29lPmfJOEA"
                  title="MetaMask Sepolia Mobile Setup"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full aspect-video"
                />
              </div>
              <div className="p-3 rounded-lg bg-app-surface/50 border border-app-border/30 text-xs space-y-2 text-app-muted-text">
                <p className="font-semibold text-app-heading">Sepolia is already in MetaMask &mdash; just unhide it:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs pl-1">
                  <li>Open MetaMask app</li>
                  <li>Tap the network selector at the top</li>
                  <li>Tap the <strong className="text-app-heading">gear icon</strong> (Settings)</li>
                  <li>Scroll down → <strong className="text-app-heading">Show test networks</strong> → toggle <strong className="text-app-heading">ON</strong></li>
                  <li>Go back → tap <strong className="text-app-heading">Sepolia</strong></li>
                </ol>
              </div>
            </div>
          </div>
        ) : (
          <>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Skeleton /><Skeleton /><Skeleton /><Skeleton />
              </div>
            ) : totalCandidates === 0 ? (
              <div className="py-12 text-center">
                <p className="text-base text-app-muted-text">No candidates registered</p>
              </div>
            ) : (
              <>

            {!voterStatus.hasVoted && !votingPhaseActive && phase !== null && phase !== 2 && (
              <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.06] to-amber-500/[0.02] p-5 text-center">
                <p className="text-sm font-bold text-amber-400">
                  {phase === 0 || phase === 1
                    ? "Voting has not started yet. Check back during the voting phase."
                    : phase === 3
                      ? "This election has ended. View the results tab for final outcomes."
                      : "Voting is not currently active."}
                </p>
              </div>
            )}

            {voterStatus.hasVoted && (
              <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.06] to-emerald-500/[0.02] p-6 sm:p-8 text-center">
                <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/10">
                  <span className="text-emerald-400 text-3xl font-bold">✓</span>
                </div>
                <p className="text-xl sm:text-2xl font-extrabold text-emerald-400">Vote Recorded</p>
                <p className="text-sm text-app-muted-text mt-1.5 max-w-sm mx-auto">
                  You have already cast your ballot. Thank you for participating in the IT Club election.
                </p>
              </div>
            )}

            {votingPhaseActive && !voterStatus.canVote && !voterStatus.hasVoted && (
              <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.06] to-amber-500/[0.02] p-5 text-center">
                <p className="text-sm font-bold text-amber-400">
                  You are not eligible to vote. Make sure your wallet is connected and you are whitelisted.
                </p>
              </div>
            )}

            {/* President */}
            {grouped[0]?.length > 0 && (
              <section>
                <div className="flex items-center justify-between pb-3 border-b border-app/20 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-1 rounded-full bg-gradient-to-b from-sky-400 to-sky-600 shrink-0" />
                    <span className="text-sm shrink-0">🏛️</span>
                    <h3 className="text-sm font-extrabold uppercase tracking-widest text-app-heading">President</h3>
                    <span className="hidden sm:inline text-[11px] text-app-muted-text font-medium">· Vote for one</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {phase === 2 && selectedPresidentId && (
                      <span className="text-[11px] font-mono font-bold text-sky-400">1 selected</span>
                    )}
                    <span className="text-[11px] font-mono text-app-muted-text bg-app-muted/40 px-2 py-0.5 rounded-full border border-app-border/30">
                      {grouped[0].length}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {grouped[0].map((c, i) => (
                    <CandidateCard
                      key={c.id}
                      candidate={c}
                      selected={selectedPresidentId === c.id}
                      onToggle={selectPresident}
                      disabled={!canVote}
                      showVoteCount={showVoteCount}
                      index={i + 1}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Secretary */}
            {grouped[1]?.length > 0 && (
              <section>
                <div className="flex items-center justify-between pb-3 border-b border-app/20 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-1 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 shrink-0" />
                    <span className="text-sm shrink-0">📋</span>
                    <h3 className="text-sm font-extrabold uppercase tracking-widest text-app-heading">Secretary</h3>
                    <span className="hidden sm:inline text-[11px] text-app-muted-text font-medium">· Vote for one</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {phase === 2 && selectedSecretaryId && (
                      <span className="text-[11px] font-mono font-bold text-emerald-400">1 selected</span>
                    )}
                    <span className="text-[11px] font-mono text-app-muted-text bg-app-muted/40 px-2 py-0.5 rounded-full border border-app-border/30">
                      {grouped[1].length}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {grouped[1].map((c, i) => (
                    <CandidateCard
                      key={c.id}
                      candidate={c}
                      selected={selectedSecretaryId === c.id}
                      onToggle={selectSecretary}
                      disabled={!canVote}
                      showVoteCount={showVoteCount}
                      index={i + 1}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* General Member */}
            {grouped[2]?.length > 0 && (
              <section>
                <div className="flex items-center justify-between pb-3 border-b border-app/20 mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-1 rounded-full bg-gradient-to-b from-amber-400 to-amber-600 shrink-0" />
                    <span className="text-sm shrink-0">👥</span>
                    <h3 className="text-sm font-extrabold uppercase tracking-widest text-app-heading">General Members</h3>
                    {phase === 2 && (
                      <span className="hidden sm:inline text-[11px] text-app-muted-text font-medium">
                        · Vote for up to {GM_MAX}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {phase === 2 && (
                      <span className={`text-[11px] font-mono font-bold ${
                        selectedGMIds.length >= GM_MIN_FEMALE
                          ? "text-emerald-400"
                          : selectedGMIds.length > 0
                            ? "text-amber-400"
                            : "text-app-muted-text"
                      }`}>
                        {selectedGMIds.length}/{GM_MAX}
                      </span>
                    )}
                    <span className="text-[11px] font-mono text-app-muted-text bg-app-muted/40 px-2 py-0.5 rounded-full border border-app-border/30">
                      {grouped[2].length}
                    </span>
                  </div>
                </div>

                {canVote && phase === 2 && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 px-1">
                    <span className="text-xs text-app-muted-text">
                      Select up to <strong className="text-app-heading">{GM_MAX}</strong> candidates
                    </span>
                    <span className="text-xs text-app-muted-text">
                      · at least <strong className="text-pink-400">{GM_MIN_FEMALE}</strong> female
                    </span>
                    {selectedGMIds.length > 0 && gmFemaleSelected < GM_MIN_FEMALE && (
                      <span className="text-xs text-pink-400 font-bold">
                        {gmFemaleSelected}/{GM_MIN_FEMALE} female selected
                      </span>
                    )}
                    {selectedGMIds.length > 0 && gmFemaleSelected >= GM_MIN_FEMALE && (
                      <span className="text-xs text-emerald-400 font-bold">✓ female requirement met</span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {grouped[2].map((c, i) => (
                    <CandidateCard
                      key={c.id}
                      candidate={c}
                      selected={selectedGMIds.includes(c.id)}
                      onToggle={toggleGM}
                      disabled={!canVote || (!selectedGMIds.includes(c.id) && (c.isFemale ? disableFemale : disableMale))}
                      showVoteCount={showVoteCount}
                      index={i + 1}
                    />
                  ))}
                </div>

                {canVote && phase === 2 && selectedGMIds.length > 0 && gmFemaleSelected < GM_MIN_FEMALE && (
                  <div className="flex items-center gap-3 mt-3 px-1">
                    <div className="flex-1 max-w-xs h-2 rounded-full bg-app-border/20 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-pink-400 to-pink-500 transition-all duration-500"
                        style={{ width: `${Math.min((gmFemaleSelected / GM_MIN_FEMALE) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-pink-400 font-semibold whitespace-nowrap">
                      {gmFemaleSelected}/{GM_MIN_FEMALE} female required
                    </span>
                  </div>
                )}
                {canVote && phase === 2 && gmFemaleRemaining === 0 && gmFemaleSelected < GM_MIN_FEMALE && selectedGMIds.length < GM_MAX && (
                  <p className="text-xs text-rose-400 mt-2 font-medium">No more eligible female candidates available</p>
                )}
              </section>
            )}
          </>
        )}

        {totalCandidates > 0 && (
          <div className="space-y-4 pt-4 border-t border-app/40">
            {canVote && totalSelected > 0 && (
              <div className="rounded-xl border border-app-accent-border bg-app-accent-soft p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-app-accent/20 flex items-center justify-center">
                      <svg className="h-3.5 w-3.5 text-app-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <p className="text-sm font-bold text-app-accent">Ballot Summary</p>
                  </div>
                  <span className="text-xs font-mono font-bold text-app-accent bg-app-accent/10 px-2.5 py-1 rounded-full border border-app-accent-border">
                    {totalSelected} vote{totalSelected > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-1.5 text-sm">
                  {selectedPresidentId && (
                    <div className="flex items-center gap-2">
                      <span className="text-app-muted-text font-medium w-20 shrink-0">President:</span>
                      <span className="text-app-heading font-bold truncate">{selectedName(selectedPresidentId)}</span>
                    </div>
                  )}
                  {selectedSecretaryId && (
                    <div className="flex items-center gap-2">
                      <span className="text-app-muted-text font-medium w-20 shrink-0">Secretary:</span>
                      <span className="text-app-heading font-bold truncate">{selectedName(selectedSecretaryId)}</span>
                    </div>
                  )}
                  {selectedGMIds.length > 0 && (
                    <div>
                      <span className="text-app-muted-text font-medium">General Members ({selectedGMIds.length}/{GM_MAX}):</span>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {selectedGMIds.map(id => (
                          <span key={id} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg bg-app-surface border border-app-border/40 text-app-heading shadow-sm">
                            {selectedName(id)}
                            <button type="button" onClick={() => toggleGM(id)} className="text-app-muted-text hover:text-rose-400 transition-colors cursor-pointer p-2 -m-1">
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <path d="M18 6L6 18M6 6l12 12" />
                              </svg>
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {phase === 2 && (
              <div className="fixed bottom-0 left-0 right-0 z-40 bg-app-surface border-t border-app/50 px-4 py-3 shadow-2xl shadow-black/20 lg:static lg:border-t-0 lg:px-0 lg:py-0 lg:shadow-none lg:bg-transparent">
              <button
                onClick={() => setShowConfirm(true)}
                disabled={casting || !canSubmit}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-slate-950 text-base font-extrabold uppercase tracking-wider hover:from-emerald-400 hover:to-emerald-500 hover:scale-[1.01] active:scale-[0.99] transition-all shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/35 disabled:opacity-30 disabled:cursor-not-allowed disabled:scale-100 disabled:shadow-none cursor-pointer"
              >
                {casting ? (
                  <span className="flex items-center justify-center gap-2.5">
                    <span className="h-5 w-5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                    <span>Confirming on-chain&hellip;</span>
                  </span>
                ) : canSubmit ? (
                  <span className="flex items-center justify-center gap-2.5">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Cast {totalSelected} Vote{totalSelected > 1 ? "s" : ""}
                  </span>
                ) : voterStatus.hasVoted ? (
                  "Already voted"
                ) : !votingPhaseActive ? (
                  "Voting not active"
                ) : (
                  "Select candidates above"
                )}
              </button>
              </div>
            )}

            {showConfirm && (
              <>
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-md" onClick={() => setShowConfirm(false)} />
                <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-lg max-h-[90vh]">
                  <div className="rounded-t-2xl border border-app-border bg-app-surface-solid shadow-2xl max-h-[90vh] flex flex-col">
                    {/* Header */}
                    <div className="relative px-4 sm:px-6 pt-4 sm:pt-6 pb-4 text-center border-b border-app/50">
                      <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500/20 to-sky-500/5 border border-sky-500/20 flex items-center justify-center shadow-lg shadow-sky-500/10 mb-3">
                        <span className="text-2xl">🗳️</span>
                      </div>
                      <h3 className="text-xl font-extrabold text-app-heading">Confirm Your Vote</h3>
                      <p className="text-sm text-app-muted-text mt-1">Review your selections before submitting to the blockchain</p>
                    </div>

                    {/* Body */}
                    <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 overflow-y-auto min-h-0 flex-1">
                      {/* President */}
                      <div className={`rounded-2xl border-2 p-5 ${selectedPresidentId ? "border-app-trust-border bg-gradient-to-br from-app-trust-soft to-transparent" : "border-app-ballot-border bg-gradient-to-br from-app-ballot-soft to-transparent"}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-sm shadow-sm">🏛️</div>
                            <span className="text-sm font-extrabold uppercase tracking-wider text-app-heading">President</span>
                          </div>
                          {selectedPresidentId ? (
                            <span className="text-[11px] font-bold text-app-trust bg-app-trust-soft px-3 py-1 rounded-full border border-app-trust-border flex items-center gap-1.5">
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                              Selected
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold text-app-ballot bg-app-ballot-soft px-3 py-1 rounded-full border border-app-ballot-border">Skipped</span>
                          )}
                        </div>
                        {selectedPresidentId && (
                          <div className="flex items-center gap-3 mt-1">
                            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-300 via-emerald-500 to-sky-500 flex items-center justify-center text-sm font-black text-slate-950 shadow-sm">
                              {selectedName(selectedPresidentId).split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <p className="text-base font-extrabold text-app-heading">{selectedName(selectedPresidentId)}</p>
                          </div>
                        )}
                        {skippedPresident && (
                          <div className="flex items-center gap-2 mt-1">
                            <svg className="h-4 w-4 shrink-0 text-app-ballot" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                            <p className="text-xs text-app-ballot font-semibold">You skipped President — your vote will abstain for this position.</p>
                          </div>
                        )}
                      </div>

                      {/* Secretary */}
                      <div className={`rounded-2xl border-2 p-5 ${selectedSecretaryId ? "border-app-trust-border bg-gradient-to-br from-app-trust-soft to-transparent" : "border-app-ballot-border bg-gradient-to-br from-app-ballot-soft to-transparent"}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-sm shadow-sm">📋</div>
                            <span className="text-sm font-extrabold uppercase tracking-wider text-app-heading">Secretary</span>
                          </div>
                          {selectedSecretaryId ? (
                            <span className="text-[11px] font-bold text-app-trust bg-app-trust-soft px-3 py-1 rounded-full border border-app-trust-border flex items-center gap-1.5">
                              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                              Selected
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold text-app-ballot bg-app-ballot-soft px-3 py-1 rounded-full border border-app-ballot-border">Skipped</span>
                          )}
                        </div>
                        {selectedSecretaryId && (
                          <div className="flex items-center gap-3 mt-1">
                            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-300 via-emerald-500 to-sky-500 flex items-center justify-center text-sm font-black text-slate-950 shadow-sm">
                              {selectedName(selectedSecretaryId).split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <p className="text-base font-extrabold text-app-heading">{selectedName(selectedSecretaryId)}</p>
                          </div>
                        )}
                        {skippedSecretary && (
                          <div className="flex items-center gap-2 mt-1">
                            <svg className="h-4 w-4 shrink-0 text-app-ballot" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                            <p className="text-xs text-app-ballot font-semibold">You skipped Secretary — your vote will abstain for this position.</p>
                          </div>
                        )}
                      </div>

                      {/* General Members */}
                      <div className={`rounded-2xl border-2 p-5 ${selectedGMIds.length > 0 ? "border-app-trust-border bg-gradient-to-br from-app-trust-soft to-transparent" : "border-app-ballot-border bg-gradient-to-br from-app-ballot-soft to-transparent"}`}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center text-sm shadow-sm">👥</div>
                            <span className="text-sm font-extrabold uppercase tracking-wider text-app-heading">General Members</span>
                          </div>
                          {selectedGMIds.length > 0 ? (
                            <span className="text-[11px] font-bold text-app-trust bg-app-trust-soft px-3 py-1 rounded-full border border-app-trust-border">{selectedGMIds.length}/{GM_MAX}</span>
                          ) : (
                            <span className="text-[11px] font-bold text-app-ballot bg-app-ballot-soft px-3 py-1 rounded-full border border-app-ballot-border">Skipped</span>
                          )}
                        </div>
                        {selectedGMIds.length > 0 && (
                          <div className="space-y-2">
                            {selectedGMIds.map((id, i) => (
                              <div key={id} className="flex items-center gap-3 bg-app-elevated rounded-xl px-4 py-2.5 border border-app-border">
                                <span className="h-7 w-7 rounded-lg bg-app-muted flex items-center justify-center text-xs font-black text-app-muted-text font-mono">{i + 1}</span>
                                <p className="text-sm font-bold text-app-heading flex-1">{selectedName(id)}</p>
                                <svg className="h-4 w-4 text-app-trust shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                              </div>
                            ))}
                          </div>
                        )}
                        {skippedGM && (
                          <div className="flex items-center gap-2">
                            <svg className="h-4 w-4 shrink-0 text-app-ballot" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                            <p className="text-xs text-app-ballot font-semibold">You skipped General Members — no GM votes will be cast.</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="px-4 sm:px-6 py-4 border-t border-app/50 bg-app-muted/20 flex items-center gap-3">
                      <button
                        onClick={() => setShowConfirm(false)}
                        className="flex-1 py-3.5 rounded-xl border-2 border-app-border bg-app-surface text-sm font-extrabold text-app-heading hover:bg-app-accent-soft hover:border-app-accent-border hover:text-app-accent transition-all cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={castVote}
                        className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-slate-950 text-sm font-extrabold uppercase tracking-wider hover:from-emerald-400 hover:to-emerald-500 hover:scale-[1.01] active:scale-[0.99] transition-all shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/35 cursor-pointer"
                      >
                        Confirm & Submit
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </>
      )}
    </div>
  </div>
  );
}
