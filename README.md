# 🪞 Magic Mirror - Interactive Avatar System

A modern, cloud-native avatar animation platform built with **Deno + TypeScript**. Create interactive 3D characters that talk, listen, and respond with emotion-aware AI.

**Tech Stack**: Deno 🦕 | Oak Framework | TypeScript | Three.js | NVIDIA Audio2Face | face-api.js | OpenAI/Mammouth.ai

---

## ✨ Features

### 🎬 Core Avatar Engine

- **Real-time Animation**: NVIDIA Audio2Face gRPC service for mouth sync
- **3D Models**: FBX avatars (Lynx, Frank, Mirror) rendered with Three.js
- **Blendshape Control**: 100+ facial expressions and emotions
- **Multi-Model Support**: Mark v2.3, Claire v2.3, James v2.3 with YAML configs

### 🎤 Voice Conversation

- **Speech Recognition**: OpenAI Whisper STT (speech-to-text)
- **AI Responses**: ChatGPT via OpenAI or cheaper Mammouth.ai
- **Text-to-Speech**: OpenAI TTS (text-to-speech) with natural voices
- **Full Pipeline**: Microphone → STT → AI Chat → TTS → Avatar Animation

### 😊 Emotion Detection

- **Real-time Webcam Analysis**: face-api.js emotion recognition
- **7 Emotion States**: Happy, Sad, Angry, Fearful, Disgusted, Surprised, Neutral
- **Smart Greetings**: Personalized responses based on detected emotion
- **Live Visualization**: Detection box + confidence scores on canvas

### 💰 Cost Optimization

- **Default**: Uses OpenAI for full feature set
- **Budget Mode**: Switch to Mammouth.ai for 70-80% cheaper chat (optional)
- **Environment Config**: Easy provider switching via `.env`

---

## 🚀 Quick Start

### 1️⃣ Prerequisites

