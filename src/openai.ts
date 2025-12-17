/**
 * OpenAI / Mammouth.ai Integration Module
 * Handles Whisper (STT), ChatGPT (responses), and TTS
 *
 * Supports:
 * - OpenAI (https://api.openai.com/v1)
 * - Mammouth.ai (https://api.mammouth.ai/v1) - recommended, cheaper
 */

import { Buffer } from "node:buffer";

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  voice?: string;
  maxTokens?: number;
  baseUrl?: string;
  provider?: "openai" | "mammouth";
}

export interface TranscriptionResult {
  text: string;
  duration?: number;
}

export interface ChatResponse {
  text: string;
  tokens?: {
    prompt: number;
    completion: number;
  };
}

export interface TTSResult {
  audioBase64: string;
  format: string;
  duration?: number;
}

const DEFAULT_CONFIG: Partial<OpenAIConfig> = {
  model: "gpt-4o-mini",
  voice: "alloy",
  maxTokens: 256,
  provider: "mammouth",
};

/**
 * Get API base URL based on provider
 */
function getApiBaseUrl(config: OpenAIConfig): string {
  if (config.baseUrl) {
    return config.baseUrl;
  }

  const provider = config.provider || DEFAULT_CONFIG.provider;

  if (provider === "mammouth") {
    return "https://api.mammouth.ai/v1";
  }

  return "https://api.openai.com/v1";
}

/**
 * Transcribe audio using Whisper (only works with OpenAI for now)
 */
export async function transcribeAudio(
  audioBase64: string,
  config: OpenAIConfig
): Promise<TranscriptionResult> {
  const apiKey =
    config.apiKey ||
    Deno.env.get("MAMMOUTH_API_KEY") ||
    Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("API key not configured");
  }

  // Whisper is only available on OpenAI, not Mammouth
  if (config.provider !== "openai") {
    throw new Error(
      "Whisper STT is only available with OpenAI. Please set provider: 'openai'"
    );
  }

  // Convert base64 to blob data
  const audioBuffer = Buffer.from(audioBase64, "base64");

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([audioBuffer], { type: "audio/wav" }),
    "audio.wav"
  );
  formData.append("model", "whisper-1");

  try {
    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Whisper API error: ${error.error?.message}`);
    }

    const result = await response.json();
    return {
      text: result.text,
    };
  } catch (err) {
    throw new Error(
      `Failed to transcribe audio: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
}

/**
 * Generate chat response (works with Mammouth.ai or OpenAI)
 */
export async function generateChatResponse(
  userMessage: string,
  systemPrompt: string,
  config: OpenAIConfig
): Promise<ChatResponse> {
  const apiKey =
    config.apiKey ||
    Deno.env.get("MAMMOUTH_API_KEY") ||
    Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("API key not configured");
  }

  const baseUrl = getApiBaseUrl(config);
  const model = config.model || DEFAULT_CONFIG.model;
  const maxTokens = config.maxTokens || DEFAULT_CONFIG.maxTokens;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`ChatGPT API error: ${error.error?.message}`);
    }

    const result = await response.json();
    const assistantMessage = result.choices[0]?.message?.content;

    if (!assistantMessage) {
      throw new Error("No response from ChatGPT");
    }

    return {
      text: assistantMessage,
      tokens: {
        prompt: result.usage?.prompt_tokens || 0,
        completion: result.usage?.completion_tokens || 0,
      },
    };
  } catch (err) {
    throw new Error(
      `Failed to generate chat response: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
}

/**
 * Generate speech from text using OpenAI TTS (only on OpenAI, not Mammouth)
 */
export async function generateSpeech(
  text: string,
  config: OpenAIConfig
): Promise<TTSResult> {
  const apiKey = config.apiKey || Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("API key not configured");
  }

  // TTS is only available on OpenAI
  if (config.provider !== "openai") {
    throw new Error(
      "TTS is only available with OpenAI. Please set provider: 'openai'"
    );
  }

  const voice = config.voice || DEFAULT_CONFIG.voice;

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: voice,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`TTS API error: ${error.error?.message}`);
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    return {
      audioBase64: base64,
      format: "mp3",
    };
  } catch (err) {
    throw new Error(
      `Failed to generate speech: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
  }
}

/**
 * Full conversation pipeline: transcribe → chat → tts
 */
export async function conversationPipeline(
  audioBase64: string,
  systemPrompt: string,
  config: OpenAIConfig
): Promise<{
  userMessage: string;
  assistantMessage: string;
  audioBase64: string;
  tokens?: ChatResponse["tokens"];
}> {
  console.log("[OpenAI] Starting conversation pipeline...");

  // Step 1: Transcribe
  console.log("[OpenAI] Transcribing audio...");
  const transcription = await transcribeAudio(audioBase64, config);
  console.log(`[OpenAI] User said: "${transcription.text}"`);

  // Step 2: Generate response
  console.log("[OpenAI] Generating chat response...");
  const chatResponse = await generateChatResponse(
    transcription.text,
    systemPrompt,
    config
  );
  console.log(`[OpenAI] Assistant: "${chatResponse.text}"`);

  // Step 3: Generate speech
  console.log("[OpenAI] Generating speech...");
  const ttsResponse = await generateSpeech(chatResponse.text, config);
  console.log("[OpenAI] Speech generated");

  return {
    userMessage: transcription.text,
    assistantMessage: chatResponse.text,
    audioBase64: ttsResponse.audioBase64,
    tokens: chatResponse.tokens,
  };
}
