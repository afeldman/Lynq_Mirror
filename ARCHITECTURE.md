# 🏗️ Architecture & Technical Design

Comprehensive guide to Magic Mirror's system architecture, data flows, and implementation details.

## 🎯 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (Client)                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Three.js 3D Renderer                              │   │
│  │  ┌──────────────────┐      ┌──────────────────┐   │   │
│  │  │ FBX Avatar Model │◄─────┤ Blendshape Data  │   │   │
│  │  │ Lynx, Frank,     │      │ (100+ shapes)    │   │   │
│  │  │ Mirror           │      └──────────────────┘   │   │
│  │  └──────────────────┘                             │   │
│  │         │                                         │   │
│  │         ├─ face-api.js (Emotion Detection)       │   │
│  │         │  ├─ TinyFaceDetector                   │   │
│  │         │  └─ FaceExpressionNet                  │   │
│  │         │                                         │   │
│  │         ├─ WebAudio API (Microphone Capture)    │   │
│  │         │  └─ MediaRecorder                      │   │
│  │         │                                         │   │
│  │         └─ WebGL Canvas (Video Display)          │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  API Communication Layer                            │   │
│  │  ├─ POST /api/conversation (Main endpoint)          │   │
│  │  ├─ GET /api/characters (List avatars)              │   │
│  │  ├─ GET /api/models (List A2F models)               │   │
│  │  └─ POST /api/process-audio (Direct A2F)            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ HTTPS/REST
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Deno Server (Backend)                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Oak HTTP Framework                                │   │
│  │  ├─ Route Handler: /talk, /face, /settings        │   │
│  │  ├─ Middleware: Logger, CORS                       │   │
│  │  └─ Static Files: public/, characters/             │   │
│  └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│  ┌──────────────────────┼──────────────────────────────┐   │
│  │                      │                              │   │
│  ▼                      ▼                              ▼   │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │   │
│ │ OpenAI API   │  │ NVIDIA A2F   │  │ Config       │    │   │
│ │              │  │ gRPC Service │  │ Loader       │    │   │
│ │ ├─ Whisper   │  │              │  │              │    │   │
│ │ │  (STT)     │  │ ┌──────────┐ │  │ ├─ .env      │    │   │
│ │ ├─ ChatGPT   │  │ │gRPC Proto│ │  │ │ Loader    │    │   │
│ │ │  (Chat)    │  │ │ Bindings │ │  │ ├─ YAML     │    │   │
│ │ ├─ TTS       │  │ └──────────┘ │  │ │ Parser    │    │   │
│ │ │  (Voice)   │  │              │  │ └─ Env      │    │   │
│ │ └──EncProv───┘  └──────────────┘  │   Vars     │    │   │
│ │  (Mammouth.ai   ┌─────────────┐   └──────────────┘    │   │
│ │   optional)     │ Audio       │                        │   │
│ │                 │ Processor   │   ┌──────────────┐    │   │
│ │                 │             │   │ Blendshape   │    │   │
│ │                 │ ├─ PCM16    │   │ Utils        │    │   │
│ │                 │ ├─ Normalize│   │              │    │   │
│ │                 │ ├─ Resample │   │ ├─ Apply    │    │   │
│ │                 │ └─ Encode   │   │ │ Config    │    │   │
│ │                 └─────────────┘   │ ├─ Smooth   │    │   │
│ │                                   │ └─ Normalize│    │   │
│ │                 ┌─────────────┐   └──────────────┘    │   │
│ │                 │ Conversation│                        │   │
│ │                 │ Pipeline    │                        │   │
│ │                 │             │                        │   │
│ │                 │ ├─ STT      │                        │   │
│ │                 │ ├─ Chat     │                        │   │
│ │                 │ ├─ TTS      │                        │   │
│ │                 │ ├─ A2F      │                        │   │
│ │                 │ └─ Respond  │                        │   │
│ │                 └─────────────┘                        │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Data Models                                        │   │
│  │  ├─ OpenAIConfig (provider, model, voice, key)      │   │
│  │  ├─ AudioStats (duration, samples, bytes)          │   │
│  │  ├─ ConversationResult (messages, audio, tokens)   │   │
│  │  ├─ BlendshapeConfig (emotions, values)            │   │
│  │  └─ ModelConfig (mark_v2_3, claire_v2_3, etc.)    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 📊 Data Flow Diagram

### Voice Conversation Flow (Detailed)

