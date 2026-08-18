import OpenAI from "openai";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("/Users/mrnetwork/Syndix/.env.local", "utf8")
    .split("\n").filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const client = new OpenAI({
  apiKey: env.ZG_API_KEY,
  baseURL: "https://router-api.0g.ai/v1",
  timeout: 180_000,   // the previous run had none and hung past 13 minutes
  maxRetries: 0,
});
const schema = JSON.parse(readFileSync("/tmp/schema.json", "utf8"));
const messages = JSON.parse(readFileSync("/tmp/messages.json", "utf8"));
const LOG = "/tmp/bench2.log";
writeFileSync(LOG, "");

// Validation mirroring lib/openai.ts, so a pass here means a pass there.
function problems(p) {
  const out = [];
  if (!p || typeof p !== "object") return ["not an object"];
  for (const [k, min] of [["title",8],["standfirst",16],["subjectLine",8],["body",400]]) {
    if (typeof p[k] !== "string") out.push(`${k}:${typeof p[k]}`);
    else if (p[k].trim().length < min) out.push(`${k}:short`);
  }
  const b = typeof p.body === "string" ? p.body.trim() : "";
  if (b.startsWith("{") || b.startsWith("[")) out.push("body:json");
  if (b && !/^##\s/m.test(b)) out.push("body:no-h2");
  if (!["bullish","neutral","cautious"].includes(String(p.sentiment))) out.push("sentiment");
  if (typeof p.engagementIndex !== "number" || p.engagementIndex < 0 || p.engagementIndex > 100) out.push("engagementIndex");
  if (!Array.isArray(p.executiveSummary) || p.executiveSummary.length === 0) out.push("executiveSummary");
  return out;
}

const models = process.argv.slice(2);
const TRIALS = Number(process.env.TRIALS || 2);
const results = {};

// Models run concurrently; trials within a model stay sequential.
await Promise.all(models.map(async (model) => {
  results[model] = [];
  for (let i = 1; i <= TRIALS; i++) {
    const t0 = Date.now();
    try {
      const r = await client.chat.completions.create({
        model, messages, response_format: { type: "json_schema", json_schema: schema },
      });
      const raw = r.choices[0]?.message?.content ?? "";
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* stays null */ }
      const probs = parsed ? problems(parsed) : ["unparseable"];
      results[model].push({ ms: Date.now() - t0, ok: probs.length === 0, probs, usage: r.usage, words: parsed?.body ? String(parsed.body).split(/\s+/).length : 0 });
      appendFileSync(LOG, `${model} trial ${i}: ${probs.length === 0 ? "PASS" : "FAIL " + probs.join(",")} (${Date.now()-t0}ms)\n`);
    } catch (e) {
      results[model].push({ ms: Date.now() - t0, ok: false, probs: ["request:" + String(e.message || e).slice(0, 60)] });
      appendFileSync(LOG, `${model} trial ${i}: ERROR ${String(e.message || e).slice(0,70)}\n`);
    }
    writeFileSync("/tmp/bench2.json", JSON.stringify(results, null, 2));
  }
}));
appendFileSync(LOG, "ALL DONE\n");
