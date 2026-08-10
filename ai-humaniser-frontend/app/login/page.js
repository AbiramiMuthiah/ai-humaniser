"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "../../lib/api";
import GoogleButton from "../components/GoogleButton";

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) router.replace("/dashboard");
  }, [router]);

  const submit = async (e) => {
    e.preventDefault();
    setMsg("");
    setLoading(true);
    try {
      const res = await api.post("/auth/login", form);
      localStorage.setItem("token", res.data.token);
      if (res.data.user)
        localStorage.setItem("user", JSON.stringify(res.data.user));
      const key = `usage:${todayKey()}`;
      if (!localStorage.getItem(key)) localStorage.setItem(key, "0");
      router.push("/dashboard");
    } catch (err) {
      setMsg(err?.response?.data?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="authPage">
      <div className="authBg" />
      <div className="authWrap">
        <div className="brandRow">
          <div className="brandMark">
            <img
              src="/logo.png"
              alt="AI Humaniser"
              style={{ width: "80%", height: "80%", objectFit: "contain" }}
            />
          </div>
          <div className="brandText">
            <div className="brandName">AI Humaniser</div>
            <div className="brandTag">Sign in to continue</div>
          </div>
        </div>

        <div className="authCard">
          <div className="authHeader">
            <h1>Welcome back</h1>
            <p>Login to your account</p>
          </div>

          <form onSubmit={submit} className="authForm">
            <label className="field">
              <span>Email</span>
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                type="password"
                autoComplete="current-password"
              />
            </label>

            {msg ? <div className="alert">{msg}</div> : null}

            <button className="btnPrimary" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>

            <div className="divider">
              <span>or</span>
            </div>

            <div className="googleRow">
              <GoogleButton
                onDone={(payload) => {
                  if (payload?.token)
                    localStorage.setItem("token", payload.token);
                  if (payload?.user)
                    localStorage.setItem("user", JSON.stringify(payload.user));
                  const key = `usage:${todayKey()}`;
                  if (!localStorage.getItem(key))
                    localStorage.setItem(key, "0");
                  router.push("/dashboard");
                }}
              />
            </div>

            <div className="authFooter">
              <span>Don&apos;t have an account?</span>
              <Link href="/register">Create account</Link>
            </div>
          </form>
        </div>

        <div className="authHint">
          By signing in, you agree to the Terms and Privacy Policy.
        </div>
      </div>
    </div>
  );
}
