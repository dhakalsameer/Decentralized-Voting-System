import { useState, useEffect, useMemo, useRef } from "react";
import { API_URL } from "../config";
import { getContractV3 } from "../contract";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { useToast } from "./ui/Toast";
import { getImageUrl } from "../utils/ipfs";


const POSITIONS = ["President", "Secretary", "General Member"];

function fmtYear(y) {
  if (!y) return "";
  const n = parseInt(y, 10);
  if (Number.isFinite(n)) return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"} Year`;
  return y;
}

function Avatar({ src, name, size }) {
  const s = size === "sm" ? "h-14 w-14" : "h-16 w-16";
  const fs = size === "sm" ? "text-xs" : "text-sm";
  const initials = (name || "?").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className={`${s} rounded-full overflow-hidden border-2 border-app/30 shrink-0 bg-gradient-to-br from-[var(--app-trust-soft)] to-[var(--app-accent-soft)]`}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover"
          onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
        />
      ) : null}
      <div className={`${src ? "hidden" : "flex"} h-full w-full items-center justify-center ${fs} font-bold text-app-muted-text`}>
        {initials}
      </div>
    </div>
  );
}

const POSITION_LABELS = {
  0: "President",
  1: "Secretary",
  2: "General Member",
};

function getWinners(candidates) {
  const hasWinnerFlag = candidates.some(c => c.is_winner === true);
  if (hasWinnerFlag) {
    const winners = candidates.filter(c => c.is_winner === true);
    const pres = winners.filter(c => c.position === "President").sort((a, b) => Number(b.vote_count) - Number(a.vote_count));
    const sec = winners.filter(c => c.position === "Secretary").sort((a, b) => Number(b.vote_count) - Number(a.vote_count));
    const gms = winners.filter(c => c.position === "General Member").sort((a, b) => Number(b.vote_count) - Number(a.vote_count)).slice(0, 5);
    return { president: pres[0] || null, secretary: sec[0] || null, gmWinners: gms };
  }
  // Fallback: determine winners by vote count
  const pres = candidates.filter(c => c.position === "President").sort((a, b) => Number(b.vote_count) - Number(a.vote_count));
  const sec = candidates.filter(c => c.position === "Secretary").sort((a, b) => Number(b.vote_count) - Number(a.vote_count));
  const gms = candidates.filter(c => c.position === "General Member").sort((a, b) => Number(b.vote_count) - Number(a.vote_count)).slice(0, 5);
  return { president: pres[0] || null, secretary: sec[0] || null, gmWinners: gms };
}

