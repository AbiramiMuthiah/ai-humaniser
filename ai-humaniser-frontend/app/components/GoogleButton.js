"use client";

import { GoogleLogin } from "@react-oauth/google";
import api from "../../lib/api";

export default function GoogleButton({ onDone }) {
  return (
    <div className="googleBtnWrap">
      <GoogleLogin
        onSuccess={async (credentialResponse) => {
          try {
            const credential = credentialResponse?.credential;
            if (!credential) {
              alert("Google login failed (missing credential).");
              return;
            }

            const res = await api.post("/auth/google", { credential });

            const token = res.data?.token;
            const user = res.data?.user;

            if (!token) {
              alert(res.data?.message || "Google login failed (no token).");
              return;
            }

            // ✅ store token + user so plan updates in dashboard
            localStorage.setItem("token", token);
            if (user) localStorage.setItem("user", JSON.stringify(user));

            // ✅ notify parent (Register/Login) with payload
            onDone?.({ token, user });
          } catch (e) {
            console.error(e);
            alert(e?.response?.data?.message || "Google login failed");
          }
        }}
        onError={() => alert("Google login failed")}
        useOneTap={false}
        theme="outline"
        size="large"
        shape="pill"
        width="360"
      />
    </div>
  );
}