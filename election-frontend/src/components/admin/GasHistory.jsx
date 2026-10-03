import { useEffect, useState } from "react";
import { API_URL } from "../../config";
import { useToast } from "../ui/Toast";
import StatCard from "../ui/StatCard";
import EmptyState from "../ui/EmptyState";

function HistoryIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg className="w-3 h-3 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg className="h-10 w-10 mx-auto mb-2 text-app-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20" />
      <path d="M17 7l-5-5-5 5" />
      <path d="M7 17l5 5 5-5" />
    </svg>
  );
}

export default function GasHistory({ wallet }) {
  const { error: showError } = useToast();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState(null);
  const [years, setYears] = useState([]);
  const [yearFilter, setYearFilter] = useState("all");

  const loadSummary = async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`${API_URL}/api/distribution/summary?adminWallet=${wallet}`);
      if (res.ok) {
        const data = await res.json();
        if (data.totalDistributions > 0) setSummary(data);
      }
    } catch (err) {
      console.error("Failed to load distribution summary:", err.message);
    }
  };

  const loadYears = async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`${API_URL}/api/distribution/stats`);
      if (res.ok) {
        const data = await res.json();
        const y = (data.years || [])
          .map(s => s.year)
          .filter(y => y !== "Unknown")
          .sort();
        setYears(y);
      }
    } catch (err) {
      console.error("Failed to load distribution years:", err.message);
    }
  };

  const loadHistory = async (p = 1) => {
    if (!wallet) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, limit: "20", adminWallet: wallet });
      if (yearFilter !== "all") params.set("year", yearFilter);
      const res = await fetch(`${API_URL}/api/distribution/history?${params}`);
      if (!res.ok) throw new Error("Failed to load history");
      const data = await res.json();
      setLogs(data.logs || []);
      setTotalPages(data.totalPages || 1);
      setPage(data.page || 1);
    } catch (err) {
      showError(err.message || "Could not load distribution history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!wallet) return;
    loadYears();
    loadHistory(1);
    loadSummary();
  }, [wallet]);

  useEffect(() => {
    if (!wallet) return;
    loadHistory(1);
  }, [yearFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300">
          <HistoryIcon />
        </div>
        <h3 className="text-base font-black uppercase tracking-wider text-app-heading">Distribution History</h3>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total ETH Sent" value={`${summary.totalEthSent} ETH`} accent="emerald" />
          <StatCard label="Students Served" value={summary.totalStudents} accent="emerald" />
          <StatCard label="Total Distributions" value={summary.totalDistributions} />
          <StatCard
            label="Last Distribution"
            value={summary.lastDistribution
              ? new Date(summary.lastDistribution).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "—"}
            accent="muted"
          />
        </div>
      )}

      {years.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-app-muted">Year:</span>
          <button
            onClick={() => setYearFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              yearFilter === "all"
                ? "bg-sky-400/20 text-sky-300 border border-sky-400/30"
                : "bg-app-muted/20 text-app-muted border border-app/50 hover:border-sky-400/20 hover:text-app-heading"
            }`}
          >
            All
          </button>
          {years.map(y => (
            <button
              key={y}
              onClick={() => setYearFilter(String(y))}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                yearFilter === String(y)
                  ? "bg-sky-400/20 text-sky-300 border border-sky-400/30"
                  : "bg-app-muted/20 text-app-muted border border-app/50 hover:border-sky-400/20 hover:text-app-heading"
              }`}
            >
              {y} Year
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-sm text-app-muted animate-pulse">Loading history…</div>
      ) : logs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-app bg-app-muted/50 p-8 sm:p-10 text-center">
          <EmptyIcon />
          <p className="mt-3 text-base font-mono text-app-muted">No distribution records yet.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-app">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-app-elevated/80 backdrop-blur text-app-muted uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Student</th>
                  <th className="text-left px-4 py-3">Year</th>
                  <th className="text-left px-4 py-3">Wallet</th>
                  <th className="text-left px-4 py-3">Amount</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Tx Hash</th>
                  <th className="text-left px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-app/50 hover:bg-app-muted/20 transition-colors">
                    <td className="px-4 py-3 font-mono text-app-body">{log.student_id}</td>
                    <td className="px-4 py-3 text-app-muted text-xs font-bold">{log.year || "—"}</td>
                    <td className="px-4 py-3 font-mono text-app-muted text-xs">
                      {log.wallet_address.slice(0, 6)}…{log.wallet_address.slice(-4)}
                    </td>
                    <td className="px-4 py-3 font-mono text-app-heading">{log.amount_eth} ETH</td>
                    <td className="px-4 py-3">
                      {log.status === "sent" ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                          <span className="h-2 w-2 rounded-full bg-emerald-400" />
                          Sent
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-400 font-semibold" title={log.error}>
                          <span className="h-2 w-2 rounded-full bg-rose-400" />
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {log.tx_hash ? (
                        <a
                          href={`https://sepolia.etherscan.io/tx/${log.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 hover:underline transition-colors"
                        >
                          {log.tx_hash.slice(0, 6)}…{log.tx_hash.slice(-4)}
                          <ExternalIcon />
                        </a>
                      ) : (
                        <span className="text-app-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-app-muted text-xs">
                      {new Date(log.distributed_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="text-sm text-app-muted">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => loadHistory(page - 1)}
                  disabled={page <= 1}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border border-app bg-app-surface text-app-heading hover:bg-app-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Prev
                </button>
                <button
                  onClick={() => loadHistory(page + 1)}
                  disabled={page >= totalPages}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border border-app bg-app-surface text-app-heading hover:bg-app-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
