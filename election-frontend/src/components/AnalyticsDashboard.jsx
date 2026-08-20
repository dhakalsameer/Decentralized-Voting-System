import { useState, useEffect, useMemo, useRef } from "react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from "recharts";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { API_URL } from "../config";
import { useToast } from "./ui/Toast";
import { LiveResults } from "./Results";
import { getImageUrl as _ipfsGetImageUrl } from "../utils/ipfs";

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#0ea5e9"];

const MAX_VISIBLE = 8;

export default function AnalyticsDashboard() {
  const { error: showError, info } = useToast();
  const reportRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [data, setData] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [selectedElection, setSelectedElection] = useState("live");
  const [showAllAnalytics, setShowAllAnalytics] = useState(false);
  const [tabPage, setTabPage] = useState(0);

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_URL}/api/results`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const results = await res.json();
      setData(Array.isArray(results) ? results : []);
      setDataError(null);
    } catch (err) {
      setDataError(err.message);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_URL}/api/results/history`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const d = await res.json();
      if (Array.isArray(d)) setHistory(d);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err.message);
    }
  };

  useEffect(() => {
    Promise.all([fetchData(), fetchHistory()]).finally(() => setLoading(false));
    const interval = setInterval(fetchData, 30000);
    const histInterval = setInterval(fetchHistory, 60000);
    return () => { clearInterval(interval); clearInterval(histInterval); };
  }, []);

  const tabs = useMemo(() => {
    const t = [{ key: "live", label: "Live" }];
    for (const h of history) {
      t.push({ key: String(h.election_number), label: `Election ${h.election_number}`, data: h });
    }
    return t;
  }, [history]);

  const currentTab = tabs.find(t => t.key === selectedElection);
  const isLive = selectedElection === "live";
  const TABS_PER_PAGE = 4;
  const tabPages = Math.max(1, Math.ceil((tabs.length - 1) / TABS_PER_PAGE));
  const tabStart = tabPage * TABS_PER_PAGE + 1;
  const visibleTabs = [tabs[0], ...tabs.slice(tabStart, tabStart + TABS_PER_PAGE)].filter(Boolean);

  const displayData = useMemo(() => {
    if (isLive) return data;
    return (currentTab?.data?.candidates || []).map((c, i) => ({ ...c, id: i }));
  }, [isLive, data, currentTab]);

  const sortedData = useMemo(() => {
    return [...displayData].sort((a, b) => Number(b.vote_count) - Number(a.vote_count));
  }, [displayData]);

  const visibleData = showAllAnalytics ? sortedData : sortedData.slice(0, MAX_VISIBLE);

  const totalVotes = displayData.reduce((acc, c) => acc + Number(c.vote_count), 0);
  const positions = [...new Set(displayData.map(c => c.position))].filter(Boolean);

  const winners = useMemo(() => {
    const pres = displayData
      .filter(c => c.position === "President")
      .sort((a, b) => Number(b.vote_count) - Number(a.vote_count));
    const sec = displayData
      .filter(c => c.position === "Secretary")
      .sort((a, b) => Number(b.vote_count) - Number(a.vote_count));
    const gms = displayData
      .filter(c => c.position === "General Member")
      .sort((a, b) => Number(b.vote_count) - Number(a.vote_count))
      .slice(0, 5);
    return {
      president: pres.length > 0 ? { ...pres[0], votes: Number(pres[0].vote_count) } : null,
      secretary: sec.length > 0 ? { ...sec[0], votes: Number(sec[0].vote_count) } : null,
      gmWinners: gms.map(g => ({ ...g, votes: Number(g.vote_count) })),
    };
  }, [displayData]);

  function getImageUrl(cid) {
    return _ipfsGetImageUrl(cid);
  }

  function fmtYear(y) {
    if (!y) return "";
    const n = parseInt(y, 10);
    if (Number.isFinite(n)) return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"} Year`;
    return y;
  }

  const electionDate = isLive
    ? new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : currentTab?.data?.snapshot_at
      ? new Date(currentTab.data.snapshot_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : null;

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

  function WinnersBanner() {
    const title = isLive ? "Current Leaders" : `Election ${currentTab?.data?.election_number} Winners`;
    const hasAny = winners.president || winners.secretary || winners.gmWinners.length > 0;
    if (!hasAny) return null;

    function Avatar({ src, name, gender, size }) {
      const s = size === "sm" ? "h-14 w-14" : "h-16 w-16";
      const initials = (name || "?").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
      return (
        <div className={`${s} rounded-full overflow-hidden border-2 border-app/30 shrink-0 bg-gradient-to-br from-[var(--app-trust-soft)] to-[var(--app-accent-soft)]`}>
          {src ? (
            <img src={src} alt="" className="h-full w-full object-cover"
              onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
            />
          ) : null}
          <div className={`${src ? "hidden" : "flex"} h-full w-full items-center justify-center text-xs font-bold text-app-muted-text`}>
            {initials}
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-app bg-app-surface">
        <div className="px-4 sm:px-5 py-3 border-b border-app flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-app-heading flex items-center gap-2">
            <span className="text-base">🏆</span> {title}
          </h3>
          {electionDate && (
            <span className="text-[10px] sm:text-[11px] font-mono text-app-muted-text">{electionDate}</span>
          )}
        </div>
        <div className="p-4 sm:p-5 space-y-4 sm:space-y-5">
          <div className="flex flex-col sm:grid sm:grid-cols-2 gap-3 sm:gap-4">
            {winners.president && (
              <div className="flex items-center gap-3 sm:gap-4 rounded-xl border border-[var(--app-trust-border)] bg-[var(--app-trust-soft)] px-4 sm:px-5 py-3 sm:py-4">
                <Avatar src={getImageUrl(winners.president.photo || winners.president.image_cid)} name={winners.president.name} gender={winners.president.gender} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[var(--app-trust)] mb-0.5 sm:mb-1">President</p>
                  <p className="text-sm sm:text-lg font-bold text-app-heading break-words">{winners.president.name}</p>
                  <div className="flex items-center gap-2 mt-1 sm:mt-1.5">
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
                      <p className="text-xl sm:text-2xl font-black text-[var(--app-trust)]">{winners.president.votes}</p>
                      <p className="text-[9px] sm:text-[10px] text-app-muted-text">votes</p>
                    </>
                  )}
                </div>
              </div>
            )}
            {winners.secretary && (
              <div className="flex items-center gap-3 sm:gap-4 rounded-xl border border-[var(--app-accent-border)] bg-[var(--app-accent-soft)] px-4 sm:px-5 py-3 sm:py-4">
                <Avatar src={getImageUrl(winners.secretary.photo || winners.secretary.image_cid)} name={winners.secretary.name} gender={winners.secretary.gender} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[var(--app-accent)] mb-0.5 sm:mb-1">Secretary</p>
                  <p className="text-sm sm:text-lg font-bold text-app-heading break-words">{winners.secretary.name}</p>
                  <div className="flex items-center gap-2 mt-1 sm:mt-1.5">
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
                      <p className="text-xl sm:text-2xl font-black text-[var(--app-accent)]">{winners.secretary.votes}</p>
                      <p className="text-[9px] sm:text-[10px] text-app-muted-text">votes</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {winners.gmWinners.length > 0 && (
            <div>
              <p className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[var(--app-ballot)] mb-2 sm:mb-3">General Members</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
                {winners.gmWinners.map((gm, i) => (
                  <div key={i} className="flex items-center gap-2 sm:gap-3 rounded-xl border border-[var(--app-ballot-border)] bg-[var(--app-ballot-soft)] px-3 sm:px-4 py-2.5 sm:py-3.5">
                    <span className="text-[10px] sm:text-xs font-mono font-bold text-[var(--app-ballot)] w-4 sm:w-5 shrink-0">#{i + 1}</span>
                    <Avatar src={getImageUrl(gm.photo || gm.image_cid)} name={gm.name} gender={gm.gender} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] sm:text-sm font-bold text-app-heading break-words leading-snug">{gm.name}</p>
                      <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] text-app-muted-text mt-0.5">
                        {gm.year && <span className="whitespace-nowrap">{fmtYear(gm.year)}</span>}
                        {gm.gender && (
                          <span className={`px-1 sm:px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                            gm.gender === "female" ? "text-pink-500 bg-pink-500/10" : "text-app-accent bg-app-accent/10"
                          }`}>{gm.gender}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm sm:text-base font-bold text-[var(--app-ballot)]">{isLive ? "—" : gm.votes}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading && !dataError) {
    return (
      <div className="glass-panel rounded-2xl border border-app p-8 text-center text-app-muted font-mono italic animate-pulse">
        Processing analytics engine...
      </div>
    );
  }

  if (dataError && data.length === 0) {
    return (
      <div className="glass-panel rounded-2xl border border-app/40 p-8 text-center">
        <p className="text-sm text-rose-400 mb-1">Could not load candidate data</p>
        <p className="text-xs text-app-muted-text mb-3">{dataError}</p>
        <button
          onClick={() => { setDataError(null); fetchData(); }}
          className="text-xs text-app-accent underline hover:text-app-accent/80 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="section-gap mt-0 lg:mt-0">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div>
          <h2 className="text-lg sm:text-2xl font-black text-app-heading uppercase tracking-wider">
            Election Intelligence
          </h2>
          <p className="text-app-body text-xs sm:text-sm mt-1">Real-time data visualization & audit reporting</p>
        </div>
        <button
          onClick={downloadPDF}
          disabled={downloading}
          className="btn-secondary shrink-0 self-start sm:self-auto text-xs sm:text-sm"
        >
          <span aria-hidden="true">{downloading ? "⏳" : "📥"}</span>
          {downloading ? "Generating PDF..." : "Download Audit Report"}
        </button>
      </div>

      {tabs.length > 1 && (
        <div className="flex items-center gap-1.5 mt-2 sm:mt-3 mb-3 sm:mb-4 overflow-x-auto pb-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setSelectedElection(tab.key); setShowAllAnalytics(false); setTabPage(0); }}
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
                onClick={() => setTabPage(p => Math.max(0, p - 1))}
                disabled={tabPage === 0}
                className="text-xs px-1.5 py-1 rounded border border-app text-app-muted-text disabled:opacity-30 hover:text-app-heading transition-all cursor-pointer disabled:cursor-not-allowed"
              >◀</button>
              <span className="text-[10px] font-mono text-app-muted-text px-1 min-w-[3ch] text-center">{tabPage + 1}/{tabPages}</span>
              <button
                onClick={() => setTabPage(p => Math.min(tabPages - 1, p + 1))}
                disabled={tabPage >= tabPages - 1}
                className="text-xs px-1.5 py-1 rounded border border-app text-app-muted-text disabled:opacity-30 hover:text-app-heading transition-all cursor-pointer disabled:cursor-not-allowed"
              >▶</button>
            </div>
          )}
        </div>
      )}

      <div ref={reportRef}>
      {isLive ? (
        <LiveResults />
      ) : (
      <div id="analytics-report" className="space-y-6 sm:space-y-8 p-3 sm:p-6 rounded-2xl sm:rounded-3xl bg-app-bg border border-app">
        <WinnersBanner />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-app">
             <p className="text-xs font-mono font-bold text-app-muted uppercase tracking-widest mb-1">Total Participation</p>
             <h4 className="text-2xl sm:text-3xl font-black text-app-trust text-glow-emerald">{totalVotes} <span className="text-xs font-normal text-app-muted tracking-normal font-sans">Votes Sealed</span></h4>
          </div>
          <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-app">
             <p className="text-xs font-mono font-bold text-app-muted uppercase tracking-widest mb-1">On-chain Audit Integrity</p>
             <h4 className="text-2xl sm:text-3xl font-black text-app-trust text-glow-emerald">100% <span className="text-xs font-normal text-app-muted tracking-normal font-sans">Verified</span></h4>
          </div>
          <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-app sm:col-span-2 lg:col-span-1">
             <p className="text-xs font-mono font-bold text-app-muted uppercase tracking-widest mb-1">Voter Protocol Whitelist</p>
             <h4 className="text-2xl sm:text-3xl font-black text-app-trust text-glow-emerald">Merkle <span className="text-xs font-normal text-app-muted tracking-normal font-sans">Proof</span></h4>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
          <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-app min-h-[320px] sm:min-h-[400px] flex flex-col">
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <h3 className="font-black text-sm text-app-heading uppercase tracking-widest">Candidate Performance Ranking</h3>
              {!showAllAnalytics && sortedData.length > MAX_VISIBLE && (
                <button onClick={() => setShowAllAnalytics(true)} className="text-[10px] font-semibold text-app-accent hover:text-app-accent/80 underline underline-offset-2 cursor-pointer whitespace-nowrap">
                  Show all ({sortedData.length})
                </button>
              )}
            </div>
            <div className="flex-1 min-h-[240px] sm:min-h-[300px]">
              {visibleData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minHeight={240}>
                  <BarChart data={visibleData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--app-border)" />
                    <XAxis 
                      dataKey="name" 
                      tick={{ fontSize: 11, fontWeight: 700, fill: "var(--app-muted-text)" }} 
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis 
                      tick={isLive ? false : { fontSize: 11, fontWeight: 700, fill: "var(--app-muted-text)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: "var(--app-elevated)", border: "1px solid var(--app-border)", borderRadius: "12px", color: "var(--app-text)", fontSize: "13px", fontFamily: "var(--font-mono)" }}
                      cursor={{ fill: "var(--app-trust)", opacity: 0.12 }}
                      {...(isLive ? { formatter: () => "—" } : {})}
                    />
                    <Bar dataKey="vote_count" fill="var(--app-trust)" radius={[4, 4, 0, 0]} barSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-app-muted-text italic text-sm">No data</div>
              )}
            </div>
          </div>

          <div className="glass-panel p-4 sm:p-6 rounded-2xl border border-app min-h-[320px] sm:min-h-[400px] flex flex-col">
            <h3 className="font-black text-sm text-app-heading mb-4 sm:mb-6 uppercase tracking-widest">Vote Distribution by position</h3>
            <div className="flex-1 min-h-[240px] sm:min-h-[300px]">
              {positions.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" minHeight={240}>
                  <PieChart>
                    <Pie
                      data={positions.map(pos => ({
                        name: pos,
                        value: displayData.filter(c => c.position === pos).reduce((a, b) => a + Number(b.vote_count), 0)
                      }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {positions.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "var(--app-elevated)", border: "1px solid var(--app-border)", borderRadius: "12px", color: "var(--app-text)", fontSize: "13px" }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--app-muted-text)' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-app-muted-text italic text-sm">No data</div>
              )}
            </div>
          </div>
        </div>

        {/* Analytics Table */}
        <div className="glass-panel rounded-2xl border border-app shadow-card">
          <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[500px]">
            <thead className="bg-app-elevated border-b border-app">
              <tr>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[10px] sm:text-xs font-mono font-bold text-app-muted uppercase tracking-widest whitespace-nowrap">Candidate</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[10px] sm:text-xs font-mono font-bold text-app-muted uppercase tracking-widest whitespace-nowrap">Position</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[10px] sm:text-xs font-mono font-bold text-app-muted uppercase tracking-widest whitespace-nowrap">{isLive ? "Rank" : "Votes"}</th>
                {!isLive && (
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[10px] sm:text-xs font-mono font-bold text-app-muted uppercase tracking-widest whitespace-nowrap">Ballot Share</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-app/40 bg-app-muted/30">
              {visibleData.length > 0 ? visibleData.map((c, idx) => (
                <tr key={c.id} className="hover:bg-app-trust-soft transition-colors">
                  <td className="px-4 sm:px-6 py-3 sm:py-4 min-w-0 font-bold text-app-heading text-xs sm:text-base whitespace-nowrap">{c.name}</td>
                  <td className="px-4 sm:px-6 py-3 sm:py-4 text-[10px] sm:text-xs font-mono font-bold text-app-trust uppercase tracking-wider whitespace-nowrap">{c.position}</td>
                  <td className="px-4 sm:px-6 py-3 sm:py-4 font-mono font-black text-app-heading text-xs sm:text-base whitespace-nowrap">{isLive ? `#${idx + 1}` : c.vote_count}</td>
                  {!isLive && (
                  <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2 sm:gap-3">
                       <div className="h-1.5 w-12 sm:w-16 bg-app-muted border border-app rounded-full overflow-hidden shrink-0">
                          <div 
                            className="h-full bg-gradient-to-r from-[var(--app-trust)] to-[var(--app-accent)]" 
                            style={{ width: `${(Number(c.vote_count) / totalVotes * 100) || 0}%` }}
                          ></div>
                       </div>
                       <span className="text-[10px] sm:text-xs font-mono font-bold text-app-muted">
                        {((Number(c.vote_count) / totalVotes * 100) || 0).toFixed(1)}%
                       </span>
                    </div>
                  </td>
                  )}
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-4 sm:px-6 py-8 text-center text-app-muted-text italic text-sm">No candidates available for this election</td>
                </tr>
              )}
            </tbody>
          </table>
          {!showAllAnalytics && sortedData.length > MAX_VISIBLE && (
            <div className="border-t border-app/40 px-4 sm:px-6 py-3">
              <button
                onClick={() => setShowAllAnalytics(true)}
                className="w-full text-center text-xs font-semibold text-app-accent hover:text-app-accent/80 underline underline-offset-2 cursor-pointer"
              >
                Show all {sortedData.length} candidates
              </button>
            </div>
          )}
          </div>
        </div>
      </div>
      )}
      </div>
    </div>
  );
}
