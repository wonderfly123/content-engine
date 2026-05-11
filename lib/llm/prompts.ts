/**
 * Prompt builders for the Anthropic LLM adapter.
 *
 * Each builder returns the `system` array (with `cache_control` on the long
 * brand-context block so Anthropic caches it across many briefs/drafts) and a
 * `messages` array. The adapter is responsible for orchestrating the SDK call.
 *
 * Cache strategy: persona + voice + voice examples are stable across an entire
 * brief batch (often 7 briefs in one cron run), so we mark that system block
 * with `cache_control: { type: 'ephemeral' }` per Anthropic's prompt caching
 * docs. Tokens for that block bill at 90% off on subsequent calls within the
 * 5-minute cache TTL.
 */

import type {
  Brand,
  Brief,
  BriefInput,
  Persona,
  Voice,
  VoiceExample,
} from './types';

export interface CacheableSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface PromptPayload {
  system: CacheableSystemBlock[];
  user: string;
}

function formatPersona(persona: Persona): string {
  return [
    `Mission: ${persona.mission}`,
    `Audience: ${persona.audience_summary}`,
    `Archetype: ${persona.archetype}`,
    `Point of view: ${persona.pov}`,
    `Traits: ${persona.traits.join(', ')}`,
  ].join('\n');
}

