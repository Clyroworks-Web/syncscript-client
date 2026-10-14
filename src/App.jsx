import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "https://syncscript-server-0rc2.onrender.com";
const socket = io(SERVER_URL);

export default function App() {
  const [socket, setSocket] = useState(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isMeetingEnded, setIsMeetingEnded] = useState(false);
  const [userCount, setUserCount] = useState(1);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [copiedLink, setCopiedLink] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Saved to Cloud • Active");

  const editorRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // Initialize Room ID and Host State
  const roomData = useRef((() => {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const existingId = pathParts[pathParts.length - 1];
    const isNew = !existingId || existingId === "documents";
    const id = isNew ? crypto.randomUUID() : existingId;

    if (isNew) {
      window.history.replaceState(null, "", `/documents/${id}`);
    }

    let hostKey = localStorage.getItem(`syncscript_host_${id}`);
    const isOwner = Boolean(hostKey) || isNew;

    if (isNew && !hostKey) {
      hostKey = crypto.randomUUID();
      localStorage.setItem(`syncscript_host_${id}`, hostKey);
    }

    return { id, hostKey, isOwner };
  })());

  const [isHost, setIsHost] = useState(roomData.current.isOwner);

  // 1. Socket Setup
  useEffect(() => {
    const s = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    setSocket(s);

    s.on("cursor-update", ({ socketId, x, y, name, color }) => {
      setRemoteCursors((prev) => ({
        ...prev,
        [socketId]: { x, y, name: name || "Collaborator", color: color || "#3B82F6" },
      }));
    });

    s.on("cursor-remove", (socketId) => {
      setRemoteCursors((prev) => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
    });

    return () => {
      s.disconnect();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // 2. Room State & Meeting End Handlers
  useEffect(() => {
    if (!socket) return;
    const { id: docId, hostKey } = roomData.current;

    socket.emit("get-document", { docId, hostKey });

    socket.on("room-init", (data) => {
      if (data && typeof data.isHost === "boolean") setIsHost(data.isHost);
      if (data && typeof data.isLocked === "boolean") setIsLocked(data.isLocked);
    });

    socket.on("load-document", (docContent) => {
      if (editorRef.current) {
        const raw = typeof docContent === "string" ? docContent : docContent?.data || "";
        editorRef.current.innerHTML = raw;
      }
    });

    socket.on("receive-changes", (delta) => {
      if (isMeetingEnded) return;
      if (editorRef.current && delta !== editorRef.current.innerHTML) {
        editorRef.current.innerHTML = delta;
      }
    });

    socket.on("lock-updated", (status) => setIsLocked(status));
    socket.on("user-count", (count) => setUserCount(count));

    // Hard lock on termination
    socket.on("meeting-terminated", () => {
      setIsMeetingEnded(true);
      setIsLocked(true);
      setSaveStatus("Session Terminated");
      if (editorRef.current) {
        editorRef.current.contentEditable = "false";
      }
      if (roomData.current?.id) {
        localStorage.removeItem(`syncscript_host_${roomData.current.id}`);
      }
    });

    return () => {
      socket.off("room-init");
      socket.off("load-document");
      socket.off("receive-changes");
      socket.off("lock-updated");
      socket.off("user-count");
      socket.off("meeting-terminated");
    };
  }, [socket, isMeetingEnded]);

  // Document Editing
  const handleInput = () => {
    if (isMeetingEnded || (isLocked && !isHost)) return;
    if (!socket || !editorRef.current) return;

    setSaveStatus("Saving changes...");
    const content = editorRef.current.innerHTML;
    socket.emit("send-changes", content);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      socket.emit("save-document", content);
      setSaveStatus("Saved to Cloud • Active");
    }, 1000);
  };

  // Block any keyboard interaction if meeting has ended or locked
  const handleKeyDown = (e) => {
    if (isMeetingEnded || (isLocked && !isHost)) {
      e.preventDefault();
    }
  };

  // Live Cursor Broadcast
  const handleMouseMove = (e) => {
    if (!socket || isMeetingEnded) return;
    socket.emit("cursor-move", {
      x: e.clientX,
      y: e.clientY,
      name: isHost ? "Host" : "Guest",
      color: isHost ? "#3B6B96" : "#48BB78",
    });
  };

  // Actions
  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleToggleLock = () => {
    if (!socket || !isHost || isMeetingEnded) return;
    socket.emit("toggle-lock", {
      docId: roomData.current.id,
      hostKey: roomData.current.hostKey,
    });
    setIsLocked((prev) => !prev);
  };

  const handleEndMeeting = () => {
    const confirmEnd = window.confirm(
      "Are you sure you want to end this meeting for everyone? The document will be permanently locked."
    );
    if (confirmEnd) {
      if (socket) {
        socket.emit("end-meeting", {
          docId: roomData.current.id,
          hostKey: roomData.current.hostKey,
        });
      }
      setIsMeetingEnded(true);
      setIsLocked(true);
      setSaveStatus("Session Terminated");
      if (editorRef.current) {
        editorRef.current.contentEditable = "false";
      }
      localStorage.removeItem(`syncscript_host_${roomData.current.id}`);
    }
  };

  const handleExportTxt = () => {
    if (!editorRef.current) return;
    const text = editorRef.current.innerText;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `SyncScript-${roomData.current.id.slice(0, 8)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMd = () => {
    if (!editorRef.current) return;
    const text = editorRef.current.innerText;
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `SyncScript-${roomData.current.id.slice(0, 8)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Formatting actions
  const formatText = (cmd, val = null) => {
    if (isMeetingEnded || (isLocked && !isHost)) return;
    document.execCommand(cmd, false, val);
    if (editorRef.current) editorRef.current.focus();
  };

  const isEditable = !isMeetingEnded && (!isLocked || isHost);

  return (
    <div
      onMouseMove={handleMouseMove}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#f4f5f7",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: "#2d3748",
        overflow: "hidden",
      }}
    >
      {/* Live Remote Multiplayer Cursors */}
      {!isMeetingEnded &&
        Object.entries(remoteCursors).map(([id, cursor]) => (
          <div
            key={id}
            style={{
              position: "fixed",
              left: `${cursor.x}px`,
              top: `${cursor.y}px`,
              pointerEvents: "none",
              zIndex: 9999,
              transition: "left 0.08s ease-out, top 0.08s ease-out",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={cursor.color}>
              <path d="M3 3l7 18 3-7 7-3L3 3z" />
            </svg>
            <span
              style={{
                marginLeft: "8px",
                backgroundColor: cursor.color,
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: "600",
                padding: "2px 8px",
                borderRadius: "12px",
                boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
                whiteSpace: "nowrap",
              }}
            >
              {cursor.name}
            </span>
          </div>
        ))}

      {/* TOP HEADER */}
      <header
        style={{
          height: "60px",
          backgroundColor: "#ffffff",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          flexShrink: 0,
        }}
      >
        {/* Left Header Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#ffffff",
              border: "1.5px solid #d1d5db",
              borderRadius: "8px",
              padding: "5px 12px",
              fontSize: "13px",
              fontWeight: "600",
              color: "#374151",
            }}
          >
            <span>Room ID: {roomData.current.id.slice(0, 8)}...</span>
            <button
              onClick={handleCopyLink}
              title="Copy Room Link"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px",
                display: "flex",
                alignItems: "center",
              }}
            >
              📋
            </button>
          </div>

          <div
            style={{
              backgroundColor: "#e6fffa",
              border: "1.5px solid #81e6d9",
              color: "#234e52",
              padding: "5px 12px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>👥 {userCount} Online</span>
          </div>
        </div>

        {/* Center Logo */}
        <div
          style={{
            fontSize: "20px",
            fontWeight: "800",
            color: "#1e293b",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span style={{ color: "#0284c7" }}>⚡</span> SyncScript
        </div>

        {/* Right Cloud Status Pill */}
        <div
          style={{
            backgroundColor: "#f8fafc",
            border: "1.5px solid #e2e8f0",
            color: "#475569",
            padding: "5px 14px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: "500",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>☁️</span>
          <span>
            {saveStatus.includes("Active") ? (
              <>
                Saved to Cloud • <strong style={{ color: "#16a34a" }}>Active</strong>
              </>
            ) : (
              saveStatus
            )}
          </span>
        </div>
      </header>

      {/* WORKSPACE BODY */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* LEFT SIDEBAR (No 'Control Panel' text, matching colors) */}
        <aside
          style={{
            width: "200px",
            backgroundColor: "#ffffff",
            borderRight: "1px solid #e2e8f0",
            padding: "20px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            flexShrink: 0,
          }}
        >
          {/* HOST / GUEST BADGE */}
          <div
            style={{
              backgroundColor: isHost ? "#426b8f" : "#e2e8f0",
              color: isHost ? "#ffffff" : "#4a5568",
              padding: "10px",
              borderRadius: "8px",
              fontWeight: "700",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}
          >
            {isHost ? "👑 HOST" : "👤 GUEST"}
          </div>

          {/* LOCK ROOM */}
          {isHost && (
            <button
              onClick={handleToggleLock}
              disabled={isMeetingEnded}
              style={{
                backgroundColor: isLocked ? "#fef3c7" : "#fffdf0",
                border: "1.5px solid #d4a346",
                color: "#8f6517",
                padding: "10px",
                borderRadius: "8px",
                fontWeight: "700",
                fontSize: "13px",
                cursor: isMeetingEnded ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}
            >
              {isLocked ? "🔒 LOCKED" : "🔓 LOCK ROOM"}
            </button>
          )}

          {/* COPY LINK */}
          <button
            onClick={handleCopyLink}
            style={{
              backgroundColor: "#eef4fb",
              border: "1.5px solid #b7d3f2",
              color: "#2c649b",
              padding: "10px",
              borderRadius: "8px",
              fontWeight: "600",
              fontSize: "13px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            {copiedLink ? "✅ Copied!" : "📋 Copy Link"}
          </button>

          {/* EXPORT TXT (Soft Pastel Green) */}
          <button
            onClick={handleExportTxt}
            style={{
              backgroundColor: "#eef8f2",
              border: "1.5px solid #a8ddc0",
              color: "#28734a",
              padding: "10px",
              borderRadius: "8px",
              fontWeight: "600",
              fontSize: "13px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            📄 Export TXT
          </button>

          {/* EXPORT MD (Soft Pastel Purple) */}
          <button
            onClick={handleExportMd}
            style={{
              backgroundColor: "#f5effb",
              border: "1.5px solid #d0b8ed",
              color: "#623696",
              padding: "10px",
              borderRadius: "8px",
              fontWeight: "600",
              fontSize: "13px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            📝 Export MD
          </button>

          {/* PUSH TO BOTTOM */}
          <div style={{ flex: 1 }} />

          {/* END MEETING */}
          {isHost && (
            <button
              onClick={handleEndMeeting}
              disabled={isMeetingEnded}
              style={{
                backgroundColor: isMeetingEnded ? "#f3f4f6" : "#fdecec",
                border: `1.5px solid ${isMeetingEnded ? "#d1d5db" : "#f2aeae"}`,
                color: isMeetingEnded ? "#9ca3af" : "#a62828",
                padding: "10px",
                borderRadius: "8px",
                fontWeight: "700",
                fontSize: "13px",
                cursor: isMeetingEnded ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}
            >
              🛑 {isMeetingEnded ? "Meeting Ended" : "End Meeting"}
            </button>
          )}
        </aside>

        {/* MAIN COLLABORATIVE AREA SHEET */}
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "20px 24px 16px 24px",
            overflowY: "auto",
            position: "relative",
          }}
        >
          {/* TERMINATION BANNER */}
          {isMeetingEnded && (
            <div
              style={{
                width: "100%",
                maxWidth: "880px",
                backgroundColor: "#fdecec",
                border: "1.5px solid #f2aeae",
                color: "#991b1b",
                padding: "12px 18px",
                borderRadius: "8px",
                marginBottom: "12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontWeight: "600",
                fontSize: "13px",
              }}
            >
              <span>🛑 Meeting has ended. Pad editing is permanently disabled for all participants.</span>
              <button
                onClick={() => (window.location.href = "/")}
                style={{
                  backgroundColor: "#a62828",
                  color: "#ffffff",
                  border: "none",
                  padding: "6px 14px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "700",
                  fontSize: "12px",
                }}
              >
                New Meeting
              </button>
            </div>
          )}

          {/* COLLABORATIVE PAD CARD */}
          <div
            style={{
              width: "100%",
              maxWidth: "880px",
              backgroundColor: "#faf7f2",
              border: `1px solid ${isMeetingEnded ? "#f2aeae" : "#e8e3da"}`,
              borderRadius: "10px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.03)",
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: "70vh",
              marginBottom: "80px",
            }}
          >
            {/* Pad Card Title */}
            <div
              style={{
                textAlign: "center",
                padding: "8px 0",
                fontSize: "12px",
                fontWeight: "700",
                letterSpacing: "0.8px",
                color: "#78716c",
                borderBottom: "1px solid #ede8e1",
              }}
            >
              COLLABORATIVE AREA
            </div>

            {/* Editable Content Area */}
            <div
              ref={editorRef}
              contentEditable={isEditable}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              suppressContentEditableWarning={true}
              style={{
                flex: 1,
                padding: "24px 32px",
                fontSize: "15px",
                lineHeight: "1.75",
                outline: "none",
                color: "#1c1917",
                cursor: !isEditable ? "not-allowed" : "text",
                opacity: isMeetingEnded ? 0.65 : 1,
              }}
              data-placeholder="...Collaborative notes here..."
            />
          </div>

          {/* BOTTOM FLOATING DOCK */}
          <div
            style={{
              position: "fixed",
              bottom: "16px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
              zIndex: 50,
            }}
          >
            <span
              style={{
                fontSize: "11px",
                fontWeight: "700",
                letterSpacing: "0.6px",
                color: "#64748b",
              }}
            >
              FONT & STYLING
            </span>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: "#ffffff",
                border: "1.5px solid #d1d5db",
                borderRadius: "10px",
                padding: "6px 14px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
              }}
            >
              <select
                onChange={(e) => formatText("fontName", e.target.value)}
                disabled={!isEditable}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                  padding: "4px 8px",
                  fontSize: "12px",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="Sans-Serif">Sans</option>
                <option value="Georgia">Serif</option>
                <option value="Courier New">Mono</option>
              </select>

              <div style={{ width: "1px", height: "18px", backgroundColor: "#e2e8f0" }} />

              <button
                onClick={() => formatText("bold")}
                disabled={!isEditable}
                style={{
                  background: "none",
                  border: "none",
                  fontWeight: "800",
                  fontSize: "14px",
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
              >
                B
              </button>

              <button
                onClick={() => formatText("italic")}
                disabled={!isEditable}
                style={{
                  background: "none",
                  border: "none",
                  fontStyle: "italic",
                  fontSize: "14px",
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
              >
                I
              </button>

              <button
                onClick={() => formatText("underline")}
                disabled={!isEditable}
                style={{
                  background: "none",
                  border: "none",
                  textDecoration: "underline",
                  fontSize: "14px",
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
              >
                U
              </button>

              <button
                onClick={() => formatText("insertUnorderedList")}
                disabled={!isEditable}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "14px",
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
              >
                ≡
              </button>

              <div style={{ width: "1px", height: "18px", backgroundColor: "#e2e8f0" }} />

              <input
                type="color"
                defaultValue="#000000"
                onChange={(e) => formatText("foreColor", e.target.value)}
                disabled={!isEditable}
                title="Pick Text Color"
                style={{
                  width: "22px",
                  height: "22px",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: "4px",
                  backgroundColor: "transparent",
                }}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}