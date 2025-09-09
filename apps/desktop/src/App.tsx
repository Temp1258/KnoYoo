import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hello } from "@knoyoo/shared";

type Hit = { id: number; title: string; snippet: string };

export default function App() {
  const [name, setName] = useState("KnoYoo");

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<Hit[]>([]);

  async function onSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await invoke<number>("add_note", { title, content });
      setTitle("");
      setContent("");
      alert("已保存！");
    } catch (e) {
      console.error(e);
      alert("保存失败: " + e);
    } finally {
      setSaving(false);
    }
  }

  async function onSearch() {
    try {
      const rows = await invoke<Hit[]>("search_notes", { query: q });
      setResults(rows);
    } catch (e) {
      console.error(e);
      alert("搜索失败: " + e);
    }
  }

  const renderSnippet = (s: string) =>
    ({ __html: s.replaceAll("[mark]", "<mark>").replaceAll("[/mark]", "</mark>") });

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h2>{hello(name)}</h2>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Enter a name..."
        style={{ padding: 8, borderRadius: 8, marginBottom: 16 }}
      />

      <hr style={{ margin: "16px 0" }} />

      <h3>新增记录</h3>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="标题"
        style={{ width: "100%", padding: 8, borderRadius: 8, marginBottom: 8 }}
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="正文内容..."
        rows={4}
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
        placeholder='关键字 / "短语" / a OR b'
        style={{ padding: 8, borderRadius: 8, width: "100%" }}
      />
      <div style={{ marginTop: 8 }}>
        <button onClick={onSearch} style={{ padding: "8px 12px" }}>
          搜索
        </button>
      </div>

      <ul style={{ marginTop: 16, lineHeight: 1.6 }}>
        {results.map((hit) => (
          <li key={hit.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{hit.title}</div>
            <div
              dangerouslySetInnerHTML={renderSnippet(hit.snippet)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
