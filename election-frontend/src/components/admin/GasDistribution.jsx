import { useEffect, useState, useContext, useRef } from "react";
import { API_URL } from "../../config";
import { AuthContext } from "../../context/AuthContextValue";
import { useToast } from "../ui/Toast";
import { useBalance } from "../../hooks/useBalance";
import StatCard from "../ui/StatCard";
import GasHistory from "./GasHistory";
import ConfirmModal from "../ui/ConfirmModal";

function GasIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5v14a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2H6a2 2 0 00-2 2z" />
      <path d="M10 11h2" />
      <path d="M14 7l2 2 2-2" />
      <path d="M14 11h4" />
      <path d="M16 15h2a2 2 0 012 2v1a1 1 0 01-1 1h-1" />
    </svg>
  );
}

function DistributeIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20" />
      <path d="M17 7l-5-5-5 5" />
      <path d="M7 17l5 5 5-5" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function BeakerIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6" />
      <path d="M10 3v4l-4 11a2 2 0 002 2h8a2 2 0 002-2l-4-11V3" />
      <path d="M8 14h8" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function EthIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L4 12.5l8 3.5 8-3.5L12 2z" opacity="0.6" />
      <path d="M12 16.5l-8-3.5L12 22l8-9-8 3.5z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  );
}

const GAS_TABS = [
  { id: "distribute", label: "Distribute", icon: DistributeIcon },
  { id: "history", label: "History", icon: HistoryIcon },
];

const AMOUNT_PRESETS = ["0.001", "0.002", "0.005", "0.01"];

