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
    <>
      <style>{`
        @keyframes trophy-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes glow-pulse {
          0%, 100% { box-shadow: 0 0 8px rgba(251,191,36,0.2); }
          50% { box-shadow: 0 0 25px rgba(251,191,36,0.4); }
        }
        @keyframes shimmer-slide {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes card-fade-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .winner-banner-glow { animation: glow-pulse 3s ease-in-out infinite; }
        .winner-banner-trophy { animation: trophy-bob 2.5s ease-in-out infinite; }
        .winner-banner-shimmer {
          background-size: 200% auto;
          animation: shimmer-slide 4s linear infinite;
        }
        .winner-banner-card {
          animation: card-fade-in 0.6s ease-out both;
        }
      `}</style>
      <div
        className="relative overflow-hidden rounded-2xl border border-amber-400/20 p-2 shadow-2xl winner-banner-glow"
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
            <span className={`text-6xl sm:text-8xl mb-2 ${trophyShadow} winner-banner-trophy`}>🏆</span>
            <h3 className={`text-2xl sm:text-4xl font-black leading-tight text-transparent bg-clip-text bg-gradient-to-r ${headingGrad} winner-banner-shimmer`}>
              Congratulations!
            </h3>
            <p className="text-sm sm:text-base font-semibold mt-0.5" style={{color: bodyText}}>You won the election</p>
          </div>

          <div className="flex flex-col gap-2 max-w-xl mx-auto">
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
              const posEmoji = w.position === "President" ? "🏛️" : w.position === "Secretary" ? "📜" : "👥";
              return (
                <div
                  key={i}
                  className={`relative rounded-xl border ${borderColors[posKey]} ${cardBgInner} p-3 sm:p-4 shadow-[0_4px_20px_rgba(0,0,0,0.25)] transition-transform hover:scale-[1.02] duration-300 winner-banner-card`}
                  style={{ animationDelay: `${i * 0.15}s` }}
                >
                  <div className="flex items-center gap-3 sm:gap-4">
                    {/* Avatar */}
                    <div className="shrink-0">
                      {imgSrc ? (
                        <div className={`h-12 w-12 sm:h-14 sm:w-14 rounded-full overflow-hidden ring-2 ${ringClr}`}>
                          <img src={imgSrc} alt="" className="h-full w-full object-cover" />
                        </div>
                      ) : (
                        <div className={`h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-amber-400/10 ring-2 ${ringClr} flex items-center justify-center`}>
                          <span className="text-lg sm:text-xl">{posEmoji}</span>
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs sm:text-sm font-black uppercase tracking-[0.15em] px-2.5 py-0.5 rounded-full ${badgeColors[posKey]}`}>
                          {w.position}
                        </span>
                        <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider ${isFemale ? genderF : genderM}`}>{w.gender}</span>
                      </div>
                      <p className="text-base sm:text-xl font-black leading-tight truncate drop-shadow-sm mt-0.5" style={{color: nameText}}>{w.name}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        {w.year && (
                          <span className="text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full" style={{background: isDark ? "rgba(251,191,36,0.1)" : "rgba(251,191,36,0.2)", color: bodyText}}>{fmtYear(w.year)}</span>
                        )}
                        <div className="flex items-center gap-1.5 rounded-full px-3 py-1 border border-amber-400/15" style={{background: voteBg}}>
                          <span className={`text-lg sm:text-xl font-black leading-none ${isDark ? "text-yellow-200" : "text-amber-700"}`}>
                            {Number(w.vote_count)}
                          </span>
                          <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider leading-none" style={{color: labelText}}>votes</span>
                        </div>
                      </div>
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
    </>
  );
}
