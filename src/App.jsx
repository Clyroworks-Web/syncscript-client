import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import DOMPurify from "dompurify";

window.DOMPurify = DOMPurify;
const SERVER_URL = "https://syncscript-server-0rc2.onrender.com";

const CURSOR_COLORS = [
  "#ef4444", "#3b82f6", "#10b981", "#f59e0b", 
  "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"
];

// Resolve Document ID and Host Key
const getRoomData = () => {
  const path = window.location.pathname;
  const match = path.match(/\/documents\/([a-zA-Z0-9_-]+)/);

  if (match && match[1]) {
    const id = match[1];
    // Existing room: read host key if this browser created it; do not invent a key for guests
    const existingHostKey = localStorage.getItem(`syncscript_host_${id}`);
    return { id, hostKey: existingHostKey || null, isCreator: Boolean(existingHostKey) };
  }

  // Creating a brand-new document from the root URL
  const newId = crypto.randomUUID();
  const newHostKey = crypto.randomUUID();
  localStorage.setItem(`syncscript_host_${newId}`, newHostKey);
  window.history.replaceState(null, "", `/documents/${newId}`);
  return { id: newId, hostKey: newHostKey, isCreator: true };
};

export default function App() {
  const roomData = useRef(getRoomData());

  const [title, setTitle] = useState("Untitled Document");
  const [collaborators, setCollaborators] = useState(1);
  const [socket, setSocket] = useState(null);
  const [copied, setCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Saved");
  const [isLocked, setIsLocked] = useState(false);
  const [isHost, setIsHost] = useState(roomData.current.isCreator);
  const [remoteCursors, setRemoteCursors] = useState({});

  const editorRef = useRef(null);
  const editorWrapperRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const lastCursorEmit = useRef(0);

  const userColor = useRef(
    CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)]
  );

  // 1. Connect to WebSocket Server
  useEffect(() => {
    const s = io(SERVER_URL, {
      transports: ["websocket", "polling"],
    });
    setSocket(s);

    s.on("connect", () => {
      console.log("Connected to live server with ID:", s.id);
    });

    s.on("connect_error", (error) => {
      console.error("Socket connection error:", error.message);
    });

    return () => {
      s.disconnect();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // 2. Room Management & Events
  useEffect(() => {
    if (!socket) return;

    socket.emit("get-document", {
      docId: roomData.current.id,
      hostKey: roomData.current.hostKey,
    });

    socket.on("room-init", (data) => {
      setIsHost(data.isHost);
      setIsLocked(data.isLocked);
      if (data.isHost && data.assignedHostKey) {
        localStorage.setItem(`syncscript_host_${roomData.current.id}`, data.assignedHostKey);
        roomData.current.hostKey = data.assignedHostKey;
      }
    });

    socket.on("load-document", (docContent) => {
      if (editorRef.current) {
        const raw = typeof docContent === "string" ? docContent : (docContent?.data || "");
        editorRef.current.innerHTML = DOMPurify.sanitize(raw);
        setSaveStatus("Saved");
      }
    });

    socket.on("receive-changes", (incomingHtml) => {
      if (editorRef.current) {
        editorRef.current.innerHTML = DOMPurify.sanitize(incomingHtml);
      }
    });

    socket.on("lock-updated", (lockedState) => {
      setIsLocked(lockedState);
    });

    socket.on("user-count", (count) => {
      setCollaborators(count);
    });

    socket.on("cursor-update", ({ socketId, x, y, color }) => {
      setRemoteCursors((prev) => ({
        ...prev,
        [socketId]: { x, y, color },
      }));
    });

    socket.on("cursor-remove", (socketId) => {
      setRemoteCursors((prev) => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
    });

    return () => {
      socket.off("room-init");
      socket.off("load-document");
      socket.off("receive-changes");
      socket.off("lock-updated");
      socket.off("user-count");
      socket.off("cursor-update");
      socket.off("cursor-remove");
    };
  }, [socket]);

  // Determine if this user is allowed to edit
  const canEdit = !isLocked || isHost;

  // 3. Mouse Movement Broadcaster
  const handleMouseMove = (e) => {
    if (!socket || !editorWrapperRef.current) return;
    const now = Date.now();
    if (now - lastCursorEmit.current < 40) return;
    lastCursorEmit.current = now;

    const rect = editorWrapperRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + editorWrapperRef.current.scrollLeft;
    const y = e.clientY - rect.top + editorWrapperRef.current.scrollTop;

    socket.emit("cursor-move", { x, y, color: userColor.current });
  };

  // 4. Editor Typing Sync & Debounced Save
  const handleInput = () => {
    if (!canEdit || !socket || !editorRef.current) return;

    const cleanHtml = DOMPurify.sanitize(editorRef.current.innerHTML);
    socket.emit("send-changes", cleanHtml);

    setSaveStatus("Saving...");
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(() => {
      socket.emit("save-document", cleanHtml);
      setSaveStatus("Saved");
    }, 800);
  };

  // 5. Paste Sanitization
  const handlePaste = (e) => {
    if (!canEdit) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    const clipboardHtml = e.clipboardData.getData("text/html");
    const clipboardText = e.clipboardData.getData("text/plain");

    const cleanContent = clipboardHtml
      ? DOMPurify.sanitize(clipboardHtml)
      : DOMPurify.sanitize(clipboardText);

    document.execCommand("insertHTML", false, cleanContent);
    handleInput();
  };

  // 6. Presenter Lock Toggle
  const toggleLock = () => {
    if (!isHost || !socket) return;
    socket.emit("toggle-lock", {
      docId: roomData.current.id,
      hostKey: roomData.current.hostKey,
    });
  };

  // 7. Copy URL
  const handleCopyLink = () => {
    const cleanUrl = `${window.location.origin}/documents/${roomData.current.id}`;
    navigator.clipboard.writeText(cleanUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // 8. Toolbar Commands
  const format = (command, value = null) => {
    if (!canEdit) return;
    document.execCommand(command, false, value);
    if (editorRef.current) editorRef.current.focus();
    handleInput();
  };

  // 9. Document Exporter
  const exportFile = (formatType) => {
    if (!editorRef.current) return;
    const content = formatType === "txt"
      ? editorRef.current.innerText
      : DOMPurify.sanitize(editorRef.current.innerHTML);

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.trim() || "document"}.${formatType}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={styles.container}>
      <header style={styles.topBar}>
        <div style={styles.titleGroup}>
          <input
            type="text"
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              if (!e.target.value.trim()) setTitle("Untitled Document");
            }}
            style={styles.titleInput}
            placeholder="Untitled Document"
          />
          <div style={styles.saveStatusBadge}>
            <span style={{
              ...styles.statusDot,
              backgroundColor: saveStatus === "Saved" ? "#22c55e" : "#f59e0b"
            }} />
            {saveStatus === "Saved" ? "Saved to Cloud" : "Saving..."}
          </div>

          {isLocked && (
            <div style={isHost ? styles.presenterBadge : styles.lockedBadge}>
              {isHost ? "🔒 Presenting (Viewers Locked)" : "🔒 Read Only (Presenter Mode)"}
            </div>
          )}
        </div>

        <div style={styles.rightActions}>
          {isHost && (
            <button
              style={{
                ...styles.btnBase,
                backgroundColor: isLocked ? "#dc2626" : "#27272a",
                borderColor: isLocked ? "#ef4444" : "#52525b",
              }}
              onClick={toggleLock}
            >
              {isLocked ? "🔓 Unlock Collaboration" : "🔒 Presenter Mode"}
            </button>
          )}

          <button
            style={{
              ...styles.btnBase,
              backgroundColor: copied ? "#16a34a" : "#2563eb",
              borderColor: copied ? "#22c55e" : "#3b82f6",
            }}
            onClick={handleCopyLink}
          >
            {copied ? "✓ Copied!" : "📋 Copy Link"}
          </button>

          <button
            style={{
              ...styles.btnBase,
              backgroundColor: "#0d9488",
              borderColor: "#14b8a6",
            }}
            onClick={() => exportFile("txt")}
          >
            📄 Export TXT
          </button>

          <button
            style={{
              ...styles.btnBase,
              backgroundColor: "#7c3aed",
              borderColor: "#8b5cf6",
            }}
            onClick={() => exportFile("md")}
          >
            📝 Export MD
          </button>

          <div style={styles.badge}>
            <span style={styles.dot}>●</span> {collaborators} Collaborator{collaborators > 1 ? "s" : ""}
          </div>
        </div>
      </header>

      {/* Formatting Toolbar */}
      <div style={{ ...styles.toolbar, opacity: canEdit ? 1 : 0.45, pointerEvents: canEdit ? "auto" : "none" }}>
        <select
          style={styles.select}
          onChange={(e) => format("formatBlock", e.target.value)}
          defaultValue="p"
        >
          <option value="p">Normal</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <div style={styles.divider} />
        <button style={styles.toolBtn} onClick={() => format("bold")}><b>B</b></button>
        <button style={styles.toolBtn} onClick={() => format("italic")}><i>I</i></button>
        <button style={styles.toolBtn} onClick={() => format("underline")}><u>U</u></button>
        <button style={styles.toolBtn} onClick={() => format("strikeThrough")}><del>S</del></button>
        <div style={styles.divider} />
        <button style={styles.toolBtn} onClick={() => format("insertOrderedList")}>1. List</button>
        <button style={styles.toolBtn} onClick={() => format("insertUnorderedList")}>• List</button>
        <button style={styles.toolBtn} onClick={() => format("removeFormat")}>T<sub>x</sub></button>
      </div>

      {/* Editor & Remote Cursors Workspace */}
      <main 
        ref={editorWrapperRef} 
        onMouseMove={handleMouseMove} 
        style={styles.editorWrapper}
      >
        {Object.entries(remoteCursors).map(([id, cursor]) => (
          <div
            key={id}
            style={{
              position: "absolute",
              left: `${cursor.x}px`,
              top: `${cursor.y}px`,
              pointerEvents: "none",
              zIndex: 50,
              transition: "left 0.06s linear, top 0.06s linear",
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill={cursor.color || "#3b82f6"}
              stroke="#ffffff"
              strokeWidth="1.5"
            >
              <path d="M3 3l7 18 3-7 7-3L3 3z" />
            </svg>
            <div
              style={{
                backgroundColor: cursor.color || "#3b82f6",
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: "600",
                padding: "2px 6px",
                borderRadius: "4px",
                marginLeft: "12px",
                marginTop: "-4px",
                whiteSpace: "nowrap",
                boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
              }}
            >
              Collaborator
            </div>
          </div>
        ))}

        <div
          ref={editorRef}
          contentEditable={canEdit}
          suppressContentEditableWarning
          onInput={handleInput}
          onPaste={handlePaste}
          style={{
            ...styles.editorPage,
            cursor: canEdit ? "text" : "not-allowed",
            backgroundColor: canEdit ? "#ffffff" : "#f8fafc",
          }}
        />
      </main>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    backgroundColor: "#18181b",
    color: "#f4f4f5",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 24px",
    backgroundColor: "#27272a",
    borderBottom: "1px solid #3f3f46",
  },
  titleGroup: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  titleInput: {
    backgroundColor: "transparent",
    border: "none",
    color: "#ffffff",
    fontSize: "18px",
    fontWeight: "600",
    outline: "none",
    width: "220px",
  },
  saveStatusBadge: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "12px",
    color: "#a1a1aa",
    fontWeight: "500",
  },
  statusDot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    display: "inline-block",
  },
  presenterBadge: {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    color: "#60a5fa",
    border: "1px solid rgba(59, 130, 246, 0.3)",
    padding: "3px 10px",
    borderRadius: "12px",
    fontSize: "12px",
    fontWeight: "600",
  },
  lockedBadge: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    color: "#f87171",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    padding: "3px 10px",
    borderRadius: "12px",
    fontSize: "12px",
    fontWeight: "600",
  },
  rightActions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  btnBase: {
    color: "#ffffff",
    border: "1px solid",
    borderRadius: "6px",
    padding: "6px 12px",
    fontSize: "13px",
    cursor: "pointer",
    fontWeight: "600",
    transition: "background-color 0.2s ease, border-color 0.2s ease",
    display: "flex",
    alignItems: "center",
    gap: "5px",
  },
  badge: {
    backgroundColor: "rgba(34, 197, 94, 0.15)",
    color: "#4ade80",
    padding: "6px 12px",
    borderRadius: "20px",
    fontSize: "13px",
    fontWeight: "500",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    border: "1px solid rgba(34, 197, 94, 0.3)",
    marginLeft: "4px",
  },
  dot: {
    color: "#22c55e",
    fontSize: "12px",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 24px",
    backgroundColor: "#202023",
    borderBottom: "1px solid #3f3f46",
    transition: "opacity 0.2s ease",
  },
  select: {
    backgroundColor: "#27272a",
    color: "#ffffff",
    border: "1px solid #3f3f46",
    borderRadius: "4px",
    padding: "4px 8px",
    fontSize: "13px",
    outline: "none",
  },
  divider: {
    width: "1px",
    height: "20px",
    backgroundColor: "#3f3f46",
    margin: "0 6px",
  },
  toolBtn: {
    backgroundColor: "#27272a",
    color: "#ffffff",
    border: "1px solid #3f3f46",
    borderRadius: "4px",
    padding: "5px 12px",
    fontSize: "13px",
    cursor: "pointer",
  },
  editorWrapper: {
    flex: 1,
    backgroundColor: "#09090b",
    overflowY: "auto",
    display: "flex",
    justifyContent: "center",
    padding: "32px 16px",
    position: "relative",
  },
  editorPage: {
    width: "850px",
    minHeight: "1100px",
    padding: "60px 80px",
    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
    borderRadius: "4px",
    outline: "none",
    fontSize: "16px",
    lineHeight: "1.6",
    color: "#18181b",
    transition: "background-color 0.2s ease",
  },
};