```
CLIENT                              SERVER                    EXTERNAL APIs
  │                                   │                            │
  ├─ 1. User speaks                   │                            │
  │  (Microphone Input)                │                            │
  │                                   │                            │
  ├─ 2. Stop recording                │                            │
  │  (PCM16 @ 16kHz)                  │                            │
  │                                   │                            │
  ├─ 3. Encode to base64 WAV          │                            │
  │                                   │                            │
  ├─ 4. POST /api/conversation ──────►│                            │
  │  { audio, systemPrompt, emotion } │                            │
  │                                   │                            │
  │                                   ├─ 5. Decode base64         │
  │                                   │                            │
  │                                   ├─ 6. Send to Whisper ─────►│
  │                                   │  (STT)                     │ OpenAI
  │                                   │                            │ Whisper
  │                                   │◄─ 7. Return text ─────────┤
  │                                   │  "What's the weather?"     │
  │                                   │                            │
  │                                   ├─ 8. Build system prompt   │
  │                                   │  + emotion context         │
  │                                   │                            │
  │                                   ├─ 9. Send to ChatGPT ─────►│
  │                                   │  (Chat completion)         │ OpenAI
  │                                   │                            │ ChatGPT
  │                                   │◄─ 10. Return response ────┤
  │                                   │  "I don't have real-time..." │
  │                                   │                            │
  │                                   ├─ 11. Send to TTS ─────────►│
  │                                   │  (Text-to-speech)          │ OpenAI
  │                                   │                            │ TTS
  │                                   │◄─ 12. Return MP3 ─────────┤
  │                                   │                            │
  │                                   ├─ 13. Send to Audio2Face──►│
  │                                   │  (Blendshape generation)   │ NVIDIA
  │                                   │                            │ A2F
  │                                   │◄─ 14. Get blendshapes ────┤
  │                                   │  animation_id, values      │
  │                                   │                            │
  │                                   ├─ 15. Apply blendshape cfg │
  │                                   │  (smoothing, normalization)│
  │                                   │                            │
  │                                   ├─ 16. Prepare response     │
  │                                   │  JSON with audio + metadata│
  │◄──────────────────────────────────┤                            │
  │  17. Receive response              │                            │
  │  { userMessage, assistantMessage,  │                            │
  │    audio, tokens, duration }       │                            │
  │                                   │                            │
  ├─ 18. Decode MP3 audio             │                            │
  │                                   │                            │
  ├─ 19. Play audio via Web Audio API │                            │
  │                                   │                            │
  ├─ 20. Update blendshapes frame    │                            │
  │  by frame as audio plays          │                            │
  │                                   │                            │
  ├─ 21. Three.js renders avatar     │                            │
  │  with animated mouth sync         │                            │
  │                                   │                            │
  ├─ 22. Display response text        │                            │
  │  "I don't have real-time..."      │                            │
  │                                   │                            │
  └─ Ready for next input             │                            │
```

## 🔄 Conversation Pipeline (Sequential Calls)

```typescript
async function conversationPipeline(
  audioBase64: string,
  systemPrompt: string,
  emotion?: string
): Promise<ConversationResult> {
  // 1. STT: Audio → Text
  const userMessage = await transcribeAudio(audioBase64);

  // 2. Chat: User Text → AI Response
  const assistantMessage = await generateChatResponse(
    userMessage,
    systemPrompt,
    emotion
  );

  // 3. TTS: Response Text → Audio (MP3)
  const audioBuffer = await generateSpeech(assistantMessage);
  const audioBase64 = bufferToBase64(audioBuffer);

  // 4. A2F: Audio → Blendshape Animation Data
  const blendshapes = await processAudioWithA2F(audioBase64);

  // 5. Return combined result
  return {
    userMessage,
    assistantMessage,
    audio: audioBase64,
    blendshapes,
    tokens: { prompt, completion, total },
    audioStats: { duration, sampleCount, byteSize }
  };
}
```

## 🎬 3D Avatar Rendering

### FBX Model Loading
```typescript
// Browser-side (Three.js)
const fbxLoader = new FBXLoader();
fbxLoader.load('/characters/lynq/lynx_bobcat_01.fbx', (fbx) => {
  // fbx = THREE.Group with:
  //  ├─ mesh (geometry + materials)
  //  ├─ skeleton (bone structure)
  //  ├─ animations (idle, etc)
  //  └─ blendshapes (100+ facial shapes)
  
  scene.add(fbx);
});
```

