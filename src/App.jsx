import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { v4 as uuidV4 } from 'uuid';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "https://syncscript-server-0rc2.onrender.com";
const socket = io(SERVER_URL);
function DocumentEditor() {
  const { id: documentId } = useParams();
  const [documentText, setDocumentText] = useState('');
  const [title, setTitle] = useState('Untitled Document');
  const [userCount, setUserCount] = useState(1);

  // Join document room and register sync listeners.
  useEffect(() => {
    if (!documentId) return;

    socket.emit('get-document', documentId);

    socket.once('load-document', (doc) => {
      setDocumentText(doc.data || '');
      setTitle(doc.title || 'Untitled Document');
    });

    socket.on('receive-changes', (newText) => {
      setDocumentText(newText);
    });

    socket.on('receive-title-change', (newTitle) => {
      setTitle(newTitle);
    });

    socket.on('update-user-count', (count) => {
      setUserCount(count);
    });

    return () => {
      socket.off('receive-changes');
      socket.off('receive-title-change');
      socket.off('update-user-count');
    };
  }, [documentId]);

  // 3. Periodic autosave every 2 seconds
  useEffect(() => {
    if (!socket || !documentId) return;

    const interval = setInterval(() => {
      socket.emit('save-document', documentText);
    }, 2000);

    return () => clearInterval(interval);
  }, [documentId, documentText]);

  // 4. Handle text edits
  const handleEditorChange = (content, delta, source) => {
    setDocumentText(content);
    if (source === 'user' && socket) {
      socket.emit('send-changes', content);
    }
  };

  // 5. Handle title edits
  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    if (socket) {
      socket.emit('send-title-change', newTitle);
    }
  };

  // 6. Export as TXT / Markdown (.md)
  const exportAsFile = (extension) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = documentText;
    const cleanText = tempDiv.innerText || tempDiv.textContent || '';

    const blob = new Blob([cleanText], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${title.trim() || 'document'}.${extension}`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div style={{ maxWidth: '900px', margin: '30px auto', fontFamily: 'sans-serif' }}>
      {/* Top Navbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 18px',
        backgroundColor: '#f8f9fa',
        border: '1px solid #dee2e6',
        borderRadius: '8px',
        marginBottom: '20px'
      }}>
        {/* Document Title */}
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder="Untitled Document"
          style={{
            fontSize: '1.25rem',
            fontWeight: '600',
            color: '#212529',
            border: '1px solid transparent',
            background: 'transparent',
            padding: '4px 8px',
            borderRadius: '4px',
            outline: 'none',
            maxWidth: '300px'
          }}
          onFocus={(e) => e.target.style.border = '1px solid #ced4da'}
          onBlur={(e) => e.target.style.border = '1px solid transparent'}
        />

        {/* Presence & Exports */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: '0.85rem',
            color: '#155724',
            backgroundColor: '#d4edda',
            padding: '4px 10px',
            borderRadius: '16px',
            fontWeight: '500'
          }}>
            <span style={{
              height: '8px',
              width: '8px',
              backgroundColor: '#28a745',
              borderRadius: '50%',
              display: 'inline-block',
              marginRight: '6px'
            }}></span>
            {userCount} {userCount === 1 ? 'Collaborator' : 'Collaborators'}
          </div>

          <button onClick={() => exportAsFile('txt')} style={buttonStyle}>
            Export TXT
          </button>
          <button onClick={() => exportAsFile('md')} style={buttonStyle}>
            Export MD
          </button>
          <button
            onClick={() => window.print()}
            style={{ ...buttonStyle, backgroundColor: '#007bff', color: '#ffffff', borderColor: '#007bff' }}
          >
            Print / PDF
          </button>
        </div>
      </div>

      {/* Editor Surface */}
      <div style={{ backgroundColor: '#ffffff', color: '#000000', borderRadius: '4px', overflow: 'hidden' }}>
        <ReactQuill
          theme="snow"
          value={documentText}
          onChange={handleEditorChange}
          style={{ height: '450px', marginBottom: '50px' }}
        />
      </div>
    </div>
  );
}

const buttonStyle = {
  padding: '6px 12px',
  fontSize: '0.85rem',
  cursor: 'pointer',
  borderRadius: '4px',
  border: '1px solid #ced4da',
  backgroundColor: '#ffffff',
  color: '#212529',
  fontWeight: '500'
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate replace to={`/documents/${uuidV4()}`} />} />
        <Route path="/documents/:id" element={<DocumentEditor />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;