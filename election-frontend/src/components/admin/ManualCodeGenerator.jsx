import { useState, useRef } from "react";

function parseStudents(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    return {
      student_id: cols[0]?.toUpperCase() || "",
      name: cols[1] || "",
      year: cols[2] || "",
      gender: cols[3] || "",
      email: cols[4] || "",
    };
  }).filter((s) => s.student_id);
}

export default function ManualCodeGenerator({ wallet, loading, generatedCodes, generatedCount, generatedMeta, merkleRoot, onGenerate, onDownloadCSV, onSendEmail, sendingEmail }) {
  const [studentIdsText, setStudentIdsText] = useState("");
  const [error, setError] = useState("");
  const textareaRef = useRef(null);

  const handleGenerate = () => {
    const students = parseStudents(studentIdsText);
    if (students.length === 0) {
      setError("Enter at least one valid student record");
      return;
    }
    setError("");
    onGenerate(students, () => setStudentIdsText(""));
  };

  return (
    <div className="rounded-xl border border-app bg-app-surface overflow-hidden">
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-app bg-app-muted/20">
        <h3 className="text-base font-bold text-app-heading">Generate New Codes</h3>
        <p className="text-sm text-app-muted-text mt-1 break-words">
          Paste comma-separated student records below. Each student gets a unique one-time registration code.
        </p>
      </div>
      <div className="p-4 sm:p-6 space-y-4">
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-app-heading mb-2">
            Student Records
            <span className="text-xs font-mono text-app-muted-text font-normal">(ID, Name, Year, Gender, Email — one per line)</span>
          </label>
          <textarea
            ref={textareaRef}
            value={studentIdsText}
            onChange={(e) => setStudentIdsText(e.target.value)}
            rows={4}
            placeholder="GU001,John Doe,1st,male,john@example.com"
            disabled={loading}
            className="input-field w-full px-4 py-3 text-sm font-mono disabled:opacity-50"
          />
          {error && <p className="mt-2 text-sm font-medium text-rose-400">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleGenerate}
            disabled={loading || !wallet}
            className="btn-primary disabled:opacity-40"
          >
            {loading ? (
              <>
                <span className="h-4 w-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin inline-block" />
                Generating…
              </>
            ) : (
              <>Generate Codes</>
            )}
          </button>

          {generatedCodes.length > 0 && (
            <>
              <button
                onClick={() => onDownloadCSV(generatedCodes)}
                className="rounded-xl border border-app bg-app-input px-5 py-2.5 text-sm font-bold text-app-heading hover:bg-app-elevated transition-all cursor-pointer"
              >
                📥 Download CSV ({generatedCount})
              </button>
              <button
                onClick={() => onSendEmail(generatedCodes.map(c => c.student_id))}
                disabled={sendingEmail}
                className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-5 py-2.5 text-sm font-bold text-sky-400 hover:bg-sky-500/20 transition-all disabled:opacity-50 cursor-pointer"
              >
                {sendingEmail ? "Sending…" : "📧 Send via Email"}
              </button>
            </>
          )}
        </div>

        {generatedMeta && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-1">
            {generatedMeta.generated.length > 0 && (
              <p className="text-sm font-medium text-emerald-400">+ {generatedMeta.generated.length} new code(s) created</p>
            )}
            {generatedMeta.reused.length > 0 && (
              <p className="text-sm font-medium text-sky-400">↻ {generatedMeta.reused.length} code(s) reused from existing</p>
            )}
            {generatedMeta.skipped.length > 0 && generatedMeta.skipped.map((s, i) => (
              <p key={i} className="text-sm text-amber-400">
                ⏭ {s.student_id} — {s.reason}
              </p>
            ))}
            {merkleRoot && (
              <div className="mt-2 pt-2 border-t border-emerald-500/10">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-400/70 mb-1">Registration Code Merkle Root (On-Chain)</p>
                <p className="text-xs font-mono text-emerald-300 break-all">{merkleRoot}</p>
                <p className="text-xs text-app-muted-text mt-1">
                  Codes are committed to this root before voting opens. At redemption the contract
                  checks the student's Merkle proof against it, so a code issued later cannot be
                  redeemed.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
