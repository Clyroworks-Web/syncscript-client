import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

// Direct production backend URL
const SERVER_URL = "https://syncscript-server-0rc2.onrender.com";

export default function App() {
  const [title, setTitle] = useState("Untitled Document");
  const [collaborators, setCollaborators] = useState(1);
  const [socket, setSocket] = useState(null);
  const editorRef = useRef(null);
  const isIncomingChange = useRef(false);

  // Extract or generate document room ID
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
    };
  }, []);

  // 2. Room Management & Incoming Real-time Updates
  useEffect(() => {
    if (!socket) return;

    socket.emit("get-document", docId.current);

    socket.on("load-document", (doc) => {
      if (editorRef.current) {
        isIncomingChange.current = true;
        editorRef.current.innerHTML = typeof doc === "string" ? doc : (doc?.data || "");
      }
    });

    socket.on("receive-changes", (incomingHtml) => {
      if (editorRef.current) {
        isIncomingChange.current = true;
        editorRef.current.innerHTML = incomingHtml;
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

  // 3. Emit Outgoing Changes to Server & MongoDB
  const handleInput = () => {
    if (isIncomingChange.current) {
      isIncomingChange.current = false;
      return;
    }
    if (!socket || !editorRef.current) return;
    const html = editorRef.current.innerHTML;
    socket.emit("send-changes", html);
    socket.emit("save-document", html);
  };

  // 4. Formatting Actions
  const format = (command, value = null) => {
    document.execCommand(command, false, value);
    if (editorRef.current) editorRef.current.focus();
    handleInput();
  };

  // 5. File Export Actions
  const exportFile = (formatType) => {
    if (!editorRef.current) return;
    const content = formatType === "txt" 
      ? editorRef.current.innerText 
      : editorRef.current.innerHTML;
    
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
      {/* Top Header */}
      <header style={styles.topBar}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={styles.titleInput}
          placeholder="Untitled Document"
        />
        <div style={styles.rightActions}>
          <div style={styles.badge}>
            <span style={styles.dot}>●</span> {collaborators} Collaborator{collaborators > 1 ? "s" : ""}
          </div>
          <button style={styles.btn} onClick={() => exportFile("txt")}>Export TXT</button>
          <button style={styles.btn} onClick={() => exportFile("md")}>Export MD</button>
        </div>
      </header>

      {/* Rich Text Toolbar */}
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

      {/* Document Workspace */}
      <main style={styles.editorWrapper}>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
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
  titleInput: {
    backgroundColor: "transparent",
    border: "none",
    color: "#ffffff",
    fontSize: "18px",
    fontWeight: "600",
    outline: "none",
    width: "280px",
  },
  rightActions: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
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