import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Send, Menu, Plus, Copy, Check, Paperclip, FileText, X, Settings, Trash2, MessageSquare, Save } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './index.css';

// --- Types ---
interface Attachment { name: string; content: string; size: number; }
interface Message {
  id: string; role: 'user' | 'assistant';
  content: string; display?: string; files?: Attachment[];
}
interface Session { id: string; title: string; messages: Message[]; ts: number; }

const PROXY_URL = 'http://localhost:3002';
const MODEL = 'gpt-oss:120b-cloud';
const LS_KEY = 'chrxgpt_apikey';
const LS_SESSIONS = 'chrxgpt_sessions';
const LS_ACTIVE = 'chrxgpt_active_session';

// --- Helpers ---
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
const loadKey = () => localStorage.getItem(LS_KEY) || '';
const saveKey = (k: string) => localStorage.setItem(LS_KEY, k);
const loadSessions = (): Session[] => { try { return JSON.parse(localStorage.getItem(LS_SESSIONS) || '[]'); } catch { return []; } };
const saveSessions = (s: Session[]) => localStorage.setItem(LS_SESSIONS, JSON.stringify(s));
const loadActive = () => localStorage.getItem(LS_ACTIVE) || '';
const saveActive = (id: string) => localStorage.setItem(LS_ACTIVE, id);

// --- Code Block ---
function CodeBlock({ lang, children }: { lang: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="code-block">
      <div className="code-header"><span>{lang || 'code'}</span>
        <button onClick={copy} className="copy-btn">{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</button>
      </div>
      <pre className="code-pre"><code>{children}</code></pre>
    </div>
  );
}

// --- Markdown ---
const MdContent = memo(({ text }: { text: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    code({ className, children }) {
      const lang = className?.replace('language-', '') || '';
      const str = String(children).replace(/\n$/, '');
      if (lang || str.includes('\n')) return <CodeBlock lang={lang}>{str}</CodeBlock>;
      return <code className="inline-code">{children}</code>;
    },
    table({ children }) { return <div className="table-wrap"><table>{children}</table></div>; },
  }}>{text}</ReactMarkdown>
));

// --- Turn ---
const Turn = memo(({ msg }: { msg: Message }) => (
  <div className={`turn ${msg.role}`}>
    <img className="turn-avatar" src={msg.role === 'user' ? '/user.jpeg' : '/gpt.png'} alt="" />
    <div className="turn-body">
      {msg.role === 'user' ? (
        <>
          {msg.files && msg.files.length > 0 && (
            <div className="msg-files">{msg.files.map((f, i) => (
              <div className="msg-file-chip" key={i}><FileText size={13} /> {f.name} <span className="file-size">({(f.size / 1024).toFixed(1)}KB)</span></div>
            ))}</div>
          )}
          {msg.display && <p>{msg.display}</p>}
        </>
      ) : <MdContent text={msg.content} />}
    </div>
  </div>
));

