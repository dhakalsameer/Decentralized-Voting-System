import { getContractV3 } from "../../contract";
import { useMemo, useState, useEffect, useContext } from "react";
import { useToast } from "../ui/Toast";
import { formatContractError } from "../../utils/errors";
import SectionHeader from "../ui/SectionHeader";
import { AuthContext } from "../../context/AuthContextValue";
import { API_URL } from "../../config";
import ConfirmModal from "../ui/ConfirmModal";

const PHASE_NAMES = ["Created", "Registration", "Voting", "Ended"];

const PHASE_DESCRIPTIONS = {
  0: "The election contract is deployed and ready. Start registration to begin accepting candidate applications.",
  1: "Candidates can register on-chain. Move to voting when registration closes.",
  2: "Verified voters can cast their vote. End the election when voting is complete.",
  3: "All voting is complete. Winners can be recorded by starting a new election cycle.",
};

function formatRemaining(seconds) {
  if (seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function toDateTimeLocal(date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toUnixSeconds(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function formatDateTimeLocal(value) {
  if (!value) return "";
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return value;
  const [y, m, d] = datePart.split("-");
  const [h, min] = timePart.split(":");
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${monthNames[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y} at ${hour12}:${min} ${ampm} NPT`;
}

function PhaseTag({ phase, remaining }) {
  const colors = [
    "bg-app-accent/10 text-app-accent border-app-accent/20",
    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    "bg-amber-500/10 text-amber-400 border-amber-500/20",
    "bg-rose-500/10 text-rose-400 border-rose-500/20",
  ];
  const pulse = phase === 1 || phase === 2;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-app bg-app-surface px-5 py-4">
      <div className="relative">
        <span className={`h-3 w-3 rounded-full block ${colors[phase]?.split(" ")[0] || "bg-app-muted"}`} />
        {pulse && <span className="absolute inset-0 h-3 w-3 rounded-full bg-inherit animate-ping opacity-50" />}
      </div>
      <span className="text-base font-bold text-app-heading">{PHASE_NAMES[phase]}</span>
      {remaining != null && remaining > 0 && (
        <span className="text-sm font-mono text-emerald-400">{formatRemaining(remaining)} remaining</span>
      )}
      {remaining != null && remaining <= 0 && phase > 0 && phase < 3 && (
        <span className="text-sm font-mono text-rose-400">Deadline passed</span>
      )}
    </div>
  );
}

function ActionCard({ title, description, icon, children }) {
  return (
    <div className="rounded-xl border border-app bg-app-surface overflow-hidden">
      <div className="flex items-center gap-3 px-4 sm:px-6 py-4 sm:py-5 border-b border-app/50 bg-app-muted/20">
        <span className="text-2xl">{icon}</span>
        <div>
          <h3 className="text-base font-bold text-app-heading">{title}</h3>
          <p className="text-sm text-app-muted-text mt-0.5">{description}</p>
        </div>
      </div>
      <div className="p-4 sm:p-6">{children}</div>
    </div>
  );
}

function DateInput({ label, value, onChange, disabled }) {
  return (
    <label className="grid gap-1.5 text-sm font-mono font-bold uppercase tracking-wider text-emerald-400">
      {label}
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1.5 w-full rounded-xl border border-app bg-app-input text-app-heading px-4 py-3 text-base transition-all focus:border-emerald-500 focus:outline-none placeholder:text-app-muted font-mono"
      />
    </label>
  );
}

function ActionButton({ children, variant = "green", onClick, disabled, icon, processing }) {
  const variants = {
    green: "bg-emerald-500 text-slate-950 hover:bg-emerald-400",
    sky: "bg-sky-500 text-slate-950 hover:bg-sky-400",
    rose: "bg-rose-500 text-slate-950 hover:bg-rose-400",
    amber: "bg-amber-500 text-slate-950 hover:bg-amber-400",
    slate: "bg-app-muted text-app-muted-text",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-xl ${variants[variant]} px-5 py-3.5 text-sm font-black uppercase tracking-wider transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-98`}
    >
      <span className="flex items-center justify-center gap-2">
        {processing ? (
          <span className="h-3.5 w-3.5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
        ) : (
          icon && <span className="text-sm">{icon}</span>
        )}
        {processing ? "Processing on-chain…" : children}
      </span>
    </button>
  );
}

export default function ElectionControl() {
  const { success, error: showError } = useToast();
  const { wallet } = useContext(AuthContext);
  const defaults = useMemo(() => {
    const now = new Date();
    const regEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const votEnd = new Date(regEnd.getTime() + 1 * 60 * 60 * 1000);
    return {
      registrationEnd: toDateTimeLocal(regEnd),
      votingEnd: toDateTimeLocal(votEnd),
    };
  }, []);

  const [registrationEnd, setRegistrationEnd] = useState(defaults.registrationEnd);
  const [votingEnd, setVotingEnd] = useState(defaults.votingEnd);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [phase, setPhase] = useState(null);
  const [phaseEnd, setPhaseEnd] = useState(null);
  const [candidateCount, setCandidateCount] = useState(0);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [syncingWhitelist, setSyncingWhitelist] = useState(false);
  const [syncStatus, setSyncStatus] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PER_PAGE = 6;
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const loadChainState = async () => {
    try {
      const contract = await getContractV3();
      const p = Number(await contract.getPhase());
      const cc = Number(await contract.candidateCount());
      setPhase(p);
      setCandidateCount(cc);
      if (p === 1) setPhaseEnd(Number(await contract.registrationEnd()));
      else if (p === 2) setPhaseEnd(Number(await contract.votingEnd()));
      else setPhaseEnd(null);
    } catch (err) {
      console.error("loadChainState error:", err);
    }
  };

  const loadSyncStatus = async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`${API_URL}/api/voters/merkle-sync-status?adminWallet=${wallet}`);
      if (!res.ok) return;
      const data = await res.json();
      setSyncStatus(data);
    } catch {}
  };

  useEffect(() => { loadChainState(); }, []);
  useEffect(() => { loadSyncStatus(); }, [wallet]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/results/history`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        setHistory([]);
        return;
      }
      data.sort((a, b) => a.election_number - b.election_number);
      const items = data.map((election) => {
        const candidates = election.candidates || [];
        const pres = candidates.find(c => c.position === "President");
        const sec = candidates.find(c => c.position === "Secretary");
        const gms = candidates
          .filter(c => c.position === "General Member")
          .sort((a, b) => Number(b.vote_count) - Number(a.vote_count))
          .slice(0, 5)
          .map(c => c.name);
        return {
          id: election.election_number - 1,
          timestamp: new Date(election.snapshot_at).toLocaleString(),
          totalCandidates: candidates.length,
          pres: pres?.name || "—",
          sec: sec?.name || "—",
          gmNames: gms.length > 0 ? gms : null,
        };
      });
      setHistory(items);
      setHistoryPage(1);
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, []);

  const execute = async (actionName, fn) => {
    setAction(actionName);
    setLoading(true);
    try {
      const tx = await fn();
      const txHash = tx.hash;
      await tx.wait();
      success(`${actionName} successful`, { txHash });
      await loadChainState();
      if (actionName === "Start New Election") {
        setVotingEnd(defaults.votingEnd);
        setRegistrationEnd(defaults.registrationEnd);
        await loadHistory();
      }
    } catch (err) {
      console.error(err);
      showError(formatContractError(err, `${actionName} failed`));
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  const canStartRegistration = phase === 0;
  const canStartVoting = phase === 1;
  const canEndElection = phase === 2;
  const canStartNewElection = phase === 3 && candidateCount > 0;

  const remaining = phaseEnd != null ? phaseEnd - now : null;

  return (
    <div className="space-y-5 sm:space-y-6">
      <SectionHeader icon="⚙️" title="Election Control" />

      {phase !== null && (
        <PhaseTag phase={phase} remaining={remaining} />
      )}

      {phase !== null && (
        <p className="text-sm text-app-muted-text leading-relaxed -mt-2">
          {PHASE_DESCRIPTIONS[phase]}
        </p>
      )}

      {/* Created: Start Registration */}
      {canStartRegistration && (
        <ActionCard title="Open Registration" description="Allow candidates to register on-chain using their identity Merkle proof." icon="🔓">
          <div className="space-y-3">
            <DateInput
              label="Registration Deadline"
              value={registrationEnd}
              onChange={setRegistrationEnd}
              disabled={loading}
            />
            <ActionButton
              variant="green" icon="📝"
              onClick={() => setConfirm({
                title: "Start Registration Phase",
                message: `Start Registration phase?\n\nDeadline: ${formatDateTimeLocal(registrationEnd)}\n\nCandidates can register. Costs gas.`,
                onConfirm: async () => {
                  setConfirm(null);
                  execute("Start Registration", async () => {
                    const endTime = toUnixSeconds(registrationEnd);
                    if (!Number.isFinite(endTime)) throw new Error("Invalid registration end time");
                    const contract = await getContractV3();
                    return contract.startRegistration(endTime);
                  });
                }
              })}
              disabled={loading}
              processing={loading && action === "Start Registration"}
            >
              Start Registration Phase
            </ActionButton>
          </div>
        </ActionCard>
      )}

      {/* Registration: Start Voting */}
      {canStartVoting && (
        <ActionCard title="Open Voting" description="Allow verified voters to cast their vote on-chain. Candidates will be locked." icon="🗳️">
          <div className="space-y-3">
            <DateInput
              label="Voting Deadline"
              value={votingEnd}
              onChange={setVotingEnd}
              disabled={loading}
            />
            <ActionButton
              variant="sky" icon="🗳️"
              onClick={async () => {
                let warningMsg = "";
                let blocking = false;
                try {
                  const [verStatus, syncStatus] = await Promise.all([
                    fetch(`${API_URL}/api/voters/verification-status`).then(r => r.json()),
                    fetch(`${API_URL}/api/voters/merkle-sync-status`).then(r => r.json()),
                  ]);
                  if (verStatus.unverified > 0) {
                    warningMsg = `⚠️ ${verStatus.unverified} student(s) have linked wallets but are NOT verified. ` +
                      "They won't be able to vote after you advance. Verify them first.";
                  }
                  if (syncStatus.needsSync) {
                    blocking = true;
                    warningMsg = `🚫 Merkle roots are out of sync. ` +
                      `${syncStatus.eligibleCount} eligible voters in DB but on-chain root is stale. ` +
                      `Click "Sync Voter Whitelist" first, then try again.`;
                  }
                } catch {}
                if (blocking) {
                  showError(warningMsg);
                  return;
                }
                setConfirm({
                  title: "Start Voting Phase",
                  message: `Start Voting phase?\n\nDeadline: ${formatDateTimeLocal(votingEnd)}\n\nCandidates locked, voting begins. Costs gas.`,
                  warning: warningMsg,
                  onConfirm: async () => {
                    setConfirm(null);
                    execute("Start Voting", async () => {
                      const endTime = toUnixSeconds(votingEnd);
                      if (!Number.isFinite(endTime)) throw new Error("Invalid voting end time");
                      const contract = await getContractV3();
                      return contract.startVoting(endTime);
                    });
                  }
                });
              }}
              disabled={loading}
              processing={loading && action === "Start Voting"}
            >
              Start Voting Phase
            </ActionButton>
          </div>
        </ActionCard>
      )}

      {/* Voting: End Election */}
      {canEndElection && (
        <ActionCard title="End Election" description="Close voting and transition to the Ended phase. Votes can no longer be cast." icon="🏁">
          <ActionButton
            variant="rose" icon="🏁"
              onClick={() => setConfirm({
                title: "End Election",
                message: "Finalize election? No more votes accepted. Costs gas.",
                onConfirm: async () => {
                  setConfirm(null);
                  execute("End Election", async () => {
                    const contract = await getContractV3();
                    return contract.endElection();
                  });
                }
              })}
              disabled={loading}
              processing={loading && action === "End Election"}
            >
              Finalize Election
          </ActionButton>
        </ActionCard>
      )}

      {/* Ended: Start New Election */}
      {canStartNewElection && (
        <ActionCard
          title="Start New Election"
          description="Record position winners and begin a fresh election cycle. Candidates are reset."
          icon="🔄"
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-400">
              <p className="font-bold">This will:</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-app-muted-text">
                <li>Record winners for President, Secretary, and General Member</li>
                <li>Reset candidate count for the next election</li>
                <li>Return the contract to <strong>Created</strong> phase</li>
              </ul>
            </div>
            <ActionButton
              variant="amber" icon="🔄"
              onClick={() => setConfirm({
                title: "Start New Election",
                message: "Start new cycle? Winners recorded, candidates reset. Costs gas.",
                onConfirm: async () => {
                  setConfirm(null);
                  execute("Start New Election", async () => {
                    const contract = await getContractV3();
                    return contract.startNewElection();
                  });
                }
              })}
              disabled={loading}
              processing={loading && action === "Start New Election"}
            >
              Start New Election Cycle
            </ActionButton>
          </div>
        </ActionCard>
      )}

      {/* Ended but no candidates: info state */}
      {phase === 3 && candidateCount === 0 && (
        <ActionCard title="No Candidates" description="Cannot start a new election without registered candidates." icon="⚠️">
          <div className="rounded-lg border border-app bg-app-muted/30 p-5 text-center">
            <p className="text-sm text-app-muted-text">
              The previous election had no candidates. Use the voter management panel to add students and whitelist them,
              then candidates can register when you open registration.
            </p>
          </div>
        </ActionCard>
      )}

      {/* Sync Whitelist — always visible, needed after redeploy */}
      <ActionCard
        title="Sync Voter Whitelist"
        description="Push latest student wallet data on-chain so they can vote."
        icon="📡"
      >
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="rounded-xl border border-app-border bg-app-muted/20 px-4 py-3 sm:px-5 sm:py-3 text-center sm:text-left sm:inline-flex sm:items-center sm:gap-3">
              <span className="text-2xl sm:text-3xl font-black text-app-heading tracking-tight">{syncStatus.eligibleCount ?? "—"}</span>
              <span className="block sm:inline text-[10px] sm:text-xs font-bold text-app-muted-text uppercase tracking-wider sm:leading-none">Eligible voters</span>
            </div>
            <div className="flex items-center justify-center">
              {syncStatus.needsSync === true && (
                <span className="inline-flex items-center gap-2 rounded-xl bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-500/25 px-4 py-2.5 text-sm font-extrabold uppercase tracking-wider shadow-sm">
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  Out of Sync
                </span>
              )}
              {syncStatus.needsSync === false && (
                <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/25 px-4 py-2.5 text-sm font-extrabold uppercase tracking-wider shadow-sm">
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  Synced
                </span>
              )}
            </div>
          </div>
          <ActionButton
            variant="sky" icon="📡"
              onClick={() => {
                if (!wallet) return;
                setConfirm({
                  title: "Sync Voter Whitelist",
                  message: phase !== null && phase >= 2
                    ? "Merkle roots are locked during Voting/Ended phase. The on-chain update will be skipped. DB changes are saved, but students won't be able to vote."
                    : "Sync voter whitelist on-chain? Rebuilds Merkle roots. Costs gas.",
                  onConfirm: async () => {
                    setConfirm(null);
                    if (phase !== null && phase >= 2) {
                      showError("Roots locked — on-chain update skipped (phase >= 2)");
                      return;
                    }
                    setSyncingWhitelist(true);
                    try {
                      const res = await fetch(`${API_URL}/api/voters/rebuild-merkle?adminWallet=${wallet}`, { method: "POST" });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "Rebuild failed");
                      success(`Merkle roots updated on-chain`, { txHash: data.txHash, duration: 8000 });
                    } catch (err) {
                      showError(err.message || "Rebuild failed");
                    } finally {
                      setSyncingWhitelist(false);
                    }
                  }
                });
              }}
            disabled={syncingWhitelist}
            processing={syncingWhitelist}
          >
            Sync Voter Whitelist
          </ActionButton>
          <p className={`text-xs text-center ${phase !== null && phase >= 2 ? "text-rose-400" : "text-app-muted-text"}`}>
            {phase !== null && phase >= 2
              ? "⚠️ Roots locked — DB updates only, no on-chain change"
              : "⚠️ Costs gas — only works during Created or Registration phase"}
          </p>
        </div>
      </ActionCard>

      {/* Election History */}
      <div className="border-t border-app/80 pt-5">
        <SectionHeader icon="📜" title="Election History" />
        {historyLoading ? (
          <p className="text-base text-app-muted-text animate-pulse mt-2">Loading history…</p>
        ) : history.length === 0 ? (
          <p className="text-base text-app-muted-text mt-2">No past election results yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
              {[...history].reverse().slice((historyPage - 1) * HISTORY_PER_PAGE, historyPage * HISTORY_PER_PAGE).map((r) => {
                const isOpen = expandedId === r.id;
              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-app/70 bg-app-surface overflow-hidden shadow-sm cursor-pointer hover:shadow-md hover:border-app transition-all"
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                >
                  <div className="px-4 py-3 text-center border-b border-app/20">
                    <h4 className="text-sm font-bold text-app-heading">Election #{r.id + 1}</h4>
                    <p className="text-[10px] text-app-muted-text/60 mt-0.5">
                      {r.timestamp} · {r.totalCandidates} candidates
                    </p>
                  </div>
                  {isOpen && (
                    <div className="p-3 space-y-2 border-t border-app/20">
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-center">
                        <p className="text-[9px] uppercase tracking-widest text-emerald-400 font-bold mb-0.5">President</p>
                        <p className="text-sm font-bold text-app-heading">{r.pres}</p>
                      </div>
                      <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2 text-center">
                        <p className="text-[9px] uppercase tracking-widest text-sky-400 font-bold mb-0.5">Secretary</p>
                        <p className="text-sm font-bold text-app-heading">{r.sec}</p>
                      </div>
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-center">
                        <p className="text-[9px] uppercase tracking-widest text-amber-400 font-bold mb-0.5">General Member</p>
                        {r.gmNames ? (
                          <ul className="space-y-0.5">
                            {r.gmNames.map((name, idx) => (
                              <li key={idx} className="text-sm font-bold text-app-heading">{name}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm font-bold text-app-heading">—</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
              disabled={historyPage === 1}
              className="px-3 py-1.5 rounded-lg border border-app/70 bg-app-surface text-sm font-bold text-app-muted-text hover:text-app-heading hover:border-app transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              ← Prev
            </button>
            {Array.from({ length: Math.ceil(history.length / HISTORY_PER_PAGE) }, (_, i) => i + 1).map(page => (
              <button
                key={page}
                onClick={() => setHistoryPage(page)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all cursor-pointer ${
                  page === historyPage
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "border border-app/70 bg-app-surface text-app-muted-text hover:text-app-heading hover:border-app"
                }`}
              >
                {page}
              </button>
            ))}
            <button
              onClick={() => setHistoryPage(p => Math.min(Math.ceil(history.length / HISTORY_PER_PAGE), p + 1))}
              disabled={historyPage === Math.ceil(history.length / HISTORY_PER_PAGE)}
              className="px-3 py-1.5 rounded-lg border border-app/70 bg-app-surface text-sm font-bold text-app-muted-text hover:text-app-heading hover:border-app transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              Next →
            </button>
          </div>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirm !== null}
        title={confirm?.title}
        message={confirm?.message}
        warning={confirm?.warning}
        confirmLabel={confirm?.confirmLabel}
        confirmClass={confirm?.confirmClass}
        onClose={() => setConfirm(null)}
        onConfirm={confirm?.onConfirm || (() => {})}
      />
    </div>
  );
}