function WinnersDeclaration({ candidates, isLive, electionNumber }) {
  const winners = useMemo(() => getWinners(candidates), [candidates]);
  const hasAny = winners.president || winners.secretary || winners.gmWinners.length > 0;
  if (!hasAny) return null;

  const presTotal = candidates.filter(c => c.position === "President").reduce((s, c) => s + Number(c.vote_count || 0), 0);
  const secTotal = candidates.filter(c => c.position === "Secretary").reduce((s, c) => s + Number(c.vote_count || 0), 0);
  const gmTotal = candidates.filter(c => c.position === "General Member").reduce((s, c) => s + Number(c.vote_count || 0), 0);

  const pShare = presTotal > 0 ? ((Number(winners.president?.vote_count || 0) / presTotal) * 100).toFixed(1) : null;
  const sShare = secTotal > 0 ? ((Number(winners.secretary?.vote_count || 0) / secTotal) * 100).toFixed(1) : null;

  const title = isLive ? "Current Leaders" : `Election ${electionNumber} Winners`;

  return (
    <div className="rounded-xl border border-[var(--app-trust-border)] bg-gradient-to-br from-[var(--app-trust-soft)] via-[var(--app-accent-soft)] to-[var(--app-ballot-soft)] p-4 sm:p-6 mb-6">
      <h3 className="text-sm sm:text-base font-bold uppercase tracking-wider text-app-heading mb-4 sm:mb-5 flex items-center gap-2">
        <span className="text-lg">🏆</span> {title}
      </h3>
      <div className="flex flex-col sm:grid sm:grid-cols-2 gap-3 sm:gap-4 mb-5">
        {winners.president && (
          <div className="flex items-center gap-3 sm:gap-4 rounded-xl border border-[var(--app-trust-border)] bg-[var(--app-trust-soft)] px-4 sm:px-5 py-3 sm:py-4">
            <Avatar src={getImageUrl(winners.president.image_cid || winners.president.photo)} name={winners.president.name} />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[var(--app-trust)] mb-0.5 sm:mb-1">President</p>
              <p className="text-base sm:text-lg font-bold text-app-heading break-words">{winners.president.name}</p>
              <div className="flex items-center gap-2 mt-1">
                {winners.president.year && <span className="text-[10px] sm:text-xs text-app-muted-text whitespace-nowrap">{fmtYear(winners.president.year)}</span>}
                {winners.president.gender && (
                  <span className={`text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 ${
                    winners.president.gender === "female" ? "text-pink-500 bg-pink-500/10" : "text-app-accent bg-app-accent/10"
                  }`}>{winners.president.gender}</span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              {isLive ? (
                <p className="text-xl sm:text-2xl font-black text-[var(--app-trust)]">—</p>
              ) : (
                <>
                  <p className="text-xl sm:text-2xl font-black text-[var(--app-trust)]">{Number(winners.president.vote_count)}</p>
                  {pShare && (
                    <p className="text-[9px] sm:text-[10px] font-bold text-[var(--app-trust)] bg-[var(--app-trust-soft)] px-1.5 py-0.5 rounded mt-0.5">{pShare}%</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
        {winners.secretary && (
          <div className="flex items-center gap-3 sm:gap-4 rounded-xl border border-[var(--app-accent-border)] bg-[var(--app-accent-soft)] px-4 sm:px-5 py-3 sm:py-4">
            <Avatar src={getImageUrl(winners.secretary.image_cid || winners.secretary.photo)} name={winners.secretary.name} />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[var(--app-accent)] mb-0.5 sm:mb-1">Secretary</p>
              <p className="text-base sm:text-lg font-bold text-app-heading break-words">{winners.secretary.name}</p>
              <div className="flex items-center gap-2 mt-1">
                {winners.secretary.year && <span className="text-[10px] sm:text-xs text-app-muted-text whitespace-nowrap">{fmtYear(winners.secretary.year)}</span>}
                {winners.secretary.gender && (
                  <span className={`text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 ${
                    winners.secretary.gender === "female" ? "text-pink-500 bg-pink-500/10" : "text-app-accent bg-app-accent/10"
                  }`}>{winners.secretary.gender}</span>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              {isLive ? (
                <p className="text-xl sm:text-2xl font-black text-[var(--app-accent)]">—</p>
              ) : (
                <>
                  <p className="text-xl sm:text-2xl font-black text-[var(--app-accent)]">{Number(winners.secretary.vote_count)}</p>
                  {sShare && (
                    <p className="text-[9px] sm:text-[10px] font-bold text-[var(--app-accent)] bg-[var(--app-accent-soft)] px-1.5 py-0.5 rounded mt-0.5">{sShare}%</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {winners.gmWinners.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--app-ballot)] mb-3">General Members</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
            {winners.gmWinners.map((gm, i) => {
              const gmShare = gmTotal > 0 ? ((Number(gm.vote_count || 0) / gmTotal) * 100).toFixed(1) : null;
              return (
                <div key={i} className="flex flex-col items-center gap-1.5 sm:gap-2 rounded-xl border border-[var(--app-ballot-border)] bg-[var(--app-ballot-soft)] px-3 sm:px-4 py-3 sm:py-4 text-center">
                  <Avatar src={getImageUrl(gm.image_cid || gm.photo)} name={gm.name} size="sm" />
                  <p className="text-[11px] sm:text-sm font-bold text-app-heading leading-snug break-words w-full">{gm.name}</p>
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    {gm.year && <span className="text-[10px] text-app-muted-text">{fmtYear(gm.year)}</span>}
                    {gm.gender && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                        gm.gender === "female" ? "text-pink-500 bg-pink-500/10" : "text-app-accent bg-app-accent/10"
                      }`}>{gm.gender}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs sm:text-sm font-mono font-bold text-[var(--app-ballot)]">{isLive ? "—" : Number(gm.vote_count)}</span>
                    {!isLive && gmShare && (
                      <span className="text-[9px] sm:text-[10px] font-bold text-[var(--app-ballot)] bg-[var(--app-ballot-soft)] px-1 py-0.5 rounded">{gmShare}%</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CandidateCard({ candidate, maxVotes }) {
  const pct = maxVotes > 0 ? ((candidate.vote_count ?? 0) / maxVotes) * 100 : 0;
  const imgSrc = getImageUrl(candidate.image_cid || candidate.photo);
  return (
    <div className="rounded-xl border border-app bg-app-surface transition-all hover:border-app-accent/30">
      <div className="hidden sm:block aspect-square bg-app-muted/20 flex items-center justify-center overflow-hidden rounded-t-xl">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={candidate.name}
            className="w-full h-full object-cover"
            onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
          />
        ) : null}
        <div className={`${imgSrc ? "hidden" : "flex"} w-full h-full items-center justify-center text-4xl text-app-muted-text`}>
          {candidate.gender === "female" ? "👩" : "🧑"}
        </div>
      </div>
      <div className="p-3 sm:p-4 space-y-1.5 sm:space-y-2">
        <p className="text-xs sm:text-base font-bold text-app-heading leading-tight truncate">{candidate.name}</p>
        <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-app-muted-text">
          {candidate.year && (
            <span className="font-medium">{candidate.year}</span>
          )}
          {candidate.gender && (
            <span className={`px-1.5 sm:px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
              candidate.gender === "female" ? "text-pink-500 bg-pink-500/10" : "text-app-accent bg-app-accent/10"
            }`}>
              {candidate.gender}
            </span>
          )}
        </div>
        <div className="pt-1 sm:pt-2">
          <div className="flex items-center gap-2">
            <span className="text-sm sm:text-xl font-black font-mono text-app-heading tabular-nums">{candidate.vote_count ?? 0}</span>
            <span className="text-[11px] sm:text-sm font-semibold text-app-muted-text bg-app-muted/20 px-1.5 py-0.5 rounded">
              {pct.toFixed(1)}%
            </span>
          </div>
          <div className="mt-1.5 sm:mt-2 h-1.5 sm:h-2 rounded-full bg-app-border/30 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--app-trust)] to-[var(--app-accent)] transition-all duration-1000 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PositionSection({ title, candidates, maxVotes }) {
  const colors = title === "President"
    ? "border-l-amber-500 bg-amber-500/[0.03]"
    : title === "Secretary"
      ? "border-l-sky-500 bg-sky-500/[0.03]"
      : "border-l-emerald-500 bg-emerald-500/[0.03]";

  const badgeColor = title === "President"
    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
    : title === "Secretary"
      ? "bg-app-accent/10 text-app-accent border-app-accent-border"
      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";

  return (
    <div className={`border-l-4 ${colors} rounded-r-xl p-3 sm:p-5 space-y-3 sm:space-y-4`}>
      <div className="flex items-center gap-2 sm:gap-3">
        <h4 className="text-sm sm:text-lg font-bold text-app-heading">{title}</h4>
        <span className={`text-[10px] sm:text-[11px] font-bold px-2 sm:px-2.5 py-0.5 rounded-full border whitespace-nowrap ${badgeColor}`}>
          {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
        </span>
      </div>
      {candidates.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-4">
          {candidates.map((c) => (
            <CandidateCard key={c.name + c.position} candidate={c} maxVotes={maxVotes} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-app-muted-text italic py-4 text-center">No candidates</p>
      )}
    </div>
  );
}

function Countdown({ votingEnd }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!votingEnd || votingEnd === 0) return setTimeLeft("");

    const tick = () => {
      const diff = votingEnd * 1000 - Date.now();
      if (diff <= 0) return setTimeLeft("Ended");
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (d > 0) return setTimeLeft(`${d}d ${h}h ${m}m ${s}s`);
      if (h > 0) return setTimeLeft(`${h}h ${m}m ${s}s`);
      if (m > 0) return setTimeLeft(`${m}m ${s}s`);
      setTimeLeft(`${s}s`);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [votingEnd]);

  if (!timeLeft) return null;

  return (
    <div className="flex items-center gap-2 text-sm text-app-muted-text">
      <span>⏱️</span>
      <span className="font-mono font-bold text-app-heading">{timeLeft}</span>
      <span>remaining</span>
    </div>
  );
}

export function LiveResults() {
  const [stats, setStats] = useState(null);
  const [prevVotes, setPrevVotes] = useState(0);
  const [animateId, setAnimateId] = useState(0);
  const [latestFinished, setLatestFinished] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [showAllPositions, setShowAllPositions] = useState(false);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_URL}/api/results/stats`);
        if (!res.ok) throw new Error(`Stats API returned ${res.status}`);
        const d = await res.json();
        if (d) {
          if (d.votesCast > prevVotes) setAnimateId((id) => id + 1);
          setPrevVotes(d.votesCast);
          setStats(d);
          setStatsError(null);
        }
      } catch (err) {
        setStatsError(err.message);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (stats?.phase !== 3) { setLatestFinished(null); return; }
    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/results/history`);
        if (!res.ok) throw new Error(`History API returned ${res.status}`);
        const d = await res.json();
        if (Array.isArray(d) && d.length > 0) setLatestFinished(d[0]);
      } catch (err) {
        console.error("Failed to load latest finished election:", err.message);
      }
    };
    load();
  }, [stats?.phase]);

  const isOver = stats?.phase === 3;

  if (!stats) {
    if (statsError) {
      return (
        <div className="py-8 text-center">
          <p className="text-sm text-rose-400">Could not load election data</p>
          <p className="text-xs text-app-muted-text mt-1">{statsError}</p>
          <button
            onClick={() => { setStatsError(null); setStats(null); }}
            className="mt-3 text-xs text-app-accent underline hover:text-app-accent/80 cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
    }
    return (
      <div className="py-8 text-center">
        <p className="text-base text-app-muted-text italic animate-pulse">Loading election dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {stats.phase === 0 ? (
            <span className="text-sm font-bold px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1.5">
              <span>📋</span> Registration Open
            </span>
          ) : stats.phase === 3 ? (
            <span className="text-sm font-bold px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1.5">
              <span>🏁</span> Voting Concluded
            </span>
          ) : (
            <span className="text-sm font-bold px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              Voting Live
            </span>
          )}
        </div>
        <Countdown votingEnd={stats.votingEnd} />
      </div>

      {/* Show latest election winners when over */}
      {isOver && latestFinished && (
        <WinnersDeclaration candidates={latestFinished.candidates} isLive={false} electionNumber={latestFinished.election_number} />
      )}

      {/* Main stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <div key={`votes-${animateId}`} className="rounded-xl border border-app bg-gradient-to-br from-emerald-500/5 to-emerald-500/10 p-3 sm:p-5 space-y-1 sm:space-y-2 transition-all duration-500">
          <div className="flex items-center justify-between">
            <span className="text-lg sm:text-2xl">🗳️</span>
            <span className="text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">{stats.turnout}%</span>
          </div>
          <p className="text-xl sm:text-3xl font-black text-app-heading tabular-nums">{stats.votesCast}</p>
          <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-app-muted-text">Votes Cast</p>
          <p className="text-[10px] sm:text-xs text-app-muted-text/60">ballots recorded on-chain</p>
        </div>

        <div className="rounded-xl border border-app bg-gradient-to-br from-sky-500/5 to-sky-500/10 p-3 sm:p-5 space-y-1 sm:space-y-2">
          <span className="text-lg sm:text-2xl">👥</span>
          <p className="text-xl sm:text-3xl font-black text-app-heading tabular-nums">{stats.totalVoters}</p>
          <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-app-muted-text">Total Voters</p>
          <p className="text-[10px] sm:text-xs text-app-muted-text/60">eligible to vote</p>
        </div>

        <div className="rounded-xl border border-app bg-gradient-to-br from-amber-500/5 to-amber-500/10 p-3 sm:p-5 space-y-1 sm:space-y-2">
          <span className="text-lg sm:text-2xl">⏳</span>
          <p className="text-xl sm:text-3xl font-black text-app-heading tabular-nums">{stats.remaining}</p>
          <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-app-muted-text">Remaining</p>
          <p className="text-[10px] sm:text-xs text-app-muted-text/60">yet to cast vote</p>
        </div>

        <div className="rounded-xl border border-app bg-gradient-to-br from-purple-500/5 to-purple-500/10 p-3 sm:p-5 space-y-1 sm:space-y-2">
          <span className="text-lg sm:text-2xl">🏆</span>
          <p className="text-xl sm:text-3xl font-black text-app-heading tabular-nums">{stats.candidateCount}</p>
          <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-app-muted-text">Candidates</p>
          <p className="text-[10px] sm:text-xs text-app-muted-text/60">across all positions</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="rounded-xl border border-app bg-app-surface p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-app-muted-text">Voter Turnout</h4>
          <span className="text-sm font-bold text-app-heading tabular-nums">{stats.turnout}%</span>
        </div>
        <div className="h-4 rounded-full bg-app-border/30 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-300 transition-all duration-1000 ease-out relative"
            style={{ width: `${Math.min(stats.turnout, 100)}%` }}
          >
            <div className="absolute inset-0 bg-white/10 animate-pulse rounded-full" />
          </div>
        </div>
        <div className="flex justify-between text-xs text-app-muted-text">
          <span className="font-medium">{stats.votesCast} voted</span>
          <span className="font-medium">{stats.remaining} remaining</span>
        </div>
      </div>

      {/* Position breakdown */}
      {stats.positions?.length > 0 && (
        <div className="rounded-xl border border-app bg-app-surface p-5 space-y-4">
          <button
            onClick={() => setShowAllPositions(!showAllPositions)}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-app-muted-text hover:text-app-heading transition-colors cursor-pointer w-full text-left"
          >
            <span className="text-base">{showAllPositions ? "▾" : "▸"}</span>
            By Position
          </button>
          {showAllPositions && (
          <div className="space-y-3">
            {stats.positions.map((pos) => {
              const maxVotes = pos.position === "General Member" ? stats.totalVoters * 5 : stats.totalVoters;
              const posVoteShare = maxVotes > 0 ? ((pos.votes / maxVotes) * 100).toFixed(1) : 0;
              let barClass = "h-full rounded-full transition-all duration-700 bg-gradient-to-r from-app-accent to-app-accent/70";
              if (pos.position === "President") barClass = "h-full rounded-full transition-all duration-700 bg-gradient-to-r from-amber-500 to-amber-400";
              if (pos.position === "Secretary") barClass = "h-full rounded-full transition-all duration-700 bg-gradient-to-r from-sky-500 to-sky-400";
              if (pos.position === "General Member") barClass = "h-full rounded-full transition-all duration-700 bg-gradient-to-r from-emerald-500 to-emerald-400";
              return (
                <div key={pos.position} className="flex items-center gap-4">
                  <div className="w-28 shrink-0">
                    <p className="text-sm font-semibold text-app-heading truncate">{pos.position}</p>
                    <p className="text-[10px] text-app-muted-text">{pos.candidates} candidate{pos.candidates !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-mono font-bold text-app-heading">{pos.votes} votes</span>
                      <span className="text-app-muted-text">{posVoteShare}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-app-border/30 overflow-hidden">
                      <div
                        className={barClass}
                        style={{ width: `${Math.min(posVoteShare, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </div>
      )}

      {/* Live indicator */}
      {!isOver && (
        <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400" />
            </span>
            <p className="text-sm text-app-muted-text">
              Results are being tallied in real-time.{" "}
              <span className="text-emerald-400 font-medium">Every vote is verified on-chain.</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryResults({ election }) {
  const candidates = election.candidates || [];
  const maxVotes = Math.max(...candidates.map((c) => Number(c.vote_count ?? 0)), 1);
  const totalVotes = candidates.reduce((acc, c) => acc + Number(c.vote_count ?? 0), 0);

  const grouped = useMemo(() => {
    const g = {};
    for (const c of candidates) {
      const pos = c.position || "Unknown";
      if (!g[pos]) g[pos] = [];
      g[pos].push(c);
    }
    return g;
  }, [candidates]);

  return (
    <div className="space-y-6">
      <WinnersDeclaration candidates={candidates} isLive={false} electionNumber={election.election_number} />
      <div className="flex items-baseline justify-between gap-4 px-1">
        <span className="text-xl font-semibold text-app-heading">
          {new Date(election.snapshot_at).toLocaleDateString(undefined, {
            year: "numeric", month: "short", day: "numeric",
          })}
        </span>
        <span className="text-lg font-bold font-mono text-app-muted-text">{totalVotes} votes</span>
      </div>
      {candidates.length > 0 ? (
        <div className="space-y-8">
          {POSITIONS.map((pos) =>
            grouped[pos] ? (
              <PositionSection key={pos} title={pos} candidates={grouped[pos]} maxVotes={maxVotes} />
            ) : null
          )}
          {Object.keys(grouped)
            .filter((pos) => !POSITIONS.includes(pos))
            .map((pos) => (
              <PositionSection key={pos} title={pos} candidates={grouped[pos]} maxVotes={maxVotes} />
            ))}
        </div>
      ) : (
        <p className="text-sm text-app-muted-text italic py-4 text-center">No data</p>
      )}
    </div>
  );
}

export default function Results() {
  const { info, error: showError } = useToast();
  const reportRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [history, setHistory] = useState([]);
  const [selectedElection, setSelectedElection] = useState("live");

  useEffect(() => {
    const loadHistoryFromContract = async () => {
      try {
        const contract = await getContractV3();
        const hc = Number(await contract.historyCount());
        if (hc === 0) return;
        const items = [];
        for (let i = 0; i < hc; i++) {
          const r = await contract.getElectionResult(i);
          const candidates = [];

          // Map each ID to its known position from the contract result structure.
          // Do NOT use getCandidate().position — the candidates mapping is
          // overwritten by later elections, so positions for reused IDs are wrong.
          const knownPositions = new Map();
          const pid = Number(r.presidentWinnerId);
          if (pid > 0) knownPositions.set(pid, "President");
          const sid = Number(r.secretaryWinnerId);
          if (sid > 0) knownPositions.set(sid, "Secretary");
          for (const gid of r.generalMemberWinnerIds.map(Number)) {
            if (gid > 0 && !knownPositions.has(gid)) knownPositions.set(gid, "General Member");
          }

          const seen = new Set();
          for (const [id, knownPos] of knownPositions) {
            if (seen.has(id)) continue;
            seen.add(id);
            try {
              const c = await contract.getHistoricalCandidate(i + 1, id);
              if (c.exists) {
                candidates.push({
                  name: c.name, position: knownPos,
                  vote_count: Number(c.voteCount), year: String(c.year),
                  gender: c.isFemale ? "female" : "male",
                  photo: getImageUrl(c.imageCID),
                  is_winner: true,
                });
              }
            } catch {}
          }
          items.push({
            election_number: i + 1,
            snapshot_at: new Date(Number(r.timestamp) * 1000).toISOString(),
            candidates,
          });
        }
        if (items.length > 0) setHistory(prev => prev.length === 0 ? items : prev);
      } catch (err) {
        console.error("Contract fallback failed:", err);
      }
    };

    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API_URL}/api/results/history`);
        if (!res.ok) throw new Error(`History API returned ${res.status}`);
        const d = await res.json();
        if (Array.isArray(d) && d.length > 0) { setHistory(d); return; }
      } catch (err) {
        console.error("Failed to fetch history from API, trying contract fallback:", err.message);
      }
      await loadHistoryFromContract();
    };
    fetchHistory();
  }, []);

  const downloadPDF = async () => {
    if (downloading) return;
    const el = reportRef.current;
    if (!el) {
      info("Report content not available yet");
      return;
    }
    setDownloading(true);
    const isMobile = window.innerWidth < 768;

    if (isMobile) {
      window.print();
      setDownloading(false);
      return;
    }

    try {
      const canvas = await html2canvas(el, {
        backgroundColor: "#ffffff",
        scale: 1,
        logging: false,
        useCORS: true,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfW = 210;
      const pdfH = (canvas.height * pdfW) / canvas.width;
      let heightLeft = pdfH;
      let position = 0;
      const pageH = 297;
      if (heightLeft <= pageH) {
        pdf.addImage(imgData, "PNG", 0, 0, pdfW, pdfH);
      } else {
        const pageW = pdfW;
        const sliceH = (pageH * canvas.width) / pdfW;
        let srcY = 0;
        while (heightLeft > 0) {
          const sliceCanvas = document.createElement("canvas");
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = Math.min(sliceH, canvas.height - srcY);
          const ctx = sliceCanvas.getContext("2d");
          ctx.drawImage(canvas, 0, srcY, canvas.width, sliceCanvas.height, 0, 0, canvas.width, sliceCanvas.height);
          const sliceData = sliceCanvas.toDataURL("image/png");
          if (position > 0) pdf.addPage();
          pdf.addImage(sliceData, "PNG", 0, 0, pageW, (sliceCanvas.height * pageW) / canvas.width);
          srcY += sliceH;
          heightLeft -= (sliceCanvas.height * pageW) / canvas.width;
          position++;
        }
      }
      pdf.save(`audit-report-${new Date().toISOString().slice(0, 10)}.pdf`);
      info("PDF audit report downloaded");
    } catch (err) {
      console.error("PDF generation failed:", err);
      window.print();
    } finally {
      setDownloading(false);
    }
  };

  const tabs = useMemo(() => {
    const t = [{ key: "live", label: "Live" }];
    for (const h of history) {
      t.push({ key: String(h.election_number), label: `Election ${h.election_number}`, data: h });
    }
    return t;
  }, [history]);

  const currentElection = tabs.find((t) => t.key === selectedElection);
  const TABS_PER_PAGE = 4;
  // The visible tab window is derived from selectedElection (single source of
  // truth): the highlighted tab is always on screen, and the ◀ ▶ arrows move
  // BOTH the selection and the window together.
  const selectedIdx = Math.max(0, tabs.findIndex((t) => t.key === selectedElection));
  const tabPages = Math.max(1, Math.ceil((tabs.length - 1) / TABS_PER_PAGE));
  const tabPage = Math.min(tabPages - 1, Math.max(0, Math.floor((selectedIdx - 1) / TABS_PER_PAGE)));
  const tabStart = tabPage * TABS_PER_PAGE + 1;
  const visibleTabs = [tabs[0], ...tabs.slice(tabStart, tabStart + TABS_PER_PAGE)].filter(Boolean);

  const stepTabSelection = (dir) => {
    const next = tabs[Math.min(tabs.length - 1, Math.max(0, selectedIdx + dir))];
    if (next && next.key !== selectedElection) setSelectedElection(next.key);
  };

  return (
    <div className="rounded-xl border border-app bg-app-surface">
      <div className="px-4 sm:px-6 py-3 border-b border-app">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--app-accent)] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--app-accent)]" />
            </span>
            <h2 className="text-sm sm:text-base font-semibold text-app-heading">Results</h2>
          </div>
          <button
            onClick={downloadPDF}
            disabled={downloading}
            className="hidden sm:inline-flex btn-secondary shrink-0 text-xs sm:text-sm"
          >
            <span aria-hidden="true">{downloading ? "⏳" : "📥"}</span>
            {downloading ? "Generating PDF..." : "Download Audit Report"}
          </button>
        </div>

        {tabs.length > 1 && (
          <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSelectedElection(tab.key)}
                className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedElection === tab.key
                    ? "bg-[var(--app-accent-soft)] text-[var(--app-accent)] border-[var(--app-accent-border)]"
                    : "bg-app-surface text-app-muted-text border-app hover:border-app-accent/30 hover:text-app-heading"
                }`}
              >
                {tab.label}
              </button>
            ))}
            {tabPages > 1 && (
              <div className="flex items-center gap-0.5 ml-auto shrink-0">
                <button
                  onClick={() => stepTabSelection(-1)}
                  disabled={selectedIdx === 0}
                  className="text-xs px-1.5 py-1 rounded border border-app text-app-muted-text disabled:opacity-30 hover:text-app-heading transition-all cursor-pointer disabled:cursor-not-allowed"
                >◀</button>
                <span className="text-[10px] font-mono text-app-muted-text px-1 min-w-[3ch] text-center">{tabPage + 1}/{tabPages}</span>
                <button
                  onClick={() => stepTabSelection(1)}
                  disabled={selectedIdx >= tabs.length - 1}
                  className="text-xs px-1.5 py-1 rounded border border-app text-app-muted-text disabled:opacity-30 hover:text-app-heading transition-all cursor-pointer disabled:cursor-not-allowed"
                >▶</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div ref={reportRef}>
      <div className="p-3 sm:p-4 md:p-6">
        {selectedElection === "live" ? (
          <LiveResults />
        ) : currentElection?.data ? (
          <HistoryResults election={currentElection.data} />
        ) : (
          <div className="py-8 text-center">
            <p className="text-base text-app-muted-text italic">Election data not available</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
