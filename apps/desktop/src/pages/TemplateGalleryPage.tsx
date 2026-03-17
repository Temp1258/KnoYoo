import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Search, Sparkles, ArrowLeft, Loader2 } from "lucide-react";
import { tauriInvoke } from "../hooks/useTauriInvoke";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import type { GalleryTemplate, CareerTemplate } from "../types";

const CATEGORY_ALL = "全部";

export default function TemplateGalleryPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<GalleryTemplate[]>([]);
  const [details, setDetails] = useState<CareerTemplate[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(CATEGORY_ALL);
  const [applying, setApplying] = useState<string | null>(null);
  const [preview, setPreview] = useState<CareerTemplate | null>(null);

  useEffect(() => {
    tauriInvoke<GalleryTemplate[]>("list_gallery_templates").then(setTemplates).catch(console.error);
    tauriInvoke<CareerTemplate[]>("list_career_templates").then(setDetails).catch(console.error);
  }, []);

  const categories = useMemo(() => {
    const cats = new Set(templates.map((t) => t.category));
    return [CATEGORY_ALL, ...Array.from(cats)];
  }, [templates]);

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (category !== CATEGORY_ALL && t.category !== category) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [templates, search, category]);

  const applyTemplate = async (id: string) => {
    setApplying(id);
    try {
      await tauriInvoke("apply_career_template", { templateId: id });
      await tauriInvoke("mark_onboarded");
      navigate("/mindmap");
    } catch (e) {
      console.error(e);
    } finally {
      setApplying(null);
    }
  };

  const detailFor = (id: string) => details.find((d) => d.id === id) || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg text-text-secondary hover:bg-bg-tertiary hover:text-text transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-[28px] font-bold tracking-tight m-0">模板库</h1>
          <p className="text-[13px] text-text-secondary m-0">
            选择一个职业模板快速开始，或浏览不同方向的成长路径
          </p>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <Input
            placeholder="搜索模板..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 text-[12px] rounded-md border transition-colors cursor-pointer ${
                category === cat
                  ? "border-accent bg-accent/10 text-accent font-medium"
                  : "border-border text-text-secondary hover:border-accent/30"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grid + Preview */}
      <div className="flex gap-6">
        {/* Template Grid */}
        <div className="flex-1 grid grid-cols-2 gap-3">
          {filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => setPreview(detailFor(t.id))}
              className={`text-left p-4 rounded-xl border transition-all cursor-pointer ${
                preview?.id === t.id
                  ? "border-accent bg-accent/5 shadow-sm"
                  : "border-border bg-bg-secondary hover:border-accent/30 hover:shadow-sm"
              }`}
            >
              <div className="text-[14px] font-semibold text-text">{t.name}</div>
              <div className="text-[12px] text-text-secondary mt-0.5">{t.description}</div>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-[11px] text-text-tertiary">
                  {t.skill_count} 技能 · {t.sub_skill_count} 子技能
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-tertiary">
                  {t.category}
                </span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-2 text-center py-12 text-text-tertiary text-[13px]">
              没有找到匹配的模板
            </div>
          )}
        </div>

        {/* Preview Panel */}
        {preview && (
          <div className="w-72 shrink-0">
            <Card padding="lg">
              <div className="space-y-4">
                <div>
                  <h3 className="text-[17px] font-bold text-text m-0">{preview.name}</h3>
                  <p className="text-[12px] text-text-secondary mt-1">{preview.description}</p>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] text-text-tertiary uppercase tracking-wide">技能清单</div>
                  {preview.skills.map((skill) => (
                    <div key={skill.name} className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-text">{skill.name}</span>
                        <span className="text-[10px] text-text-tertiary">
                          {"★".repeat(skill.importance)}
                        </span>
                      </div>
                      <div className="text-[11px] text-text-tertiary pl-2">
                        {skill.children.join(" · ")}
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  variant="primary"
                  onClick={() => applyTemplate(preview.id)}
                  disabled={applying === preview.id}
                >
                  {applying === preview.id ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> 应用中...
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} /> 使用此模板
                    </>
                  )}
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