- **Deno** 1.40+ ([install](https://deno.com))
- **OpenAI API Key** for voice features ([get one](https://platform.openai.com/api-keys))
- Modern browser with WebRTC support

### 2️⃣ Setup

```bash
# Clone/extract project
cd Magic_Mirror

# Copy environment template
cp .env.example .env

# Edit .env and add your keys:
# OPENAI_API_KEY=sk-...your-key...
nano .env
```

### 3️⃣ Start Server

```bash
deno task dev
```

Output:

```
🚀 Oak server running at http://localhost:1234
🎤 Voice conversation: ✅ enabled
📷 Emotion detection: ✅ ready
```

### 4️⃣ Access Features

| Feature         | URL                            | Description         |
| --------------- | ------------------------------ | ------------------- |
| **Face Viewer** | http://localhost:1234/face     | 3D avatar display   |
| **Voice Chat**  | http://localhost:1234/talk     | Speech + emotion UI |
| **Settings**    | http://localhost:1234/settings | Configuration panel |
| **Debug**       | http://localhost:1234/debug    | Dev tools           |

---

## 📁 Project Structure

```
Magic_Mirror/
├── 📁 src/                          # TypeScript backend (Deno)
│   ├── server.ts                    # Oak HTTP server + routes
│   ├── openai.ts                    # AI provider abstraction
│   ├── config.ts                    # Environment + .env loader
│   ├── blendshape-utils.ts          # Facial expression engine
│   └── 📁 nvidia/                   # Audio2Face integration
│       ├── index.ts                 # Module exports
│       ├── constants.ts             # PCM16, timing config
│       ├── models.ts                # Mark/Claire/James configs
│       ├── audio-processor.ts       # Audio normalization
│       ├── config-loader.ts         # YAML parser
│       └── service.ts               # A2F service layer
│
├── 📁 public/                       # Frontend (HTML/CSS/JS)
│   ├── index.html                   # Home page
│   ├── face.html                    # Avatar viewer
│   ├── talk.html                    # Voice conversation UI ⭐
│   ├── settings.html                # Config panel
│   ├── main.js                      # Three.js + FBX loader
│   ├── voice-conversation.js        # Microphone capture + API
│   ├── emotion-detector.js          # Webcam emotion recognition ⭐
│   ├── blendshape-drivers.js        # Blendshape animations
│   ├── styles.css                   # Main styles
│   └── audio-worklets/              # Web Audio API processors
│
├── 📁 characters/                   # 3D Avatar Models (FBX)
│   ├── frank/
│   ├── mirror/
│   └── lynq/                        # Default avatar (Lynx bobcat)
│
├── 📁 nvidia/                       # NVIDIA Audio2Face config
│   ├── 📁 configs/                  # Model YAML files
│   │   ├── mark_v2.3.yml
│   │   ├── claire_v2.3.yml
│   │   └── james_v2.3.yml
│   └── 📁 protos/                   # gRPC protocol buffers
│
├── deno.json                        # Deno config + tasks
├── .env.example                     # Environment template
├── VOICE_SETUP.md                   # Voice feature documentation ⭐
├── CAMERA_SETUP.md                  # Emotion detection setup
└── README.md                        # This file
```

---

## 🎯 How It Works

### 🎤 Voice Conversation Flow

```
┌─────────────┐
│  Microphone │
└──────┬──────┘
       │ WebAudio API
       ▼
┌──────────────────┐     ┌─────────────┐
│ Whisper (OpenAI) │────▶│   User Text  │
└──────────────────┘     └─────────────┘
       │                        │
       │                        ▼
       │                 ┌────────────────┐
       │                 │ ChatGPT/Claude │ (AI Response)
       │                 └────────────────┘
       │                        │
       ▼                        ▼
┌──────────────────┐     ┌─────────────────┐
│   TTS (OpenAI)   │────▶│  MP3 Audio File │
└──────────────────┘     └─────────────────┘
       │                        │
       ▼                        ▼
┌──────────────────────────────────┐
│  Audio2Face (NVIDIA gRPC)        │
│  Generates blendshape animation  │
└──────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│  Three.js Avatar               │
│  Speaks with mouth sync         │
└──────────────────────────────────┘
```

### 😊 Emotion Detection Flow

```
┌─────────────┐
│   Webcam    │
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│  face-api.js     │
│  TinyFaceDetector│ (Detects face)
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ FaceExpressionNet│ (7 emotions)
└──────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│ Emotion: Happy (92% confidence)  │
│ Personalized greeting generated  │
└──────────────────────────────────┘
```

---

## 🔧 Configuration

### Environment Variables (`.env`)

```bash
# Required: OpenAI API key
OPENAI_API_KEY=sk-...

# Optional: Server port (default: 1234)
PORT=1234

# Optional: AI Model (default: gpt-4o-mini)
OPENAI_MODEL=gpt-4o-mini

# Optional: TTS voice (default: alloy)
OPENAI_VOICE=alloy

# Optional: Mammouth.ai API key (for cheaper chat)
MAMMOUTH_API_KEY=...

# Optional: Nvidia Audio2Face endpoint
NVIDIA_A2F_ENDPOINT=grpc.nvcf.nvidia.com:443
```

### Switch to Mammouth.ai (Optional)

For 70-80% cheaper chat completions:

```bash
# In .env, add:
MAMMOUTH_API_KEY=your-key-here

# Note: Whisper STT and TTS remain on OpenAI (not available on Mammouth)
```

---

## 📊 API Endpoints

### Public Pages

- `GET /` → Home page
- `GET /face` → Avatar viewer
- `GET /talk` → Voice conversation UI with emotion detection
- `GET /settings` → Settings panel
- `GET /debug` → Debug tools

### API Routes

```
GET /api/characters
  Returns: [{ name: "Lynx", url: "/characters/lynq/lynx_bobcat_01.fbx" }, ...]

GET /api/models
  Returns: [{ name: "Mark v2.3", config: {...} }, ...]

POST /api/process-audio
  Body: { audio: "base64_pcm16", character: "mark_v2_3" }
  Returns: { blendshapes: [...], duration: 2.5 }

POST /api/conversation
  Body: { audio: "base64_wav", systemPrompt?: "...", character?: "mark_v2_3" }
  Returns: { userMessage: "...", assistantMessage: "...", audio: "base64_mp3" }
```

---

## 💻 Development

### Run in Development Mode

```bash
deno task dev
```

### View Deno Tasks

```bash
deno task
```

### Build for Production

```bash
deno compile --allow-net --allow-read --allow-env src/server.ts
```

### Debug Logs

```bash
# In server.ts, logs show:
# - API requests
# - OpenAI/Mammouth API calls
# - Emotion detection events
# - Audio processing stats
```

---

## 🎨 Customization

### Change Default Avatar

Edit `/public/face.js`:

```javascript
const MIRROR_URL = "/characters/lynq/lynx_bobcat_01.fbx"; // Change this
```

### Change Character Voice

Edit `src/openai.ts`:

```typescript
voice: "nova"; // Options: alloy, echo, fable, onyx, nova, shimmer
```

### Change AI Model

Edit `src/openai.ts`:

```typescript
model: "gpt-4"; // Options: gpt-4, gpt-4o, gpt-3.5-turbo, etc.
```

### Add Custom Emotion Greeting

Edit `public/emotion-detector.js`:

```javascript
const greetings = {
  happy: "Du siehst glücklich aus! Schön, dass es dir gut geht!",
  // Add more...
};
```

---

## 📚 Detailed Guides

- 🎤 **[Voice Conversation Setup](./VOICE_SETUP.md)** - Complete voice feature guide
- 📷 **[Camera & Emotion Detection](./CAMERA_SETUP.md)** - Webcam setup & troubleshooting
- 🔊 **[Audio Processing](./docs/realtime-audio-to-a2f.md)** - Technical audio details

---

## 🐛 Troubleshooting

| Problem                         | Solution                                               |
| ------------------------------- | ------------------------------------------------------ |
| "Port already in use"           | `lsof -ti:1234 \| xargs kill -9` then restart          |
| "OpenAI API key not configured" | Add `OPENAI_API_KEY` to `.env`                         |
| "Microphone access denied"      | Allow mic in browser permissions → Reload page         |
| "No emotion detection"          | Check browser console; face-api.js needs camera access |
| "Avatar not animating"          | Verify Audio2Face endpoint is reachable                |
| "Slow response times"           | Check OpenAI rate limits; consider Mammouth.ai         |

---

## 🚀 Deployment

### Deploy to Deno Deploy

```bash
deno publish
```

### Deploy to Docker

```dockerfile
FROM denoland/deno:latest
COPY . /app
WORKDIR /app
RUN deno cache src/server.ts
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "src/server.ts"]
```

---

## 📄 License

This project integrates with NVIDIA Audio2Face and OpenAI services. Refer to their terms of service for usage restrictions.

---

## 🤝 Contributing

Improvements welcome! Areas for enhancement:

- [ ] Additional avatar models
- [ ] More emotion states
- [ ] Alternative AI providers (Claude, Cohere, etc.)
- [ ] Multi-language support
- [ ] Recording conversations
- [ ] Analytics & metrics

---

**Made with ❤️ using Deno, TypeScript, and modern web APIs**

## 🌐 API Endpoints

### `GET /api/characters`

List available FBX models

### `GET /api/models`

List supported Audio2Face models

### `POST /api/process-audio`

Process audio with Audio2Face

## 📝 For More Details

See [DENO_README.md](DENO_README.md) for complete documentation.

## Integrating OpenAI Realtime audio with NVIDIA Audio2Face

If you are wiring OpenAI’s Realtime API into NVIDIA Audio2Face (A2F), follow the step-by-step guide in [`docs/realtime-audio-to-a2f.md`](docs/realtime-audio-to-a2f.md). It covers enabling audio output from the Realtime session, capturing the correct WebRTC stream, resampling to 16 kHz PCM16, chunking uploads for A2F, and the telemetry you need to confirm the avatar is actually receiving speech audio.
