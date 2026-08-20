import { useState, useEffect, useContext, createContext, useRef, useCallback } from "react";
import { ethers } from "ethers";
import { AuthContext } from "../context/AuthContextValue";
import { API_URL, CONTRACT_ADDRESS_V3 } from "../config";
import Election3ABI from "../abi/Election3.json";
import { useBalance } from "../hooks/useBalance";
import BlockExplorerLink from "./ui/BlockExplorerLink";
import { useToast } from "./ui/Toast";
import { formatAPIError } from "../utils/errors";
import { getImageUrl } from "../utils/ipfs";
import IpfsImage from "./ui/IpfsImage";

const WALLET_MESSAGE = "Gandaki University Election Wallet Verification";
const PortalContext = createContext(null);

function usePortal() {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error();
  return ctx;
}

function PortalAuthProvider({ children }) {
  const { wallet } = useContext(AuthContext);
  const [token, setToken] = useState(() => localStorage.getItem("portal_token") || null);
  const [student, setStudent] = useState(() => {
    const raw = localStorage.getItem("portal_student");
    return raw ? JSON.parse(raw) : null;
  });

  const save = (t, s) => {
    if (t) {
      localStorage.setItem("portal_token", t);
      setToken(t);
    }
    localStorage.setItem("portal_student", JSON.stringify(s));
    setStudent(s);
  };

  const logout = () => {
    localStorage.removeItem("portal_token");
    localStorage.removeItem("portal_student");
    setToken(null);
    setStudent(null);
  };

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401 || res.status === 404) logout();
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) {
          localStorage.setItem("portal_student", JSON.stringify(data));
          setStudent(data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!student?.wallet_address) return;
    if (!wallet) return;
    if (student.wallet_address.toLowerCase() !== wallet.toLowerCase()) {
      logout();
    }
  }, [wallet, student]);

  const authFetch = async (path, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!(opts.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${API_URL}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  return (
    <PortalContext.Provider value={{ token, student, save, logout, authFetch }}>
      {children}
    </PortalContext.Provider>
  );
}

function LoginView({ onRegister, onForgotPassword }) {
  const { save } = usePortal();
  const { wallet } = useContext(AuthContext);
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: id.trim(), password: pw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");

      const s = data.student;
      if (s.wallet_address && wallet && s.wallet_address.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error("Connected wallet does not match the wallet registered to this student ID. Please connect the correct wallet.");
      }

      save(data.token, s);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <h2 className="text-xl font-semibold text-app-heading">Sign in</h2>

      <div>
        <label className="text-base font-medium text-app-muted-text mb-2 block">Student ID</label>
        <input
          type="text"
          value={id}
          onChange={(e) => setId(e.target.value)}
          className="input-field px-4 py-3 text-base"
          placeholder="e.g. GUSD430"
          required
        />
      </div>

      <div>
        <label className="text-base font-medium text-app-muted-text mb-2 block">Password</label>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="input-field px-4 py-3 text-base"
          placeholder="Enter your password"
          required
        />
      </div>

      <div className="flex justify-end -mt-2">
        <button type="button" onClick={onForgotPassword} className="text-sm text-app-muted-text hover:text-app-accent hover:underline cursor-pointer">
          Forgot password?
        </button>
      </div>

      {error && <p className="text-base text-rose-400">{error}</p>}

      <button type="submit" disabled={loading} className="btn-primary w-full text-base py-3">
        {loading ? "Signing in..." : "Sign in"}
      </button>

      <p className="text-base text-center text-app-muted-text">
        New here?{" "}
        <button type="button" onClick={onRegister} className="text-app-accent hover:underline cursor-pointer">
          Register
        </button>
      </p>
    </form>
  );
}

function formatCode(v) {
  const raw = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const parts = [];
  for (let i = 0; i < raw.length; i += 4) parts.push(raw.slice(i, i + 4));
  return parts.join("-");
}

/*
 * Student registration: 3-step wizard (Code → Details → Wallet).
 * Step 1 validates the registration code against the backend.
 * Step 2 collects name + password.
 * Step 3 links MetaMask wallet and submits everything to /api/auth/register.
 */
