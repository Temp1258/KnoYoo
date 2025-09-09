import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hello } from "@knoyoo/shared";

export default function App() {
  const [name, setName] = useState("KnoYoo");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await invoke<number>("add_note", { content: note });
      setNote("");
    } catch (e) {
      console.error(e);
      alert("保存失败: " + e);
    } finally {
      setSaving(false);
    }
  }

  async function onSearch() {
    try {
      const rows = await invoke<string[]>("search_notes", { query: q });
      setResults(rows);
    } catch (e) {
      console.error(e);
      alert("搜索失败: " + e);
    }
  }

  return (
    <div style={{ padding: 24, color: "#111", fontFamily: "system-ui" }}>
      <h2>{hello(name)}</h2>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Enter a name..."
        style={{ padding: 8, borderRadius: 8, marginBottom: 16 }}
      />

      <hr style={{ margin: "16px 0" }} />

      <h3>新增记录</h3>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="输入要保存的文本..."
        rows={3}
        style={{ width: "100%", padding: 8, borderRadius: 8 }}
      />
      <div style={{ marginTop: 8 }}>
        <button onClick={onSave} disabled={saving} style={{ padding: "8px 12px" }}>
          {saving ? "保存中..." : "保存"}
        </button>
      </div>

      <h3 style={{ marginTop: 24 }}>全文搜索（FTS5）</h3>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder='关键字或 "短语" 或 a OR b'
        style={{ padding: 8, borderRadius: 8, width: "100%" }}
      />
      <div style={{ marginTop: 8 }}>
        <button onClick={onSearch} style={{ padding: "8px 12px" }}>
          搜索
        </button>
      </div>

      <ul style={{ marginTop: 16 }}>
        {results.map((text, i) => (
          <li key={i} style={{ marginBottom: 8 }}>
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
