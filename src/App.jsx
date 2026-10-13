import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "https://syncscript-server-0rc2.onrender.com";

export default function App() {
  const [socket, setSocket] = useState(null);
  const [isLocked, setIsLocked] = useState(false);
  const [userCount, setUserCount] = useState(1);
  const [remoteCursors, setRemoteCursors] = useState({});

  const editorRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // Determine room ID and host credentials immediately on page load
  const roomData = useRef((() => {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const existingId = pathParts[pathParts.length - 1];
    const isNew = !existingId || existingId === "documents";
    const id = isNew ? crypto.randomUUID() : existingId;

    if (isNew) {
      window.history.replaceState(null, "", `/documents/${id}`);
    }

    let hostKey = localStorage.getItem(`syncscript_host_${id}`);
    let isOwner = Boolean(hostKey) || isNew;

    if (isNew && !hostKey) {
      hostKey = crypto.randomUUID();
      localStorage.setItem(`syncscript_host_${id}`, hostKey);
    }

    return { id, hostKey, isOwner };
  })());

  // Instant host state assignment (no waiting for backend signal)
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

  // 2. Room Synchronization & Event Handlers
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

    socket.on("meeting-terminated", () => {
      alert("The host has ended this meeting session.");
      if (roomData.current?.id) {
        localStorage.removeItem(`syncscript_host_${roomData.current.id}`);
      }
      window.location.href = "/";
    });

    return () => {
      socket.off("room-init");
      socket.off("load-document");
      socket.off("receive-changes");
      socket.off("lock-updated");
      socket.off("user-count");
      socket.off("meeting-terminated");
    };
  }, [socket]);

  // 3. Document Editing & Host Actions
  const handleInput = () => {
    if (isLocked && !isHost) return;
    if (!socket || !editorRef.current) return;

    const content = editorRef.current.innerHTML;
    socket.emit("send-changes", content);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      socket.emit("save-document", content);
    }, 1000);
  };

  const handleMouseMove = (e) => {
    if (!socket) return;
    socket.emit("cursor-move", {
      x: e.clientX,
      y: e.clientY,
      color: isHost ? "#3b82f6" : "#10b981",
    });
  };

  const handleToggleLock = () => {
    if (!socket || !isHost) return;
    socket.emit("toggle-lock", {
      docId: roomData.current.id,
      hostKey: roomData.current.hostKey,
    });
    setIsLocked((prev) => !prev);
  };

  const handleEndMeeting = () => {
    const confirmEnd = window.confirm(
      "Are you sure you want to end this meeting for everyone? The document session will be terminated."
    );

    if (confirmEnd) {
      if (socket) {
        socket.emit("end-meeting", {
          docId: roomData.current.id,
          hostKey: roomData.current.hostKey,
        });
      }
      localStorage.removeItem(`syncscript_host_${roomData.current.id}`);
      alert("Meeting ended.");
      window.location.href = "/";
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#121218",
        color: "#ffffff",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
      onMouseMove={handleMouseMove}
    >
      {/* Live Remote Cursors */}
      {Object.entries(remoteCursors).map(([id, cursor]) => (
        <div
          key={id}
          style={{
            position: "fixed",
            left: `${cursor.x}px`,
            top: `${cursor.y}px`,
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: "12px",
              height: "12px",
              backgroundColor: cursor.color || "#10b981",
              borderRadius: "50%",
            }}
          />
        </div>
      ))}

      {/* Styled Top Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 24px",
          backgroundColor: "#1e1e2e",
          borderBottom: "1px solid #2e2e3e",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <span style={{ fontSize: "1.2rem", fontWeight: "700" }}>
            ⚡ SyncScript
          </span>
          <span
            style={{
              fontSize: "0.85rem",
              backgroundColor: "#2a2b3d",
              padding: "4px 10px",
              borderRadius: "6px",
              color: "#a0a0b8",
            }}
          >
            Room: {roomData.current.id.slice(0, 8)}...
          </span>
          <span
            style={{
              fontSize: "0.85rem",
              backgroundColor: "#2a2b3d",
              padding: "4px 10px",
              borderRadius: "6px",
              color: "#10b981",
            }}
          >
            👥 {userCount} online
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            onClick={handleExportTxt}
            style={{
              backgroundColor: "#2a2b3d",
              color: "#ffffff",
              border: "1px solid #3e3f58",
              padding: "6px 12px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "500",
            }}
          >
            Export TXT
          </button>
          <button
            onClick={handleExportMd}
            style={{
              backgroundColor: "#2a2b3d",
              color: "#ffffff",
              border: "1px solid #3e3f58",
              padding: "6px 12px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "500",
            }}
          >
            Export MD
          </button>

          {/* Host Controls */}
          {isHost && (
            <>
              <button
                onClick={handleToggleLock}
                style={{
                  backgroundColor: isLocked ? "#f59e0b" : "#2a2b3d",
                  color: "#ffffff",
                  border: "1px solid #3e3f58",
                  padding: "6px 14px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600",
                }}
              >
                {isLocked ? "🔒 Unlock Room" : "🔓 Lock Room"}
              </button>

              <button
                onClick={handleEndMeeting}
                style={{
                  backgroundColor: "#ef4444",
                  color: "#ffffff",
                  border: "none",
                  padding: "6px 14px",
                  borderRadius: "6px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                End Meeting
              </button>
            </>
          )}
        </div>
      </header>

      {/* Workspace Area */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "24px",
        }}
      >
        {isLocked && !isHost && (
          <div
            style={{
              backgroundColor: "#78350f",
              color: "#fef3c7",
              padding: "8px 16px",
              borderRadius: "6px",
              marginBottom: "16px",
              fontSize: "0.9rem",
            }}
          >
            ⚠️ The host has locked this document. It is currently read-only.
          </div>
        )}

        <div
          ref={editorRef}
          contentEditable={!isLocked || isHost}
          onInput={handleInput}
          suppressContentEditableWarning={true}
          style={{
            width: "100%",
            maxWidth: "850px",
            minHeight: "75vh",
            backgroundColor: "#181824",
            border: "1px solid #2e2e3e",
            borderRadius: "8px",
            padding: "24px",
            fontSize: "1.05rem",
            lineHeight: "1.6",
            outline: "none",
            cursor: isLocked && !isHost ? "not-allowed" : "text",
          }}
        />
      </main>
    </div>
  );
}