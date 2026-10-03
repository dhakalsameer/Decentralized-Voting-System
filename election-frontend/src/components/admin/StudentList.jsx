import { useEffect, useState, useCallback, useContext } from "react";
import * as XLSX from "xlsx";
import { API_URL } from "../../config";
import { AuthContext } from "../../context/AuthContextValue";
import { useToast } from "../ui/Toast";
import SectionHeader from "../ui/SectionHeader";
import StatCard from "../ui/StatCard";
import EmptyState from "../ui/EmptyState";
import DataTable from "../ui/DataTable";
import ConfirmModal from "../ui/ConfirmModal";

function StatusBadge({ eligibleToVote, registered }) {
  if (eligibleToVote) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Verified
      </span>
    );
  }
  if (registered) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider bg-amber-500/10 border border-amber-500/20 text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Registered
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider bg-app-elevated border border-app text-app-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-app-muted" />
      Awaiting Link
    </span>
  );
}

export default function StudentList() {
  const { wallet } = useContext(AuthContext);
  const { success, error: showError, info } = useToast();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("recent");
  const [yearFilter, setYearFilter] = useState("all");
  const [confirm, setConfirm] = useState(null);

  const handleLoadData = useCallback(async () => {
    if (!wallet) return;
    setFetching(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/admin/students?adminWallet=${wallet}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load students");
      setStudents(data.students || []);
    } catch (err) {
      console.error(err);
      showError("Failed to load students");
    } finally {
      setFetching(false);
    }
  }, [wallet, showError]);

  const handleDelete = async (studentId) => {
    if (!studentId) return;
    setConfirm({
      title: "Delete Student",
      message: `Delete ${studentId}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirm(null);
        setLoading(true);
        try {
          const res = await fetch(`${API_URL}/api/students/${studentId}?adminWallet=${wallet}`, { method: "DELETE" });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Delete failed");
          }
          setStudents((prev) => prev.filter((s) => s.student_id !== studentId));
          success(`Deleted student ${studentId}`);
        } catch (err) {
          showError(err.message || "Delete failed");
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleExportExcel = () => {
    const rows = sorted.map((s) => ({
      student_id: s.student_id,
      name: s.name || "",
      year: s.registration_year || s.year || "",
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
    const label = yearFilter === "all" ? "all-students" : `year-${yearFilter}`;
    XLSX.writeFile(wb, `students_${label}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    info("Excel download started");
  };

  const handleLoadAsCSV = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target.result;
      try {
        const rows = parseCSV(text);
        const csvStudents = rows
          .map((r) => ({
            student_id: String(r.student_id || "").trim().toUpperCase(),
            name: r.name ? String(r.name).trim() : null,
            year: r.year ? String(r.year).trim().toLowerCase() : null,
            gender: r.gender ? String(r.gender).trim().toLowerCase() : null,
          }))
          .filter((s) => s.student_id)
          .filter((s, i, arr) => arr.findIndex((x) => x.student_id === s.student_id) === i);

        if (csvStudents.length === 0) {
          showError("No valid student records found in CSV");
          return;
        }

        const res = await fetch(`${API_URL}/api/admin/generate-codes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adminWallet: wallet, students: csvStudents }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");

        success(`Created/updated ${data.count} student(s) from CSV. Registration codes generated.`);
        await handleLoadData();
      } catch (err) {
        showError(err.message || "CSV upload failed");
        console.error(err);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    fetch(`${API_URL}/api/auth/admin/students?adminWallet=${wallet}`)
      .then(async (res) => {
        if (cancelled) return;
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load students");
        setStudents(data.students || []);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          showError("Failed to load students");
        }
      });
    return () => { cancelled = true; };
  }, [wallet, showError]);

  const filtered = students.filter((s) => {
    if (yearFilter !== "all") {
      const syear = parseInt(s.registration_year || s.year || "0");
      if (syear !== parseInt(yearFilter)) return false;
    }
    const q = filter.trim().toUpperCase();
    if (!q) return true;
    return (s.student_id || "").toUpperCase().includes(q) || (s.name || "").toUpperCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "recent") {
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    }
    if (sort === "year") {
      const ay = parseInt((a.registration_year || a.year || "0"));
      const by = parseInt((b.registration_year || b.year || "0"));
      return by - ay;
    }
    if (sort === "name") {
      return (a.name || "").localeCompare(b.name || "");
    }
    return (a.student_id || "").localeCompare(b.student_id || "");
  });

  const verifiedCount = students.filter((s) => s.eligibleToVote).length;
  const total = students.length;

  return (
    <div className="space-y-6">
      <SectionHeader icon="🎓" title="Student Registry" />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Verified" value={verifiedCount} accent="emerald" />
        <StatCard label="Registered" value={students.filter((s) => s.registered && !s.eligibleToVote).length} accent="amber" />
      </div>

      {/* Year filter */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setYearFilter("all")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${yearFilter === "all" ? "text-app-accent bg-app-accent-soft" : "text-app-muted-text hover:text-app-heading bg-app-muted/20 hover:bg-app-elevated"}`}>All</button>
        <button onClick={() => setYearFilter("1")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${yearFilter === "1" ? "text-app-accent bg-app-accent-soft" : "text-app-muted-text hover:text-app-heading bg-app-muted/20 hover:bg-app-elevated"}`}>1st Year</button>
        <button onClick={() => setYearFilter("2")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${yearFilter === "2" ? "text-app-accent bg-app-accent-soft" : "text-app-muted-text hover:text-app-heading bg-app-muted/20 hover:bg-app-elevated"}`}>2nd Year</button>
        <button onClick={() => setYearFilter("3")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${yearFilter === "3" ? "text-app-accent bg-app-accent-soft" : "text-app-muted-text hover:text-app-heading bg-app-muted/20 hover:bg-app-elevated"}`}>3rd Year</button>
        <button onClick={() => setYearFilter("4")} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer ${yearFilter === "4" ? "text-app-accent bg-app-accent-soft" : "text-app-muted-text hover:text-app-heading bg-app-muted/20 hover:bg-app-elevated"}`}>4th Year</button>
      </div>

      {/* Filter + actions */}
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
            placeholder="Search by student ID or name…"
            className="input-field w-full pl-10 pr-4 py-2.5 text-sm"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-lg border border-app bg-app-input px-3 py-2.5 text-sm text-app-muted-text hover:text-app-heading cursor-pointer focus:outline-none"
        >
          <option value="recent">By Recent</option>
          <option value="year">By Year</option>
          <option value="name">By Name</option>
          <option value="id">By ID</option>
        </select>
        <button
          onClick={handleLoadData}
          disabled={fetching}
          className="rounded-lg border border-app bg-app-input px-4 py-2.5 text-sm font-medium text-app-muted-text hover:text-app-heading hover:bg-app-elevated transition-all cursor-pointer disabled:opacity-50"
        >
          {fetching ? "Refreshing…" : "Refresh"}
        </button>
        <button
          onClick={handleExportExcel}
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-all cursor-pointer"
        >
          Export Excel
        </button>
        <label className="rounded-lg bg-emerald-500 text-slate-950 px-4 py-2.5 text-sm font-bold cursor-pointer hover:bg-emerald-400 transition-all text-center">
          Upload CSV
          <input type="file" accept=".csv" onChange={handleLoadAsCSV} className="hidden" />
        </label>
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <EmptyState
          icon="🎓"
          message={students.length === 0 ? "No student records found. Upload a CSV to get started." : "No matching students."}
        />
      ) : (
        <DataTable
          keyExtractor={(s) => s.id || s.student_id}
          data={sorted}
          columns={[
            {
              key: "student_id",
              label: "Student ID",
              cellClassName: "font-mono text-emerald-400 font-bold",
              render: (s) => s.student_id,
            },
            {
              key: "name",
              label: "Name",
              cellClassName: "font-medium text-app-heading",
              render: (s) => s.name || "—",
            },
            {
              key: "year",
              label: "Year",
              render: (s) => s.registration_year || s.year || "—",
            },
            {
              key: "status",
              label: "Status",
              render: (s) => <StatusBadge eligibleToVote={s.eligibleToVote} registered={s.registered} />,
            },
            {
              key: "created_at",
              label: "Added",
              cellClassName: "font-mono text-sm",
              render: (s) => (s.created_at ? new Date(s.created_at).toLocaleDateString() : "—"),
            },
            {
              key: "actions",
              label: "",
              align: "right",
              render: (s) => (
                <button
                  onClick={() => handleDelete(s.student_id)}
                  disabled={loading}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all cursor-pointer disabled:opacity-40"
                >
                  Delete
                </button>
              ),
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

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  let startIndex = 0;
  const firstCols = lines[0].split(",").map((c) => c.trim().toUpperCase());
  if (firstCols.includes("STUDENT_ID") || firstCols.includes("ID") || firstCols.includes("NAME")) {
    startIndex = 1;
  }

  return lines.slice(startIndex).map((row) => {
    const cols = row.split(",").map((c) => c.trim());
    return {
      student_id: cols[0] || "",
      name: cols[1] || "",
      year: cols[2] || "",
      gender: cols[3] || "",
    };
  });
}
