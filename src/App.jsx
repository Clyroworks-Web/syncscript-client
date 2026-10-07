import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "https://syncscript-server-0rc2.onrender.com";

export default function App() {
  const [socket, setSocket] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [userCount, setUserCount] = useState(1);
  const [remoteCursors, setRemoteCursors] = useState({});

  const editorRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // Extract or generate document UUID from URL path
  const roomData = useRef({
    id: (() => {
      const pathParts = window.location.pathname.split("/").filter(Boolean);
      const existingId = pathParts[pathParts.length - 1];
      if (existingId && existingId !== "documents") {
        return existingId;
      }
      const newId = crypto.randomUUID();
      window.history.replaceState(null, "", `/documents/${newId}`);
      return newId;
    })(),
    hostKey: null,
  });

  // 1. Primary Socket Connection & Live Cursor Listeners
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

  // 2. Room Management, Document Sync & Termination Handling
  useEffect(() => {
    if (!socket) return;

    const docId = roomData.current.id;
    const storedHostKey = localStorage.getItem(`syncscript_host_${docId}`);
    roomData.current.hostKey = storedHostKey;

    // Request document state and claim/verify host privileges
    socket.emit("get-document", {
      docId,
      hostKey: storedHostKey,
    });

    socket.on("room-init", (data) => {
      setIsHost(data.isHost);
      setIsLocked(data.isLocked);

      if (data.isHost && data.assignedHostKey) {
        localStorage.setItem(`syncscript_host_${docId}`, data.assignedHostKey);
        roomData.current.hostKey = data.assignedHostKey;
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

    // Kill switch listener: kicks participants and purges host credentials
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

  // 3. User Handlers
  const handleInput = () => {
    if (isLocked && !isHost) return;
    if (!socket || !editorRef.current) return;

    const content = editorRef.current.innerHTML;

    // Instant delta broadcast to participants
    socket.emit("send-changes", content);

    // Debounced database write (1000ms idle threshold)
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
      hostKey:
        roomData.current.hostKey ||
        localStorage.getItem(`syncscript_host_${roomData.current.id}`),
    });
  };

  const handleEndMeeting = () => {
    const confirmEnd = window.confirm(
      "Are you sure you want to end this meeting for everyone? The document session will be terminated."
    );

    if (confirmEnd && socket) {
      socket.emit("end-meeting", {
        docId: roomData.current.id,
        hostKey:
          roomData.current.hostKey ||
          localStorage.getItem(`syncscript_host_${roomData.current.id}`),
      });
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

  // 4. Component Layout
  return (
    <div className="app-container" onMouseMove={handleMouseMove}>
      {/* Remote Collaborator Cursors */}
      {Object.entries(remoteCursors).map(([id, cursor]) => (
        <div
          key={id}
          className="remote-cursor"
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

      {/* Navigation Header */}
      <header className="navbar">
        <div className="navbar-brand">
          <span className="brand-logo">⚡</span>
          <span className="brand-title">SyncScript</span>
          <span className="room-badge">
            Room: {roomData.current.id.slice(0, 8)}...
          </span>
          <span className="user-badge">👥 {userCount} online</span>
        </div>

        <div className="navbar-controls">
          <button className="btn btn-secondary" onClick={handleExportTxt}>
            Export TXT
          </button>
          <button className="btn btn-secondary" onClick={handleExportMd}>
            Export MD
          </button>

          {/* Host-only Action Buttons */}
          {isHost && (
            <>
              <button
                className={`btn ${isLocked ? "btn-warning" : "btn-secondary"}`}
                onClick={handleToggleLock}
              >
                {isLocked ? "🔒 Unlock Room" : "🔓 Lock Room"}
              </button>

              <button
                className="btn btn-danger"
                onClick={handleEndMeeting}
                style={{
                  backgroundColor: "#ef4444",
                  color: "#ffffff",
                  border: "none",
                  padding: "6px 14px",
                  borderRadius: "6px",
                  fontWeight: "600",
                  cursor: "pointer",
                  marginLeft: "8px",
                }}
              >
                End Meeting
              </button>
            </>
          )}
        </div>
      </header>

      {/* Editor Surface */}
      <main className="editor-container">
        {isLocked && !isHost && (
          <div className="lock-banner">
            ⚠️ The host has locked this document. It is currently read-only.
          </div>
        )}

        <div
          ref={editorRef}
          className={`editor-surface ${isLocked && !isHost ? "readonly" : ""}`}
          contentEditable={!isLocked || isHost}
          onInput={handleInput}
          suppressContentEditableWarning={true}
          placeholder="Start typing your meeting notes here..."
        />
      </main>
    </div>
  );
}