// ═══════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════
export default function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeId, setActiveId] = useState(loadActive);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [apiKey, setApiKey] = useState(loadKey);
  const [keyDraft, setKeyDraft] = useState(loadKey);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Active session
  const activeSession = sessions.find(s => s.id === activeId);
  const messages = activeSession?.messages || [];

  // Persist sessions
  useEffect(() => { saveSessions(sessions); }, [sessions]);
  useEffect(() => { saveActive(activeId); }, [activeId]);

  // Auto-scroll
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamText]);

  // Health check
  useEffect(() => {
    if (!apiKey) { setConnected(null); return; }
    fetch(`${PROXY_URL}/health`).then(() => setConnected(true)).catch(() => setConnected(false));
  }, [apiKey]);

  // Textarea resize
  const handleInput = useCallback((v: string) => {
    setInput(v);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; }
    });
  }, []);

  // File reading
  const readFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => setAttachments(prev => [...prev, { name: file.name, content: reader.result as string, size: file.size }]);
      reader.readAsText(file);
    });
  }, []);
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) readFiles(e.target.files);
    e.target.value = '';
  }, [readFiles]);

  // Drag & Drop
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return; setDragging(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files);
  }, [readFiles]);

  // --- New Chat ---
  const newChat = () => {
    const s: Session = { id: uid(), title: 'New chat', messages: [], ts: Date.now() };
    setSessions(prev => [s, ...prev]);
    setActiveId(s.id);
    setSidebarOpen(false);
  };

  // --- Switch Chat ---
  const switchChat = (id: string) => { setActiveId(id); setSidebarOpen(false); };

  // --- Delete Chat ---
  const deleteChat = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeId === id) setActiveId('');
  };

  // --- Save API Key ---
  const handleSaveKey = () => { setApiKey(keyDraft); saveKey(keyDraft); setShowSettings(false); };

  // --- Update session messages ---
  const updateMessages = (msgs: Message[]) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== activeId) return s;
      const title = s.title === 'New chat' && msgs.length > 0
        ? (msgs[0].display || msgs[0].content).slice(0, 40)
        : s.title;
      return { ...s, messages: msgs, title };
    }));
  };

  // --- Submit ---
  const handleSubmit = async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (loading) return;

    // Auto-create session if none active
    let sid = activeId;
    if (!sid) {
      const s: Session = { id: uid(), title: 'New chat', messages: [], ts: Date.now() };
      setSessions(prev => [s, ...prev]);
      sid = s.id;
      setActiveId(s.id);
    }

    let apiContent = '';
    if (attachments.length > 0) {
      apiContent = attachments.map(f => `📎 File: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n');
      if (text) apiContent += '\n\n' + text;
    } else { apiContent = text; }

    const userMsg: Message = {
      id: uid(), role: 'user', content: apiContent,
      display: text || 'Analyze files',
      files: attachments.length > 0 ? [...attachments] : undefined,
    };

    const currentMsgs = sessions.find(s => s.id === sid)?.messages || [];
    const next = [...currentMsgs, userMsg];

    // Update session
    setSessions(prev => prev.map(s => {
      if (s.id !== sid) return s;
      const title = s.title === 'New chat' ? (text || 'File analysis').slice(0, 40) : s.title;
      return { ...s, messages: next, title };
    }));

    setInput(''); setAttachments([]);
    if (taRef.current) taRef.current.style.height = 'auto';
    setLoading(true); setStreamText('');

    try {
      const headers: any = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const res = await fetch(`${PROXY_URL}/api/chat/stream`, {
        method: 'POST', headers,
        body: JSON.stringify({ model: MODEL, messages: next.map(m => ({ role: m.role, content: m.content })) }),
      });

      if (!res.ok) {
        const err = await res.text();
        const errMsg: Message = { id: uid(), role: 'assistant', content: `⚠️ Error: ${err}` };
        setSessions(prev => prev.map(s => s.id === sid ? { ...s, messages: [...next, errMsg] } : s));
        setLoading(false); return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try { const p = JSON.parse(data); if (p.content) { full += p.content; setStreamText(full); } } catch {}
          }
        }
      }

      const aiMsg: Message = { id: uid(), role: 'assistant', content: full };
      setSessions(prev => prev.map(s => s.id === sid ? { ...s, messages: [...next, aiMsg] } : s));
      setStreamText('');
    } catch (err: any) {
      const errMsg: Message = { id: uid(), role: 'assistant', content: `⚠️ ${err.message}` };
      setSessions(prev => prev.map(s => s.id === sid ? { ...s, messages: [...next, errMsg] } : s));
    } finally { setLoading(false); }
  };

  // ═══ RENDER ═══
  return (
    <div className="app" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {dragging && <div className="drop-overlay"><div className="drop-label">Drop files here</div></div>}
      {sidebarOpen && <div className="overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Settings</h3>
              <button className="btn-close" onClick={() => setShowSettings(false)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <label>API Key</label>
              <input type="password" value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder="Enter your Ollama API key..." />
              <p className="hint">Get your key at <a href="https://ollama.com/settings/keys" target="_blank" rel="noreferrer">ollama.com/settings/keys</a></p>
              <label style={{ marginTop: 16 }}>Model</label>
              <input value={MODEL} disabled />
              <button className="btn-save" onClick={handleSaveKey}><Save size={14} /> Save Settings</button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        {/* Profile */}
        <div className="sidebar-profile">
          <img src="/gpt.png" alt="" className="profile-avatar" />
          <div className="profile-info">
            <div className="profile-name">ChrxGPT</div>
            <div className="profile-model">{MODEL}</div>
          </div>
          <button className="btn-settings-small" onClick={() => setShowSettings(true)}><Settings size={16} /></button>
        </div>

        <button className="btn-new-chat" onClick={newChat}><Plus size={16} /> New Chat</button>

        {/* Chat History */}
        <div className="sidebar-sessions">
          {sessions.map(s => (
            <div key={s.id} className={`session-item ${s.id === activeId ? 'active' : ''}`} onClick={() => switchChat(s.id)}>
              <MessageSquare size={14} />
              <span className="session-title">{s.title}</span>
              <button className="session-delete" onClick={e => { e.stopPropagation(); deleteChat(s.id); }}><X size={14} /></button>
            </div>
          ))}
          {sessions.length === 0 && <p className="sidebar-empty">No conversations yet</p>}
        </div>

        {/* Status */}
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className={`status-dot ${connected ? 'on' : ''}`} />
            <span>{connected ? 'Online' : connected === false ? 'Offline' : 'No key'}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        <header className="topbar">
          <button className="btn-menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <img src="/logo.png" alt="" className="topbar-logo" />
          <span className="topbar-title">ChrxGPT</span>
          <button className="btn-settings-top" onClick={() => setShowSettings(true)}><Settings size={18} /></button>
        </header>

        <div className="chat-scroll" ref={chatRef}>
          <div className="chat-thread">
            {messages.length === 0 && !loading && (
              <div className="welcome">
                <img className="welcome-icon" src="/gpt.png" alt="" />
                <h1>What can I help with?</h1>
                <p className="welcome-sub">Cybersecurity Research Assistant • 120B</p>
              </div>
            )}

            {messages.map(msg => <Turn key={msg.id} msg={msg} />)}

            {loading && streamText && (
              <div className="turn assistant">
                <img className="turn-avatar" src="/gpt.png" alt="" />
                <div className="turn-body"><MdContent text={streamText} /></div>
              </div>
            )}
            {loading && !streamText && (
              <div className="turn assistant">
                <img className="turn-avatar" src="/gpt.png" alt="" />
                <div className="turn-body"><div className="thinking"><span /><span /><span /></div></div>
              </div>
            )}
          </div>
        </div>

        <div className="composer">
          {attachments.length > 0 && (
            <div className="composer-attachment">
              {attachments.map((f, i) => (
                <div className="file-chip" key={i}>
                  <FileText size={14} /> <span>{f.name}</span>
                  <span className="file-size">({(f.size / 1024).toFixed(1)}KB)</span>
                  <button className="file-remove" onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="composer-box">
            <input ref={fileRef} type="file" hidden multiple
              accept=".txt,.py,.js,.ts,.tsx,.jsx,.json,.csv,.md,.html,.css,.sh,.yaml,.yml,.xml,.sql,.c,.cpp,.h,.java,.go,.rs,.rb,.php,.log,.env,.cfg,.ini,.toml"
              onChange={handleFile} />
            <button className="btn-attach" onClick={() => fileRef.current?.click()}><Paperclip size={18} /></button>
            <textarea ref={taRef} rows={1} value={input}
              onChange={e => handleInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
              placeholder="Message ChrxGPT..." />
            <button className="btn-send" onClick={handleSubmit} disabled={(!input.trim() && attachments.length === 0) || loading}>
              <Send size={16} />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
