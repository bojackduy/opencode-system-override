// ─── opencode-system-override: server plugin ────────────────────────────────
// Overwrite the OpenCode system prompt per agent.
//
// How it works: OpenCode assembles one system array per request (agent prompt
// + environment + AGENTS.md + MCP instructions + skills + ...). This hook
// looks for the marker pair in the assembled text:
//
//   RAW_SYSTEM_OVERRIDE_START_9F3A ... RAW_SYSTEM_OVERRIDE_END_9F3A
//
// Marker absent (any other agent, compaction, title, summary, subagent
// internals) → leave the system completely untouched.
// Markers present → replace the whole system array IN PLACE with the text
// between the markers. Empty between markers → clear the array entirely
// (pure LLM, no system prompt at all).
//
// The markers live in the agent file (see agents/Raw.md). Put your custom
// prompt between them. Tool access is NOT touched by this hook — use
// `permission: {"*": deny}` in the agent file to block tool use.

import type { Plugin, PluginModule } from "@opencode-ai/plugin"

const PLUGIN_ID = "opencode-system-override"

const START = "RAW_SYSTEM_OVERRIDE_START_9F3A"
const END = "RAW_SYSTEM_OVERRIDE_END_9F3A"

// Zen free-tier gating: anonymous free models at opencode.ai/zen only serve
// requests carrying the opencode client User-Agent, and the vendor now also
// requires a stable per-conversation `x-opencode-session` header (missing it
// surfaces as "must using opencode for opencode free endpoint" / 429
// FreeUsageLimitError). Inject both via the `chat.headers` hook so free
// models keep working regardless of which agent (Raw or not) is active.
//
// - User-Agent: only set when absent or not already `opencode/*`, so we never
//   clobber the real client UA or another plugin's contribution.
// - x-opencode-session: stable per conversation → use the opencode sessionID
//   directly (that is exactly the vendor's stated intent).
// - Scoped to the `opencode` provider only, so we never leak session IDs or
//   spoof UA to third-party providers.
const OPENCODE_PROVIDER_ID = "opencode"
const FALLBACK_USER_AGENT = "opencode/1.18.34"
const SESSION_HEADER = "x-opencode-session"

const server: Plugin = async ({ client }) => {
  const log = (message: string) => {
    try {
      void client.app.log({ body: { service: "system-override", level: "info", message } })
    } catch {
      // logging must never break the chat path
    }
  }

  return {
    "chat.headers": async (input, output) => {
      // Only touch opencode-provider requests (Zen / Zen-Go free + paid).
      const providerID =
        input.model?.providerID ?? input.provider?.info?.id ?? input.provider?.info?.name
      if (providerID !== OPENCODE_PROVIDER_ID) {
        return
      }
      output.headers ??= {}
      const existingUA =
        output.headers["User-Agent"] ?? output.headers["user-agent"]
      if (!existingUA || !existingUA.startsWith("opencode/")) {
        output.headers["User-Agent"] = process.env.OPENCODE_USER_AGENT ?? FALLBACK_USER_AGENT
      }
      if (input.sessionID && !output.headers[SESSION_HEADER]) {
        output.headers[SESSION_HEADER] = input.sessionID
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      // Join defensively in case multiple system blocks exist.
      const assembled = output.system.join("\n")

      const startIndex = assembled.indexOf(START)
      // Marker absent = another agent/internal request. Touch nothing.
      if (startIndex === -1) {
        return
      }

      const contentStart = startIndex + START.length
      const endIndex = assembled.indexOf(END, contentStart)

      // Malformed raw agent prompt: don't accidentally destroy system context.
      if (endIndex === -1) {
        log("system-override: START marker found but END marker missing, leaving system untouched")
        return
      }

      const customSystem = assembled.slice(contentStart, endIndex).trim()

      // Mutate output.system IN PLACE (host shares the array).
      if (!customSystem) {
        // Empty between markers = user wants TRULY empty system (pure LLM).
        output.system.splice(0, output.system.length)
        log("system-override: raw agent with empty prompt, cleared system entirely")
        return
      }

      output.system.splice(0, output.system.length, customSystem)
      log(`system-override: replaced system with raw prompt (${customSystem.length} chars)`)
    },
  }
}

export default {
  id: PLUGIN_ID,
  server,
} satisfies PluginModule & { id: string }
