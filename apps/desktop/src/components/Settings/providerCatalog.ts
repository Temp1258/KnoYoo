/**
 * Logical provider catalog for the unified API 配置 tab.
 *
 * Each entry represents what the user thinks of as a "service" (DeepSeek,
 * SiliconFlow, OpenAI, …) and maps to up to two concrete backend roles:
 *  - `ai`: the OpenAI-compatible chat endpoint used for clip cleaning,
 *    summarisation, tagging, weekly reports, and the AI assistant.
 *  - `asr`: the speech-to-text endpoint used by the video import pipeline.
 *
 * A provider can fill either or both roles. This file is the single
 * source of truth for the merged tile grid; the underlying AI / ASR
 * presets in the legacy panels still exist (and the backend keys still
 * use those same provider ids), so changing labels here doesn't move
 * any data around.
 */

export type RoleConfig = {
  /** Backend provider id — the string written to `ai_selected_provider`
   *  or `asr_selected_provider`. */
  providerKey: string;
  api_base: string;
  model: string;
};

export type LogicalProvider = {
  /** Tile id, unique across the catalog. Has no backend significance. */
  id: string;
  label: string;
  /** Short tagline shown under the name in the tile grid. */
  tagline: string;
  /** "cn" splits domestic vs overseas regions for grouping in the UI. */
  region: "cn" | "intl";
  /** Where to register an account — surfaces in the editor. */
  signupHint: string;
  ai?: RoleConfig;
  asr?: RoleConfig;
};

export const LOGICAL_PROVIDERS: LogicalProvider[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    tagline: "国内 · 高性价比通用",
    region: "cn",
    signupHint: "deepseek.com",
    ai: {
      providerKey: "deepseek",
      api_base: "https://api.deepseek.com",
      model: "deepseek-chat",
    },
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    tagline: "国内 · 模型多 · ASR 最便宜",
    region: "cn",
    signupHint: "siliconflow.cn",
    ai: {
      providerKey: "silicon",
      api_base: "https://api.siliconflow.cn",
      model: "deepseek-ai/DeepSeek-V3",
    },
    asr: {
      providerKey: "siliconflow",
      api_base: "https://api.siliconflow.cn",
      model: "FunAudioLLM/SenseVoiceSmall",
    },
  },
  {
    id: "dashscope",
    label: "通义千问",
    tagline: "国内 · 阿里旗下",
    region: "cn",
    signupHint: "dashscope.aliyun.com",
    ai: {
      providerKey: "dashscope",
      api_base: "https://dashscope.aliyuncs.com/compatible-mode",
      model: "qwen-plus",
    },
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    tagline: "国内 · 清华系",
    region: "cn",
    signupHint: "open.bigmodel.cn",
    ai: {
      providerKey: "zhipu",
      api_base: "https://open.bigmodel.cn/api/paas",
      model: "glm-4-flash",
    },
  },
  {
    id: "moonshot",
    label: "Moonshot",
    tagline: "国内 · 长上下文",
    region: "cn",
    signupHint: "platform.moonshot.cn",
    ai: {
      providerKey: "moonshot",
      api_base: "https://api.moonshot.cn",
      model: "moonshot-v1-8k",
    },
  },
  {
    id: "ollama",
    label: "Ollama",
    tagline: "本地部署 · 零云端依赖",
    region: "cn",
    signupHint: "本机 11434 端口",
    ai: {
      providerKey: "ollama",
      api_base: "http://localhost:11434",
      model: "llama3",
    },
  },
  {
    id: "openai",
    label: "OpenAI",
    tagline: "海外 · 通用 + Whisper ASR",
    region: "intl",
    signupHint: "platform.openai.com",
    ai: {
      providerKey: "openai",
      api_base: "https://api.openai.com",
      model: "gpt-4o-mini",
    },
    asr: {
      providerKey: "openai",
      api_base: "https://api.openai.com",
      model: "whisper-1",
    },
  },
  {
    id: "anthropic",
    label: "Anthropic",
    tagline: "海外 · Claude",
    region: "intl",
    signupHint: "console.anthropic.com",
    ai: {
      providerKey: "anthropic",
      api_base: "https://api.anthropic.com",
      model: "claude-sonnet-4-20250514",
    },
  },
  {
    id: "deepgram",
    label: "Deepgram",
    tagline: "海外 · ASR 速度快",
    region: "intl",
    signupHint: "deepgram.com",
    asr: {
      providerKey: "deepgram",
      api_base: "https://api.deepgram.com",
      model: "nova-2",
    },
  },
];
