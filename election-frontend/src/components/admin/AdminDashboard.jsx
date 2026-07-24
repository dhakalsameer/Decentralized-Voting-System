import { useState, useContext, useRef, useEffect, useCallback } from "react";
import ElectionControl from "./ElectionControl";
import VerifyVoter from "./VerifyVoter";
import GenerateCodes from "./GenerateCodes";
import GasDistribution from "./GasDistribution";

import { AuthContext } from "../../context/AuthContextValue";
import { useBalance } from "../../hooks/useBalance";
import { socket } from "../../socket";
import { useToast } from "../ui/Toast";
import { API_URL } from "../../config";

const ETH_ICON = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L4 12.5l8 3.5 8-3.5L12 2z" opacity="0.6" />
    <path d="M12 16.5l-8-3.5L12 22l8-9-8 3.5z" />
  </svg>
);

const ADMIN_TABS = [
  { id: "controls", label: "Controls", icon: "⚙️" },
  { id: "voters", label: "Voters", icon: "👥" },
  { id: "gas", label: "Funds", icon: ETH_ICON },
];

export default function AdminDashboard() {
  const [tab, setTab] = useState("controls");
  const [mainStuck, setMainStuck] = useState(false);
  const mainSentinelRef = useRef(null);
  const { wallet } = useContext(AuthContext);
  const { balance } = useBalance(wallet);
  const toast = useToast();
  const [syncStatus, setSyncStatus] = useState({});

  const checkSync = useCallback(async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`${API_URL}/api/voters/merkle-sync-status?adminWallet=${wallet}`);
      if (!res.ok) return;
      setSyncStatus(await res.json());
    } catch {}
  }, [wallet]);

  useEffect(() => {
    const handler = (data) => {
      if (data?.type === "voters") {
        toast.info("Voter whitelist changed — Merkle trees rebuilt");
        checkSync();
      } else if (data?.type === "registrationCodes") {
        toast.info("Registration codes updated — Merkle root synced on-chain");
      }
    };
    socket.on("dataChanged", handler);
    return () => socket.off("dataChanged", handler);
  }, [toast, checkSync]);

  useEffect(() => {
    checkSync();
    const id = setInterval(checkSync, 30000);
    return () => clearInterval(id);
  }, [checkSync]);

  useEffect(() => {
    const el = mainSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setMainStuck(!entry.isIntersecting),
      { rootMargin: "-80px 0px 0px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="space-y-6">
      {/* header card */}
      <div className="rounded-xl border border-app bg-app-surface">
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-app">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <span className="flex h-10 w-10 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-lg bg-app-accent-soft text-lg sm:text-xl">🛡️</span>
              <div className="min-w-0">
                <h2 className="text-base sm:text-2xl font-bold text-app-heading">Admin Dashboard</h2>
                <p className="text-[10px] sm:text-base text-app-muted-text mt-0.5">Manage election phases, voters, and funds</p>
              </div>
            </div>
            {balance && (
              <div className="flex items-center gap-1.5 sm:gap-2 rounded-lg border border-app-border bg-app-muted/30 px-2.5 sm:px-5 py-1 sm:py-2.5 shrink-0">
                <svg className="h-3.5 w-3.5 sm:h-5 sm:w-5 shrink-0 text-app-heading" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L4 12.5l8 3.5 8-3.5L12 2z" opacity="0.6" />
                  <path d="M12 16.5l-8-3.5L12 22l8-9-8 3.5z" />
                </svg>
                <span className="text-[11px] sm:text-lg font-mono font-semibold text-app-heading whitespace-nowrap">{Number(balance).toFixed(4)} ETH</span>
              </div>
            )}
          </div>
        </div>

        {balance !== null && Number(balance) < 0.05 && (
          <div className="mx-4 sm:mx-6 mt-3 sm:mt-4 px-3 sm:px-4 py-2 sm:py-3 rounded-lg border border-rose-500/20 bg-rose-500/5">
            <p className="text-xs sm:text-base text-rose-400 font-medium">Low balance — {Number(balance).toFixed(4)} ETH</p>
          </div>
        )}

        {syncStatus.needsSync === true && (
          <div className="mx-4 sm:mx-6 mt-3 sm:mt-4 px-3 sm:px-4 py-2 sm:py-3 rounded-lg border border-amber-500/30 bg-amber-500/10">
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="text-lg sm:text-xl shrink-0">⚠️</span>
              <div className="min-w-0">
                <p className="text-xs sm:text-base font-bold text-amber-400">Merkle roots out of sync</p>
                <p className="text-[10px] sm:text-sm text-amber-300/70 mt-0.5">
                  {syncStatus.eligibleCount ?? "?"} eligible voters in DB — on-chain root is stale.
                  Go to <button onClick={() => setTab("controls")} className="underline font-semibold hover:text-amber-200 cursor-pointer">Controls</button> and click "Sync Voter Whitelist".
                </p>
              </div>
            </div>
          </div>
        )}

        <div ref={mainSentinelRef} className="h-px" />
        <div className={`flex gap-1 sm:gap-2 pt-3 sm:pt-5 pb-2 sm:pb-3 overflow-x-auto sticky top-20 z-30 transition-all duration-200 ${mainStuck ? "bg-app-surface/80 backdrop-blur-sm shadow-sm" : "bg-transparent"} -mx-4 sm:-mx-6 px-4 sm:px-6`}>
          {ADMIN_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1 sm:gap-2 px-2.5 sm:px-6 py-1.5 sm:py-3 rounded-lg text-xs sm:text-lg font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                tab === t.id
                  ? "text-app-accent bg-app-accent-soft shadow-sm"
                  : "text-app-muted-text hover:text-app-heading hover:bg-app-muted/30"
              }`}
            >
              {typeof t.icon === "string" ? <span className="text-sm sm:text-xl">{t.icon}</span> : <span className="flex items-center justify-center w-4 h-4 sm:w-6 sm:h-6 text-app-accent">{t.icon}</span>}
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-4 sm:px-6 py-4 sm:py-6">
          {tab === "controls" && <ElectionControl />}
          {tab === "voters" && (
            <VoterSection />
          )}
          {tab === "gas" && <GasDistribution />}
        </div>
      </div>
    </div>
  );
}

function VoterSection() {
  const [subTab, setSubTab] = useState("verify");
  const [subStuck, setSubStuck] = useState(false);
  const subSentinelRef = useRef(null);

  useEffect(() => {
    const el = subSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setSubStuck(!entry.isIntersecting),
      { rootMargin: "-160px 0px 0px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const subTabs = [
    { id: "verify", label: "Verify Voters", icon: "✓" },
    { id: "codes", label: "Registration Codes", icon: "🔑" },
  ];

  return (
    <div>
      <div ref={subSentinelRef} className="h-px" />
      <div className={`flex gap-1.5 sm:gap-3 mb-4 sm:mb-6 pb-3 sm:pb-5 border-b border-app overflow-x-auto sticky top-[10rem] z-20 transition-all duration-200 ${subStuck ? "bg-app-background/80 backdrop-blur-sm" : "bg-transparent"} -mx-4 sm:-mx-6 px-4 sm:px-6`}>
        {subTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-1.5 sm:py-2.5 rounded-lg text-xs sm:text-base font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              subTab === t.id
                ? "text-app-accent bg-app-accent-soft shadow-sm"
                : "text-app-muted-text hover:text-app-heading hover:bg-app-muted/30"
            }`}
          >
            <span className="text-sm sm:text-lg">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "verify" && <VerifyVoter />}
      {subTab === "codes" && <GenerateCodes />}
    </div>
  );
}
