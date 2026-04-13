import { useMemo } from "react";

type Props = {
  text: string;
  query: string;
};

export default function HighlightText({ text, query }: Props) {
  const parts = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    return text.split(regex);
  }, [text, query]);

  if (!parts) return <>{text}</>;

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  );
}
