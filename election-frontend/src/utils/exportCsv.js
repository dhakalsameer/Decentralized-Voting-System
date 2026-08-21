function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers, rows) {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

function triggerDownload(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const CANDIDATE_HEADERS = ["Position", "Candidate", "Votes", "Vote Share %", "Year", "Gender"];

function candidateRows(candidates) {
  const totals = {};
  for (const c of candidates) {
    const pos = c.position || "Unknown";
    totals[pos] = (totals[pos] || 0) + Number(c.vote_count ?? 0);
  }
  return candidates.map((c) => {
    const pos = c.position || "Unknown";
    const total = totals[pos] || 0;
    const share = total > 0 ? ((Number(c.vote_count ?? 0) / total) * 100).toFixed(1) : "0.0";
    return [pos, c.name ?? "", Number(c.vote_count ?? 0), share, c.year ?? "", c.gender ?? ""];
  });
}

export function exportElectionResultsCsv(election) {
  if (!election) return;
  const rows = candidateRows(election.candidates || []);
  const csv = toCsv(CANDIDATE_HEADERS, rows);
  triggerDownload(`election-${election.election_number}-results.csv`, csv);
}

export async function exportLiveResultsCsv(apiUrl) {
  const res = await fetch(`${apiUrl}/api/results/stats`);
  if (!res.ok) throw new Error(`Stats API returned ${res.status}`);
  const stats = await res.json();
  const positions = stats?.positions ?? [];
  const rows = positions.map((p) => {
    const maxVotes = p.position === "General Member" ? Number(stats.totalVoters || 0) * 5 : Number(stats.totalVoters || 0);
    const share = maxVotes > 0 ? ((Number(p.votes || 0) / maxVotes) * 100).toFixed(1) : "0.0";
    return [p.position, `${p.candidates} candidates`, p.votes, share, "", ""];
  });
  const summary = [
    ["Votes Cast", stats.votesCast ?? ""],
    ["Total Voters", stats.totalVoters ?? ""],
    ["Turnout %", stats.turnout ?? ""],
    ["Candidates", stats.candidateCount ?? ""],
  ];
  const csv = [
    toCsv(["Metric", "Value"], summary),
    "",
    toCsv(CANDIDATE_HEADERS, rows),
  ].join("\r\n");
  triggerDownload(`live-results-${new Date().toISOString().slice(0, 10)}.csv`, csv);
}
