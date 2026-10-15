// Every number the report multiplies by, in one dated place. When Salesforce changes a price, this file changes and
// the report's "rates as of" line changes with it.
export const RATES_AS_OF = '2026-04-21'; // Flex Credits Rate Card
export const RATES_SOURCE = 'https://www.salesforce.com/en-us/wp-content/uploads/sites/4/assets/pdf/agentforce/Flex-Credits-Rate-Card-04.21.2026.pdf';
export const REPORTED_USD_PER_100K = 500; // what customers report paying at list; not on the rate card itself

export type Tier = 'starter' | 'basic' | 'standard' | 'advanced' | 'unknown';
export const PROMPT_CREDITS: Record<Exclude<Tier, 'unknown'>, number> = { starter: 2, basic: 2, standard: 4, advanced: 16 };
export const PROMPT_RANGE = { low: 2, high: 16 }; // when the model's tier is not known
export const ACTION_CREDITS = { production: 20, sandbox: 16 };
export const DATA360_PREP_PER_MILLION = { production: 40, sandbox: 32 };

// Which rate card tier each Salesforce-managed model falls in, by the API name the template metadata carries. The
// tier per model is from Salesforce Help, Large Language Model Support (usage type column), joined to the API names
// in the Agentforce Developer Guide, Supported Models; both read on 15 Oct 2026. Rerouted models carry the tier of the
// model they now route to. A model not listed here reports as a range.
// A prompt is one call of up to 2,000 tokens in and out together; longer ones count as several (Flex Credits Billable
// Usage Types). Advanced prompts have been metered since 21 July 2026.
export const TIERS_AS_OF = '2026-10-15';
export const TIERS_SOURCE = 'https://help.salesforce.com/s/articleView?id=ai.generative_ai_large_language_model_support.htm&type=5';
export const TOKENS_PER_PROMPT = 2000;
const B = 'basic', S = 'standard', A = 'advanced';
export const MODEL_TIERS: Record<string, Exclude<Tier, 'unknown'>> = {
  sfdc_ai__DefaultBedrockAmazonNovaLite: B, sfdc_ai__DefaultBedrockAmazonNovaPro: S,
  sfdc_ai__DefaultBedrockAnthropicClaude45Haiku: S, sfdc_ai__DefaultBedrockAnthropicClaude45Sonnet: S, sfdc_ai__DefaultBedrockAnthropicClaude46Sonnet: S, sfdc_ai__DefaultBedrockAnthropicClaude5Sonnet: S,
  sfdc_ai__DefaultBedrockAnthropicClaude45Opus: A, sfdc_ai__DefaultBedrockAnthropicClaude46Opus: A, sfdc_ai__DefaultBedrockAnthropicClaude47Opus: A, sfdc_ai__DefaultBedrockAnthropicClaude48Opus: A,
  sfdc_ai__DefaultBedrockNvidiaNemotronNano330b: B, sfdc_ai__DefaultBedrockNvidiaNemotronSuper3120b: S,
  sfdc_ai__DefaultGPT4Omni: S, sfdc_ai__DefaultGPT4OmniMini: B, sfdc_ai__DefaultOpenAIGPT4OmniMini: B, sfdc_ai__DefaultGPT41: S, sfdc_ai__DefaultGPT41Mini: B,
  sfdc_ai__DefaultGPT5: S, sfdc_ai__DefaultGPT5Mini: B, sfdc_ai__DefaultGPT51: S, sfdc_ai__DefaultGPT52: S, sfdc_ai__DefaultGPT54: S, sfdc_ai__DefaultGPT54Mini: B, sfdc_ai__DefaultGPT55: A,
  sfdc_ai__DefaultAzureOpenAIGPT56Luna: B, sfdc_ai__DefaultAzureOpenAIGPT56Terra: S, sfdc_ai__DefaultAzureOpenAIGPT56Sol: A,
  sfdc_ai__DefaultO3: S, sfdc_ai__DefaultO4Mini: S,
  sfdc_ai__DefaultVertexAIGemini25Flash001: B, sfdc_ai__DefaultVertexAIGemini25FlashLite001: B, sfdc_ai__DefaultVertexAIGeminiPro25: S, sfdc_ai__DefaultVertexAIGemini30Flash: B, sfdc_ai__DefaultVertexAIGeminiPro30: S, sfdc_ai__DefaultVertexAIGemini31FlashLite: B, sfdc_ai__DefaultVertexAIGeminiPro31: S, sfdc_ai__DefaultVertexAIGemini35Flash: B, sfdc_ai__DefaultVertexAIGemini36Flash: B,
  // Rerouted: billed as the model they now reach.
  sfdc_ai__DefaultBedrockAnthropicClaude3Haiku: S, sfdc_ai__DefaultBedrockAnthropicClaude37Sonnet: S, sfdc_ai__DefaultBedrockAnthropicClaude4Sonnet: S,
  sfdc_ai__DefaultAzureOpenAIGPT35Turbo: B, sfdc_ai__DefaultAzureOpenAIGPT35Turbo_16k: B, sfdc_ai__DefaultAzureOpenAIGPT4Turbo: S, sfdc_ai__DefaultOpenAIGPT35Turbo: B, sfdc_ai__DefaultOpenAIGPT35Turbo_16k: B, sfdc_ai__DefaultOpenAIGPT4: S, sfdc_ai__DefaultOpenAIGPT4_32k: S, sfdc_ai__DefaultOpenAIGPT4Turbo: S, sfdc_ai__DefaultVertexAIGemini20Flash001: B,
};
export function tierFor(modelApiName: string | null | undefined): Tier {
  if (!modelApiName) return 'unknown';
  return MODEL_TIERS[modelApiName] ?? 'unknown';
}
export function promptCredits(tier: Tier): { low: number; high: number } {
  return tier === 'unknown' ? PROMPT_RANGE : { low: PROMPT_CREDITS[tier], high: PROMPT_CREDITS[tier] };
}
export const usd = (credits: number) => (credits / 100_000) * REPORTED_USD_PER_100K;
