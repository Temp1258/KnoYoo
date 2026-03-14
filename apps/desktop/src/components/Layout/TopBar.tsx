import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTree, faHome as faHouse, faUser } from "@fortawesome/free-solid-svg-icons";

type View = "plan" | "note" | "mindmap" | "me";

interface Props {
  view: View;
  onViewChange: (view: View) => void;
}

export default function TopBar({ view, onViewChange }: Props) {
  return (
    <div className="topbar">
      <button
        className={view === "mindmap" ? "active" : ""}
        onClick={() => onViewChange("mindmap")}
        title="行业树"
      >
        <FontAwesomeIcon icon={faTree} />
      </button>
      <button
        className={view === "plan" ? "active" : ""}
        onClick={() => onViewChange("plan")}
        title="主页"
      >
        <FontAwesomeIcon icon={faHouse} />
      </button>
      <button
        className={view === "me" ? "active" : ""}
        onClick={() => onViewChange("me")}
        title="我"
      >
        <FontAwesomeIcon icon={faUser} />
      </button>
    </div>
  );
}
