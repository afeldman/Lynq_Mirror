import {
  Application,
  Router,
  send,
} from "https://deno.land/x/oak@v14.0.0/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import {
  processAudioWithA2F,
  listSupportedModels,
  validateAudioData,
} from "./nvidia/index.ts";
import { conversationPipeline, type OpenAIConfig } from "./openai.ts";
import { loadEnv, getConfig, printConfig } from "./config.ts";

// Load environment variables from .env
await loadEnv();

const PORT = Number(getConfig("PORT")) || 1234;
const __dirname = new URL(".", import.meta.url).pathname;

// Directory paths
const charactersDir = join(__dirname, "..", "characters");
const publicDir = join(__dirname, "..", "public");
const sfxDir = join(__dirname, "..", "sfx");

const app = new Application();
const router = new Router();

// Middleware: JSON body parser
app.use(async (ctx, next) => {
  if (
    ctx.request.method === "POST" &&
    ctx.request.headers.get("content-type")?.includes("application/json")
  ) {
    try {
      ctx.request.body = await ctx.request.body({ type: "json" }).value;
    } catch {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid JSON" };
      return;
    }
  }
  await next();
});

// Static file serving
app.use(async (ctx, next) => {
  if (
    ctx.request.url.pathname === "/" ||
    ctx.request.url.pathname === "/index.html"
  ) {
    await send(ctx, "index.html", { root: publicDir });
    return;
  }

  if (ctx.request.url.pathname.startsWith("/characters/")) {
    const filePath = ctx.request.url.pathname.replace(/^\/characters\//, "");
    try {
      await send(ctx, filePath, { root: charactersDir });
      return;
    } catch {
      // Fall through
    }
  }

  if (ctx.request.url.pathname.startsWith("/sfx/")) {
    const filePath = ctx.request.url.pathname.replace(/^\/sfx\//, "");
    try {
      await send(ctx, filePath, { root: sfxDir });
      return;
    } catch {
      // Fall through
    }
  }

  try {
    await send(ctx, ctx.request.url.pathname.replace(/^\//, ""), {
      root: publicDir,
    });
  } catch {
    await next();
  }
});

// Routes
router.get("/face", async (ctx) => {
  await send(ctx, "face.html", { root: publicDir });
});

router.get("/debug", async (ctx) => {
  await send(ctx, "debug.html", { root: publicDir });
});

router.get("/settings", async (ctx) => {
  await send(ctx, "settings.html", { root: publicDir });
});

router.get("/nvidia", async (ctx) => {
  await send(ctx, "nvidia.html", { root: publicDir });
});

router.get("/talk", async (ctx) => {
  await send(ctx, "talk.html", { root: publicDir });
});

// List available characters
router.get("/api/characters", async (ctx) => {
  try {
    const characters: Array<{ name: string; url: string }> = [];

    try {
      for await (const entry of Deno.readDir(charactersDir)) {
        if (entry.isDirectory) {
          try {
            for await (const file of Deno.readDir(
              join(charactersDir, entry.name)
            )) {
              if (file.isFile && file.name.toLowerCase().endsWith(".fbx")) {
                characters.push({
                  name: `${entry.name} / ${file.name}`,
                  url: `/characters/${entry.name}/${file.name}`,
                });
              }
            }
          } catch {
            // Skip unreadable directories
          }
        } else if (entry.isFile && entry.name.toLowerCase().endsWith(".fbx")) {
          characters.push({
            name: entry.name,
            url: `/characters/${entry.name}`,
          });
        }
      }
    } catch {
      // Characters directory might not exist
    }

    ctx.response.body = characters;
  } catch (err) {
    console.error("Error listing characters:", err);
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to list characters" };
  }
});

// List supported models
router.get("/api/models", async (ctx) => {
  try {
    const models = listSupportedModels();
    ctx.response.body = models;
  } catch (err) {
    console.error("Error listing models:", err);
    ctx.response.status = 500;
    ctx.response.body = { error: "Failed to list models" };
  }
});

// Process audio with Audio2Face
router.post("/api/process-audio", async (ctx) => {
  try {
    const body = ctx.request.body as {
      audio: string;
      model?: string;
      functionId?: string;
    };

    if (!body.audio) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Audio data required" };
      return;
    }

    // Validate audio data
    const validation = validateAudioData(body.audio);
    if (!validation.valid) {
      ctx.response.status = 400;
      ctx.response.body = { error: validation.error };
      return;
    }

    const result = await processAudioWithA2F(
      body.audio,
      body.model || "mark_v2_3",
      body.functionId
    );

    ctx.response.body = result;
  } catch (err) {
    console.error("Error processing audio:", err);
    ctx.response.status = 500;
    ctx.response.body = {
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
});

// Voice conversation with character
router.post("/api/conversation", async (ctx) => {
  try {
    const body = ctx.request.body as {
      audio: string;
      systemPrompt?: string;
      character?: string;
    };

    if (!body.audio) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Audio data required" };
      return;
    }

    // Validate audio
    const validation = validateAudioData(body.audio);
    if (!validation.valid) {
      ctx.response.status = 400;
      ctx.response.body = { error: validation.error };
      return;
    }

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      ctx.response.status = 500;
      ctx.response.body = { error: "OpenAI API key not configured" };
      return;
    }

    const systemPrompt =
      body.systemPrompt ||
      `You are a helpful and friendly character. Keep responses concise (1-2 sentences). 
      The user is speaking to you via voice, so be warm and conversational.`;

    const openaiConfig: OpenAIConfig = {
      apiKey: openaiApiKey,
      voice: "alloy",
    };

    // Run full conversation pipeline
    const result = await conversationPipeline(
      body.audio,
      systemPrompt,
      openaiConfig
    );

    // Optionally process with Audio2Face for animation
    const a2fResult = await processAudioWithA2F(
      result.audioBase64,
      body.character || "mark_v2_3"
    );

    ctx.response.body = {
      userMessage: result.userMessage,
      assistantMessage: result.assistantMessage,
      audio: result.audioBase64,
      audioStats: a2fResult.audioStats,
      tokens: result.tokens,
    };
  } catch (err) {
    console.error("Error processing conversation:", err);
    ctx.response.status = 500;
    ctx.response.body = {
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

// Error handler
app.addEventListener("error", (evt) => {
  console.error("Application error:", evt.error);
});

console.log(`🚀 Server running at http://localhost:${PORT}`);
console.log(`📁 Public directory: ${publicDir}`);
console.log(`👥 Characters directory: ${charactersDir}`);
console.log(
  `🎤 Voice conversation: ${
    getConfig("OPENAI_API_KEY")
      ? "✅ enabled"
      : "❌ disabled (set OPENAI_API_KEY in .env)"
  }`
);
printConfig();

await app.listen({ port: PORT });
