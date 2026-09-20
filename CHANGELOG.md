# Changelog

## 0.1.0 — Initial release

- `experimental.chat.system.transform` hook: replaces the assembled OpenCode
  system prompt with the text between `RAW_SYSTEM_OVERRIDE_START_9F3A` /
  `RAW_SYSTEM_OVERRIDE_END_9F3A` markers in the agent file.
- Empty between markers clears the system entirely (pure LLM).
- Missing markers (other agents, compaction, title, summary) leave the
  system untouched; missing END marker is a safe no-op with a log line.
- Ships `agents/Raw.md` + `scripts/install.mjs` installer (`bin:
  opencode-system-override`).
