import { useState, useRef } from "react";
import * as XLSX from "xlsx";

const COLUMN_ALIASES = {
  student_id: ["student_id", "studentid", "id", "voter_id", "voterid", "voter", "roll_no", "rollno", "roll number", "enrollment", "enrollment_no"],
  name: ["name", "full_name", "fullname", "student_name", "studentname", "display_name"],
  year: ["year", "academic_year", "academicyear", "level", "class", "grade", "batch"],
  gender: ["gender", "sex"],
  email: ["email", "e_mail", "mail", "email_address"],
};

function findColumn(headers, aliases) {
  const lower = headers.map((h) => String(h).trim().toLowerCase().replace(/[^a-z0-9_]/g, ""));
  for (const alias of aliases) {
    const idx = lower.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseFile(buffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rows.length < 2) return [];

  const headers = rows[0];
  const colIdx = {
    student_id: findColumn(headers, COLUMN_ALIASES.student_id),
    name: findColumn(headers, COLUMN_ALIASES.name),
    year: findColumn(headers, COLUMN_ALIASES.year),
    gender: findColumn(headers, COLUMN_ALIASES.gender),
    email: findColumn(headers, COLUMN_ALIASES.email),
  };

  if (colIdx.student_id === -1) return [];

  const students = [];
  const seen = new Set();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => String(c).trim() === "")) continue;

    const student_id = String(row[colIdx.student_id] ?? "").trim();
    if (!student_id || seen.has(student_id.toUpperCase())) continue;
    seen.add(student_id.toUpperCase());

    students.push({
      student_id,
      name: colIdx.name !== -1 ? String(row[colIdx.name] ?? "").trim() : "",
      year: colIdx.year !== -1 ? String(row[colIdx.year] ?? "").trim() : "",
      gender: colIdx.gender !== -1 ? String(row[colIdx.gender] ?? "").trim() : "",
      email: colIdx.email !== -1 ? String(row[colIdx.email] ?? "").trim() : "",
    });
  }

  return students;
}

export default function CodesUploader({ wallet, generatedCodes, generatedCount, generatedMeta, merkleRoot, onUpload, onDownloadCSV, onSendEmail, sendingEmail }) {
  const [file, setFile] = useState(null);
  const [previewStudents, setPreviewStudents] = useState([]);
  const [previewError, setPreviewError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileSelect = (selectedFile) => {
    setFile(selectedFile);
    setPreviewError("");
    setPreviewStudents([]);

    if (!selectedFile) return;

    const ext = selectedFile.name.toLowerCase();
    if (!ext.endsWith(".xlsx") && !ext.endsWith(".xls") && !ext.endsWith(".csv")) {
      setPreviewError("Unsupported file type. Upload .xlsx, .xls, or .csv");
      setFile(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const students = parseFile(e.target.result);
        if (students.length === 0) {
          setPreviewError("No valid student records found. Make sure the file has a header row with a student ID column.");
          return;
        }
        setPreviewStudents(students);
      } catch (err) {
        setPreviewError("Failed to parse file: " + err.message);
      }
    };
    reader.onerror = () => {
      setPreviewError("Failed to read file");
    };
    reader.readAsArrayBuffer(selectedFile);
  };

  const handleUpload = async () => {
    if (!file || previewStudents.length === 0) {
      setPreviewError("No valid students to upload");
      return;
    }

    setUploading(true);
    await onUpload(file, () => {
      setFile(null);
      setPreviewStudents([]);
    });
    setUploading(false);
  };

  return (
    <div className="rounded-xl border border-app bg-app-surface overflow-hidden">
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-app bg-app-muted/20">
        <h3 className="text-base font-bold text-app-heading">Upload Student File</h3>
        <p className="text-sm text-app-muted-text mt-1 break-words">
          Upload an Excel (.xlsx, .xls) or CSV file exported from the registrar. The system detects columns automatically.
        </p>
      </div>
      <div className="p-4 sm:p-6 space-y-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files[0]); }}
          onClick={() => fileInputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 sm:p-10 cursor-pointer transition-all ${
            dragOver
              ? "border-app-accent bg-app-accent-soft/20"
              : file
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-app bg-app-muted/20 hover:border-app-muted-text"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => handleFileSelect(e.target.files[0])}
            className="hidden"
          />
          {file ? (
            <>
              <span className="text-3xl mb-3">📄</span>
              <p className="text-base font-semibold text-app-heading break-all text-center">{file.name}</p>
              <p className="text-sm text-app-muted-text mt-1">
                {(file.size / 1024).toFixed(1)} KB · {previewStudents.length} student(s) detected
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); setPreviewStudents([]); setPreviewError(""); fileInputRef.current.value = ""; }}
                className="mt-3 px-3 py-2 text-sm text-rose-400 hover:text-rose-300 font-medium transition-colors cursor-pointer rounded-lg hover:bg-rose-500/10"
              >
                Remove file
              </button>
            </>
          ) : (
            <>
              <span className="text-3xl mb-3">📂</span>
              <p className="text-base font-semibold text-app-heading">
                Drop your file here, or click to browse
              </p>
              <p className="text-sm text-app-muted-text mt-1">
                Supports .xlsx, .xls, and .csv files
              </p>
            </>
          )}
        </div>

        {previewError && (
          <p className="text-sm font-medium text-rose-400">{previewError}</p>
        )}

        {previewStudents.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-app-heading mb-2">
              Preview ({previewStudents.length} student(s) parsed)
            </h4>
            <div className="rounded-xl border border-app overflow-hidden">
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full min-w-[400px] text-sm">
                  <thead className="bg-app-elevated border-b border-app sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-app-muted-text">Student ID</th>
                      <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-app-muted-text">Name</th>
                      <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-app-muted-text">Year</th>
                      <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-app-muted-text">Gender</th>
                      <th className="px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-app-muted-text">Email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-app/40">
                    {previewStudents.slice(0, 10).map((s, i) => (
                      <tr key={i} className="hover:bg-app-accent-soft transition-colors">
                        <td className="px-4 py-2.5 font-mono text-app-heading">{s.student_id}</td>
                        <td className="px-4 py-2.5 text-app-body">{s.name || "\u2014"}</td>
                        <td className="px-4 py-2.5 text-app-body">{s.year || "\u2014"}</td>
                        <td className="px-4 py-2.5 text-app-body">{s.gender || "\u2014"}</td>
                        <td className="px-4 py-2.5 text-sm text-app-muted-text">{s.email || "\u2014"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewStudents.length > 10 && (
                <p className="px-4 py-2 text-xs text-app-muted-text border-t border-app bg-app-muted/10">
                  Showing 10 of {previewStudents.length} student(s). Upload to process all.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleUpload}
            disabled={!file || previewStudents.length === 0 || uploading || !wallet}
            className="btn-primary disabled:opacity-40"
          >
            {uploading ? (
              <>
                <span className="h-4 w-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin inline-block" />
                Uploading & Generating…
              </>
            ) : (
              <>Upload & Generate Codes</>
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