function formatVoice(voice: Voice, freeform: string): string {
  const lines: string[] = [];
  if (voice.tone_sliders) {
    lines.push(
      `Tone sliders: ${Object.entries(voice.tone_sliders)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
    );
  }
  if (voice.emoji_policy) lines.push(`Emoji policy: ${voice.emoji_policy}`);
  if (voice.hashtag_style) lines.push(`Hashtag style: ${voice.hashtag_style}`);
  if (voice.reading_level) lines.push(`Reading level: ${voice.reading_level}`);
  if (voice.banned_words?.length)
    lines.push(`Banned words (NEVER use): ${voice.banned_words.join(', ')}`);
  if (voice.signature_phrases?.length)
    lines.push(`Signature phrases: ${voice.signature_phrases.join('; ')}`);
  if (freeform) lines.push(`\nVoice description:\n${freeform}`);
  return lines.join('\n');
}

function formatExamples(examples: VoiceExample[]): string {
  if (!examples?.length) return '';
  return examples
    .map(
      (e, i) =>
        `Example ${i + 1}${e.channel ? ` (${e.channel}/${e.format ?? 'post'})` : ''}:\n${e.text}${e.notes ? `\nNotes: ${e.notes}` : ''}`,
    )
    .join('\n\n');
}

/**
 * Brief generation prompt. Brand persona + voice goes in the cached system
 * block; per-brief inputs (research, ICP, target date, rejections) go in the
 * user message so each brief in a batch hits the cache.
 */
export function buildBriefPrompt(
  input: BriefInput,
  brand?: Pick<Brand, 'voice_freeform' | 'voice_examples'>,
): PromptPayload {
  const cached = [
    '# Brand Persona',
    formatPersona(input.persona),
    '',
    '# Voice',
    formatVoice(input.voice, brand?.voice_freeform ?? ''),
    brand?.voice_examples?.length
      ? `\n# Voice Examples (few-shot)\n${formatExamples(brand.voice_examples)}`
      : '',
  ].join('\n');

  const system: CacheableSystemBlock[] = [
    {
      type: 'text',
      text: 'You are a senior social-media strategist generating content briefs. Respond with valid JSON matching the requested schema. No prose outside the JSON.',
    },
    {
      type: 'text',
      text: cached,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const rejectionBlock =
    input.rejections.length === 0
      ? 'No recent rejections.'
      : input.rejections
          .map(
            (r) =>
              `- (${r.briefOrDraft}, ${r.at}) ${r.reason}`,
          )
          .join('\n');

  const user = [
    `# ICP`,
    `Name: ${input.icp.name}`,
    input.icp.description ? `Description: ${input.icp.description}` : '',
    input.icp.pain_points?.length
      ? `Pain points: ${input.icp.pain_points.join('; ')}`
      : '',
    input.icp.where_they_hang_out
      ? `Where they hang out: ${input.icp.where_they_hang_out}`
      : '',
    input.icp.content_they_engage_with
      ? `Engages with: ${input.icp.content_they_engage_with}`
      : '',
    ``,
    `# Research findings`,
    input.research.llm_pattern_summary ?? '(none)',
    ``,
    `# Recent rejections (what NOT to repeat)`,
    rejectionBlock,
    ``,
    `# Task`,
    `Generate ONE content brief for channel=${input.channel}, format=${input.format}, target_publish_date=${input.target_date}.`,
    ``,
    `Respond with JSON exactly matching:`,
    `{`,
    `  "hook": string,`,
    `  "angle": string,`,
    `  "key_message": string,`,
    `  "suggested_hashtags": string[],`,
    `  "suggested_cta": string | null,`,
    `  "inspiration_post_refs": [{ "ref_id"?: string, "external_url"?: string, "why": string }]`,
    `}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

export function buildDraftPrompt(brief: Brief, brand: Brand): PromptPayload {
  const cached = [
    '# Brand Persona',
    formatPersona(brand.persona_json),
    '',
    '# Voice',
    formatVoice(brand.voice_json, brand.voice_freeform),
    brand.voice_examples?.length
      ? `\n# Voice Examples (few-shot)\n${formatExamples(brand.voice_examples)}`
      : '',
  ].join('\n');

  const system: CacheableSystemBlock[] = [
    {
      type: 'text',
      text: 'You are a senior copywriter producing channel-ready drafts. Match the brand voice exactly. Respond with valid JSON only.',
    },
    {
      type: 'text',
      text: cached,
      cache_control: { type: 'ephemeral' },
    },
  ];

  let schemaSection = '';
  if (brief.format === 'reel') {
    schemaSection = [
      `Respond with JSON:`,
      `{`,
      `  "caption": string,`,
      `  "script_json": {`,
      `    "shots": [{ "index": number, "on_screen_text"?: string, "b_roll"?: string, "duration_sec": number }],`,
      `    "target_duration_sec": number,`,
      `    "hook_score": number,`,
      `    "cover_image_prompt": string`,
      `  },`,
      `  "image_prompts": string[]`,
      `}`,
    ].join('\n');
  } else if (brief.format === 'carousel') {
    schemaSection = [
      `Respond with JSON:`,
      `{`,
      `  "caption": string,`,
      `  "slide_json": {`,
      `    "slides": [{ "index": number, "copy": string, "image_prompt": string, "style_hint"?: string }]`,
      `  },`,
      `  "image_prompts": string[]`,
      `}`,
    ].join('\n');
  } else {
    schemaSection = [
      `Respond with JSON:`,
      `{`,
      `  "caption": string,`,
      `  "body"?: string,`,
      `  "image_prompts": string[]`,
      `}`,
    ].join('\n');
  }

  const user = [
    `# Brief`,
    `Channel: ${brief.channel}`,
    `Format: ${brief.format}`,
    `Hook: ${brief.hook}`,
    `Angle: ${brief.angle}`,
    `Key message: ${brief.key_message}`,
    brief.suggested_cta ? `Suggested CTA: ${brief.suggested_cta}` : '',
    brief.suggested_hashtags?.length
      ? `Suggested hashtags: ${brief.suggested_hashtags.join(' ')}`
      : '',
    ``,
    `# Task`,
    `Produce the deliverable for this brief.`,
    ``,
    schemaSection,
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

export function buildPersonaExtractionPrompt(
  scrapedContent: string,
): PromptPayload {
  const system: CacheableSystemBlock[] = [
    {
      type: 'text',
      text: 'You analyze brand websites and produce structured persona profiles. Respond with valid JSON only.',
    },
  ];
  const user = [
    `# Scraped site content`,
    scrapedContent.slice(0, 20000),
    ``,
    `# Task`,
    `Extract a brand persona. Respond with JSON exactly matching:`,
    `{`,
    `  "mission": string,`,
    `  "audience_summary": string,`,
    `  "archetype": string,`,
    `  "pov": string,`,
    `  "traits": string[]`,
    `}`,
  ].join('\n');
  return { system, user };
}

export function buildImagePromptsPrompt(slidesOrShots: unknown): PromptPayload {
  const system: CacheableSystemBlock[] = [
    {
      type: 'text',
      text: 'You write concise, evocative image generation prompts. Respond with a JSON array of strings only.',
    },
  ];
  const user = [
    `# Source slides or shots`,
    JSON.stringify(slidesOrShots, null, 2).slice(0, 10000),
    ``,
    `Produce one image prompt per slide/shot. Respond with JSON: ["prompt1", "prompt2", ...]`,
  ].join('\n');
  return { system, user };
}
