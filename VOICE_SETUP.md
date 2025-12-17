# 🎤 Voice Conversation Setup

## Features

- **Voice Input**: Speak to the character via microphone
- **AI Powered**: Uses OpenAI Whisper (STT), ChatGPT (responses), and TTS
- **Real-time Animation**: NVIDIA Audio2Face syncs the avatar's mouth
- **Custom Prompts**: Define character personality

## 🔑 Prerequisites

You need an **OpenAI API key** to use this feature.

1. Get key: https://platform.openai.com/api-keys
2. Set environment variable:

```bash
export OPENAI_API_KEY="sk-...your-key-here..."
```

Or in `.env` file:

```
OPENAI_API_KEY=sk-...your-key-here...
```

## 🚀 Start Server

```bash
deno task dev
```

Look for this message:

```
🎤 Voice conversation: ✅ enabled
```

## 📱 Access UI

Go to:

```
http://localhost:1234/talk
```

## 🎯 How It Works

1. **Click "🎤 Start Conversation"**
2. **Speak your question** into microphone
3. **AI listens** and generates response
4. **Character speaks back** with synced animation

## 🔄 Flow

```
Microphone → Whisper (STT) → ChatGPT → TTS → Audio2Face → Animated Avatar
```

## 💰 Costs

- Whisper API: $0.02 per minute of audio
- ChatGPT: ~$0.003 per conversation (gpt-4o-mini)
- TTS: $0.015 per 1K characters

Budget: ~$0.05-0.10 per conversation

## 🛠️ Customization

### Change Character Personality

Edit `system-prompt` field in UI or use default:

```
"You are a helpful and friendly character. Keep responses concise."
```

### Change Voice

In `src/openai.ts`, change `voice` option:

- alloy (default)
- echo
- fable
- onyx
- nova
- shimmer

### Change AI Model

Edit `src/openai.ts`:

```typescript
model: "gpt-4o-mini"; // or "gpt-4", "gpt-3.5-turbo", etc.
```

## 🐛 Troubleshooting

### "OpenAI API key not configured"

→ Set `OPENAI_API_KEY` environment variable

### "Microphone access denied"

→ Allow microphone access in browser permissions

### "No audio response"

→ Check browser console for errors
→ Verify OpenAI key is valid
→ Check rate limits

## 📊 API Endpoint

### POST `/api/conversation`

```json
{
  "audio": "base64_encoded_audio",
  "systemPrompt": "Optional character prompt",
  "character": "mark_v2_3"
}
```

Response:

```json
{
  "userMessage": "What's your name?",
  "assistantMessage": "I'm Mark, nice to meet you!",
  "audio": "base64_mp3_audio",
  "audioStats": {
    "duration": 2.5,
    "sampleCount": 40000,
    "byteSize": 80000
  },
  "tokens": {
    "prompt": 45,
    "completion": 12
  }
}
```
