"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "../../../lib/api";

function makeTitle(input) {
  const t = String(input || "").trim().replace(/\s+/g, " ");
  if (!t) return "Untitled";
  return t.length > 44 ? t.slice(0, 44) + "…" : t;
}

function safeId(v) {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default function TextItemPage() {
  const router = useRouter();
  const params = useParams();
  const id = safeId(params?.id);

  const [historyOpen, setHistoryOpen] = useState(true);
  const [menuOpenId, setMenuOpenId] = useState(null);

  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState([]);

  const [loadingItem, setLoadingItem] = useState(false);
  const [item, setItem] = useState(null);

  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);

  const closeMenu = () => setMenuOpenId(null);

  function showToast(msg) {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2000);
  }

  // Auth protect
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) router.replace("/login");
  }, [router]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Close menu on outside click / esc
  useEffect(() => {
    const onDown = (e) => {
      // if menu is open and click happens anywhere, close (we stopPropagation inside menu)
      if (menuOpenId) closeMenu();
    };
    const onKey = (e) => {
      if (e.key === "Escape") closeMenu();
    };

    document.addEventListener("click", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpenId]);

  useEffect(() => {
    if (!id) return;
    loadHistory();
    loadItem(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await api.get("/history");
      const items = Array.isArray(res.data) ? res.data : res.data?.items || [];
      setHistory(items);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function loadItem(textId) {
    setLoadingItem(true);
    try {
      const res = await api.get(`/texts/${textId}`);
      setItem(res.data?.item || null);
    } catch {
      setItem(null);
    } finally {
      setLoadingItem(false);
    }
  }

  function openHistoryItem(textId) {
    closeMenu();
    router.push(`/texts/${textId}`);
  }

  function newHumanise() {
    // clears "loadFromHistory" if you use it on dashboard
    sessionStorage.removeItem("loadFromHistory");
    closeMenu();
    router.push("/dashboard");
  }

  function loadIntoEditor() {
    if (!item) return;
    sessionStorage.setItem(
      "loadFromHistory",
      JSON.stringify({
        input: item.input || "",
        output: item.output || "",
      })
    );
    router.push("/dashboard");
  }

  async function deleteHistoryItem(textId) {
    closeMenu();
    try {
      await api.delete(`/texts/${textId}`);
      showToast("Deleted");

      setHistory((prev) => prev.filter((x) => String(x._id || x.id) !== String(textId)));

      // If we deleted the current item, go back to dashboard
      if (String(textId) === String(id)) {
        router.push("/dashboard");
      }
    } catch {
      showToast("Delete failed");
    }
  }

  async function deleteCurrent() {
    if (!id) return;
    const ok = confirm("Delete this history item?");
    if (!ok) return;
    await deleteHistoryItem(id);
  }

  const title = useMemo(() => makeTitle(item?.input), [item]);

  return (
    <>
      <style jsx global>{`
        :root {
          --bg0: #070a12;
          --bg1: #0b1022;
          --text: rgba(255, 255, 255, 0.92);
          --muted: rgba(255, 255, 255, 0.62);
          --line: rgba(255, 255, 255, 0.1);
          --glassA: rgba(255, 255, 255, 0.06);
          --glassB: rgba(255, 255, 255, 0.04);
          --accentA: rgba(139, 120, 255, 0.9);
          --accentB: rgba(109, 93, 255, 0.9);
        }
        body {
          margin: 0;
          background: radial-gradient(1200px 700px at 55% 20%, rgba(139, 120, 255, 0.25), transparent 60%),
            radial-gradient(900px 600px at 25% 60%, rgba(109, 93, 255, 0.18), transparent 60%),
            linear-gradient(180deg, var(--bg0), var(--bg1));
          color: var(--text);
          min-height: 100vh;
        }
        * {
          box-sizing: border-box;
        }

        /* Top bar */
        .topbar {
          position: sticky;
          top: 0;
          z-index: 30;
          backdrop-filter: blur(10px);
          background: rgba(5, 8, 16, 0.45);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          padding: 14px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        .brandLeft {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .brandIcon {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          background: linear-gradient(135deg, var(--accentA), var(--accentB));
          display: grid;
          place-items: center;
          box-shadow: 0 10px 30px rgba(139, 120, 255, 0.25);
          font-weight: 900;
          flex: 0 0 auto;
        }
        .brandText {
          display: flex;
          flex-direction: column;
          line-height: 1.05;
        }
        .brandName {
          font-weight: 900;
          white-space: nowrap;
        }
        .brandSub {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.55);
          white-space: nowrap;
        }
        .topActions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .btnSmall {
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.88);
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }
        .btnDanger {
          padding: 8px 10px;
          border-radius: 12px;
          border: 1px solid rgba(255, 120, 120, 0.22);
          background: rgba(255, 120, 120, 0.08);
          color: rgba(255, 210, 210, 0.95);
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }

        .pageWrap {
          width: 100%;
          padding: 18px 14px 64px;
        }
        .shell {
          display: flex;
          gap: 14px;
          align-items: flex-start;
          width: 100%;
        }

        /* Sidebar */
        .historySidebar {
          position: sticky;
          top: 74px;
          height: calc(100vh - 92px);
          border-radius: 18px;
          background: linear-gradient(180deg, var(--glassA), var(--glassB));
          border: 1px solid var(--line);
          box-shadow: 0 30px 70px rgba(0, 0, 0, 0.25);
          overflow: hidden;
          transition: width 0.25s ease;
          will-change: width;
        }
        .historySidebar.open {
          width: 340px;
        }
        .historySidebar.closed {
          width: 64px;
        }
        .historyHeader {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding: 12px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .historyHeaderLeft {
          font-weight: 900;
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .miniDot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: rgba(139, 120, 255, 0.55);
          box-shadow: 0 0 0 4px rgba(139, 120, 255, 0.12);
          flex: 0 0 auto;
        }
        .historyHeaderRight {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .historyBody {
          height: calc(100% - 56px);
          overflow-y: auto;
          padding: 10px;
        }

        .newBtn {
          width: 100%;
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(139, 120, 255, 0.28);
          background: rgba(139, 120, 255, 0.12);
          color: rgba(255, 255, 255, 0.92);
          cursor: pointer;
          font-weight: 900;
          margin-bottom: 10px;
        }

        .histItem {
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.18);
          padding: 10px;
          cursor: pointer;
          position: relative;
          transition: transform 0.12s ease, border-color 0.12s ease;
          display: grid;
          gap: 8px;
        }
        .histItem:hover {
          border-color: rgba(255, 255, 255, 0.18);
          transform: translateY(-1px);
        }
        .histItemActive {
          border-color: rgba(139, 120, 255, 0.55);
          box-shadow: 0 0 0 4px rgba(139, 120, 255, 0.14);
        }

        .histRowTop {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }
        .histTitle {
          font-weight: 900;
          font-size: 13px;
          line-height: 1.25;
        }
        .histMetaRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.62);
        }

        .dotsBtn {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.9);
          cursor: pointer;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
        }

        .menu {
          position: absolute;
          right: 10px;
          top: 44px;
          z-index: 60;
          width: 170px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(10, 12, 24, 0.9);
          backdrop-filter: blur(10px);
          overflow: hidden;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
        }
        .menu button {
          width: 100%;
          padding: 10px 12px;
          background: transparent;
          border: 0;
          color: rgba(255, 255, 255, 0.9);
          cursor: pointer;
          text-align: left;
          font-size: 13px;
        }
        .menu button:hover {
          background: rgba(255, 255, 255, 0.06);
        }
        .menu .danger {
          color: rgba(255, 170, 170, 0.95);
        }

        /* Closed sidebar look */
        .closedStack {
          display: grid;
          gap: 10px;
        }
        .closedPill {
          height: 44px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.18);
          display: grid;
          place-items: center;
          color: rgba(255, 255, 255, 0.55);
        }
        .closedPill.active {
          border-color: rgba(139, 120, 255, 0.55);
          box-shadow: 0 0 0 4px rgba(139, 120, 255, 0.14);
          color: rgba(255, 255, 255, 0.85);
        }

        /* Main */
        .main {
          flex: 1;
          min-width: 0;
        }
        .pageTitle {
          font-size: 36px;
          font-weight: 900;
          margin: 0 0 6px;
          letter-spacing: -0.6px;
        }
        .sub {
          margin: 0 0 16px;
          color: rgba(255, 255, 255, 0.62);
        }

        .card {
          border-radius: 18px;
          background: linear-gradient(180deg, var(--glassA), var(--glassB));
          border: 1px solid var(--line);
          padding: 16px;
          box-shadow: 0 30px 70px rgba(0, 0, 0, 0.35);
          max-width: 980px;
        }
        .block {
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.18);
          padding: 14px;
          margin-top: 12px;
          white-space: pre-wrap;
          line-height: 1.5;
        }
        .blockTitle {
          font-weight: 900;
          margin-bottom: 8px;
        }

        .btnPrimary {
          width: 100%;
          margin-top: 14px;
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid rgba(139, 120, 255, 0.25);
          background: linear-gradient(135deg, var(--accentA), var(--accentB));
          color: rgba(255, 255, 255, 0.95);
          cursor: pointer;
          font-weight: 900;
        }

        .toast {
          position: fixed;
          left: 16px;
          bottom: 18px;
          z-index: 80;
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(10, 12, 24, 0.72);
          backdrop-filter: blur(10px);
          color: rgba(255, 255, 255, 0.92);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
          font-size: 13px;
        }

        @media (max-width: 980px) {
          .shell {
            flex-direction: column;
          }
          .historySidebar.open,
          .historySidebar.closed {
            width: 100%;
            height: auto;
            position: relative;
            top: auto;
          }
          .historyBody {
            height: auto;
            max-height: 340px;
          }
          .card {
            max-width: 100%;
          }
        }
      `}</style>

      {/* Top bar */}
      <div className="topbar">
        <div className="brandLeft">
          <div className="brandIcon">✦</div>
          <div className="brandText">
            <div className="brandName">AI Humaniser</div>
            <div className="brandSub">History</div>
          </div>
        </div>

        <div className="topActions">
          <button className="btnSmall" onClick={() => router.push("/dashboard")}>
            ← Back
          </button>
          <button className="btnDanger" onClick={deleteCurrent} disabled={!id}>
            Delete
          </button>
        </div>
      </div>

      <div className="pageWrap">
        <div className="shell">
          {/* Sidebar */}
          <aside className={`historySidebar ${historyOpen ? "open" : "closed"}`}>
            <div className="historyHeader" onClick={(e) => e.stopPropagation()}>
              <div className="historyHeaderLeft">
                <span className="miniDot" />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {historyOpen ? "History" : ""}
                </span>
              </div>

              <div className="historyHeaderRight">
                {historyOpen ? (
                  <button className="btnSmall" onClick={newHumanise}>
                    + New
                  </button>
                ) : null}
                <button
                  className="btnSmall"
                  onClick={() => {
                    closeMenu();
                    setHistoryOpen((v) => !v);
                  }}
                >
                  {historyOpen ? "Collapse" : "Open"}
                </button>
              </div>
            </div>

            <div
              className="historyBody"
              onClick={(e) => {
                // keep clicks inside sidebar from auto-closing due to document handler if we want
                e.stopPropagation();
              }}
            >
              {historyOpen ? (
                <>
                  <button className="newBtn" onClick={newHumanise}>
                    + New Humanise
                  </button>

                  <div style={{ color: "rgba(255,255,255,0.62)", fontSize: 13, marginBottom: 10 }}>
                    {loadingHistory ? "Loading..." : `${history.length} item${history.length === 1 ? "" : "s"}`}
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    {history.map((h) => {
                      const hid = h._id || h.id;
                      const createdAt = h.createdAt || h.timestamp || h.date;
                      const input = h.input || h.aiText || h.text || "";
                      const t = makeTitle(input);
                      const active = String(hid) === String(id);

                      return (
                        <div
                          key={hid}
                          className={`histItem ${active ? "histItemActive" : ""}`}
                          onClick={() => openHistoryItem(hid)}
                        >
                          <div className="histRowTop">
                            <div className="histTitle">{t}</div>
                            <button
                              className="dotsBtn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpenId((prev) => (String(prev) === String(hid) ? null : hid));
                              }}
                              aria-label="More"
                              title="More"
                            >
                              ⋯
                            </button>
                          </div>

                          <div className="histMetaRow">
                            <span>{createdAt ? new Date(createdAt).toLocaleString() : ""}</span>
                            <span style={{ color: "rgba(255,255,255,0.45)" }}>{active ? "Active" : ""}</span>
                          </div>

                          {String(menuOpenId) === String(hid) && (
                            <div
                              className="menu"
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                            >
                              <button onClick={() => openHistoryItem(hid)}>Open</button>
                              <button className="danger" onClick={() => deleteHistoryItem(hid)}>
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="closedStack">
                  {history.slice(0, 10).map((h) => {
                    const hid = h._id || h.id;
                    const active = String(hid) === String(id);
                    return (
                      <div
                        key={hid}
                        className={`closedPill ${active ? "active" : ""}`}
                        onClick={() => openHistoryItem(hid)}
                        title={makeTitle(h.input || h.aiText || h.text || "")}
                      >
                        {active ? "●" : "•"}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          {/* Main */}
          <main className="main" onClick={closeMenu}>
            <h1 className="pageTitle">{loadingItem ? "Loading..." : "History Item"}</h1>
            <p className="sub">{item?.createdAt ? new Date(item.createdAt).toLocaleString() : ""}</p>

            <div className="card">
              <div className="block">
                <div className="blockTitle">Input</div>
                <div>{item?.input || ""}</div>
              </div>

              <div className="block" style={{ marginTop: 14 }}>
                <div className="blockTitle">Output</div>
                <div>{item?.output || ""}</div>
              </div>

              <button
                className="btnPrimary"
                onClick={() => {
                  loadIntoEditor();
                  showToast("Loaded into editor");
                }}
                disabled={!item}
              >
                Load into editor
              </button>
            </div>
          </main>
        </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}