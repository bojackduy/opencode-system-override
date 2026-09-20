#!/usr/bin/env node
// Installer for @bojackduy/opencode-system-override.
// - Registers the plugin in opencode.json/jsonc (server-only, no TUI entry).
// - Copies agents/Raw.md into the OpenCode config dir.
// - --uninstall removes both. Supports OPENCODE_CONFIG_DIR + --help/--version.
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const config = process.env.OPENCODE_CONFIG_DIR || join(homedir(), ".config", "opencode")
const packageName = "@bojackduy/opencode-system-override"
const packageVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version
const configCandidates = ["opencode.json", "opencode.jsonc", "config.json", "config.jsonc"]
const installerArgs = process.argv.slice(2)
const uninstallRequested = installerArgs.length === 1 && ["--uninstall", "uninstall", "--remove"].includes(installerArgs[0] || "")

if (installerArgs.includes("--help") || installerArgs.includes("-h")) {
  console.log(`opencode-system-override installer — overwrite the OpenCode system prompt per agent

Usage:
  opencode-system-override
  npx -y @bojackduy/opencode-system-override@latest
  npx -y @bojackduy/opencode-system-override@latest --uninstall

Install/update registers the server plugin and installs agents/Raw.md.
Uninstall removes the plugin registration and the agent file.

Set OPENCODE_CONFIG_DIR to target a non-default OpenCode config directory.`)
  process.exit(0)
}

if (installerArgs.includes("--version") || installerArgs.includes("-v")) {
  console.log(packageVersion)
  process.exit(0)
}

if (installerArgs.length && !uninstallRequested) {
  console.error(`Unknown installer option: ${installerArgs[0]}`)
  process.exit(2)
}

function stripJsonComments(input) {
  let out = "", quote = "", esc = false, lc = false, bc = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i], n = input[i + 1]
    if (lc) { if (c === "\n" || c === "\r") { lc = false; out += c } continue }
    if (bc) { if (c === "*" && n === "/") { bc = false; i++ } else if (c === "\n" || c === "\r") out += c; continue }
    if (quote) { out += c; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === quote) quote = ""; continue }
    if (c === '"') { quote = c; out += c; continue }
    if (c === "/" && n === "/") { lc = true; i++; continue }
    if (c === "/" && n === "*") { bc = true; i++; continue }
    out += c
  }
  return out
}
function stripTrailingCommas(input) {
  let out = "", quote = "", esc = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quote) { out += c; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === quote) quote = ""; continue }
    if (c === '"') { quote = c; out += c; continue }
    if (c === ",") { let j = i + 1; while (/\s/.test(input[j] || "")) j++; if (input[j] === "]" || input[j] === "}") continue }
    out += c
  }
  return out
}
function parseJsonc(input) {
  const p = JSON.parse(stripTrailingCommas(stripJsonComments(input)))
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("OpenCode config root must be an object")
  return p
}
function isOwnSpec(v) {
  const s = String(v || "").trim()
  return s === packageName || s === `${packageName}@${packageVersion}` || s.startsWith(`${packageName}@`)
}
function skipTrivia(s, i) { while (i < s.length) { const c=s[i]||"", n=s[i+1]||""; if (/\s/.test(c)) {i++;continue} if (c==="/"&&n==="/") {i+=2; while(i<s.length&&s[i]!=="\n"&&s[i]!=="\r") i++; continue} if (c==="/"&&n==="*") { const e=s.indexOf("*/",i+2); if(e<0) throw new Error("unterminated block comment"); i=e+2; continue } break } return i }
function readJsonString(s, i) { if(s[i]!=='"') throw new Error("expected JSON string"); let esc=false; for(let j=i+1;j<s.length;j++){const c=s[j]||""; if(esc){esc=false; continue} if(c==="\\"){esc=true;continue} if(c==='"'){return {value:JSON.parse(s.slice(i,j+1)), end:j+1}}} throw new Error("unterminated JSON string") }
function skipJsonValue(s,i){ const vs=skipTrivia(s,i), f=s[vs]; if(f==='"') return readJsonString(s,vs).end; if(f==="{"||f==="["){const st=[]; let q=false,esc=false,lc=false,bc=false; for(let j=vs;j<s.length;j++){const c=s[j]||"",n=s[j+1]||""; if(lc){if(c==="\n"||c==="\r") lc=false; continue} if(bc){if(c==="*"&&n==="/"){bc=false;j++} continue} if(q){if(esc) esc=false; else if(c==="\\") esc=true; else if(c==='"') q=false; continue} if(c==='"'){q=true;continue} if(c==="/"&&n==="/"){lc=true;j++;continue} if(c==="/"&&n==="*"){bc=true;j++;continue} if(c==="{"||c==="[") st.push(c); else if(c==="}"||c==="]"){const e=c==="}"?"{":"["; if(st.at(-1)!==e) throw new Error("mismatched delimiters"); st.pop(); if(!st.length) return j+1} } throw new Error("unterminated JSON value") } let j=vs; while(j<s.length&&![",","}","]"].includes(s[j])) j++; return j }
function findRootProperty(s, name){ let i=skipTrivia(s,0); if(s[i]!=="{") throw new Error("OpenCode config must be root object"); i++; while(true){ i=skipTrivia(s,i); if(s[i]==="}") return null; const k=readJsonString(s,i); i=skipTrivia(s,k.end); if(s[i]!==":") throw new Error(`expected ':' after ${k.value}`); const vs=skipTrivia(s,i+1), ve=skipJsonValue(s,vs); if(k.value===name){ const ls=Math.max(s.lastIndexOf("\n",vs-1),s.lastIndexOf("\r",vs-1))+1; const kls=Math.max(s.lastIndexOf("\n",k.end-1),s.lastIndexOf("\r",k.end-1))+1; const indent=s.slice(kls,k.end-k.value.length-2).match(/^[\t ]*/)?.[0]||"  "; return {valueStart:vs,valueEnd:ve,indent,lineStart:ls} } const av=skipTrivia(s,ve); if(s[av]===",") i=av+1; else if(s[av]==="}") return null; else throw new Error(`expected ',' or '}' after ${k.value}`) } }
function formatPluginArray(vals, indent, eol){ if(!vals.length) return "[]"; const ci=`${indent}  `; return `[${eol}${vals.map(v=>`${ci}${JSON.stringify(v)}`).join(`,${eol}`)}${eol}${indent}]` }
function rewriteExistingPluginArray(source, next){ const prop=findRootProperty(source,"plugin"); if(!prop) return source; const eol=source.includes("\r\n")?"\r\n":"\n"; const rep=formatPluginArray(next,prop.indent,eol); return `${source.slice(0,prop.valueStart)}${rep}${source.slice(prop.valueEnd)}` }

