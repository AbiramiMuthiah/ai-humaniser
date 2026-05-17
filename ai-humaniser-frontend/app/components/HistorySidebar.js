"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import api from "../lib/api";

function makeTitle(item) {
  const input = item?.input || item?.aiText || item?.text || "";
  const t = String(input).trim();
  if (!t) return "Untitled";
  return t.length > 42 ? t.slice(0, 42) + "…" : t;
}

export default function HistorySidebar({
  open,
  setOpen,
  activeId = null, // pass current id when on /texts/[id]
  onNew = null, // optional callback for dashboard
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [menuId, setMenuId] = useState(null);

  const bodyRef = useRef(null);

  const inTextsPage = useMemo(() => pathname?.startsWith("/texts/"), [pathname]);

  async function loadHistory() {
    setLoading(true);
    try {
      const res = await api.get("/history?limit=50&page=1");
      const list = res.data?.items || [];
      setItems(Array.isArray(list) ? list : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // close menu on outside click
  useEffect(() => {
    function onDocClick(e) {
      if (!menuId) return;
      const el = document.getElementById(`menu-${menuId}`);
      if (el && !el.contains(e.target)) setMenuId(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuId]);

  const handleNew = () => {
    // clear draft + go dashboard
    sessionStorage.removeItem("draft_ai");
    sessionStorage.removeItem("draft_human");
    sessionStorage.setItem("toast", "New Humanise ready.");
    router.push("/dashboard");
    onNew?.();
  };

  const handleOpenItem = (id) => {
    router.push(`/texts/${id}`);
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/texts/${id}`);
      setItems((prev) => prev.filter((x) => (x._id || x.id) !== id));
      setMenuId(null);

      // if you delete the currently open item, route back
      if (activeId && activeId === id) router.push("/dashboard");
    } catch {
      // ignore
    }
  };

  return (
    <aside className={`historySidebar ${open ? "open" : "closed"}`} aria-label="History">
      <div className="historyHeader">
        <div className="historyTitle">{open ? "History" : ""}</div>

        <div className="historyHeaderBtns">
          {open ? (
            <button className="btn btn--mini btn--ghost" onClick={handleNew}>
              + New
            </button>
          ) : (
            <button className="iconBtn" title="New" onClick={handleNew}>
              +
            </button>
          )}

          <button className="btn btn--mini btn--ghost" onClick={() => setOpen((v) => !v)}>
            {open ? "Collapse" : "›"}
          </button>
        </div>
      </div>

      <div className="historyBody" ref={bodyRef}>
        {open ? (
          <>
            <button className="btn newHumaniseBtn" onClick={handleNew}>
              + New Humanise
            </button>

            <div className="historyMetaRow">
              <div className="muted">{loading ? "Loading..." : `${items.length} item${items.length === 1 ? "" : "s"}`}</div>
            </div>
          </>
        ) : null}

        <div className="historyListCompact">
          {items.map((item) => {
            const id = item._id || item.id;
            const createdAt = item.createdAt || item.timestamp || item.date;
            const title = makeTitle(item);

            const isActive = String(activeId || "") === String(id);

            return (
              <div
                key={id}
                className={`historyRow ${open ? "rowOpen" : "rowClosed"} ${isActive ? "active" : ""}`}
                onClick={() => handleOpenItem(id)}
                role="button"
                tabIndex={0}
              >
                <div className="historyRowText">
                  <div className="historyRowTitle">{open ? title : "•"}</div>
                  {open ? (
                    <div className="historyRowTime">{createdAt ? new Date(createdAt).toLocaleString() : ""}</div>
                  ) : null}
                </div>

                {open ? (
                  <div className="historyRowActions" onClick={(e) => e.stopPropagation()}>
                    <button className="iconBtn" title="More" onClick={() => setMenuId((v) => (v === id ? null : id))}>
                      …
                    </button>

                    {menuId === id ? (
                      <div id={`menu-${id}`} className="dotMenu">
                        <button className="dotMenuItem danger" onClick={() => handleDelete(id)}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* tiny footer hint when collapsed */}
      {!open ? <div className="historyCollapsedHint" /> : null}
    </aside>
  );
}