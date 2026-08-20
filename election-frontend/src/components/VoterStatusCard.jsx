import { useState } from "react";
import { API_URL } from "../config";
import { getImageUrl } from "../utils/ipfs";
import IpfsImage from "./ui/IpfsImage";

const STEP_META = [
  { label: "Register", icon: "📋" },
  { label: "Wallet", icon: "🔗" },
  { label: "Verify", icon: "✅" },
  { label: "Ready", icon: "🗳️" },
];

export default function VoterStatusCard({ voterStatus, balance }) {
  const [imgErr, setImgErr] = useState(false);

  const steps = [
    { done: voterStatus.registered },
    { done: voterStatus.registered && voterStatus.walletLinked },
    { done: voterStatus.registered && voterStatus.walletLinked && voterStatus.verified },
    { done: voterStatus.canVote },
  ];

  const done = steps.filter(s => s.done).length;
  const total = steps.length;
  const allDone = done === total;

  const statusText = allDone
    ? "Ready to vote"
    : !voterStatus.registered
      ? "Register your account"
      : !voterStatus.walletLinked
        ? "Link your wallet"
        : !voterStatus.verified
          ? "Awaiting verification"
          : "Complete setup";

  const statusIcon = allDone ? "🗳️"
    : !voterStatus.registered ? "📋"
    : !voterStatus.walletLinked ? "🔗"
    : !voterStatus.verified ? "⏳"
    : "⚡";

  const photoUrl = getImageUrl(voterStatus.image_cid);

  return (
    <div className="rounded-2xl border border-app/80 bg-app-surface shadow-card p-5 space-y-4">
      <div className="flex items-center gap-3">
        {photoUrl && !imgErr ? (
          <IpfsImage
            cid={voterStatus.image_cid}
            alt=""
            className="h-12 w-12 shrink-0 rounded-xl object-cover border border-app shadow-sm"
            onError={() => setImgErr(true)}
          />
        ) : voterStatus.registered ? (
          <div className="h-12 w-12 shrink-0 rounded-xl bg-gradient-to-br from-amber-300 via-emerald-500 to-sky-500 flex items-center justify-center text-sm font-black text-slate-950 border border-app/50 shadow-md shadow-emerald-500/10">
            {voterStatus.name?.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
          </div>
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-xl bg-app-muted border border-app-border flex items-center justify-center text-lg">
            👤
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-app-muted-text">Status</p>
          <p className="text-xl font-extrabold text-app-heading tabular-nums leading-tight mt-0.5">
            {done}
            <span className="text-app-muted-text font-medium">/{total}</span>
          </p>
        </div>
        {balance !== null && Number(balance) < 0.001 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 shrink-0">
            <span className="h-2 w-2 rounded-full bg-rose-400" />
            <span className="text-xs font-bold text-rose-400">Low gas</span>
          </div>
        )}
        {allDone && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs font-bold text-emerald-400">Ready</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex gap-1.5">
          {steps.map((s, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <div
                className={`h-2.5 w-full rounded-full transition-all duration-500 ${
                  s.done
                    ? "bg-emerald-400 shadow-sm shadow-emerald-400/30"
                    : "bg-app-border/40"
                }`}
              />
              <span
                className={`text-[10px] font-bold uppercase tracking-wider text-center truncate w-full ${
                  s.done ? "text-emerald-400" : "text-app-muted-text/40"
                }`}
              >
                {STEP_META[i].label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div
        className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 ${
          allDone
            ? "border-emerald-200 bg-emerald-50"
            : "border-slate-200 bg-white shadow-sm"
        }`}
      >
        <span className={`shrink-0 flex items-center justify-center h-8 w-8 rounded-lg ${
          allDone ? "bg-emerald-100" : "bg-slate-100"
        }`}>
          <span className={`text-sm ${allDone ? "" : "text-slate-600"}`}>{statusIcon}</span>
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${
            allDone ? "text-emerald-700" : "text-slate-800"
          }`}>
            {statusText}
          </p>
          {!allDone && (
            <p className="text-xs text-slate-500 mt-0.5">
              {!voterStatus.registered
                ? "Create your account to get started"
                : !voterStatus.walletLinked
                  ? "Connect MetaMask to link your wallet"
                  : !voterStatus.verified
                    ? "Admin will verify your registration"
                    : "Complete the remaining steps"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