### Blendshape Application
```typescript
// Update blendshape weights per frame
function updateBlendshapes(blendshapeData) {
  for (const [shapeName, value] of Object.entries(blendshapeData)) {
    mesh.morphTargetInfluences[shapeIndex] = value; // 0-1
  }
}

// Sync with audio playback
audioElement.addEventListener('timeupdate', () => {
  const frameIndex = Math.floor(currentTime / frameDelta);
  updateBlendshapes(blendshapes[frameIndex]);
});
```

## 🔊 Audio Processing Pipeline

### Input: WebAudio API Microphone
```
Raw Microphone Input (AudioBuffer)
  ↓ (Sample rate may vary: 44.1kHz, 48kHz, 96kHz)
Convert to 16-bit PCM @ 16kHz
  ↓ (Whisper requirement)
Base64 encode as WAV
  ↓
Send to server
```

### Processing: Audio Normalization
```typescript
function normalizeAudio(audioBuffer: AudioBuffer): Float32Array {
  // 1. Get single channel (mono)
  const rawData = audioBuffer.getChannelData(0);
  
  // 2. Find max amplitude
  const max = Math.max(...Array.from(rawData));
  
  // 3. Normalize to -1.0 to 1.0 range
  const normalized = rawData.map(sample => sample / max);
  
  // 4. Convert to Int16 for PCM16
  const int16 = new Int16Array(normalized.length);
  for (let i = 0; i < normalized.length; i++) {
    int16[i] = normalized[i] * 32767; // Max 16-bit signed
  }
  
  return int16;
}
```

### Output: TTS MP3 to Blendshape Timeline

```
OpenAI TTS Output (MP3)
  ↓ (Encoded audio, duration ~2-5 seconds)
Decode MP3 in browser
  ↓ (AudioBuffer or typed array)
Resample to 16kHz if needed
  ↓
Send to Audio2Face (NVIDIA gRPC)
  ↓
Receives blendshape keyframes:
  {
    animation_id: "...",
    blendshapes: [
      { frame: 0, values: [0.1, 0.2, 0.3, ...] },
      { frame: 1, values: [0.12, 0.22, 0.35, ...] },
      ...
    ]
  }
  ↓
Apply to avatar blendshape targets
  ↓
Sync playback with audio timeline
```

## 📁 Module Organization

### `src/openai.ts` - AI Provider Abstraction
```
OpenAIConfig interface
  ├─ apiKey: string
  ├─ model: string
  ├─ voice: string
  ├─ provider: "openai" | "mammouth"
  ├─ baseUrl: string (optional)
  └─ maxTokens: number

Functions:
  ├─ getApiBaseUrl() → Dynamic endpoint
  ├─ transcribeAudio() → STT (Whisper only)
  ├─ generateChatResponse() → Chat (OpenAI or Mammouth)
  ├─ generateSpeech() → TTS (OpenAI only)
  └─ conversationPipeline() → Full flow (STT→Chat→TTS→A2F)
```

### `src/nvidia/` - Audio2Face Module
```
├─ index.ts (Public exports)
├─ constants.ts (PCM16_SAMPLE_RATE, CHUNK_DURATION)
├─ models.ts (Mark v2.3, Claire v2.3, James v2.3)
├─ audio-processor.ts (Normalize, resample, encode)
├─ config-loader.ts (Load YAML, parse emotions)
└─ service.ts (Main processAudioWithA2F() function)

Types:
  ├─ AudioStats { duration, sampleCount, byteSize }
  ├─ BlendshapeFrame { frame, values }
  ├─ A2FResponse { animation_id, blendshapes }
  └─ ModelConfig { blendshapes, emotions }
```

### `public/emotion-detector.js` - Webcam ML
```
EmotionDetector class
  ├─ initialize() → Request camera + load models
  ├─ startDetection() → Continuous inference
  ├─ detectEmotion() → Single frame analysis
  ├─ getEmotion() → Current emotion
  ├─ getAverageEmotion() → Smoothed emotion
  ├─ getPersonalizedGreeting() → Response text
  └─ onEmotionUpdate(callback) → Real-time updates

Models:
  ├─ TinyFaceDetector (face detection box)
  └─ FaceExpressionNet (7 emotions)
```

### `public/voice-conversation.js` - Microphone & API
```
VoiceConversation class
  ├─ initialize() → Request microphone
  ├─ startRecording() / stopRecording()
  ├─ sendConversation() → POST /api/conversation
  ├─ playResponse() → Web Audio API playback
  ├─ conversationLoop() → Full cycle
  ├─ setEmotionDetector() → Attach ML model
  └─ dispose() → Cleanup

Data:
  ├─ mediaRecorder (Audio capture)
  ├─ audioChunks (WAV data)
  └─ audioContext (Web Audio API)
```

