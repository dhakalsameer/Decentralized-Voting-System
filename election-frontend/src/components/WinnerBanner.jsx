import { useState, useEffect, useContext } from "react";
import { AuthContext } from "../context/AuthContextValue";
import { useTheme } from "../context/ThemeContext";
import { API_URL } from "../config";

function getImageUrl(cid) {
  if (!cid) return null;
  if (cid.startsWith("local:")) return `${API_URL}/uploads/${cid.slice(6)}`;
  if (cid.startsWith("http")) return cid;
  return `https://ipfs.io/ipfs/${cid}`;
}

function fmtYear(y) {
  if (!y) return "";
  const n = parseInt(y, 10);
  if (Number.isFinite(n)) return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"} Year`;
  return y;
}

const WINNER_EMOJIS = ["🏆", "🌟", "💫", "✨", "🎊", "🎉", "⭐", "💎", "🔥", "🎯"];

export default function WinnerBanner() {
  const { wallet } = useContext(AuthContext);
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [electionOver, setElectionOver] = useState(false);
  const [myWins, setMyWins] = useState([]);

  const myWallet = wallet?.toLowerCase();

  useEffect(() => {
    if (!myWallet) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/api/contract/phase`);
        const phaseData = await res.json();
        if (cancelled) return;

        const over = phaseData.phase === 3 || phaseData.phase === 0;
        setElectionOver(over);

        if (!over) {
          setMyWins([]);
          setLoading(false);
          return;
        }

        const winnerRes = await fetch(`${API_URL}/api/results/my-wins?wallet=${myWallet}`);
        if (cancelled) return;
        if (!winnerRes.ok) { setLoading(false); return; }
        const data = await winnerRes.json();
        setMyWins(data.wins || []);
      } catch (err) {
        console.error("Winner check failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    check();
    const interval = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [myWallet]);

  if (loading || !electionOver || myWins.length === 0) return null;

  const bg = isDark ? "#000" : "#fffbeb";
  const bgGlow1 = isDark
    ? "radial-gradient(ellipse 80% 50% at 50% -20%,rgba(255,200,50,0.12),transparent)"
    : "radial-gradient(ellipse 80% 50% at 50% -20%,rgba(251,191,36,0.08),transparent)";
  const bgGlow2 = isDark
    ? "radial-gradient(ellipse 60% 40% at 50% 120%,rgba(255,150,50,0.08),transparent)"
    : "radial-gradient(ellipse 60% 40% at 50% 120%,rgba(217,119,6,0.05),transparent)";
  const shineOpacity = isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.08)";
  const shineMid = isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.15)";
  const cardBg = isDark ? "from-amber-400/8 to-transparent" : "from-amber-50/80 to-white/50";
  const headingGrad = isDark
    ? "from-amber-200 via-yellow-100 to-amber-200"
    : "from-amber-600 via-yellow-700 to-amber-600";
  const borderClr = isDark ? "border-amber-400/15" : "border-amber-300/50";
  const trophyShadow = isDark
    ? "drop-shadow-[0_0_20px_rgba(255,200,0,0.6)]"
    : "drop-shadow-[0_0_20px_rgba(217,119,6,0.3)]";
  const mutedText = isDark ? "#d4a017" : "#92400e";
  const labelText = isDark ? "#a78b5a" : "#92400e";
  const bodyText = isDark ? "#fcd34d" : "#78350f";
  const nameText = isDark ? "#fff" : "#451a03";
  const genderF = isDark ? "text-pink-300 bg-pink-400/12" : "text-pink-700 bg-pink-100";
  const genderM = isDark ? "text-sky-300 bg-sky-400/12" : "text-sky-700 bg-sky-100";
  const ringClr = isDark ? "ring-white/15" : "ring-amber-300/30";
  const cardBgInner = isDark ? "bg-amber-400/6" : "bg-white/70";
  const voteBg = isDark ? "rgba(251,191,36,0.1)" : "rgba(255,255,255,0.7)";

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-amber-400/20 p-2 shadow-2xl"
      style={{ background: bg }}
    >
      <div className="absolute inset-0 pointer-events-none" style={{ background: bgGlow1 }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: bgGlow2 }} />

      {/* Animated floating emojis */}
      {WINNER_EMOJIS.map((emoji, i) => (
        <span
          key={i}
          className="absolute select-none pointer-events-none animate-pulse"
          style={{
            top: `${10 + Math.sin(i * 1.2) * 40 + 20}%`,
            left: `${(i / WINNER_EMOJIS.length) * 90 + 5}%`,
            fontSize: `${0.8 + (i % 3) * 0.4}rem`,
            opacity: isDark ? 0.15 + (i % 4) * 0.08 : 0.25 + (i % 4) * 0.12,
            animationDelay: `${i * 0.3}s`,
            animationDuration: `${2 + (i % 3)}s`,
          }}
        >
          {emoji}
        </span>
      ))}

      {/* Shine sweep */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(105deg,transparent_30%,${shineOpacity}_45%,${shineMid}_50%,${shineOpacity}_55%,transparent_70%)`,
        }}
      />

      <div className={`relative z-10 rounded-xl border ${borderClr} bg-gradient-to-b ${cardBg} p-4 sm:p-6 backdrop-blur-[2px]`}>
        {/* Trophy */}
        <div className="flex flex-col items-center mb-4">
          <span className={`text-6xl sm:text-8xl mb-2 ${trophyShadow}`}>🏆</span>
          <h3 className={`text-2xl sm:text-4xl font-black leading-tight text-transparent bg-clip-text bg-gradient-to-r ${headingGrad}`}>
            Congratulations!
          </h3>
          <p className="text-sm sm:text-base font-semibold mt-0.5" style={{color: bodyText}}>You won the election</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl mx-auto">
          {myWins.map((w, i) => {
            const imgSrc = getImageUrl(w.photo || w.image_cid);
            const isFemale = w.gender === "female";
            const posKey = w.position === "President" ? "prez" : w.position === "Secretary" ? "sec" : "gm";
            const borderColors = {
              prez: "border-yellow-400/30",
              sec: "border-sky-400/30",
              gm: "border-emerald-400/30",
            };
            const badgeColors = {
              prez: isDark ? "bg-yellow-500/15 text-yellow-300" : "bg-yellow-100 text-yellow-800",
              sec: isDark ? "bg-sky-500/15 text-sky-300" : "bg-sky-100 text-sky-800",
              gm: isDark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-800",
            };
            const glowColors = {
              prez: isDark ? "rgba(255,200,0,0.25)" : "rgba(255,200,0,0.35)",
              sec: isDark ? "rgba(100,200,255,0.2)" : "rgba(100,200,255,0.3)",
              gm: isDark ? "rgba(50,255,150,0.2)" : "rgba(50,200,100,0.3)",
            };
            const posEmoji = w.position === "President" ? "🏛️" : w.position === "Secretary" ? "📜" : "👥";
            return (
              <div
                key={i}
                className={`relative overflow-hidden rounded-xl border ${borderColors[posKey]} ${cardBgInner} p-4 shadow-[0_4px_20px_rgba(0,0,0,0.25)] backdrop-blur-sm transition-transform hover:scale-[1.02] duration-300`}
              >
                <div className="absolute -top-6 -right-6 text-4xl opacity-8 select-none pointer-events-none">{posEmoji}</div>
                <div className="flex flex-col items-center gap-2.5">
                  {/* Avatar */}
                  <div className="relative">
                    <div className={`absolute inset-0 rounded-full bg-amber-400/15 blur-[6px]`} />
                    {imgSrc ? (
                      <div className={`relative h-16 w-16 sm:h-18 sm:w-18 rounded-full overflow-hidden ring-3 ${ringClr} shadow-[0_0_20px_var(--glow)]`} style={{"--glow": glowColors[posKey]}}>
                        <img src={imgSrc} alt="" className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <div className={`relative h-16 w-16 sm:h-18 sm:w-18 rounded-full bg-amber-400/10 ring-3 ${ringClr} flex items-center justify-center shadow-[0_0_20px_var(--glow)]`} style={{"--glow": glowColors[posKey]}}>
                        <span className="text-xl">{posEmoji}</span>
                      </div>
                    )}
                  </div>

                  {/* Position + Name */}
                  <div className="text-center">
                    <div className={`text-[9px] font-black uppercase tracking-[0.15em] px-2.5 py-0.5 rounded-full inline-block ${badgeColors[posKey]} mb-1`}>
                      {w.position}
                    </div>
                    <p className="text-base sm:text-lg font-black leading-tight drop-shadow-sm" style={{color: nameText}}>{w.name}</p>
                  </div>

                  {/* Meta row */}
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {w.year && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-400/10" style={{color: bodyText}}>{fmtYear(w.year)}</span>
                    )}
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${isFemale ? genderF : genderM}`}>{w.gender}</span>
                  </div>

                  {/* Votes pill */}
                  <div className="flex items-center gap-1 backdrop-blur-sm rounded-full px-3 py-1 border border-amber-400/10" style={{background: voteBg}}>
                    <span className={`text-lg sm:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r ${isDark ? "from-yellow-200 to-amber-200" : "from-amber-700 to-amber-600"}`}>
                      {Number(w.vote_count)}
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{color: labelText}}>votes</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom flourish */}
        <div className="mt-4 text-center">
          <p className="text-[10px] font-medium italic" style={{color: mutedText}}>Decentralized &middot; Transparent &middot; Verifiable</p>
        </div>
      </div>
    </div>
  );
}
