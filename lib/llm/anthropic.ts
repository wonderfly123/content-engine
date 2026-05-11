/**
 * Anthropic Claude adapter implementing the `LLMProvider` interface.
 *
 * Models (per Section 2 of the foundation spec):
 *   - Default: Sonnet 4.6 (`claude-sonnet-4-6`) — briefs, research summary,
 *     persona extraction, image prompts.
 *   - Nuanced voice work: Opus 4.7 (`claude-opus-4-7`) — draft generation.
 *
 * Prompt caching: the brand persona + voice + voice-examples block is sent in
 * a separate cacheable system content block (`cache_control: ephemeral`) so
 * subsequent calls within the 5-minute TTL bill at ~90% off. See
 * `lib/llm/prompts.ts` for prompt construction.
 *
 * Testability: constructor accepts an optional `sdkClient` so tests can inject
 * a stub Anthropic-shaped object without hitting the network.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  buildBriefPrompt,
  buildDraftPrompt,
  buildImagePromptsPrompt,
  buildPersonaExtractionPrompt,
} from './prompts';
import type {
  Brand,
  Brief,
  BriefDraft,
  BriefInput,
  Draft,
  LLMProvider,
  PersonaDraft,
} from './types';
import { LLMError } from './types';

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const NUANCED_MODEL = 'claude-opus-4-7';

/** Minimal subset of the Anthropic SDK we use — enables clean mocking. */
export interface AnthropicLike {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system?: Array<{
        type: 'text';
        text: string;
        cache_control?: { type: 'ephemeral' };
      }>;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    }): Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

export interface AnthropicProviderOptions {
  apiKey?: string;
  defaultModel?: string;
  nuancedModel?: string;
  sdkClient?: AnthropicLike;
  maxTokens?: number;
}

const briefDraftSchema = z.object({
  hook: z.string(),
  angle: z.string(),
  key_message: z.string(),
  suggested_hashtags: z.array(z.string()),
  suggested_cta: z.string().nullable(),
  inspiration_post_refs: z
    .array(
      z.object({
        ref_id: z.string().optional(),
        external_url: z.string().optional(),
        why: z.string(),
      }),
    )
    .default([]),
});

const draftSchema = z.object({
  caption: z.string(),
  body: z.string().nullable().optional(),
  script_json: z
    .object({
      shots: z.array(
        z.object({
          index: z.number(),
          on_screen_text: z.string().optional(),
          b_roll: z.string().optional(),
          duration_sec: z.number(),
        }),
      ),
      target_duration_sec: z.number(),
      hook_score: z.number().optional(),
      cover_image_prompt: z.string().optional(),
    })
    .nullable()
    .optional(),
  slide_json: z
    .object({
      slides: z.array(
        z.object({
          index: z.number(),
          copy: z.string(),
          image_prompt: z.string(),
          style_hint: z.string().optional(),
        }),
      ),
    })
    .nullable()
    .optional(),
  image_prompts: z.array(z.string()).default([]),
});

const personaSchema = z.object({
  mission: z.string(),
  audience_summary: z.string(),
  archetype: z.string(),
  pov: z.string(),
  traits: z.array(z.string()),
});

const imagePromptsSchema = z.array(z.string());

export class AnthropicProvider implements LLMProvider {
  private readonly client: AnthropicLike;
  private readonly defaultModel: string;
  private readonly nuancedModel: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicProviderOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!opts.sdkClient && !apiKey) {
      throw new LLMError(
        'ANTHROPIC_API_KEY is not set. Add it to your environment to use the Anthropic LLM provider.',
        'missing_api_key',
      );
    }
    this.client =
      opts.sdkClient ?? (new Anthropic({ apiKey: apiKey! }) as unknown as AnthropicLike);
    this.defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
    this.nuancedModel = opts.nuancedModel ?? NUANCED_MODEL;
    this.maxTokens = opts.maxTokens ?? 4096;
  }

  private extractText(response: {
    content: Array<{ type: string; text?: string }>;
  }): string {
    const block = response.content.find(
      (b) => b.type === 'text' && typeof b.text === 'string',
    );
    if (!block?.text) {
      throw new LLMError(
        'Anthropic response contained no text block',
        'parse_error',
      );
    }
    return block.text;
  }

  private parseJson<T>(raw: string, schema: z.ZodType<T>): T {
    let candidate = raw.trim();
    // Strip ``` fences if model wrapped JSON in code block
    if (candidate.startsWith('```')) {
      candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }
    // Find first { or [ to be lenient
    const firstBrace = candidate.search(/[\[{]/);
    if (firstBrace > 0) candidate = candidate.slice(firstBrace);
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch (err) {
      throw new LLMError(
        `Failed to parse JSON from Anthropic response: ${(err as Error).message}`,
        'parse_error',
        err,
      );
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new LLMError(
        `Anthropic response did not match expected schema: ${result.error.message}`,
        'parse_error',
        result.error,
      );
    }
    return result.data;
  }

  private async invoke(
    model: string,
    system: Array<{
      type: 'text';
      text: string;
      cache_control?: { type: 'ephemeral' };
    }>,
    user: string,
  ): Promise<string> {
    try {
      const res = await this.client.messages.create({
        model,
        max_tokens: this.maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      });
      return this.extractText(res);
    } catch (err) {
      if (err instanceof LLMError) throw err;
      throw new LLMError(
        `Anthropic API error: ${(err as Error).message}`,
        'api_error',
        err,
      );
    }
  }

  async generateBrief(input: BriefInput): Promise<BriefDraft> {
    const { system, user } = buildBriefPrompt(input);
    const raw = await this.invoke(this.defaultModel, system, user);
    const parsed = this.parseJson(raw, briefDraftSchema);
    return {
      hook: parsed.hook,
      angle: parsed.angle,
      key_message: parsed.key_message,
      suggested_hashtags: parsed.suggested_hashtags,
      suggested_cta: parsed.suggested_cta,
      inspiration_post_refs: parsed.inspiration_post_refs ?? [],
    };
  }

  async generateDraft(brief: Brief, brand: Brand): Promise<Draft> {
    const { system, user } = buildDraftPrompt(brief, brand);
    const raw = await this.invoke(this.nuancedModel, system, user);
    const parsed = this.parseJson(raw, draftSchema);
    return {
      caption: parsed.caption,
      body: parsed.body ?? null,
      script_json: parsed.script_json ?? null,
      slide_json: parsed.slide_json ?? null,
      image_prompts: parsed.image_prompts ?? [],
    };
  }

  async extractPersona(scrapedContent: string): Promise<PersonaDraft> {
    const { system, user } = buildPersonaExtractionPrompt(scrapedContent);
    const raw = await this.invoke(this.defaultModel, system, user);
    return this.parseJson(raw, personaSchema);
  }

  async generateImagePrompts(slidesOrShots: unknown): Promise<string[]> {
    const { system, user } = buildImagePromptsPrompt(slidesOrShots);
    const raw = await this.invoke(this.defaultModel, system, user);
    return this.parseJson(raw, imagePromptsSchema);
  }
}
