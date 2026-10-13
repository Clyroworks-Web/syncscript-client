import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "https://syncscript-server-0rc2.onrender.com";

export default function App() {
  const [socket, setSocket] = useState(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isMeetingEnded, setIsMeetingEnded] = useState(false);
  const [userCount, setUserCount] = useState(1);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [copied, setCopied] = useState(false);

  const editorRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // Initialize room ID and local host credential
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

  // 1. Establish Socket Connection
  useEffect(() => {
    const s = io(SERVER_URL, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    setSocket(s);

    s.on("cursor-update", ({ socketId, x, y, color }) => {
      setRemoteCursors((prev) => ({
        ...prev,
        [socketId]: { x, y, color },
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

  // 2. Room State Synchronization & Meeting End Enforcement
  useEffect(() => {
    if (!socket) return;

    const { id: docId, hostKey } = roomData.current;

    socket.emit("get-document", {
      docId,
      hostKey,
    });

    socket.on("room-init", (data) => {
      if (data && typeof data.isHost === "boolean") {
        setIsHost(data.isHost);
      }
      if (data && typeof data.isLocked === "boolean") {
        setIsLocked(data.isLocked);
      }
    });

    socket.on("load-document", (docContent) => {
      if (editorRef.current) {
        const raw =
          typeof docContent === "string" ? docContent : docContent?.data || "";
        editorRef.current.innerHTML = raw;
      }
    });

    socket.on("receive-changes", (delta) => {
      if (isMeetingEnded) return;
      if (editorRef.current && delta !== editorRef.current.innerHTML) {
        editorRef.current.innerHTML = delta;
      }
    });

    socket.on("lock-updated", (lockedStatus) => {
      setIsLocked(lockedStatus);
    });

    socket.on("user-count", (count) => {
      setUserCount(count);
    });

    // Enforce permanent read-only lock when host ends session
    socket.on("meeting-terminated", () => {
      setIsMeetingEnded(true);
      setIsLocked(true);
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

  // 3. User Handlers
  const handleInput = () => {
    if (isMeetingEnded || (isLocked && !isHost)) return;
    if (!socket || !editorRef.current) return;

    const content = editorRef.current.innerHTML;
    socket.emit("send-changes", content);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      socket.emit("save-document", content);
    }, 1000);
  };

  const handleKeyDown = (e) => {
    // Hard-block all typing, deletion, or shortcuts if session has ended
    if (isMeetingEnded || (isLocked && !isHost)) {
      e.preventDefault();
    }
  };

  const handleMouseMove = (e) => {
    if (!socket || isMeetingEnded) return;
    socket.emit("cursor-move", {
      x: e.clientX,
      y: e.clientY,
      color: isHost ? "#3b82f6" : "#10b981",
    });
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      "Are you sure you want to end this meeting for everyone? The document will be permanently locked and wiped."
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

  const isEditable = !isMeetingEnded && (!isLocked || isHost);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        backgroundColor: "#0d0e15",
        color: "#e2e8f0",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
      onMouseMove={handleMouseMove}
    >
      {/* Remote Collaborators Cursors */}
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
              transition: "left 0.08s linear, top 0.08s linear",
            }}
          >
            <div
              style={{
                width: "12px",
                height: "12px",
                backgroundColor: cursor.color || "#10b981",
                borderRadius: "50%",
                boxShadow: "0 0 8px rgba(0,0,0,0.5)",
              }}
            />
          </div>
        ))}

      {/* Top Collaborative Navbar */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 24px",
          backgroundColor: "#161722",
          borderBottom: "1px solid #232536",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span
            style={{
              fontSize: "1.25rem",
              fontWeight: "700",
              color: "#60a5fa",
              letterSpacing: "-0.5px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            ⚡ SyncScript
          </span>

          <span
            style={{
              fontSize: "0.82rem",
              backgroundColor: "#202234",
              border: "1px solid #2e3047",
              padding: "4px 10px",
              borderRadius: "6px",
              color: "#94a3b8",
              fontFamily: "monospace",
            }}
          >
            Room: {roomData.current.id.slice(0, 8)}...
          </span>

          <span
            style={{
              fontSize: "0.82rem",
              backgroundColor: "#1a2c26",
              border: "1px solid #22493d",
              padding: "4px 10px",
              borderRadius: "6px",
              color: "#34d399",
              fontWeight: "500",
            }}
          >
            👥 {userCount} online
          </span>

          <span
            style={{
              fontSize: "0.82rem",
              backgroundColor: isHost ? "#1e293b" : "#1f2937",
              border: `1px solid ${isHost ? "#3b82f6" : "#4b5563"}`,
              color: isHost ? "#93c5fd" : "#d1d5db",
              padding: "4px 10px",
              borderRadius: "6px",
              fontWeight: "600",
            }}
          >
            {isHost ? "👑 Host" : "👤 Collaborator"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={handleCopyLink}
            style={{
              backgroundColor: copied ? "#059669" : "#222538",
              color: "#ffffff",
              border: "1px solid #333752",
              padding: "6px 12px",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: "500",
              transition: "background-color 0.2s",
            }}
          >
            {copied ? "✅ Copied!" : "📋 Copy Link"}
          </button>

          <button
            onClick={handleExportTxt}
            style={{
              backgroundColor: "#222538",
              color: "#cbd5e1",
              border: "1px solid #333752",
              padding: "6px 12px",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: "500",
            }}
          >
            Export TXT
          </button>

          <button
            onClick={handleExportMd}
            style={{
              backgroundColor: "#222538",
              color: "#cbd5e1",
              border: "1px solid #333752",
              padding: "6px 12px",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: "500",
            }}
          >
            Export MD
          </button>

          {/* Host Exclusive Actions */}
          {isHost && !isMeetingEnded && (
            <>
              <button
                onClick={handleToggleLock}
                style={{
                  backgroundColor: isLocked ? "#d97706" : "#222538",
                  color: "#ffffff",
                  border: "1px solid #4a4e70",
                  padding: "6px 14px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: "600",
                }}
              >
                {isLocked ? "🔒 Unlock Room" : "🔓 Lock Room"}
              </button>

              <button
                onClick={handleEndMeeting}
                style={{
                  backgroundColor: "#dc2626",
                  color: "#ffffff",
                  border: "none",
                  padding: "6px 14px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                  fontWeight: "600",
                }}
              >
                End Meeting
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Workspace Sheet Surface */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "36px 16px",
          backgroundColor: "#0d0e15",
        }}
      >
        {/* Meeting Ended Alert Banner */}
        {isMeetingEnded && (
          <div
            style={{
              width: "100%",
              maxWidth: "850px",
              backgroundColor: "#450a0a",
              border: "1px solid #991b1b",
              color: "#fecaca",
              padding: "14px 20px",
              borderRadius: "8px",
              marginBottom: "20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              boxShadow: "0 4px 14px rgba(0,0,0,0.3)",
            }}
          >
            <div>
              <strong>🛑 Meeting Terminated:</strong> The host has ended this
              session. Editing is permanently disabled on this pad.
            </div>
            <button
              onClick={() => (window.location.href = "/")}
              style={{
                backgroundColor: "#dc2626",
                color: "#ffffff",
                border: "none",
                padding: "6px 14px",
                borderRadius: "6px",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "0.85rem",
              }}
            >
              Start New Meeting
            </button>
          </div>
        )}

        {/* Lock Notice Banner */}
        {isLocked && !isHost && !isMeetingEnded && (
          <div
            style={{
              width: "100%",
              maxWidth: "850px",
              backgroundColor: "#451a03",
              border: "1px solid #92400e",
              color: "#fef3c7",
              padding: "10px 18px",
              borderRadius: "8px",
              marginBottom: "16px",
              fontSize: "0.9rem",
            }}
          >
            ⚠️ The host has locked this document. It is currently read-only.
          </div>
        )}

        {/* Collaborative Document Pad Canvas */}
        <div
          ref={editorRef}
          contentEditable={isEditable}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          suppressContentEditableWarning={true}
          style={{
            width: "100%",
            maxWidth: "850px",
            minHeight: "78vh",
            backgroundColor: "#161722",
            border: `1px solid ${isMeetingEnded ? "#7f1d1d" : "#232536"}`,
            borderRadius: "10px",
            padding: "40px 48px",
            fontSize: "1.05rem",
            lineHeight: "1.75",
            outline: "none",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
            cursor: !isEditable ? "not-allowed" : "text",
            opacity: isMeetingEnded ? 0.7 : 1,
            color: "#f1f5f9",
          }}
          placeholder="Start typing your collaborative notes here..."
        />
      </main>
    </div>
  );
}