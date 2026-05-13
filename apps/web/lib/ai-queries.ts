"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

export type AiProvider = "anthropic" | "openai" | "unigpt";

export interface ProviderConfig {
  api_key: string | null;
  base_url: string | null;
}

export interface AiConfig {
  system_prompt: string;
  anthropic: ProviderConfig;
  openai: ProviderConfig;
  unigpt: ProviderConfig;
  selected_provider: AiProvider | null;
  selected_model: string | null;
}

export interface ModelInfo {
  id: string;
  display_name: string | null;
  created: number | null;
}

interface FetchModelsResponse {
  models: ModelInfo[];
}

/** Slice of the litellm pricing JSON the UI cares about. The upstream payload
 *  includes many more fields per model; we keep them as unknown. */
export interface ModelPricing {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  max_tokens?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  litellm_provider?: string;
}

export type PricingCatalog = Record<string, ModelPricing>;

export const DEFAULT_AI_CONFIG: AiConfig = {
  system_prompt: "",
  anthropic: { api_key: null, base_url: null },
  openai: { api_key: null, base_url: null },
  unigpt: { api_key: null, base_url: null },
  selected_provider: null,
  selected_model: null,
};

const KEYS = {
  config: ["ai", "config"] as const,
  pricing: ["ai", "pricing"] as const,
};

export function useAiConfig() {
  return useQuery<AiConfig>({
    queryKey: KEYS.config,
    queryFn: () => api<AiConfig>("/api/v1/ai/config"),
    staleTime: 60_000,
  });
}

export function useUpdateAiConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AiConfig) =>
      api<AiConfig>("/api/v1/ai/config", { method: "PUT", json: payload }),
    onSuccess: (data) => {
      qc.setQueryData(KEYS.config, data);
    },
  });
}

export function useFetchProviderModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: AiProvider) =>
      api<FetchModelsResponse>(`/api/v1/ai/models/${provider}`, { method: "POST" }),
    onSuccess: (_data, provider) => {
      qc.setQueryData(["ai", "models", provider], _data);
    },
  });
}

export function usePricingCatalog() {
  return useQuery<PricingCatalog>({
    queryKey: KEYS.pricing,
    queryFn: () => api<PricingCatalog>("/api/v1/ai/pricing"),
    // Server caches an hour; we mirror that so navigations don't refetch.
    staleTime: 60 * 60 * 1000,
  });
}

/** Best-effort match between a fetched model id (e.g. `claude-opus-4-7-20260101`)
 *  and a litellm catalog key. Returns the pricing entry or `null`. */
export function lookupPricing(
  catalog: PricingCatalog | undefined,
  modelId: string,
): ModelPricing | null {
  if (!catalog) return null;
  if (catalog[modelId]) return catalog[modelId]!;

  // litellm prefixes some providers (e.g. "anthropic/claude-..."). Try with
  // each known provider prefix before falling back to looser matching.
  const prefixes = [
    "anthropic/",
    "openai/",
    "azure/",
    "openrouter/",
    "mistral/",
    "groq/",
    "ollama/",
    "together_ai/",
    "fireworks_ai/",
  ];
  for (const prefix of prefixes) {
    const k = `${prefix}${modelId}`;
    if (catalog[k]) return catalog[k]!;
  }

  // Strip a trailing date suffix (`-YYYYMMDD`) for Anthropic-style versioned ids.
  const stripped = modelId.replace(/-\d{6,8}$/, "");
  if (stripped !== modelId && catalog[stripped]) return catalog[stripped]!;

  // Case-insensitive scan as a last resort. Match either a catalog key that
  // ends with the model id (provider-prefixed entry) or vice-versa.
  const lower = modelId.toLowerCase();
  for (const [key, value] of Object.entries(catalog)) {
    const kLower = key.toLowerCase();
    if (
      kLower === lower ||
      kLower.endsWith(`/${lower}`) ||
      kLower === lower.replace(/-\d{6,8}$/, "")
    ) {
      return value;
    }
  }
  return null;
}