function RegisterView({ onLogin }) {
  const { save } = usePortal();
  const { connectWallet, wallet } = useContext(AuthContext);
  const [step, setStep] = useState(1);
  const [id, setId] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [merkleProof, setMerkleProof] = useState(null);
  const [onChainVerified, setOnChainVerified] = useState(null); // null = unchecked, true/false

  const verify = async () => {
    setError("");
    const sid = id.trim().toUpperCase();
    const clean = code.replace(/-/g, "").trim().toUpperCase();
    if (!sid) return setError("Enter your student ID");
    if (clean.length !== 12) return setError("Invalid code");
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: sid, code: code.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) throw new Error(data.error || "Invalid code");

      // Fetch Merkle proof for on-chain verification (non-blocking for step transition)
      fetch(`${API_URL}/api/codes/proof?studentId=${sid}&code=${code.trim().toUpperCase()}`)
        .then(r => r.json())
        .then(d => { if (d.proof) setMerkleProof(d.proof); })
        .catch(() => {});

      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submitDetails = () => {
    setError("");
    if (pw.length < 6) return setError("Password must be 6+ characters");
    if (pw !== confirm) return setError("Passwords don't match");
    setStep(3);
  };

  /*
   * Step 3: Connect wallet, sign message, then submit everything to backend.
   * IMPORTANT: 'name' is explicitly included in the request body. Without it,
   * the backend returns 400 if the admin did not pre-fill names via CSV.
   */
  const signAndRegister = async () => {
    setLoading(true);
    setError("");
    try {
      let addr = wallet;
      if (!addr && connectWallet) addr = await connectWallet();
      if (!addr) throw new Error("Connect MetaMask");

      // Optional on-chain verification of the registration code
      if (merkleProof) {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const contract = new ethers.Contract(CONTRACT_ADDRESS_V3, Election3ABI.abi, provider);
          const sid = id.trim().toUpperCase();
          const raw = code.replace(/-/g, "").trim().toUpperCase();
          const valid = await contract.verifyRegCode(sid, raw, merkleProof);
          setOnChainVerified(valid);
          if (!valid) {
            throw new Error("Registration code is not registered on the blockchain. Contact the election committee.");
          }
        } catch (err) {
          if (err.message.includes("not registered on the blockchain")) throw err;
          console.warn("On-chain verification unavailable:", err.message);
        }
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(WALLET_MESSAGE);

      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: id.trim().toUpperCase(),
          code: code.trim().toUpperCase(),
          password: pw,
          wallet: addr,
          signature,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      save(data.token, data.student);
      setStep(4);
    } catch (err) {
      setError(formatAPIError(err, "Registration failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const steps = [
    { num: 1, label: "Code" },
    { num: 2, label: "Details" },
    { num: 3, label: "Wallet" },
  ];

  return (
    <div className="space-y-6">
      {step < 4 && (
        <>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-app-heading">Create Account</h2>
            <p className="text-sm text-app-muted-text mt-1">Complete all steps to register for the election</p>
          </div>

          <div className="relative">
            <div className="absolute top-5 left-7 right-7 h-px bg-app-border/60" />
            <div className="flex justify-between relative">
              {steps.map((s) => (
                <div key={s.label} className="flex flex-col items-center gap-2">
                  <span
                    className={`relative z-10 h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 ${
                      step > s.num
                        ? "bg-emerald-500/20 text-emerald-400 border-2 border-emerald-500/40"
                        : step === s.num
                        ? "bg-app-accent-soft text-app-accent border-2 border-app-accent shadow-sm"
                        : "bg-app-muted/50 text-app-muted-text border-2 border-app-border/50"
                    }`}
                  >
                    {step > s.num ? "✓" : s.num}
                  </span>
                  <span
                    className={`text-sm font-bold uppercase tracking-wider ${
                      step >= s.num ? "text-app-heading" : "text-app-muted-text"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {step === 1 && (
        <div className="rounded-xl border border-app bg-app-muted/30 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">🔐</span>
              <p className="text-base font-medium text-app-heading">Enter your registration credentials</p>
          </div>
          <div>
            <label className="text-base font-medium text-app-muted-text mb-2 block">Student ID</label>
            <input
              className="input-field px-4 py-3 text-base"
              placeholder="e.g. GUSD430"
              value={id}
              onChange={(e) => setId(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label className="text-base font-medium text-app-muted-text mb-2 block">Registration Code</label>
            <input
              className="input-field font-mono tracking-[0.15em] px-4 py-3 text-base"
              placeholder="XXXX-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(formatCode(e.target.value))}
            />
          </div>
          {error && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
              <p className="text-base text-rose-400">{error}</p>
            </div>
          )}
          <button onClick={verify} disabled={loading} className="btn-primary w-full text-base py-3">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin inline-block" />
                Verifying…
              </span>
            ) : (
              "Verify Code"
            )}
          </button>
            <p className="text-base text-center text-app-muted-text">
              Have an account?{" "}
            <button type="button" onClick={onLogin} className="text-app-accent hover:underline cursor-pointer font-medium">Sign in</button>
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="rounded-xl border border-app bg-app-muted/30 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">✏️</span>
            <p className="text-base font-medium text-app-heading">Set up your profile and password</p>
          </div>
          <div>
            <label className="text-base font-medium text-app-muted-text mb-2 block">Password</label>
            <input
              className="input-field px-4 py-3 text-base"
              type="password"
              placeholder="Min 6 characters"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </div>
          <div>
            <label className="text-base font-medium text-app-muted-text mb-2 block">Confirm Password</label>
            <input
              className="input-field px-4 py-3 text-base"
              type="password"
              placeholder="Re-enter password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
              <p className="text-base text-rose-400">{error}</p>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(1)} className="btn-secondary flex-1 text-base py-3">← Back</button>
            <button onClick={submitDetails} className="btn-primary flex-1 text-base py-3">Next →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="rounded-xl border border-app bg-app-muted/30 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">🦊</span>
            <p className="text-base font-medium text-app-heading">Link your wallet to complete registration</p>
          </div>

          {!wallet ? (
            <button
              onClick={connectWallet}
              className="w-full rounded-xl border-2 border-dashed border-app-accent/40 bg-app-accent-soft/10 py-8 flex flex-col items-center gap-3 hover:bg-app-accent-soft/20 hover:border-app-accent/60 transition-all cursor-pointer"
            >
              <span className="text-3xl">🦊</span>
              <span className="text-base font-bold text-app-accent">Connect MetaMask</span>
              <span className="text-sm text-app-muted-text">Your wallet will be linked to your account</span>
            </button>
          ) : (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-5 text-center space-y-3">
              <div className="mx-auto h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <span className="text-emerald-400 text-base">✓</span>
              </div>
              <p className="text-base font-mono text-app-accent break-all">{wallet}</p>
              <p className="text-sm text-emerald-400 font-medium">Wallet connected</p>
            </div>
          )}

          {wallet && merkleProof && onChainVerified === null && (
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-4 py-3">
              <p className="text-sm text-app-accent font-medium">Code will be verified on-chain</p>
              <p className="text-base text-app-muted-text mt-1">
                Your registration code will be verified against the blockchain before registering.
              </p>
            </div>
          )}

          {onChainVerified === true && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <p className="text-sm text-emerald-400 font-medium">✓ Code verified on-chain</p>
              <p className="text-base text-app-muted-text mt-1">
                Your registration code has been verified against the smart contract.
              </p>
            </div>
          )}

          {onChainVerified === false && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
              <p className="text-sm text-rose-400 font-medium">✕ Code NOT found on-chain</p>
              <p className="text-base text-app-muted-text mt-1">
                This code is not registered on the blockchain. Contact the election committee.
              </p>
            </div>
          )}

          {wallet && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <p className="text-sm text-amber-400 font-medium">Signature required</p>
              <p className="text-base text-app-muted-text mt-1">
                You will be asked to sign a message to prove wallet ownership.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3">
              <p className="text-base text-rose-400">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(2)} className="btn-secondary flex-1 text-base py-3">← Back</button>
            <button
              onClick={signAndRegister}
              disabled={loading || !wallet}
              className="btn-primary flex-1 text-base py-3"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-4 w-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin inline-block" />
                  Registering…
                </span>
              ) : (
                "Complete Registration"
              )}
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="py-10 text-center space-y-5">
          <div className="mx-auto h-20 w-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 flex items-center justify-center animate-bounce">
            <span className="text-emerald-400 text-3xl">✓</span>
          </div>
          <div>
            <p className="text-lg font-bold text-emerald-400">Registration Complete!</p>
            <p className="text-base text-app-muted-text mt-1">You can now sign in and access the portal.</p>
          </div>
          <button onClick={() => setStep(1)} className="btn-primary text-base px-10 py-3 mx-auto">
            Go to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}

function ForgotPasswordView({ onBackToLogin }) {
  const [studentId, setStudentId] = useState("");
  const [code, setCode] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleReset = async (e) => {
    e.preventDefault();
    setError("");
    if (!studentId.trim()) return setError("Enter your student ID");
    if (newPw.length < 6) return setError("Password must be 6+ characters");
    if (newPw !== confirmPw) return setError("Passwords don't match");
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: studentId.trim().toUpperCase(),
          code: code.replace(/-/g, "").trim().toUpperCase(),
          password: newPw,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Password reset failed");
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="space-y-5">
        <div className="py-8 text-center space-y-3">
          <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 flex items-center justify-center">
            <span className="text-emerald-400 text-2xl">✓</span>
          </div>
          <p className="text-lg font-bold text-emerald-400">Password Reset Successful</p>
          <p className="text-base text-app-muted-text">You can now sign in with your new password.</p>
        </div>
        <button onClick={onBackToLogin} className="btn-primary w-full text-base py-3">Sign in</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleReset} className="space-y-5">
      <h2 className="text-xl font-semibold text-app-heading">Reset Password</h2>
      <p className="text-sm text-app-muted-text">Enter your student ID and registration code to set a new password.</p>

      <div>
        <label className="text-base font-medium text-app-muted-text mb-2 block">Student ID</label>
        <input
          type="text"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value.toUpperCase())}
          className="input-field px-4 py-3 text-base"
          placeholder="e.g. GUSD430"
          required
        />
      </div>

      <div>
        <label className="text-base font-medium text-app-muted-text mb-2 block">Registration Code</label>
        <input
          className="input-field font-mono tracking-[0.15em] px-4 py-3 text-base"
          placeholder="XXXX-XXXX-XXXX"
          value={code}
          onChange={(e) => setCode(formatCode(e.target.value))}
        />
      </div>

      <div>
        <label className="text-base font-medium text-app-muted-text mb-2 block">New Password</label>
        <input
          className="input-field px-4 py-3 text-base"
          type="password"
          placeholder="Min 6 characters"
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
        />
      </div>

      <div>
        <label className="text-base font-medium text-app-muted-text mb-2 block">Confirm Password</label>
        <input
          className="input-field px-4 py-3 text-base"
          type="password"
          placeholder="Re-enter password"
          value={confirmPw}
          onChange={(e) => setConfirmPw(e.target.value)}
        />
      </div>

      {error && <p className="text-base text-rose-400">{error}</p>}

      <button type="submit" disabled={loading} className="btn-primary w-full text-base py-3">
        {loading ? "Resetting..." : "Reset Password"}
      </button>

      <p className="text-base text-center text-app-muted-text">
        Remember your password?{" "}
        <button type="button" onClick={onBackToLogin} className="text-app-accent hover:underline cursor-pointer">Sign in</button>
      </p>
    </form>
  );
}

function ProfileCard({ student, onPhotoChange }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const { authFetch } = usePortal();
  const { checkVoterStatus } = useContext(AuthContext);
  const imageUrl = getImageUrl(student.image_cid);
  const initials = (student.name || "?").split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("photo", file);
      const data = await authFetch("/api/auth/me/photo", {
        method: "POST",
        body: form,
      });
      if (data.student) onPhotoChange(data.student);
      if (student.wallet_address) checkVoterStatus(student.wallet_address);
    } catch (err) {
      console.error("Photo upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="relative group">
        <div className="h-16 w-16 rounded-xl overflow-hidden border border-app bg-app-elevated">
          {imageUrl ? (
            <IpfsImage cid={student.image_cid} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-emerald-500 to-teal-600 text-lg font-black text-slate-950">
              {initials}
            </div>
          )}
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-emerald-500 border-2 border-app-surface-solid flex items-center justify-center text-slate-950 text-sm font-bold hover:bg-emerald-400 transition-colors cursor-pointer disabled:opacity-50"
        >
          {uploading ? "…" : "+"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-base font-bold text-app-heading truncate">{student.name}</p>
          {student.walletVerified && (
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Verified</span>
          )}
        </div>
        <p className="text-base text-app-muted-text font-mono">{student.student_id}</p>
      </div>
    </div>
  );
}

/*
 * CandidateSection: shown inside the student Dashboard.
 * Fetches the student's candidate application (if any) and displays:
 *   - No application and not eligible → "wait for whitelist"
 *   - No application and eligible → apply form (President/Secretary/General Member)
 *   - Pending application → "under review"
 *   - Approved + eligible → directs user to the main page registration section
 *   - Rejected → "contact committee"
 */
function CandidateSection({ student }) {
  const [phase, setPhase] = useState(null);
  const [regEnd, setRegEnd] = useState(null);
  const [phaseLoading, setPhaseLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/contract/phase`);
        const data = await res.json();
        if (mounted && res.ok) {
          setPhase(data.phase);
          setRegEnd(data.registrationEnd);
        }
      } catch (err) {
        console.error("Failed to load phase:", err);
      } finally {
        if (mounted) setPhaseLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (phaseLoading) {
    return (
      <div className="rounded-xl border border-app bg-app-surface p-4 animate-pulse space-y-2">
        <div className="h-3 w-24 bg-app-muted rounded" />
        <div className="h-3 w-40 bg-app-muted rounded" />
      </div>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const isRegistrationOpen = phase === 1 && regEnd > now;

  const studentYear = Number(student.year);
  const eligiblePositions = [];
  if (studentYear === 4) eligiblePositions.push("President");
  if (studentYear >= 3) eligiblePositions.push("Secretary");
  eligiblePositions.push("General Member");

  if (!student.eligibleToVote) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-xl">🎯</span>
          <h4 className="text-base font-bold text-app-heading">Candidate Registration</h4>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <p className="text-base text-amber-400 font-medium">
            You must be whitelisted as a voter before you can register as a candidate.
          </p>
        </div>
      </div>
    );
  }

  if (!isRegistrationOpen) {
    const expired = phase === 1 && regEnd <= now;
    return (
      <div className="rounded-xl border border-app bg-app-surface p-5 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-xl">🎯</span>
          <h4 className="text-base font-bold text-app-heading">Candidate Registration</h4>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <p className="text-base text-amber-400 font-medium">
            {expired ? "The registration window has expired." : "Registration is not open yet."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-xl">🎯</span>
        <h4 className="text-base font-bold text-app-heading">Register as Candidate</h4>
      </div>
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 space-y-3">
        <p className="text-base text-emerald-400 font-medium">
          Registration is open. You are eligible to run for:
        </p>
        <div className="flex flex-wrap gap-2">
          {eligiblePositions.map((pos) => (
            <span key={pos} className="text-sm font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded">
              {pos}
            </span>
          ))}
        </div>
        <p className="text-sm text-app-muted-text pt-1">
          Use the <strong>Candidate Registration</strong> banner on the main page to register directly on-chain. Your wallet will sign the transaction and you pay the gas fee.
        </p>
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder, label }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="text-sm font-medium text-app-muted-text mb-1 block">{label}</label>
      <div className="relative">
        <input
          className="input-field w-full px-4 py-3 text-base pr-12"
          type={show ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-app-muted-text hover:text-app-heading cursor-pointer p-2"
        >
          {show ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

function ChangePasswordCard() {
  const { authFetch } = usePortal();
  const [open, setOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleChange = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    if (!currentPw) return setError("Enter your current password");
    if (newPw.length < 6) return setError("Password must be 6+ characters");
    if (newPw !== confirmPw) return setError("Passwords don't match");
    setLoading(true);
    try {
      await authFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      setSuccess(true);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-app bg-app-surface p-5 space-y-3">
      <button onClick={() => setOpen(!open)} className="flex items-center justify-between w-full cursor-pointer">
        <div className="flex items-center gap-3">
          <span className="text-xl">🔑</span>
          <h3 className="text-base font-bold text-app-heading">Change Password</h3>
        </div>
        <span className={`text-app-muted-text transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <form onSubmit={handleChange} className="space-y-3 pt-2 border-t border-app">
          <PasswordInput
            label="Current Password"
            placeholder="Enter current password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
          />
          <PasswordInput
            label="New Password"
            placeholder="Min 6 characters"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <PasswordInput
            label="Confirm New Password"
            placeholder="Re-enter new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
          />
          {error && <p className="text-sm text-rose-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">Password updated successfully.</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full text-base py-3">
            {loading ? "Updating..." : "Update Password"}
          </button>
        </form>
      )}
    </div>
  );
}

function Dashboard() {
  const { student, logout, save } = usePortal();
  const { balance, loading: balanceLoading } = useBalance(student?.wallet_address);
  if (!student) return null;

  const steps = [
    { label: "Account", done: true },
    { label: "Wallet", done: Boolean(student.wallet_address) },
    { label: "Verified", done: Boolean(student.walletVerified) },
    { label: "Whitelisted", done: Boolean(student.eligibleToVote) },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-app bg-app-surface p-5 space-y-3">
        <ProfileCard student={student} onPhotoChange={(s) => save(null, { ...student, image_cid: s.image_cid })} />
        <div className="flex items-center justify-between pt-1 border-t border-app">
          <div className="flex items-center gap-2">
            <span className="text-sm text-app-muted-text">Progress</span>
            <span className="text-sm font-bold text-app-heading">{doneCount}/{steps.length}</span>
          </div>
          <button onClick={logout} className="text-sm font-medium text-app-muted-text hover:text-app-heading cursor-pointer">Sign out</button>
        </div>
      </div>

      <CandidateSection student={student} />

      <div>
        <h3 className="text-base font-bold text-app-heading mb-3">Profile Details</h3>
        <div className="grid grid-cols-2 gap-3">
          {student.year && (
            <div className="rounded-xl border border-app bg-app-elevated/30 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wider text-app-muted-text">Year</p>
              <p className="text-base font-semibold text-app-heading mt-1">{student.year}</p>
            </div>
          )}
          {student.gender && (
            <div className="rounded-xl border border-app bg-app-elevated/30 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wider text-app-muted-text">Gender</p>
              <p className="text-base font-semibold text-app-heading mt-1 capitalize">{student.gender}</p>
            </div>
          )}
          {student.wallet_address && (
            <div className="col-span-2 rounded-xl border border-app bg-app-elevated/30 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wider text-app-muted-text">Wallet</p>
              <div className="flex items-center justify-between mt-1">
                <BlockExplorerLink hash={student.wallet_address} type="address" />
                {balanceLoading ? (
                  <span className="text-sm text-app-muted-text animate-pulse">...</span>
                ) : balance != null ? (
                  <span className="text-base font-mono font-bold text-emerald-400">{Number(balance).toFixed(4)} ETH</span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-base font-bold text-app-heading mb-3">Verification Progress</h3>
        <div className="flex gap-1.5 mb-3">
          {steps.map((s) => (
            <div key={s.label} className={`flex-1 h-2 rounded-full ${s.done ? "bg-emerald-400" : "bg-app-border/50"}`} />
          ))}
        </div>

        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={s.label} className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-base ${
              s.done
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-app-border bg-app-muted/50"
            }`}>
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                s.done ? "bg-emerald-500/20 text-emerald-400" : "bg-app-border/30 text-app-muted-text"
              }`}>
                {s.done ? "✓" : i + 1}
              </span>
              <span className={s.done ? "text-emerald-400 font-medium" : "text-app-muted-text"}>{s.label}</span>
              {s.done && (
                <span className="ml-auto text-xs font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Done</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <ChangePasswordCard />
    </div>
  );
}

function PortalInner({ onClose }) {
  const { student } = usePortal();
  const [view, setView] = useState("login");

  useEffect(() => {
    if (student) setView("dashboard");
    else setView("login");
  }, [student]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="bg-app-surface-solid w-full sm:max-w-md rounded-t-xl sm:rounded-xl border border-app shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 h-14 border-b border-app">
          <span className="text-sm font-semibold text-app-heading">Portal</span>
          <button onClick={onClose} className="h-10 w-10 flex items-center justify-center text-app-heading hover:text-app-heading cursor-pointer text-lg rounded-lg hover:bg-app-muted/30 transition-colors">
            ✕
          </button>
        </div>
        <div className="p-5">
          {view === "dashboard" && <Dashboard />}
          {view === "login" && <LoginView onRegister={() => setView("register")} onForgotPassword={() => setView("forgot-password")} />}
          {view === "register" && <RegisterView onLogin={() => setView("login")} />}
          {view === "forgot-password" && <ForgotPasswordView onBackToLogin={() => setView("login")} />}
        </div>
      </div>
    </div>
  );
}

export default function StudentPortal({ open, onClose }) {
  if (!open) return null;
  return (
    <PortalAuthProvider>
      <PortalInner onClose={onClose} />
    </PortalAuthProvider>
  );
}
