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

const server: Plugin = async ({ client }) => {
  const log = (message: string) => {
    try {
      void client.app.log({ body: { service: "system-override", level: "info", message } })
    } catch {
      // logging must never break the chat path
    }
  }

  return {
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
