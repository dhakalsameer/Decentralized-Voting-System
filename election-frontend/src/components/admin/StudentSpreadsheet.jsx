import { useState, useEffect, useCallback, useContext, useRef } from "react";
import * as XLSX from "xlsx";
import { API_URL } from "../../config";
import { AuthContext } from "../../context/AuthContextValue";
import { useToast } from "../ui/Toast";
import ConfirmModal from "../ui/ConfirmModal";

const YEARS = ["1st", "2nd", "3rd", "4th"];
const GENDERS = ["male", "female", "other"];
const FIELDS = ["student_id", "name", "year", "gender", "email"];

function isRowEmpty(row) {
  return FIELDS.every((f) => !String(row[f] || "").trim());
}

export default function StudentSpreadsheet() {
  const { wallet } = useContext(AuthContext);
  const { success, error: showError, info } = useToast();

  const [students, setStudents] = useState([]);
  const [originalMap, setOriginalMap] = useState({});
  const [yearTab, setYearTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rebuildingMerkle, setRebuildingMerkle] = useState(false);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState(null);
  const inputRef = useRef(null);

  const [generatedCodes, setGeneratedCodes] = useState([]);
  const [generatedMeta, setGeneratedMeta] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const loadStudents = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    setError("");
    try {
      const url = yearTab === "all"
        ? `${API_URL}/api/auth/admin/students?adminWallet=${wallet}`
        : `${API_URL}/api/auth/admin/students?adminWallet=${wallet}&year=${yearTab}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load students");

      const list = data.students || [];
      setStudents(list);
      const map = {};
      list.forEach((s) => { map[s.student_id] = { ...s }; });
      setOriginalMap(map);
    } catch (err) {
      setError(err.message);
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }, [wallet, yearTab, showError]);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (typeof inputRef.current.select === "function") {
        inputRef.current.select();
      }
    }
  }, [editing]);

  const isDirty = (row, idx) => {
    const orig = originalMap[row.student_id];
    if (!orig) return true;
    return FIELDS.some((f) => String(row[f] || "") !== String(orig[f] || ""));
  };

  const hasDirtyRows = students.some((s, i) => isDirty(s, i));

  const isExisting = (row) => row.student_id && originalMap[row.student_id];

  const canEditField = (row, field) => {
    if (field === "student_id" && isExisting(row)) return false;
    return true;
  };

  const startEdit = (rowIndex, field, value) => {
    if (!canEditField(students[rowIndex], field)) return;
    setEditing({ rowIndex, field });
  };

  const commitEdit = (value) => {
    if (!editing) return;
    const { rowIndex, field } = editing;
    setStudents((prev) => {
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], [field]: value };
      return next;
    });
    setEditing(null);
  };

  const cancelEdit = () => {
    setEditing(null);
  };

  const handleCellKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const cur = editing;
      commitEdit(e.target.value);
      if (cur) {
        const { rowIndex, field } = cur;
        const fieldIdx = FIELDS.indexOf(field);
        const dir = e.key === "Tab" && e.shiftKey ? -1 : 1;
        const nextIdx = e.key === "Tab"
          ? Math.max(0, Math.min(FIELDS.length - 1, fieldIdx + dir))
          : Math.min(FIELDS.length - 1, fieldIdx + 1);
        if (nextIdx !== fieldIdx) {
          const nextField = FIELDS[nextIdx];
          startEdit(rowIndex, nextField, students[rowIndex][nextField] || "");
        }
      }
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const addRow = () => {
    const newRow = { student_id: "", name: "", year: yearTab !== "all" ? yearTab : "", gender: "", email: "" };
    setStudents((prev) => [...prev, newRow]);
    const idx = students.length;
    setTimeout(() => startEdit(idx, "student_id", ""), 50);
  };

  const deleteRow = async (rowIndex) => {
    const row = students[rowIndex];
    if (row.student_id && originalMap[row.student_id]) {
      const studentId = row.student_id;
      setConfirm({
        title: "Delete Student",
        message: `Delete ${studentId}? Removes all codes & applications. Cannot be undone.`,
        onConfirm: async () => {
          setConfirm(null);
          setDeleting(true);
          try {
            const res = await fetch(`${API_URL}/api/students/${studentId}?adminWallet=${wallet}`, { method: "DELETE" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Delete failed");
            success(`Deleted ${studentId}`);
          } catch (err) {
            showError(err.message || "Delete failed");
            setDeleting(false);
            return;
          }
          setDeleting(false);
          setStudents((prev) => prev.filter((_, i) => i !== rowIndex));
          if (editing && editing.rowIndex === rowIndex) cancelEdit();
        }
      });
      return;
    }
    setStudents((prev) => prev.filter((_, i) => i !== rowIndex));
    if (editing && editing.rowIndex === rowIndex) cancelEdit();
  };

  const handleSave = async () => {
    const dirty = students.filter((s, i) => isDirty(s, i) && !isRowEmpty(s));
    if (dirty.length === 0) {
      info("No changes to save");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/admin/students/batch-upsert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminWallet: wallet, students: dirty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      const errMsgs = data.errors?.length
        ? data.errors.map((e) => `${e.student_id || "?"}: ${e.reason}`).join("; ")
        : "";
      if (errMsgs) showError(errMsgs);
      let saveMsg = `Saved ${data.count} student(s)`;
      if (data.merkleTxHash) saveMsg += ` · Merkle root updated on-chain`;
      if (errMsgs) saveMsg += ` (${data.errors.length} errors)`;
      success(saveMsg);
      await loadStudents();
    } catch (err) {
      setError(err.message);
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    const valid = students.filter((s) => !isRowEmpty(s));
    if (valid.length === 0) {
      setError("No student records to process");
      return;
    }
    setGenerating(true);
    setError("");
    setGeneratedCodes([]);
    setGeneratedMeta(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/generate-codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminWallet: wallet, students: valid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setGeneratedCodes(data.codes || []);
      setGeneratedMeta({ generated: data.generated || [], reused: data.reused || [], skipped: data.skipped || [] });
      const parts = [];
      if (data.generated?.length) parts.push(`${data.generated.length} new`);
      if (data.reused?.length) parts.push(`${data.reused.length} reused`);
      if (data.skipped?.length) parts.push(`${data.skipped.length} skipped`);
      success(`Codes: ${parts.join(", ") || "none"}`);
      await loadStudents();
    } catch (err) {
      setError(err.message);
      showError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleRebuildMerkle = async () => {
    if (!wallet) return;
    setConfirm({
      title: "Rebuild Merkle Root",
      message: "Sync voter whitelist on-chain? Rebuilds Merkle roots. Costs gas.",
      onConfirm: async () => {
        setConfirm(null);
        setRebuildingMerkle(true);
        try {
          const res = await fetch(`${API_URL}/api/voters/rebuild-merkle?adminWallet=${wallet}`, { method: "POST" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Rebuild failed");
          success(`Merkle roots updated on-chain`, { txHash: data.txHash, duration: 8000 });
        } catch (err) {
          showError(err.message || "Rebuild failed");
        } finally {
          setRebuildingMerkle(false);
        }
      }
    });
  };

  const handleDownloadExcel = () => {
    const rows = students
      .filter((s) => !isRowEmpty(s))
      .map((s) => ({
        student_id: s.student_id,
        name: s.name || "",
        year: s.year || "",
        gender: s.gender || "",
        email: s.email || "",
      }));
    if (rows.length === 0) {
      showError("No students to export");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    const label = yearTab === "all" ? "all-years" : yearTab;
    XLSX.writeFile(wb, `students_${label}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    info("Excel download started");
  };

  const downloadCodeCSV = () => {
    if (generatedCodes.length === 0) return;
    const header = "student_id,code";
    const lines = generatedCodes.map((r) => `${r.student_id},${r.code}`);
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
  };

  const renderCell = (row, field, rowIndex) => {
    const isEditing = editing && editing.rowIndex === rowIndex && editing.field === field;
    const value = row[field] || "";

    if (isEditing) {
      if (field === "year") {
        return (
          <select
            ref={inputRef}
            defaultValue={value}
            onChange={(e) => commitEdit(e.target.value)}
            onBlur={(e) => commitEdit(e.target.value)}
            onKeyDown={handleCellKeyDown}
            className="w-full bg-app-input border border-app-accent rounded px-2 py-1 text-sm text-app-heading outline-none"
          >
            <option value="">—</option>
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        );
      }
      if (field === "gender") {
        return (
          <select
            ref={inputRef}
            defaultValue={value}
            onChange={(e) => commitEdit(e.target.value)}
            onBlur={(e) => commitEdit(e.target.value)}
            onKeyDown={handleCellKeyDown}
            className="w-full bg-app-input border border-app-accent rounded px-2 py-1 text-sm text-app-heading outline-none"
          >
            <option value="">—</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        );
      }
      return (
        <input
          ref={inputRef}
          type="text"
          defaultValue={value}
          onBlur={(e) => commitEdit(e.target.value)}
          onKeyDown={handleCellKeyDown}
          className="w-full bg-app-input border border-app-accent rounded px-2 py-1 text-sm text-app-heading outline-none"
        />
      );
    }

    if (field === "student_id") {
      const locked = isExisting(row);
      return (
        <span className={`font-mono font-bold flex items-center gap-1 ${locked ? "text-app-heading" : "text-emerald-400"}`}>
          {locked ? (
            <svg className="w-3 h-3 text-app-muted-text shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          ) : (
            <span className="text-emerald-400 font-bold">+ </span>
          )}
          {value || "—"}
        </span>
      );
    }

    return (
      <span className={value ? "text-app-body" : "text-app-muted-text/50 italic"}>
        {value || "—"}
      </span>
    );
  };

  const totalCount = students.filter((s) => !isRowEmpty(s)).length;
  const dirtyCount = students.filter((s, i) => isDirty(s, i) && !isRowEmpty(s)).length;

  const q = searchQuery.toLowerCase().trim();
  const displayStudents = q
    ? students.filter((s) =>
        (s.student_id?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q))
      )
    : students;

  return (
    <div className="rounded-xl border border-app bg-app-surface overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-app bg-app-muted/20">
        <h3 className="text-base font-bold text-app-heading">Student Spreadsheet</h3>
        <p className="text-sm text-app-muted-text mt-1">
          Edit student data directly in the table. Changes are tracked until saved.
        </p>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {/* Year filter tabs + search */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setYearTab("all")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${yearTab === "all" ? "text-app-accent bg-app-accent-soft" : "text-app-muted-text hover:text-app-heading bg-app-muted/20 hover:bg-app-elevated"}`}
          >
            All Years
          </button>
          {YEARS.map((y) => (
            <button
              key={y}
              onClick={() => setYearTab(y)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${yearTab === y ? "text-app-accent bg-app-accent-soft" : "text-app-muted-text hover:text-app-heading bg-app-muted/20 hover:bg-app-elevated"}`}
            >
              {y}
            </button>
          ))}
          <div className="flex-1" />
          <div className="relative w-full sm:w-64">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-app-muted-text" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              placeholder="Search by ID or name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-app-border bg-app-input text-sm text-app-heading placeholder:text-app-muted-text/50 focus:outline-none focus:border-emerald-500/50 transition-all"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm font-medium text-rose-400">{error}</p>
        )}

        {/* Spreadsheet table */}
        <div className="rounded-xl border border-app overflow-hidden">
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-app-elevated border-b border-app sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider text-app-muted-text w-28">Student ID</th>
                  <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider text-app-muted-text">Name</th>
                  <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider text-app-muted-text w-20">Year</th>
                  <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider text-app-muted-text w-24">Gender</th>
                  <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider text-app-muted-text">Email</th>
                  <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider text-app-muted-text w-20">Status</th>
                  <th className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wider text-app-muted-text w-12">Del</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app/40">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-12 text-center text-sm text-app-muted-text">
                      <span className="h-4 w-4 border-2 border-app-muted-text border-t-app-heading rounded-full animate-spin inline-block mr-2" />
                      Loading students…
                    </td>
                  </tr>
                ) :                   displayStudents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-12 text-center text-sm text-app-muted-text">
                      {q ? `No students match "${q}".` : 'No students found. Click "Add Row" to get started.'}
                    </td>
                  </tr>
                ) : (
                  displayStudents.map((row, rowIndex) => (
                    <tr
                      key={row.student_id || `new-${rowIndex}`}
                      className={`hover:bg-app-accent-soft/30 transition-colors ${isDirty(row, rowIndex) ? "bg-amber-500/5" : ""} ${isRowEmpty(row) ? "opacity-50" : ""}`}
                    >
                      {FIELDS.map((field) => (
                        <td
                          key={field}
                          onClick={() => canEditField(row, field) && startEdit(rowIndex, field, row[field] || "")}
                          className={`px-3 py-2.5 ${canEditField(row, field) ? "cursor-pointer hover:bg-app-accent-soft/40" : "cursor-default"} ${field === "student_id" ? "font-mono" : ""}`}
                        >
                          {renderCell(row, field, rowIndex)}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-center">
                        {row.eligibleToVote ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                            Whitelisted
                          </span>
                        ) : row.registered ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-500/10 border border-amber-500/20 text-amber-400">
                            Registered
                          </span>
                        ) : (
                          <span className="text-[10px] text-app-muted-text">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => deleteRow(rowIndex)}
                          disabled={deleting}
                          className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all cursor-pointer disabled:opacity-30"
                          title="Delete student"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add row + stats */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={addRow}
              className="rounded-lg border border-app bg-app-input px-4 py-2 text-sm font-medium text-app-heading hover:bg-app-elevated transition-all cursor-pointer flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Row
            </button>
            <span className="text-xs text-app-muted-text">
              {totalCount} student(s)
              {dirtyCount > 0 && <span className="text-amber-400 font-medium ml-1">· {dirtyCount} unsaved</span>}
            </span>
          </div>

          <button
            onClick={loadStudents}
            disabled={loading}
            className="rounded-lg border border-app bg-app-input px-3 py-2 text-xs font-medium text-app-muted-text hover:text-app-heading hover:bg-app-elevated transition-all cursor-pointer disabled:opacity-50"
          >
            {loading ? "Loading…" : "↻ Reload"}
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-app">
          <button
            onClick={handleSave}
            disabled={saving || !hasDirtyRows || !wallet}
            className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-5 py-2.5 text-sm font-bold text-sky-400 hover:bg-sky-500/20 transition-all disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
          >
            {saving ? (
              <>
                <span className="h-4 w-4 border-2 border-sky-400/30 border-t-sky-400 rounded-full animate-spin inline-block" />
                Saving…
              </>
            ) : (
              <>💾 Save Changes {dirtyCount > 0 && `(${dirtyCount})`}</>
            )}
          </button>

          <button
            onClick={handleGenerate}
            disabled={generating || totalCount === 0 || !wallet}
            className="btn-primary disabled:opacity-40 flex items-center gap-1.5"
          >
            {generating ? (
              <>
                <span className="h-4 w-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin inline-block" />
                Generating…
              </>
            ) : (
              <>🔑 Generate Codes</>
            )}
          </button>

          <button
            onClick={handleDownloadExcel}
            disabled={totalCount === 0}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-5 py-2.5 text-sm font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download Excel
          </button>

        </div>

        {/* Sync whitelist */}
        <div className="flex flex-col sm:flex-row items-start gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-sky-400">Sync Voter Whitelist</p>
            <p className="text-xs text-app-muted-text mt-0.5">Push updated wallets on-chain so students can vote</p>
          </div>
          <button
            onClick={handleRebuildMerkle}
            disabled={rebuildingMerkle || !wallet}
            className="shrink-0 rounded-xl bg-sky-500 px-5 py-3 text-sm font-black uppercase tracking-wider text-slate-950 hover:bg-sky-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-98"
          >
            {rebuildingMerkle ? "Syncing…" : "Sync"}
          </button>
        </div>

        {/* Generated codes result */}
        {generatedMeta && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-1">
            {generatedMeta.generated.length > 0 && (
              <p className="text-sm font-medium text-emerald-400">+ {generatedMeta.generated.length} new code(s) created</p>
            )}
            {generatedMeta.reused.length > 0 && (
              <p className="text-sm font-medium text-sky-400">↻ {generatedMeta.reused.length} code(s) reused from existing</p>
            )}
            {generatedMeta.skipped.length > 0 && generatedMeta.skipped.map((s, i) => (
              <p key={i} className="text-sm text-amber-400">⏭ {s.student_id} — {s.reason}</p>
            ))}
            {generatedCodes.length > 0 && (
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={downloadCodeCSV}
                  className="rounded-lg border border-app bg-app-input px-4 py-1.5 text-sm font-medium text-app-heading hover:bg-app-elevated transition-all cursor-pointer"
                >
                  📥 Download CSV
                </button>
              </div>
            )}
          </div>
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
