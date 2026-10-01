import { describe, expect, test } from "bun:test"
import pluginModule from "./server"

const START = "RAW_SYSTEM_OVERRIDE_START_9F3A"
const END = "RAW_SYSTEM_OVERRIDE_END_9F3A"

const logged: string[] = []
const fakeClient = {
  app: {
    log: ({ body }: { body: { message: string } }) => {
      logged.push(body.message)
    },
  },
} as never

async function hooks() {
  logged.length = 0
  const server = (pluginModule as unknown as { server: (input: unknown) => Promise<Record<string, (input: unknown, output: never) => Promise<void>>> }).server
  return server({ client: fakeClient } as never)
}

async function transform(system: string[]) {
  const h = await hooks()
  const output = { system: [...system] }
  // keep a reference to prove in-place mutation keeps the same array object
  const ref = output.system
  await (h["experimental.chat.system.transform"] as (input: unknown, output: { system: string[] }) => Promise<void>)({}, output)
  expect(output.system).toBe(ref)
  return output.system
}

async function runHeaders(
  input: { sessionID?: string; model?: { providerID: string }; provider?: { info: { id: string } } },
  initial: Record<string, string> = {},
) {
  const h = await hooks()
  const output = { headers: { ...initial } }
  const ref = output.headers
  await (
    h["chat.headers"] as (input: unknown, output: { headers: Record<string, string> }) => Promise<void>
  )(input, output as never)
  expect(output.headers).toBe(ref)
  return output.headers
}

describe("system-override transform", () => {
  test("leaves non-raw agents untouched (no markers)", async () => {
    const system = ["default agent prompt", "environment info"]
    expect(await transform(system)).toEqual(system)
    expect(logged).toHaveLength(0)
  })

  test("replaces full system with text between markers", async () => {
    const custom = "You are a pirate. Speak like one."
    const system = [`before ${START}\n${custom}\n${END} after`]
    expect(await transform(system)).toEqual([custom])
  })

  test("joins multiple system blocks before extracting", async () => {
    const system = ["agent prompt", `${START}\nhello\n${END}`, "trailing skills block"]
    expect(await transform(system)).toEqual(["hello"])
  })

  test("empty between markers clears system entirely (pure LLM)", async () => {
    const system = [`${START}   \n  ${END}`, "other block"]
    expect(await transform(system)).toEqual([])
  })

  test("missing END marker leaves system untouched", async () => {
    const system = [`${START}\noops, no end`, "other block"]
    expect(await transform(system)).toEqual(system)
    expect(logged.join("\n")).toContain("END marker missing")
  })
})

describe("chat.headers (Zen free-tier gating)", () => {
  test("injects User-Agent + x-opencode-session for opencode provider", async () => {
    const out = await runHeaders(
      { sessionID: "ses_abc123", model: { providerID: "opencode" } },
      {},
    )
    expect(out["User-Agent"]).toMatch(/^opencode\//)
    expect(out["x-opencode-session"]).toBe("ses_abc123")
  })

  test("ignores non-opencode providers (no UA spoof, no session leak)", async () => {
    const out = await runHeaders(
      { sessionID: "ses_abc123", model: { providerID: "anthropic" } },
      {},
    )
    expect(out).toEqual({})
  })

  test("never clobbers an existing opencode/* User-Agent", async () => {
    const out = await runHeaders(
      { sessionID: "ses_xyz", model: { providerID: "opencode" } },
      { "User-Agent": "opencode/9.9.9" },
    )
    expect(out["User-Agent"]).toBe("opencode/9.9.9")
    expect(out["x-opencode-session"]).toBe("ses_xyz")
  })

  test("repairs a non-opencode User-Agent", async () => {
    const out = await runHeaders(
      { sessionID: "ses_1", model: { providerID: "opencode" } },
      { "User-Agent": "curl/8.0" },
    )
    expect(out["User-Agent"]).toMatch(/^opencode\//)
  })

  test("preserves an existing session header", async () => {
    const out = await runHeaders(
      { sessionID: "ses_new", model: { providerID: "opencode" } },
      { "x-opencode-session": "ses_old" },
    )
    expect(out["x-opencode-session"]).toBe("ses_old")
  })
})
