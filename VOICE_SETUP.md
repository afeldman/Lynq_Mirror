# 🎤 Voice Conversation Setup

Build interactive conversations where users **speak** to an AI avatar that **listens**, **thinks**, and **responds** with animated mouth sync.

## ✨ Features

- **🎙️ Speech Recognition**: OpenAI Whisper converts audio to text
- **💬 AI Chat**: ChatGPT/Claude generates natural responses
- **🔊 Text-to-Speech**: OpenAI TTS with natural-sounding voices
- **😊 Emotion-Aware**: Detects user emotion and personalizes responses
- **🎬 Real-time Animation**: NVIDIA Audio2Face syncs avatar mouth movement
- **📱 Browser-based**: Works with standard webcam + microphone

## 🔑 Prerequisites

### Required

1. **OpenAI API Key** - For Whisper (STT), ChatGPT, and TTS

   - Get it: https://platform.openai.com/api-keys
   - Cost: ~$0.05-0.10 per conversation

2. **Modern Browser**

   - Chrome, Firefox, Edge, or Safari (WebRTC support required)
   - Microphone access allowed

3. **NVIDIA Audio2Face Endpoint** (optional but recommended)
   - Provides realistic mouth sync
   - Endpoint: `grpc.nvcf.nvidia.com:443`

## 🚀 Quick Setup

### Step 1: Configure Environment

```bash
# Copy template
cp .env.example .env

# Edit with your keys
nano .env
```

```env
OPENAI_API_KEY=sk-...your-api-key-here...
OPENAI_MODEL=gpt-4o-mini          # or gpt-4, gpt-3.5-turbo
OPENAI_VOICE=alloy                 # or echo, fable, onyx, nova, shimmer
PORT=1234
```

### Step 2: Start Server

```bash
deno task dev
```

Watch for success message:

```
🎤 Voice conversation: ✅ enabled
🚀 Server running at http://localhost:1234
```

### Step 3: Access Voice Chat

Open browser:

```
http://localhost:1234/talk
```

## 🎯 Using Voice Chat

### Basic Conversation

1. **Allow Permissions**: Grant microphone + camera access when prompted
2. **See Your Emotion**: Webcam shows detected emotion (Happy, Sad, etc.)
3. **Click 🎤 Button**: Start recording
4. **Speak**: Ask your question or say something
5. **Wait**: AI processes and responds
6. **Watch**: Avatar animates and "speaks" the response

### Advanced: Custom System Prompt

Define character behavior in the UI:

```
Du bist ein hilfsbereiter Roboter mit Sarkasmus.
Antworte kurz und witzig. Sei freundlich aber kritisch.
```

### Select Different Avatar

- **Lynx** (default bobcat) - Energetic
- **Frank** - Friendly
- **Mirror** - Neutral

## 📊 How It Works (Flow)

```
┌─────────────────────────────────────────────────────────┐
│                    USER SPEAKS                          │
└────────────────────────┬────────────────────────────────┘
                         │
         ┌───────────────▼───────────────┐
         │  Microphone Capture           │
         │  Browser WebAudio API         │
         └───────────────┬───────────────┘
                         │
         ┌───────────────▼───────────────┐
         │  OpenAI Whisper               │
         │  Speech-to-Text (STT)         │
         │  Converts audio → text        │
         └───────────────┬───────────────┘
                         │ (Transcribed text)
         ┌───────────────▼───────────────┐
         │  ChatGPT/Claude               │
         │  Generates AI response        │
         │  (Uses emotion context)       │
         └───────────────┬───────────────┘
                         │ (Response text)
         ┌───────────────▼───────────────┐
         │  OpenAI TTS                   │
         │  Text-to-Speech               │
         │  Converts text → audio (MP3)  │
         └───────────────┬───────────────┘
                         │ (Audio file)
         ┌───────────────▼───────────────┐
         │  NVIDIA Audio2Face            │
         │  Analyzes audio               │
         │  Generates blendshape data    │
         │  (mouth movements)            │
         └───────────────┬───────────────┘
                         │
         ┌───────────────▼───────────────┐
         │  Three.js Avatar              │
         │  Animates mouth + speaks      │
         │  User hears and sees response │
         └───────────────────────────────┘
```

## 💬 Emotion-Aware Responses

The system automatically detects your emotion and adjusts the response:

| Your Emotion | AI Tone      | Example Response                                            |
| ------------ | ------------ | ----------------------------------------------------------- |
| 😊 Happy     | Enthusiastic | "Du siehst glücklich aus! Schön, dass es dir gut geht!"     |
| 😢 Sad       | Empathetic   | "Du wirkst nachdenklich... Möchtest du mir etwas erzählen?" |
| 😠 Angry     | Calm         | "Du siehst ernst aus. Vielleicht kann ich dir helfen?"      |
| 😨 Fearful   | Reassuring   | "Du wirkst angespannt. Keine Sorge, ich bin hier!"          |
| 😐 Neutral   | Friendly     | "Hallo! Wie kann ich dir heute helfen?"                     |

## 💰 Cost Breakdown

