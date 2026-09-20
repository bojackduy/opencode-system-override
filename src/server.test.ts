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
  const server = (pluginModule as unknown as { server: (input: unknown) => Promise<Record<string, (input: unknown, output: { system: string[] }) => Promise<void>>> }).server
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
