import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import DOMPurify from "dompurify";

window.DOMPurify = DOMPurify;
const SERVER_URL = "https://syncscript-server-0rc2.onrender.com";

export default function App() {
  const [title, setTitle] = useState("Untitled Document");
  const [collaborators, setCollaborators] = useState(1);
  const [socket, setSocket] = useState(null);
  const [copied, setCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Saved");
  const [isLocked, setIsLocked] = useState(false);
  const [isHost, setIsHost] = useState(false);

  const editorRef = useRef(null);
  const isIncomingChange = useRef(false);
  const saveTimeoutRef = useRef(null);

  // 1. Get or Generate Room ID & Host Key
  const getRoomData = () => {
    const path = window.location.pathname;
    const match = path.match(/\/documents\/([a-zA-Z0-9_-]+)/);
    
    if (match && match[1]) {
      const id = match[1];
      const existingHostKey = localStorage.getItem(`syncscript_host_${id}`);
      return { id, hostKey: existingHostKey || null };
    }

    const newId = crypto.randomUUID();
    const newHostKey = crypto.randomUUID();
    localStorage.setItem(`syncscript_host_${newId}`, newHostKey);
    window.history.replaceState(null, "", `/documents/${newId}`);
    return { id: newId, hostKey: newHostKey };
  };

  const roomData = useRef(getRoomData());

  // 2. Establish Socket Connection
  useEffect(() => {
    const s = io(SERVER_URL, {
      transports: ["websocket", "polling"],
    });
    setSocket(s);

    s.on("connect", () => {
      console.log("Connected to live server:", s.id);
    });

    s.on("connect_error", (error) => {
      console.error("Socket error:", error.message);
    });

    return () => {
      s.disconnect();
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // 3. Socket Event Handlers
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

    socket.on("load-document", (doc) => {
      if (editorRef.current) {
        isIncomingChange.current = true;
        const rawContent = typeof doc === "string" ? doc : (doc?.data || "");
        editorRef.current.innerHTML = DOMPurify.sanitize(rawContent);
        setSaveStatus("Saved");
      }
    });

    socket.on("receive-changes", (incomingHtml) => {
      if (editorRef.current) {
        isIncomingChange.current = true;
        editorRef.current.innerHTML = DOMPurify.sanitize(incomingHtml);
      }
    });

    socket.on("lock-updated", (lockedState) => {
      setIsLocked(lockedState);
    });

    socket.on("user-count", (count) => {
      setCollaborators(count);
    });

    return () => {
      socket.off("room-init");
      socket.off("load-document");
      socket.off("receive-changes");
      socket.off("lock-updated");
      socket.off("user-count");
    };
  }, [socket]);

  const canEdit = !isLocked || isHost;

  // 4. Input Handler with Debounced Auto-Save
  const handleInput = () => {
    if (!canEdit || isIncomingChange.current || !socket || !editorRef.current) {
      isIncomingChange.current = false;
      return;
    }

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

  // 7. Copy Link Handler
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

          {/* Copy Link (Blue) */}
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

          {/* Export TXT (Teal) */}
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

          {/* Export MD (Violet) */}
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

      <main style={styles.editorWrapper}>
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