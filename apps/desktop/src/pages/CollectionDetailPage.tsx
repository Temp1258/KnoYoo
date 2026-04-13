import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft } from "lucide-react";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import type { Collection, WebClip } from "../types";
import ClipCard from "../components/Clips/ClipCard";
import ClipDetail from "../components/Clips/ClipDetail";
import Button from "../components/ui/Button";
import { SkeletonCard } from "../components/ui/Skeleton";
import { useMediaQuery } from "../hooks/useMediaQuery";

export default function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const collectionId = Number(id);

  const [collection, setCollection] = useState<Collection | null>(null);
  const [clips, setClips] = useState<WebClip[]>([]);
  const [selectedClip, setSelectedClip] = useState<WebClip | null>(null);
  const [loading, setLoading] = useState(true);
  const isWide = useMediaQuery("(min-width: 1024px)");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [col, list] = await Promise.all([
        tauriInvoke<Collection>("get_collection", { id: collectionId }),
        tauriInvoke<WebClip[]>("list_collection_clips", { collectionId, pageSize: 100 }),
      ]);
      setCollection(col);
      setClips(list);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [collectionId]);

  useEffect(() => {
    let stale = false;
    Promise.all([
      tauriInvoke<Collection>("get_collection", { id: collectionId }),
      tauriInvoke<WebClip[]>("list_collection_clips", { collectionId, pageSize: 100 }),
    ])
      .then(([col, list]) => {
        if (stale) return;
        setCollection(col);
        setClips(list);
      })
      .catch(console.error)
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [collectionId]);

  const handleStar = async (clipId: number) => {
    await tauriInvoke("toggle_star_clip", { id: clipId });
    load();
    if (selectedClip?.id === clipId) {
      setSelectedClip((prev) => (prev ? { ...prev, is_starred: !prev.is_starred } : null));
    }
  };

  const handleRemove = async (clipId: number) => {
    await tauriInvoke("remove_clip_from_collection", { collectionId, clipId });
    load();
    if (selectedClip?.id === clipId) setSelectedClip(null);
  };

  if (!collection && !loading) {
    return (
      <div className="text-center py-16 text-text-tertiary">
        <p>集合不存在</p>
        <Button variant="ghost" size="sm" onClick={() => navigate("/collections")}>
          返回集合列表
        </Button>
      </div>
    );
  }

  if (selectedClip && !isWide) {
    return (
      <ClipDetail
        key={selectedClip.id}
        clip={selectedClip}
        onBack={() => setSelectedClip(null)}
        onStar={handleStar}
        onUpdate={(c) => {
          setSelectedClip(c);
          load();
        }}
      />
    );
  }

  const splitView = isWide && selectedClip;

  return (
    <div className={splitView ? "flex gap-0 -mx-6 -my-6 h-[calc(100vh)]" : ""}>
      {splitView && (
        <div className="w-3/5 order-2 overflow-y-auto px-6 py-6 border-l border-border">
          <ClipDetail
            clip={selectedClip}
            onBack={() => setSelectedClip(null)}
            onStar={handleStar}
            onUpdate={(c) => {
              setSelectedClip(c);
              load();
            }}
            compact
          />
        </div>
      )}

      <div className={splitView ? "w-2/5 order-1 overflow-y-auto px-4 py-4" : ""}>
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/collections")}>
            <ArrowLeft size={14} />
          </Button>
          {collection && (
            <>
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[14px] font-bold shrink-0"
                style={{ backgroundColor: collection.color }}
              >
                {collection.name[0]?.toUpperCase()}
              </div>
              <div>
                <h1 className="text-[22px] font-bold text-text m-0">{collection.name}</h1>
                {collection.description && (
                  <p className="text-[12px] text-text-tertiary m-0">{collection.description}</p>
                )}
              </div>
              <span className="text-[12px] text-text-tertiary ml-auto">{clips.length} 条收藏</span>
            </>
          )}
        </div>

        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {!loading && clips.length === 0 && (
          <div className="text-center py-16 text-text-tertiary">
            <p className="text-[14px]">这个集合还是空的</p>
            <p className="text-[12px]">在收藏详情中点击"添加到集合"来添加内容</p>
          </div>
        )}

        {clips.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {clips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                onStar={handleStar}
                onDelete={() => handleRemove(clip.id)}
                onSelect={setSelectedClip}
                onRetag={() => {}}
                isSelected={selectedClip?.id === clip.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
