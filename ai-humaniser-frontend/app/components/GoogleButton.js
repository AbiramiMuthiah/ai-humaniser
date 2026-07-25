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
        onError={() => {
          // Most Google login failures here are caused by an ad blocker or
          // privacy extension blocking the sign-in popup, not an actual
          // Google/account error. Give people a way to self-resolve instead
          // of a generic dead-end message.
          alert(
            "Google sign-in didn't open. This is usually caused by an ad blocker " +
            "or privacy extension blocking the sign-in popup.\n\n" +
            "Try disabling it for this site, use a private/incognito window, " +
            "or sign in with your email and password instead."
          );
        }}
        useOneTap={false}
        theme="outline"
        size="large"
        shape="pill"
        width="360"
      />
    </div>
  );
}