## 🔐 Environment Configuration

### .env Resolution Order
```
1. Check .env file in project root
2. Parse with loadEnv() from src/config.ts
3. Merge into Deno.env
4. Fall back to process.env if not in Deno.env
5. Use defaults if all missing
```

### Configuration Flow
```
.env file
  ↓
loadEnv() parser
  ↓
Deno.env.set()
  ↓
OpenAI module checks:
  getRequiredConfig("OPENAI_API_KEY")
  getConfig("MAMMOUTH_API_KEY", "")
  getConfig("OPENAI_MODEL", "gpt-4o-mini")
  ↓
Used in API calls
```

## 🎯 Performance Considerations

### Latency Breakdown (Typical)
```
User speaks          → Audio capture:        1-5 seconds
Stop → Send          → Network:              0.1-0.5 seconds
Network → Server     → Processing:           0.1 seconds
Whisper (STT)        → Server:               1-3 seconds
ChatGPT (Chat)       → Server:               1-3 seconds
TTS (Speech)         → Server:               0.5-1 seconds
Audio2Face (A2F)     → Server:               1-2 seconds
Network → Browser    → Network:              0.1-0.5 seconds
Playback start       → Browser:              0.1 seconds
─────────────────────────────────────────────────────
Total                                        ~5-15 seconds
```

### Memory Usage
```
Browser (Client-side):
  ├─ Three.js scene:         ~30-50 MB (FBX + textures)
  ├─ face-api.js models:     ~100 KB (cached)
  ├─ Audio buffers:          ~5-10 MB (recording)
  └─ Canvas + rendering:     ~10-20 MB
  Total:                      ~50-80 MB

Server (Deno runtime):
  ├─ Oak framework:           ~20 MB
  ├─ OpenAI SDK:              ~10 MB
  ├─ gRPC connections:        ~5 MB
  └─ Module cache:            ~10 MB
  Total:                       ~50-100 MB
```

### Network Bandwidth
```
Per conversation:
  ├─ Upload (WAV audio):      ~200-500 KB
  ├─ Download (MP3 audio):    ~50-200 KB
  ├─ JSON metadata:           ~5-10 KB
  └─ Blendshape data:         ~20-50 KB
  Total:                       ~300-800 KB
```

## 🔌 API Contract

### POST `/api/conversation`

**Request Schema:**
```typescript
interface ConversationRequest {
  audio: string;              // base64 encoded WAV
  systemPrompt?: string;      // Character personality prompt
  character?: string;         // Avatar model (mark_v2_3, etc)
  emotion?: string;           // Detected emotion context
}
```

**Response Schema:**
```typescript
interface ConversationResponse {
  userMessage: string;        // Transcribed user input
  assistantMessage: string;   // AI generated response
  audio: string;              // base64 encoded MP3
  audioStats: {
    duration: number;         // seconds
    sampleCount: number;      // PCM samples
    byteSize: number;         // bytes
  };
  tokens: {
    prompt: number;           // Input tokens
    completion: number;       // Output tokens
    total: number;            // Sum
  };
}
```

## 🧪 Testing Strategy

### Unit Tests
```typescript
// Test audio normalization
const input = new Float32Array([0.5, 1.0, 0.8]);
const output = normalizeAudio(input);
assert(output[0] >= -1.0 && output[0] <= 1.0);

// Test emotion detection
const emotions = await detectEmotion(faceData);
assert(emotions.happy + emotions.sad + ... === 1.0);
```

### Integration Tests
```typescript
// Test full conversation
const response = await conversationPipeline(
  audioBase64,
  "Be helpful",
  "happy"
);
assert(response.userMessage.length > 0);
assert(response.assistantMessage.length > 0);
assert(response.audio.length > 0);
```

### Performance Tests
```typescript
// Benchmark API call times
const start = performance.now();
const result = await generateChatResponse("Hello");
const duration = performance.now() - start;
console.log(`Chat response: ${duration}ms`);
// Target: < 3 seconds for gpt-4o-mini
```

## 📚 References

- **Deno**: https://deno.com
- **Oak**: https://oak.deno.dev
- **Three.js**: https://threejs.org
- **face-api.js**: https://github.com/justadudewhohacks/face-api.js
- **NVIDIA Audio2Face**: https://developer.nvidia.com/ace
- **OpenAI API**: https://platform.openai.com/docs
