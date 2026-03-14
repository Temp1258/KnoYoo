import React, { useState } from "react";
import PlanPanel from "../components/Plan/PlanPanel";
import AISettingsPanel from "../components/AI/AISettingsPanel";
import { useAIConfig } from "../hooks/useAIConfig";
import type { Hit, Note } from "../types";

interface Props {
  results: Hit[];
  onSelectNote: (note: Note) => void;
}

/** Safe snippet renderer: replaces [mark]/[/mark] with <mark> elements */
function HighlightedSnippet({ snippet }: { snippet: string }) {
  const parts = snippet.split(/\[\/?(mark)\]/);
  const elements: React.ReactNode[] = [];
  let inMark = false;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "mark") {
      inMark = !inMark;
      continue;
    }
    if (inMark) {
      elements.push(<mark key={i}>{parts[i]}</mark>);
    } else {
      elements.push(parts[i]);
    }
  }

  return <span>{elements}</span>;
}

export default function HomePage({ results, onSelectNote }: Props) {
  const [showAISettings, setShowAISettings] = useState(false);
  const { loadConfig } = useAIConfig();

  return (
    <div>
      <h2 style={{ marginBottom: 8 }}>Know More About You!</h2>
      <div style={{ marginTop: 8, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="btn"
          onClick={async () => {
            setShowAISettings((v) => !v);
            if (!showAISettings) await loadConfig();
          }}
        >
          {showAISettings ? "收起 AI 设置" : "AI 设置"}
        </button>
      </div>
      {showAISettings && <AISettingsPanel />}

      {results.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3>搜索结果</h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {results.map((hit) => (
              <li key={hit.id} style={{ marginBottom: 16 }}>
                <div
                  style={{ fontWeight: 600, cursor: "pointer" }}
                  onClick={() => onSelectNote({ id: hit.id, title: hit.title, content: "", created_at: "" })}
                >
                  {hit.title}
                </div>
                <HighlightedSnippet snippet={hit.snippet} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>计划</h3>
        </div>
        <PlanPanel />
      </div>
    </div>
  );
}
