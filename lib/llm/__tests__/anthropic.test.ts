import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider, type AnthropicLike } from '../anthropic';
import { LLMError } from '../types';

const originalKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = originalKey;
});

describe('AnthropicProvider', () => {
  it('throws when ANTHROPIC_API_KEY is missing and no client injected', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider()).toThrowError(LLMError);
  });

  it('generateBrief parses Anthropic response into BriefDraft shape', async () => {
    const briefJson = {
      hook: 'Stop scrolling — your wrists deserve better.',
      angle: 'Anatomy-driven grip design',
      key_message: 'A better grip prevents injury and improves PRs.',
      suggested_hashtags: ['#gripstrength', '#lifting'],
      suggested_cta: 'Tap the link to learn more',
      inspiration_post_refs: [
        { external_url: 'https://instagram.com/p/abc', why: 'Hook style' },
      ],
    };

    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(briefJson) }],
    });
    const sdkClient: AnthropicLike = { messages: { create } };

    const provider = new AnthropicProvider({ sdkClient });
    const result = await provider.generateBrief({
      persona: {
        mission: 'm',
        audience_summary: 'a',
        archetype: 'arch',
        pov: 'pov',
        traits: ['t'],
      },
      voice: {},
      icp: { name: 'Lifter' },
      research: {},
      rejections: [],
      channel: 'instagram',
      format: 'reel',
      target_date: '2026-05-15',
    });

    expect(result).toMatchObject(briefJson);
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0][0];
    // Verify prompt caching is wired on the persona/voice block
    expect(call.system).toBeDefined();
    const cached = call.system.find(
      (b: { cache_control?: unknown }) => b.cache_control,
    );
    expect(cached?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('extractPersona handles ```json-fenced``` responses', async () => {
    const personaJson = {
      mission: 'm',
      audience_summary: 'a',
      archetype: 'sage',
      pov: 'p',
      traits: ['curious'],
    };
    const fenced = '```json\n' + JSON.stringify(personaJson) + '\n```';
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: fenced }],
    });
    const provider = new AnthropicProvider({
      sdkClient: { messages: { create } },
    });
    const out = await provider.extractPersona('some scraped html...');
    expect(out).toEqual(personaJson);
  });

  it('throws LLMError on malformed JSON', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'not json at all' }],
    });
    const provider = new AnthropicProvider({
      sdkClient: { messages: { create } },
    });
    await expect(provider.generateImagePrompts({ a: 1 })).rejects.toThrow(LLMError);
  });
});