export default function GasDistribution() {
  const { wallet } = useContext(AuthContext);
  const [subTab, setSubTab] = useState("distribute");
  const [subStuck, setSubStuck] = useState(false);
  const subSentinelRef = useRef(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    const el = subSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setSubStuck(!entry.isIntersecting),
      { rootMargin: "-160px 0px 0px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!wallet) return;
    fetch(`${API_URL}/api/distribution/summary?adminWallet=${wallet}`)
      .then(r => r.json())
      .then(d => setSummary(d))
      .catch(() => {});
  }, [wallet]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
            <GasIcon />
          </div>
          <div>
            <h3 className="text-base font-black uppercase tracking-wide text-app-heading">
              Sepolia ETH Distribution
            </h3>
            <p className="text-sm text-app-muted mt-0.5">
              Send test ETH to verified voters by year group
            </p>
          </div>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total ETH Sent" value={`${summary.totalEthSent} ETH`} accent="emerald" />
          <StatCard label="Students Served" value={summary.totalStudents} accent="emerald" />
          <StatCard label="Distributions" value={summary.totalDistributions} />
          <StatCard
            label="Last Distribution"
            value={summary.lastDistribution
              ? new Date(summary.lastDistribution).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "—"}
            accent="muted"
          />
        </div>
      )}

      <div ref={subSentinelRef} className="h-px" />
      <div className={`flex gap-1.5 sm:gap-3 mb-4 sm:mb-6 pb-3 sm:pb-5 border-b border-app overflow-x-auto sticky top-[10rem] z-20 transition-all duration-200 ${subStuck ? "bg-app-background/80 backdrop-blur-sm" : "bg-transparent"} -mx-4 sm:-mx-6 px-4 sm:px-6`}>
        {GAS_TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-1.5 sm:py-2.5 rounded-lg text-xs sm:text-base font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                subTab === t.id
                  ? "text-app-accent bg-app-accent-soft shadow-sm"
                  : "text-app-muted-text hover:text-app-heading hover:bg-app-muted/30"
              }`}
            >
              <Icon />
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === "distribute" && <GasDistribute />}
      {subTab === "history" && <GasHistory wallet={wallet} />}
    </div>
  );
}

function DistributionConfirmModal({ open, onClose, onConfirm, selectedCount, totalEth, amount }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-app bg-app-surface p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-black uppercase tracking-wide text-app-heading">Confirm Distribution</h3>
          <button onClick={onClose} className="p-2 rounded-lg text-app-muted hover:text-app-heading hover:bg-app-muted/30 transition-colors cursor-pointer">
            <CloseIcon />
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b border-app/50">
            <span className="text-app-muted">Recipients</span>
            <span className="font-bold text-app-heading">{selectedCount}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-app/50">
            <span className="text-app-muted">Amount per student</span>
            <span className="font-bold text-emerald-300">{amount} ETH</span>
          </div>
          <div className="flex justify-between py-2 border-b border-app/50">
            <span className="text-app-muted">Total ETH required</span>
            <span className="font-bold text-emerald-300">{totalEth.toFixed(4)} ETH</span>
          </div>
        </div>
        <p className="mt-4 text-sm text-rose-400 flex items-start gap-2">
          <WarningIcon />
          <span>This will send real Sepolia ETH. Ensure you have sufficient balance.</span>
        </p>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-app bg-app-elevated px-4 py-3 text-sm font-bold text-app-heading hover:bg-app-muted/30 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-400 text-slate-950 px-4 py-3 text-sm font-black uppercase tracking-widest shadow-neon-glow hover:brightness-110 transition-all cursor-pointer"
          >
            <span className="flex items-center justify-center gap-2">
              <SendIcon />
              Confirm Send
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function GasDistribute() {
  const { wallet } = useContext(AuthContext);
  const { balance } = useBalance(wallet);
  const { success, error: showError, info } = useToast();
  const [stats, setStats] = useState([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [selectedYears, setSelectedYears] = useState([]);
  const [amount, setAmount] = useState("0.002");
  const [distributing, setDistributing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [results, setResults] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sendProgress, setSendProgress] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const loadStats = async () => {
    setLoadingStats(true);
    try {
      const res = await fetch(`${API_URL}/api/distribution/stats`);
      if (!res.ok) throw new Error("Failed to load stats");
      const data = await res.json();
      setStats(data.years || []);
    } catch (err) {
      showError(err.message || "Could not load distribution stats");
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const toggleYear = (year) => {
    setSelectedYears((prev) =>
      prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]
    );
    setPreview(null);
    setResults(null);
  };

  const selectAllYears = () => {
    setSelectedYears(stats.filter(s => Number(s.eligible_count) > 0).map(s => s.year));
    setPreview(null);
    setResults(null);
  };

  const deselectAllYears = () => {
    setSelectedYears([]);
    setPreview(null);
    setResults(null);
  };

  const selectedCount = stats
    .filter((s) => selectedYears.includes(s.year))
    .reduce((sum, s) => sum + Number(s.eligible_count || 0), 0);

  const totalEth = selectedCount * parseFloat(amount || 0);
  const adminBalance = balance ? parseFloat(balance) : 0;
  const hasEnough = adminBalance >= totalEth + 0.01;
  const canSend = selectedCount > 0 && parseFloat(amount) > 0 && wallet;

  const runDistribution = async (dryRun) => {
    if (!wallet) {
      showError("Connect your MetaMask wallet first.");
      return;
    }
    if (selectedYears.length === 0) {
      showError("Select at least one year group.");
      return;
    }
    if (!dryRun && !hasEnough) {
      showError(
        `Admin balance (${adminBalance.toFixed(4)} ETH) is insufficient. Need ${(totalEth + 0.01).toFixed(4)} ETH.`
      );
      return;
    }

    setDistributing(true);
    setPreview(null);
    setResults(null);
    setSendProgress(dryRun ? null : { sent: 0, failed: 0, total: selectedCount });

    try {
      const res = await fetch(`${API_URL}/api/distribution/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          years: selectedYears,
          amount: amount,
          dryRun,
          adminWallet: wallet,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Distribution request failed");
      }

      if (dryRun) {
        setPreview(data);
        info(`Dry run: ${data.totalRecipients} recipient(s), ${data.totalEth} ETH total`);
      } else {
        setResults(data);
        setSendProgress({ sent: data.sent, failed: data.failed, total: data.totalRecipients });
        success(
          `Distribution complete! ${data.sent} sent, ${data.failed} failed. Total: ${data.totalEth} ETH`
        );
      }
    } catch (err) {
      showError(err.message || "Distribution failed");
    } finally {
      setDistributing(false);
    }
  };

  const handleRetryFailed = async () => {
    const failedEntries = results?.results?.filter(r => r.status === "failed") || [];
    if (failedEntries.length === 0) return;
    setConfirm({
      title: "Retry Failed Distributions",
      message: `Resend ETH to ${failedEntries.length} failed recipient(s)? Costs gas.`,
      onConfirm: async () => {
        setConfirm(null);
        const logIds = failedEntries.map(r => r.logId).filter(Boolean);
        if (logIds.length === 0) {
          showError("No failed entries with log IDs to retry.");
          return;
        }

        setDistributing(true);
        try {
          const res = await fetch(`${API_URL}/api/distribution/retry`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ logIds, amount, adminWallet: wallet }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Retry failed");
          success(`Retry sent ${data.sent} successfully, ${data.failed} still failed.`);
          // Re-run dry run to refresh results
          runDistribution(true);
        } catch (err) {
          showError(err.message || "Retry request failed");
        } finally {
          setDistributing(false);
        }
      }
    });
  };

  const handleSendClick = () => {
    setShowConfirm(true);
  };

  const allSelected = stats.filter(s => Number(s.eligible_count) > 0).length > 0
    && selectedYears.length === stats.filter(s => Number(s.eligible_count) > 0).length;

  return (
    <div className="space-y-6">
      {balance && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-sm font-mono font-bold text-emerald-300 w-fit">
          <EthIcon />
          <span>{Number(balance).toFixed(4)} ETH</span>
        </div>
      )}

      {/* Step 1: Year Selection */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-black uppercase tracking-widest text-app-muted flex items-center gap-2">
            <UsersIcon />
            <span>1. Select Year Groups</span>
          </h4>
          {stats.some(s => Number(s.eligible_count) > 0) && (
            <button
              onClick={allSelected ? deselectAllYears : selectAllYears}
              className="text-xs font-bold text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
            >
              {allSelected ? "Deselect All" : "Select All"}
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {loadingStats ? (
            <div className="col-span-full text-center py-8 text-app-muted text-xs animate-pulse">
              Loading voter stats…
            </div>
          ) : stats.length === 0 ? (
            <div className="col-span-full text-center py-8 text-app-muted text-xs">
              No students with linked wallets found.
            </div>
          ) : (
            stats.map((s) => {
              const selected = selectedYears.includes(s.year);
              const disabled = Number(s.eligible_count || 0) === 0;
              return (
                <button
                  key={s.year}
                  type="button"
                  onClick={() => !disabled && toggleYear(s.year)}
                  disabled={disabled}
                  className={`relative text-left rounded-2xl border-2 p-4 transition-all cursor-pointer ${
                    disabled
                      ? "border-app/50 bg-app-muted/30 opacity-50 cursor-not-allowed"
                      : selected
                      ? "border-emerald-500/50 bg-emerald-500/10 shadow-neon-glow"
                      : "border-app bg-app-elevated/40 hover:border-sky-400/30 hover:bg-app-elevated/60"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black uppercase tracking-wide text-app-heading">
                      {s.year === "Unknown" ? "No Year" : `${s.year} Year`}
                    </span>
                    {selected && (
                      <span className="text-emerald-400">
                        <CheckIcon />
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-app-muted space-y-1">
                    <p>
                      <span className="font-bold text-app-body">{s.wallet_count}</span> wallets linked
                    </p>
                    <p>
                      <span className="font-bold text-emerald-400">{s.eligible_count}</span> eligible to vote
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Step 2: Configure */}
      {selectedYears.length > 0 && (
        <div className="rounded-2xl border border-app bg-app-elevated/30 p-4 sm:p-5 space-y-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-app-muted">2. Configure Amount</h4>

          <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
            <div className="flex-1">
              <label className="block text-sm font-black uppercase tracking-widest text-app-muted mb-1.5">
                ETH per Student
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setPreview(null);
                    setResults(null);
                  }}
                  className="flex-1 rounded-xl border border-app bg-app-input px-3 py-2 text-sm font-mono text-app-heading focus:outline-none focus:ring-1 focus:ring-sky-400/40"
                />
                <span className="text-sm font-bold text-app-muted uppercase">ETH</span>
              </div>
              <div className="flex gap-1.5 mt-2">
                {AMOUNT_PRESETS.map(p => (
                  <button
                    key={p}
                    onClick={() => { setAmount(p); setPreview(null); setResults(null); }}
                    className={`px-3 py-2 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      amount === p
                        ? "bg-sky-400/20 text-sky-300 border border-sky-400/30"
                        : "bg-app-muted/20 text-app-muted border border-app/50 hover:border-sky-400/20 hover:text-app-heading"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1">
              <div className="text-sm font-black uppercase tracking-widest text-app-muted mb-1">
                Summary
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-app-body">
                  <span className="font-bold text-emerald-400">{selectedCount}</span> recipients
                </span>
                <span className="text-app-body">
                  <span className="font-bold text-emerald-300">{totalEth.toFixed(4)}</span> ETH total
                </span>
                <span className="text-app-body">
                  <span className="font-bold text-sky-400">{Number(amount).toFixed(4)}</span> ETH each
                </span>
              </div>
            </div>
          </div>

          {!hasEnough && balance && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300 flex items-start gap-2">
              <WarningIcon />
              <span>
                Insufficient balance. Admin has {Number(balance).toFixed(4)} ETH but needs approximately{" "}
                {(totalEth + 0.01).toFixed(4)} ETH (including buffer).
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={() => runDistribution(true)}
              disabled={!canSend || distributing}
              className="flex-1 rounded-xl border border-sky-400/25 bg-sky-400/10 px-4 py-3 text-xs font-black uppercase tracking-widest text-sky-300 hover:bg-sky-400/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {distributing && !results && preview === null ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 border-2 border-sky-300/30 border-t-sky-300 rounded-full animate-spin inline-block" />
                  Simulating…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <BeakerIcon />
                  Dry Run
                </span>
              )}
            </button>
            <button
              onClick={handleSendClick}
              disabled={!canSend || distributing || !hasEnough}
              className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-sky-400 text-slate-950 px-4 py-3 text-xs font-black uppercase tracking-widest shadow-neon-glow hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {distributing && !results && preview === null ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin inline-block" />
                  Sending…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <SendIcon />
                  Send Sepolia ETH
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <DistributionConfirmModal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={() => { setShowConfirm(false); runDistribution(false); }}
        selectedCount={selectedCount}
        totalEth={totalEth}
        amount={amount}
      />

      {/* Progress indicator during send */}
      {sendProgress && !preview && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 sm:p-5 space-y-3">
          <h4 className="text-xs font-black uppercase tracking-wide text-emerald-300 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Distribution Progress
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-app-muted">
              <span>{sendProgress.sent + sendProgress.failed} of {sendProgress.total}</span>
              <span>{Math.round((sendProgress.sent + sendProgress.failed) / sendProgress.total * 100)}%</span>
            </div>
            <div className="h-2 rounded-full bg-app-muted/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-400 transition-all duration-500"
                style={{ width: `${Math.round((sendProgress.sent + sendProgress.failed) / sendProgress.total * 100)}%` }}
              />
            </div>
            <div className="flex gap-4 text-xs">
              <span className="text-emerald-400 font-bold">{sendProgress.sent} sent</span>
              {sendProgress.failed > 0 && (
                <span className="text-rose-400 font-bold">{sendProgress.failed} failed</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dry Run Preview */}
      {preview && (
        <div className="rounded-2xl border border-sky-400/20 bg-sky-400/5 p-4 sm:p-5 space-y-3">
          <h4 className="text-xs font-black uppercase tracking-wide text-sky-300 flex items-center gap-2">
            <BeakerIcon />
            Dry Run Preview
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Recipients" value={preview.totalRecipients} />
            <StatCard label="Total ETH" value={`${preview.totalEth} ETH`} accent="emerald" />
            <StatCard label="Per Student" value={`${preview.amountPerVoter} ETH`} accent="emerald" />
            <StatCard label="Admin Balance" value={`${preview.adminBalance} ETH`} />
          </div>
          <div className="max-h-48 overflow-y-auto rounded-xl border border-app bg-app-elevated/30">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-app-elevated/80 backdrop-blur text-app-muted uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Student</th>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Year</th>
                  <th className="text-left px-3 py-2">Wallet</th>
                </tr>
              </thead>
              <tbody>
                {preview.recipients.map((r) => (
                  <tr key={r.student_id} className="border-t border-app/50">
                    <td className="px-3 py-2 text-app-body font-mono text-xs">{r.student_id}</td>
                    <td className="px-3 py-2 text-app-body text-xs">{r.name || "—"}</td>
                    <td className="px-3 py-2 text-app-body text-xs">{r.year}</td>
                    <td className="px-3 py-2 font-mono text-app-muted text-xs">
                      {r.wallet_address.slice(0, 6)}…{r.wallet_address.slice(-4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Live Results */}
      {results && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 sm:p-5 space-y-3">
          <h4 className="text-xs font-black uppercase tracking-wide text-emerald-300 flex items-center gap-2">
            <CheckIcon />
            Distribution Results
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Recipients" value={results.totalRecipients} />
            <StatCard label="Total ETH" value={`${results.totalEth} ETH`} accent="emerald" />
            <StatCard label="Sent" value={results.sent} accent="emerald" />
            {results.failed > 0 && (
              <StatCard label="Failed" value={results.failed} accent="default" />
            )}
          </div>

          <div className="max-h-64 overflow-y-auto rounded-xl border border-app bg-app-elevated/30">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-app-elevated/80 backdrop-blur text-app-muted uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Student</th>
                  <th className="text-left px-3 py-2">Year</th>
                  <th className="text-left px-3 py-2">Tx Hash</th>
                  <th className="text-left px-3 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {results.results.map((r, i) => (
                  <tr key={i} className="border-t border-app/50">
                    <td className="px-3 py-2">
                      {r.status === "sent" ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                          <CheckIcon /> Sent
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-400 font-bold">
                          <WarningIcon /> Failed
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-app-body font-mono text-xs">{r.student_id}</td>
                    <td className="px-3 py-2 text-app-body text-xs">{r.year}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.tx_hash ? (
                        <a
                          href={`https://sepolia.etherscan.io/tx/${r.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-300 hover:text-sky-200 hover:underline transition-colors"
                        >
                          {r.tx_hash.slice(0, 6)}…{r.tx_hash.slice(-4)}
                        </a>
                      ) : (
                        <span className="text-app-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-rose-300 max-w-[150px] truncate text-xs" title={r.error}>
                      {r.error || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {results.failed > 0 && (
            <button
              onClick={handleRetryFailed}
              disabled={distributing}
              className="flex items-center gap-2 rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-rose-300 hover:bg-rose-400/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <RetryIcon />
              Retry Failed ({results.failed})
            </button>
          )}
        </div>
      )}

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