/** Built-in context-window fallback for common open-source / proxied models
 *  that the litellm catalog often misses (free university LibreChat
 *  deployments, OpenRouter clones, etc.). Tokens, not characters. */
const CONTEXT_FALLBACKS: { pattern: RegExp; context: number }[] = [
  { pattern: /^mistral-small/i, context: 131_072 },
  { pattern: /^mistral-large/i, context: 131_072 },
  { pattern: /^mistral-medium/i, context: 131_072 },
  { pattern: /^mixtral-8x/i, context: 32_768 },
  { pattern: /^gemma-3/i, context: 131_072 },
  { pattern: /^gemma-2/i, context: 8_192 },
  { pattern: /^llama-?3\.3-70b/i, context: 131_072 },
  { pattern: /^llama-?3\.2/i, context: 131_072 },
  { pattern: /^llama-?3\.1/i, context: 131_072 },
  { pattern: /^gpt-oss-120b/i, context: 131_072 },
  { pattern: /^gpt-oss-20b/i, context: 131_072 },
  { pattern: /^qwen3-embedding/i, context: 32_768 },
  { pattern: /^qwen3/i, context: 131_072 },
  { pattern: /^qwen2\.5/i, context: 131_072 },
  { pattern: /^apertus-8b/i, context: 65_536 },
  { pattern: /^apertus/i, context: 65_536 },
  { pattern: /^deepseek/i, context: 65_536 },
  { pattern: /^phi-?3/i, context: 131_072 },
];

export function fallbackContext(modelId: string): number | null {
  for (const { pattern, context } of CONTEXT_FALLBACKS) {
    if (pattern.test(modelId)) return context;
  }
  return null;
}

/** Best-effort parameter count derived from the model id. Returns a string
 *  like `"70B"`, `"8×7B"`, or `null` if nothing recognisable is encoded. */
export function deriveParameters(modelId: string): string | null {
  // Mixtral-style "8x7B" / "8x22B"
  const mix = modelId.match(/(\d+)x(\d+(?:\.\d+)?)b(?![a-z])/i);
  if (mix) return `${mix[1]}×${mix[2]}B`;

  // Plain "<N>B" anywhere in the id, preceded by anything that isn't a digit
  // and not followed by another letter (so we don't match "blarg").
  const b = modelId.match(/(?:^|[^\d])(\d+(?:\.\d+)?)b(?![a-z])/i);
  if (b) return `${b[1]}B`;

  return null;
}

/** Turn a raw model id into a human-friendly display name by dropping the
 *  parameter-count and trailing date segments (which live in their own
 *  columns) and replacing separators with spaces. Examples:
 *
 *    "Llama-3.3-70B"             → "Llama 3.3"
 *    "Apertus-8B-Instruct-2509"  → "Apertus Instruct"
 *    "Qwen3-Embedding-4B"        → "Qwen3 Embedding"
 *    "gpt-oss-120b"              → "Gpt oss"
 */
export function cleanDisplayName(modelId: string): string {
  const segments = modelId.split(/[-_]/).filter((p) => {
    // Parameter-count segments: "70B", "8B", "8x7B", "8x22B".
    if (/^\d+(?:[x×]\d+(?:\.\d+)?)?[bB]$/.test(p)) return false;
    // Trailing date-ish segments — 4 to 8 digits ("2509", "20250101").
    if (/^\d{4,8}$/.test(p)) return false;
    return true;
  });
  const joined = segments.join(" ");
  if (joined.length === 0) return modelId;
  if (/^[a-z]/.test(joined)) {
    return joined[0]!.toUpperCase() + joined.slice(1);
  }
  return joined;
}

/** Convert litellm's per-token cost into $ per million tokens. */
export function perMillion(perToken: number | undefined): number | null {
  if (perToken === undefined || perToken === null) return null;
  return perToken * 1_000_000;
}
