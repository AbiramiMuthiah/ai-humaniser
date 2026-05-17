"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

function LogoMark() {
  // simple clean logo (no image files needed)
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2l1.6 6.1L20 10l-6.4 1.9L12 18l-1.6-6.1L4 10l6.4-1.9L12 2z"
        fill="currentColor"
        opacity="0.95"
      />
      <path
        d="M18.7 14.4l.7 2.6 2.6.7-2.6.7-.7 2.6-.7-2.6-2.6-.7 2.6-.7.7-2.6z"
        fill="currentColor"
        opacity="0.6"
      />
    </svg>
  );
}

export default function TopNav({
  showLogout = false,
  plan = null,
  usedToday = null,
  limitToday = null,
  onUpgrade = null,
}) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href) => pathname === href;

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/login");
  };

  return (
    <div className="topnav">
      <div className="topnav__inner">
        {/* LEFT */}
        <div className="topnav__left">
          <div className="brand">
            <div className="brand__icon" aria-label="AI Humaniser">
              <LogoMark />
            </div>
            <div className="brand__stack">
              <div className="brand__name">AI Humaniser</div>
              <div className="brand__tag">Dashboard</div>
            </div>
          </div>

          <div className="navlinks">
            <Link className={isActive("/dashboard") ? "active" : ""} href="/dashboard">
              Dashboard
            </Link>
            <Link className={isActive("/pricing") ? "active" : ""} href="/pricing">
              Pricing
            </Link>
          </div>
        </div>

        {/* RIGHT */}
        <div className="topnav__right">
          {plan != null && usedToday != null && limitToday != null ? (
            <div className="pill">
              Plan: <b>{String(plan).toUpperCase()}</b> • Used today: <b>{usedToday}</b> / {limitToday}
            </div>
          ) : null}

          {onUpgrade ? (
            <button className="btn btn--ghost" onClick={onUpgrade}>
              Upgrade
            </button>
          ) : null}

          {showLogout ? (
            <button className="btn btn--ghost" onClick={logout}>
              Logout
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}