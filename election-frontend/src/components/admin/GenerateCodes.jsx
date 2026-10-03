import { useState, useContext, useEffect, useCallback } from "react";
import { API_URL } from "../../config";
import { AuthContext } from "../../context/AuthContextValue";
import { useToast } from "../ui/Toast";
import SectionHeader from "../ui/SectionHeader";
import StatCard from "../ui/StatCard";
import EmptyState from "../ui/EmptyState";
import DataTable from "../ui/DataTable";
import StudentSpreadsheet from "./StudentSpreadsheet";
import ManualCodeGenerator from "./ManualCodeGenerator";
import ConfirmModal from "../ui/ConfirmModal";
import CodesUploader from "./CodesUploader";

const INPUT_TABS = [
  { id: "manual", label: "Manual Entry", icon: "⌨️" },
  { id: "spreadsheet", label: "Spreadsheet", icon: "📊" },
  { id: "upload", label: "Upload File", icon: "📄" },
];

export default function GenerateCodes() {
  const { wallet } = useContext(AuthContext);
  const { success, error: showError, info } = useToast();

  const [inputTab, setInputTab] = useState("manual");
  const [codes, setCodes] = useState([]);
  const [generatedCodes, setGeneratedCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [rebuildingRoot, setRebuildingRoot] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [filter, setFilter] = useState("");
  const [showUsed, setShowUsed] = useState(false);
  const [sort, setSort] = useState("recent");
  const [generatedCount, setGeneratedCount] = useState(0);
  const [generatedMeta, setGeneratedMeta] = useState(null);
  const [merkleRoot, setMerkleRoot] = useState(null);
  const [chainMerkleRoot, setChainMerkleRoot] = useState(null);
  const [reminderConfig, setReminderConfig] = useState(null);
  const [pendingStats, setPendingStats] = useState({ total: 0, with_email: 0 });
  const [sendingReminder, setSendingReminder] = useState(false);
  const [togglingReminder, setTogglingReminder] = useState(false);
  const [sendingEmailMap, setSendingEmailMap] = useState({});

  const loadCodes = useCallback(async () => {
    if (!wallet) return;
    setFetching(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/codes?limit=200&adminWallet=${wallet}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load codes");
      setCodes(data.codes || []);
    } catch (err) {
      console.error(err);
      showError("Failed to load registration codes");
    } finally {
      setFetching(false);
    }
  }, [wallet, showError]);

  useEffect(() => {
    if (wallet) loadCodes();
  }, [wallet, loadCodes]);

  const loadReminderConfig = useCallback(async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/reminder-config?adminWallet=${wallet}`);
      if (res.ok) setReminderConfig(await res.json());
    } catch (_) {}
  }, [wallet]);

  const loadPendingStats = useCallback(async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/pending-codes?adminWallet=${wallet}`);
      if (res.ok) setPendingStats(await res.json());
    } catch (_) {}
  }, [wallet]);

  useEffect(() => {
    if (wallet) {
      loadReminderConfig();
      loadPendingStats();
    }
  }, [wallet, loadReminderConfig, loadPendingStats]);

  const handleGenerate = async (students, onDone) => {
    setLoading(true);
    setGeneratedCodes([]);
    setGeneratedMeta(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/generate-codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminWallet: wallet, students }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setGeneratedCodes(data.codes || []);
      setGeneratedCount(data.count || 0);
      setGeneratedMeta({ generated: data.generated || [], reused: data.reused || [], skipped: data.skipped || [] });
      setMerkleRoot(data.merkleRoot || null);
      onDone();
      const parts = [];
      if (data.generated?.length) parts.push(`${data.generated.length} new`);
      if (data.reused?.length) parts.push(`${data.reused.length} reused`);
      if (data.skipped?.length) parts.push(`${data.skipped.length} skipped (${data.skipped.map(s => s.reason).join(', ')})`);
      success(`Codes: ${parts.join(', ') || 'none'}`);
      await loadCodes();
    } catch (err) {
      showError(err.message || "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file, onDone) => {
    setGeneratedCodes([]);
    setGeneratedMeta(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("adminWallet", wallet);

      const res = await fetch(`${API_URL}/api/admin/upload-codes`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setGeneratedCodes(data.codes || []);
      setGeneratedCount(data.count || 0);
      setGeneratedMeta({ generated: data.generated || [], reused: data.reused || [], skipped: data.skipped || [] });
      setMerkleRoot(data.merkleRoot || null);
      onDone();
      const parts = [];
      if (data.generated?.length) parts.push(`${data.generated.length} new`);
      if (data.reused?.length) parts.push(`${data.reused.length} reused`);
      if (data.skipped?.length) parts.push(`${data.skipped.length} skipped (${data.skipped.map(s => s.reason).join(', ')})`);
      success(`Upload: ${parts.join(', ') || 'none'}`);
      await loadCodes();
    } catch (err) {
      showError(err.message || "Upload failed");
    }
  };

  const handleRebuildRoot = async () => {
    setConfirm({
      title: "Rebuild Merkle Root",
      message: "Rebuild reg-code Merkle root on-chain? Costs gas.",
      onConfirm: async () => {
        setConfirm(null);
        setRebuildingRoot(true);
        try {
          const res = await fetch(`${API_URL}/api/admin/rebuild-regcode-merkle-root`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adminWallet: wallet }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Rebuild failed");
          setMerkleRoot(data.merkleRoot);
          success("Merkle root rebuilt on-chain");
        } catch (err) {
          showError(err.message);
        } finally {
          setRebuildingRoot(false);
        }
      }
    });
  };

  const handleToggleReminder = async () => {
    if (!reminderConfig) return;
    setTogglingReminder(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/reminder-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminWallet: wallet, enabled: !reminderConfig.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setReminderConfig(data);
      success(data.enabled ? "Auto reminders enabled" : "Auto reminders disabled");
    } catch (err) {
      showError(err.message);
    } finally {
      setTogglingReminder(false);
    }
  };

  const handleSendReminderNow = async () => {
    setSendingReminder(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/send-reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminWallet: wallet }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send reminders");
      if (data.devMode) {
        info(data.message || "Reminders logged to console (SMTP not configured)");
      } else {
        success(data.message || `Reminders sent to ${data.sent.length} student(s)`);
      }
      if (data.failed?.length) {
        showError(`${data.failed.length} failed: ${data.failed.map(f => `${f.student_id} (${f.reason})`).join(", ")}`);
      }
      loadPendingStats();
    } catch (err) {
      showError(err.message);
    } finally {
      setSendingReminder(false);
    }
  };

  const handleSendSingleEmail = async (studentId) => {
    setSendingEmailMap(prev => ({ ...prev, [studentId]: true }));
    try {
      const res = await fetch(`${API_URL}/api/admin/send-codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminWallet: wallet, student_ids: [studentId] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      if (data.devMode) {
        info(`Email logged to console for ${studentId}`);
      } else {
        success(`Code sent to ${studentId}`);
      }
      if (data.failed?.length) {
        showError(`${studentId}: ${data.failed[0]?.reason || "failed"}`);
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setSendingEmailMap(prev => ({ ...prev, [studentId]: false }));
    }
  };

  const handleSendEmail = async (studentIds) => {
    setSendingEmail(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/send-codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminWallet: wallet, student_ids: studentIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      if (data.devMode) {
        info(data.message || "Emails logged to console (SMTP not configured)");
      } else {
        success(data.message || `Emails sent to ${data.sent.length} student(s)`);
      }
      if (data.failed?.length) {
        showError(`${data.failed.length} failed: ${data.failed.map(f => `${f.student_id} (${f.reason})`).join(", ")}`);
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setSendingEmail(false);
    }
  };

  const downloadCSV = (rows) => {
    const header = "student_id,code";
    const lines = rows.map((r) => `${r.student_id},${r.code}`);
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `registration_codes_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    info("CSV download started");
  };

  const filteredCodes = codes.filter((c) => {
    if (!showUsed && c.used) return false;
    const q = filter.trim().toUpperCase();
    if (!q) return true;
    return (
      (c.student_id || "").toUpperCase().includes(q) ||
      (c.name || "").toUpperCase().includes(q) ||
      (c.code || "").toUpperCase().includes(q)
    );
  });

  const sortedCodes = [...filteredCodes].sort((a, b) => {
    if (sort === "recent") {
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    }
    if (sort === "status") {
      return (a.used === b.used) ? 0 : a.used ? 1 : -1;
    }
    return (a.student_id || "").localeCompare(b.student_id || "");
  });

  return (
    <div className="space-y-6">
      <SectionHeader icon="🔑" title="Registration Codes" />

      <div className="flex gap-2 overflow-x-auto border-b border-app pb-3">
        {INPUT_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setInputTab(t.id)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-base font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              inputTab === t.id
                ? "text-app-accent bg-app-accent-soft shadow-sm"
                : "text-app-muted-text hover:text-app-heading hover:bg-app-muted/30"
            }`}
          >
            <span className="text-lg">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {inputTab === "manual" && (
        <ManualCodeGenerator
          wallet={wallet}
          loading={loading}
          generatedCodes={generatedCodes}
          generatedCount={generatedCount}
          generatedMeta={generatedMeta}
          merkleRoot={merkleRoot}
          onGenerate={handleGenerate}
          onDownloadCSV={downloadCSV}
          onSendEmail={handleSendEmail}
          sendingEmail={sendingEmail}
        />
      )}

      {inputTab === "spreadsheet" && <StudentSpreadsheet />}

      {inputTab === "upload" && (
        <CodesUploader
          wallet={wallet}
          generatedCodes={generatedCodes}
          generatedCount={generatedCount}
          generatedMeta={generatedMeta}
          merkleRoot={merkleRoot}
          onUpload={handleFileUpload}
          onDownloadCSV={downloadCSV}
          onSendEmail={handleSendEmail}
          sendingEmail={sendingEmail}
        />
      )}

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Codes" value={codes.length} />
        <StatCard label="Unused" value={codes.filter((c) => !c.used).length} accent="emerald" />
        <StatCard label="Used" value={codes.filter((c) => c.used).length} accent="muted" />
      </div>

      <div className="rounded-xl border border-app bg-app-surface overflow-hidden">
        <div className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-0 sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-app-heading">⏰ Auto Reminder Emails</h3>
            <p className="text-xs text-app-muted-text mt-0.5">
              {pendingStats.total} pending code(s) · {pendingStats.with_email} with email
              {reminderConfig?.lastRun && ` · Last run: ${new Date(reminderConfig.lastRun).toLocaleString()}`}
              {reminderConfig?.lastSentCount > 0 && ` · Sent: ${reminderConfig.lastSentCount}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleSendReminderNow}
              disabled={sendingReminder || pendingStats.with_email === 0 || !wallet}
              className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-400 hover:bg-sky-500/20 transition-all disabled:opacity-50 cursor-pointer"
            >
              {sendingReminder ? "Sending…" : "Send Reminders Now"}
            </button>
            <button
              onClick={handleToggleReminder}
              disabled={togglingReminder || !wallet}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 cursor-pointer ${
                reminderConfig?.enabled
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  : "border-app bg-app-input text-app-muted-text hover:text-app-heading"
              }`}
            >
              {togglingReminder
                ? "…"
                : reminderConfig?.enabled
                  ? "Auto On (Daily 9AM)"
                  : "Enable Auto Reminder"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-app-muted-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by student ID or code…"
            className="input-field w-full pl-10 pr-4 py-2.5 text-sm"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-lg border border-app bg-app-input px-3 py-2.5 text-sm text-app-muted-text hover:text-app-heading cursor-pointer focus:outline-none"
        >
          <option value="recent">By Recent</option>
          <option value="status">By Status</option>
          <option value="id">By ID</option>
        </select>
        <label className="flex items-center gap-2 text-sm font-medium text-app-muted-text cursor-pointer select-none shrink-0">
          <input
            type="checkbox"
            checked={showUsed}
            onChange={(e) => setShowUsed(e.target.checked)}
            className="h-4 w-4 accent-emerald-500 rounded cursor-pointer"
          />
          Show used
        </label>
        <button
          onClick={() => downloadCSV(codes)}
          className="rounded-lg border border-app bg-app-input px-4 py-2.5 text-sm font-medium text-app-muted-text hover:text-app-heading hover:bg-app-elevated transition-all cursor-pointer"
        >
          Backup CSV
        </button>
        <button
          onClick={loadCodes}
          disabled={fetching}
          className="rounded-lg border border-app bg-app-input px-4 py-2.5 text-sm font-medium text-app-muted-text hover:text-app-heading hover:bg-app-elevated transition-all disabled:opacity-50 cursor-pointer"
        >
          {fetching ? "Syncing…" : "Refresh"}
        </button>
        <button
          onClick={handleRebuildRoot}
          disabled={rebuildingRoot}
          className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-400 hover:bg-sky-500/20 transition-all disabled:opacity-50 cursor-pointer"
        >
          {rebuildingRoot ? "Rebuilding…" : "Rebuild Merkle Root"}
        </button>
      </div>

      {sortedCodes.length === 0 ? (
        <EmptyState icon="🔑" message="No registration codes match your filters." />
      ) : (
        <DataTable
          keyExtractor={(c) => c.id}
          data={sortedCodes}
          rowClassName={(c) => (c.used ? "opacity-60" : "")}
          columns={[
            {
              key: "student_id",
              label: "Voter ID",
              cellClassName: "font-mono text-emerald-400 font-bold",
              render: (c) => c.student_id,
            },
            {
              key: "name",
              label: "Name",
              cellClassName: "font-medium text-app-heading",
              render: (c) => c.name || "\u2014",
            },
            {
              key: "code",
              label: "Key Code",
              cellClassName: "font-mono font-bold tracking-wider text-app-heading",
              render: (c) => c.code,
            },
            {
              key: "status",
              label: "Status",
              render: (c) =>
                c.used ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider bg-app-elevated border border-app text-app-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-app-muted" />
                    Claimed
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Available
                  </span>
                ),
            },
            {
              key: "created_at",
              label: "Issued",
              cellClassName: "font-mono text-sm",
              render: (c) => (c.created_at ? new Date(c.created_at).toLocaleDateString() : "\u2014"),
            },
            {
              key: "email",
              label: "Email",
              cellClassName: "text-sm text-app-muted-text max-w-[180px] truncate",
              render: (c) => c.email || "\u2014",
            },
            {
              key: "actions",
              label: "",
              render: (c) =>
                !c.used && c.email ? (
                  <button
                    onClick={() => handleSendSingleEmail(c.student_id)}
                    disabled={sendingEmailMap[c.student_id]}
                    className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-400 hover:bg-sky-500/20 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {sendingEmailMap[c.student_id] ? "…" : "📧 Send"}
                  </button>
                ) : null,
            },
          ]}
        />
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
