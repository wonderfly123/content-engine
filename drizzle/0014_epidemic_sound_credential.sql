-- Epidemic Sound as a workspace connection (Settings > Integrations): the workspace's own MCP Server API key,
-- stored encrypted in workspace_credentials like the Anthropic key (lib/credentials/store.ts).
-- Hand-written to match credentialProviderValues in lib/db/enums.ts. Applied to production on 2026-11-20.
-- Additive and safe to run again. Tracks the editor brings in from Epidemic Sound need no schema change:
-- they are music_tracks rows of the brand with source 'epidemic-sound:<recording id>'.
ALTER TYPE "credential_provider" ADD VALUE IF NOT EXISTS 'epidemic_sound';