### OpenAI Pricing (per conversation)

| Service           | Price           | Usage                       |
| ----------------- | --------------- | --------------------------- |
| **Whisper (STT)** | $0.02/min       | ~0.5-2 min per conversation |
| **ChatGPT**       | $0.001-0.01     | ~50-100 tokens per response |
| **TTS**           | $0.015/1K chars | ~200-500 chars per response |
| **Total**         | **~$0.05-0.15** | Typical conversation        |

### Optimization: Use Mammouth.ai (Optional)

Switch to Mammouth.ai for **70-80% cheaper** chat:

```env
MAMMOUTH_API_KEY=your-key-here
# Note: Keep OPENAI_API_KEY for Whisper & TTS
```

Cost drops to ~$0.01-0.03 per conversation!

## 🎨 Customization

### Change TTS Voice

Edit `src/openai.ts` → Change `voice` option:

```typescript
voice: "nova"; // Options: alloy, echo, fable, onyx, nova, shimmer
```

**Try all voices** in OpenAI playground: https://platform.openai.com/docs/guides/text-to-speech

### Change AI Model

Edit `src/openai.ts` → Change `model`:

```typescript
// More capable but expensive
model: "gpt-4";

// Budget option (still very good)
model: "gpt-3.5-turbo";

// Best balance (default)
model: "gpt-4o-mini";
```

### Custom System Prompt

In `/talk` UI, enter custom system prompt:

```
Du bist ein sachkundiger Techniker.
Antworte präzise und hilfreich.
Erkläre technische Konzepte verständlich.
```

This controls the character's personality for the entire conversation.

## 🔊 Audio Formats

The system handles:

- **Input**: WebAudio PCM16 @ 16kHz (Whisper requirement)
- **Internal**: Base64-encoded WAV
- **Output**: MP3 (OpenAI TTS standard)
- **Processing**: NVIDIA Audio2Face requires linear PCM

Automatic conversion between all formats! ✨

## 🐛 Troubleshooting

### ❌ "OpenAI API key not configured"

**Solution:**

```bash
# Check .env exists and has OPENAI_API_KEY
cat .env | grep OPENAI_API_KEY

# If missing, add it:
echo "OPENAI_API_KEY=sk-..." >> .env
```

### ❌ "Microphone access denied"

**Solution:**

1. Check browser microphone permissions (top-left icon)
2. Click Settings → Allow camera + microphone
3. Reload page: `Ctrl+R` or `Cmd+R`

### ❌ "Emotion detection not working"

**Solution:**

1. Grant **camera** permission (separate from microphone)
2. Check browser console for errors: `F12` → Console tab
3. Ensure face is visible and well-lit
4. Works best in Chrome/Firefox (Safari may have limitations)

### ❌ "Avatar not animating"

**Solution:**

1. Check NVIDIA A2F endpoint:
   ```bash
   echo $NVIDIA_A2F_ENDPOINT
   # Should show: grpc.nvcf.nvidia.com:443
   ```
2. Try default avatar first (Lynx)
3. Check server logs: `deno task dev` output

### ❌ "Audio response is robotic/slow"

**Solution:**

1. Check OpenAI TTS voice setting (try different voices)
2. Reduce system prompt complexity
3. Check OpenAI rate limits
4. May be network latency - try closer server

### ❌ "High latency / slow responses"

**Solution:**

1. Use cheaper model: `gpt-3.5-turbo` instead of `gpt-4`
2. Reduce system prompt length
3. Check internet connection
4. Consider Mammouth.ai for cheaper chat tier

## 🔌 API Reference

### POST `/api/conversation`

**Request:**

```json
{
  "audio": "data:audio/wav;base64,UklGRi4A...",
  "systemPrompt": "You are a helpful assistant",
  "character": "mark_v2_3",
  "emotion": "happy"
}
```

**Response:**

```json
{
  "userMessage": "What's the weather?",
  "assistantMessage": "I don't have real-time weather data...",
  "audio": "data:audio/mp3;base64,//NExAAR...",
  "audioStats": {
    "duration": 3.2,
    "sampleCount": 51200,
    "byteSize": 20480
  },
  "tokens": {
    "prompt": 45,
    "completion": 18,
    "total": 63
  }
}
```

## 🔄 Conversation Loop

The `/talk` interface automatically:

1. Records 5-30 seconds of audio
2. Sends to server
3. Server processes: STT → Chat → TTS → A2F
4. Returns animated response
5. Avatar plays response with sync
6. Ready for next input

## 📱 Mobile Support

- ✅ iOS Safari: Microphone ✓ (camera ? - iOS limits)
- ✅ Android Chrome: Microphone ✓, Camera ✓
- ⚠️ Desktop Safari: Limited WebRTC
- ✅ Firefox: Full support

## 🎓 Learn More

- OpenAI Whisper: https://openai.com/research/whisper
- OpenAI TTS: https://platform.openai.com/docs/guides/text-to-speech
- NVIDIA Audio2Face: https://developer.nvidia.com/ace
- face-api.js: https://github.com/justadudewhohacks/face-api.js
