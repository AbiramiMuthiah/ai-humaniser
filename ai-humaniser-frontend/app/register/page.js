"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "../../lib/api";
import GoogleButton from "../components/GoogleButton";

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function RegisterPage() {
  const router = useRouter();

  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // If already logged in, go dashboard
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) router.replace("/dashboard");
  }, [router]);

  const onChange = (e) => {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setMsg("");

    if (!form.name || !form.email || !form.password) {
      setMsg("All fields are required.");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post("/auth/register", form);

      // Save auth
      localStorage.setItem("token", res.data.token);
      if (res.data.user) localStorage.setItem("user", JSON.stringify(res.data.user));

      // Optional: initialize usage key for today if missing
      const key = `usage:${todayKey()}`;
      if (!localStorage.getItem(key)) localStorage.setItem(key, "0");

      router.push("/dashboard");
    } catch (err) {
      setMsg(err?.response?.data?.message || "Register failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-wrap">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">✦</div>
          <div className="brand-text">
            <div className="brand-name">AI Humaniser</div>
            <div className="brand-sub">Start free, upgrade later</div>
          </div>
        </div>

        <div className="card">
          <h1>Create account</h1>
          <p className="sub">Create your account to continue</p>

          <form onSubmit={submit} className="form">
            <label>
              Name
              <input
                name="name"
                value={form.name}
                onChange={onChange}
                placeholder="Your name"
                autoComplete="name"
              />
            </label>

            <label>
              Email
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={onChange}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>

            <label>
              Password
              <input
                name="password"
                type="password"
                value={form.password}
                onChange={onChange}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </label>

            {msg ? <div className="msg">{msg}</div> : null}

            <button className="primary" disabled={loading}>
              {loading ? "Creating..." : "Create account"}
            </button>

            <div className="divider">
              <span />
              <em>or</em>
              <span />
            </div>

            <div className="google">
              <GoogleButton
                onDone={(payload) => {
                  // payload may include { token, user } depending on your GoogleButton
                  // If your GoogleButton already stores token, this is safe anyway.
                  if (payload?.token) localStorage.setItem("token", payload.token);
                  if (payload?.user) localStorage.setItem("user", JSON.stringify(payload.user));

                  const key = `usage:${todayKey()}`;
                  if (!localStorage.getItem(key)) localStorage.setItem(key, "0");

                  router.push("/dashboard");
                }}
              />
            </div>

            <div className="foot">
              Already have an account?{" "}
              <a href="/login" className="link">
                Sign in
              </a>
            </div>
          </form>
        </div>

        <div className="legal">
          By creating an account, you agree to the{" "}
          <a href="#" className="link">Terms</a> and{" "}
          <a href="#" className="link">Privacy Policy</a>.
        </div>
      </div>

      <style jsx>{`
        .auth-page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 48px 16px;
          background:
            radial-gradient(900px 500px at 50% 25%, rgba(139,92,246,.35), transparent 60%),
            radial-gradient(700px 450px at 20% 80%, rgba(56,189,248,.18), transparent 60%),
            linear-gradient(180deg, #0b1020 0%, #070a14 100%);
        }

        .auth-wrap {
          width: 100%;
          max-width: 460px;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
          color: rgba(255,255,255,.92);
        }

        .brand-icon {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          background: rgba(139,92,246,.25);
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: 0 10px 30px rgba(0,0,0,.35);
          font-size: 18px;
        }

        .brand-name {
          font-weight: 700;
          letter-spacing: .2px;
        }

        .brand-sub {
          margin-top: 2px;
          font-size: 13px;
          color: rgba(255,255,255,.65);
        }

        .card {
          border-radius: 18px;
          padding: 22px;
          background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: 0 18px 60px rgba(0,0,0,.45);
          backdrop-filter: blur(16px);
        }

        h1 {
          margin: 0;
          font-size: 26px;
          color: rgba(255,255,255,.95);
          letter-spacing: .2px;
        }

        .sub {
          margin: 6px 0 16px;
          color: rgba(255,255,255,.65);
          font-size: 13.5px;
        }

        .form {
          display: grid;
          gap: 12px;
        }

        label {
          display: grid;
          gap: 6px;
          font-size: 12px;
          color: rgba(255,255,255,.7);
        }

        input {
          width: 100%;
          height: 44px;
          padding: 0 14px;
          border-radius: 12px;
          outline: none;
          background: rgba(0,0,0,.25);
          border: 1px solid rgba(255,255,255,.12);
          color: rgba(255,255,255,.92);
        }

        input:focus {
          border-color: rgba(139,92,246,.55);
          box-shadow: 0 0 0 4px rgba(139,92,246,.15);
        }

        .msg {
          font-size: 13px;
          color: #ffd0d0;
          background: rgba(239,68,68,.12);
          border: 1px solid rgba(239,68,68,.25);
          padding: 10px 12px;
          border-radius: 12px;
        }

        .primary {
          height: 44px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,.12);
          background: linear-gradient(90deg, rgba(139,92,246,.95), rgba(99,102,241,.9));
          color: #0b1020;
          font-weight: 700;
          cursor: pointer;
        }

        .primary:disabled {
          opacity: .7;
          cursor: not-allowed;
        }

        .divider {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 10px;
          color: rgba(255,255,255,.5);
          margin: 6px 0 2px;
        }

        .divider span {
          height: 1px;
          background: rgba(255,255,255,.12);
        }

        .divider em {
          font-style: normal;
          font-size: 12px;
        }

        .google :global(iframe) {
          max-width: 100%;
        }

        .foot {
          margin-top: 6px;
          font-size: 13px;
          color: rgba(255,255,255,.65);
          text-align: center;
        }

        .link {
          color: rgba(167,139,250,.95);
          text-decoration: none;
          font-weight: 700;
        }

        .link:hover {
          text-decoration: underline;
        }

        .legal {
          margin-top: 12px;
          text-align: center;
          font-size: 12px;
          color: rgba(255,255,255,.45);
        }
      `}</style>
    </div>
  );
}