async function configurePlugins(isUninstall) {
  const plans = []
  for (const name of configCandidates) {
    const target = join(config, name)
    try {
      const source = await readFile(target, "utf8")
      const parsed = parseJsonc(source)
      if (parsed.plugin !== undefined && !Array.isArray(parsed.plugin)) throw new Error("plugin must be array")
      const plugins = parsed.plugin || []
      let next
      if (isUninstall) {
        next = plugins.filter(v => !isOwnSpec(v))
      } else {
        next = plugins.filter(v => !isOwnSpec(v))
        next.push(packageName)
        next = [...new Set(next)]
      }
      const updated = next.length === plugins.length && next.every((v,i)=>v===plugins[i]) ? source : rewriteExistingPluginArray(source, next)
      if (!findRootProperty(source, "plugin") && !isUninstall) {
        const eol = source.includes("\r\n") ? "\r\n" : "\n"
        const indent = "  "
        const pluginStr = `,\n${indent}"plugin": ${formatPluginArray([packageName], indent, eol)}`
        const lastBrace = source.lastIndexOf("}")
        const updated2 = source.slice(0, lastBrace) + pluginStr + "\n" + source.slice(lastBrace)
        plans.push({ target, source, updated: updated2 })
      } else {
        plans.push({ target, source, updated })
      }
    } catch (e) {
      if (e?.code !== "ENOENT") throw new Error(`Could not inspect ${target}: ${e.message}`)
      if (!isUninstall && (name === "opencode.jsonc" || name === "opencode.json")) {
        const content = `{\n  "plugin": ["${packageName}"]\n}\n`
        plans.push({ target, source: "", updated: content, isNew: true })
      }
    }
  }
  const toWrite = plans.filter(p => p.updated !== p.source)
  for (const p of toWrite) {
    await writeFile(p.target, p.updated, "utf8")
  }
  return toWrite.length
}

async function installOrUpdate() {
  await mkdir(join(config, "agents"), { recursive: true })
  const changed = await configurePlugins(false)
  let agentsCount = 0
  try {
    await copyFile(join(root, "agents", "Raw.md"), join(config, "agents", "Raw.md"))
    agentsCount = 1
  } catch (e) {
    throw new Error(`Could not install agents/Raw.md: ${e.message}`)
  }
  console.log(`Installed ${packageName}@${packageVersion} to ${config}`)
  if (changed) console.log(`Updated plugin registration in ${changed} config file(s)`)
  console.log(`  Agents: ${agentsCount} (Raw)`)
  console.log(`  Plugin: ${packageName} (server)`)
  console.log("\nRestart OpenCode to load the plugin.")
  console.log("  Put your prompt between the markers in agents/Raw.md, then select the Raw agent.")
}

async function uninstall() {
  const changed = await configurePlugins(true)
  try { await rm(join(config, "agents", "Raw.md"), { force: true }) } catch {}
  console.log(changed ? `Removed ${packageName} from ${changed} config file(s).` : `${packageName} was not registered.`)
  console.log("Removed agents/Raw.md when present. Restart OpenCode to finish unloading.")
}

if (uninstallRequested) await uninstall()
else await installOrUpdate()
