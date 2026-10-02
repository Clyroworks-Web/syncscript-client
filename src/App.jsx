import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import DOMPurify from "dompurify";

// Expose DOMPurify globally for browser console testing
window.DOMPurify = DOMPurify;

const SERVER_URL = "https://syncscript-server-0rc2.onrender.com";

export default function App() {
  const [title, setTitle] = useState("Untitled Document");
  const [collaborators, setCollaborators] = useState(1);
  const [socket, setSocket] = useState(null);
  const [copied, setCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Saved"); // "Saved" | "Saving..."
  
  const editorRef = useRef(null);
  const isIncomingChange = useRef(false);
  const saveTimeoutRef = useRef(null);

  const getDocumentId = () => {
    const path = window.location.pathname;
    const match = path.match(/\/documents\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    const newId = crypto.randomUUID();
    window.history.replaceState(null, "", `/documents/${newId}`);
    return newId;
  };

  const docId = useRef(getDocumentId());

  // 1. Establish Socket Connection
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

  // 2. Room Management & Incoming Real-time Updates (Sanitized)
  useEffect(() => {
    if (!socket) return;

    socket.emit("get-document", docId.current);

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

    socket.on("user-count", (count) => {
      setCollaborators(count);
    });

    return () => {
      socket.off("load-document");
      socket.off("receive-changes");
      socket.off("user-count");
    };
  }, [socket]);

  // 3. Emit Changes with Real-Time Sync & Debounced Cloud Save
  const handleInput = () => {
    if (isIncomingChange.current) {
      isIncomingChange.current = false;
      return;
    }
    if (!socket || !editorRef.current) return;
    
    const cleanHtml = DOMPurify.sanitize(editorRef.current.innerHTML);
    
    // Broadcast immediately so collaborators see typing in real time
    socket.emit("send-changes", cleanHtml);

    // Set saving status and debounce database write (waits 800ms after you pause typing)
    setSaveStatus("Saving...");
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(() => {
      socket.emit("save-document", cleanHtml);
      setSaveStatus("Saved");
    }, 800);
  };

  // 4. Sanitize Clipboard Paste Events Before Insertion
  const handlePaste = (e) => {
    e.preventDefault();
    const clipboardHtml = e.clipboardData.getData("text/html");
    const clipboardText = e.clipboardData.getData("text/plain");
    
    const cleanContent = clipboardHtml 
      ? DOMPurify.sanitize(clipboardHtml) 
      : DOMPurify.sanitize(clipboardText);

    document.execCommand("insertHTML", false, cleanContent);
    handleInput();
  };

  // 5. One-Click Copy Link Handler
  const handleCopyLink = () => {
    const cleanUrl = `${window.location.origin}/documents/${docId.current}`;
    navigator.clipboard.writeText(cleanUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // 6. Formatting Actions
  const format = (command, value = null) => {
    document.execCommand(command, false, value);
    if (editorRef.current) editorRef.current.focus();
    handleInput();
  };

  // 7. File Export Actions
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
        </div>

        <div style={styles.rightActions}>
          <button 
            style={{
              ...styles.copyBtn,
              backgroundColor: copied ? "#16a34a" : "#2563eb",
              borderColor: copied ? "#22c55e" : "#3b82f6"
            }} 
            onClick={handleCopyLink}
          >
            {copied ? "✓ Copied!" : "📋 Copy Link"}
          </button>

          <div style={styles.badge}>
            <span style={styles.dot}>●</span> {collaborators} Collaborator{collaborators > 1 ? "s" : ""}
          </div>
          <button style={styles.btn} onClick={() => exportFile("txt")}>Export TXT</button>
          <button style={styles.btn} onClick={() => exportFile("md")}>Export MD</button>
        </div>
      </header>

      <div style={styles.toolbar}>
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
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onPaste={handlePaste}
          style={styles.editorPage}
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
    gap: "16px",
  },
  titleInput: {
    backgroundColor: "transparent",
    border: "none",
    color: "#ffffff",
    fontSize: "18px",
    fontWeight: "600",
    outline: "none",
    width: "240px",
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
  rightActions: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  copyBtn: {
    color: "#ffffff",
    border: "1px solid",
    borderRadius: "6px",
    padding: "6px 14px",
    fontSize: "13px",
    cursor: "pointer",
    fontWeight: "600",
    transition: "background-color 0.2s ease, border-color 0.2s ease",
  },
  badge: {
    backgroundColor: "rgba(34, 197, 94, 0.15)",
    color: "#4ade80",
    padding: "6px 14px",
    borderRadius: "20px",
    fontSize: "13px",
    fontWeight: "500",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    border: "1px solid rgba(34, 197, 94, 0.3)",
  },
  dot: {
    color: "#22c55e",
    fontSize: "12px",
  },
  btn: {
    backgroundColor: "#3f3f46",
    color: "#ffffff",
    border: "1px solid #52525b",
    borderRadius: "6px",
    padding: "6px 14px",
    fontSize: "13px",
    cursor: "pointer",
    fontWeight: "500",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 24px",
    backgroundColor: "#202023",
    borderBottom: "1px solid #3f3f46",
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
    backgroundColor: "#ffffff",
    color: "#18181b",
    padding: "60px 80px",
    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
    borderRadius: "4px",
    outline: "none",
    fontSize: "16px",
    lineHeight: "1.6",
  },
};