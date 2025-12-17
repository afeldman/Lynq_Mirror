# Magic Mirror - Deno/TypeScript Edition

Modern avatar animation with NVIDIA Audio2Face and Three.js WebGL.

## 🚀 Features

- **Audio2Face Integration**: Real-time avatar animation based on audio input
- **Blendshape Visualization**: Interactive 3D display of FBX models
- **Multi-Model Support**: Mark, Claire, James with predefined configurations
- **YAML Configuration**: Blendshape and emotion parameters
- **REST API**: HTTP endpoints for audio processing and model management

## 🛠️ Getting Started

```bash
# Start the server
deno task dev

# Or run directly
deno run --allow-net --allow-read --allow-env src/server.ts
```

Server runs at [http://localhost:1234](http://localhost:1234) (or your custom PORT)

## 📁 Project Structure

```
src/
  server.ts                    # Oak HTTP Server
  blendshape-utils.ts         # Blendshape utilities
  nvidia/
    index.ts                  # Main API exports
    constants.ts              # Audio/timing constants
    models.ts                 # Model configurations
    audio-processor.ts        # Audio normalization
    config-loader.ts          # YAML config loading
    service.ts                # Audio2Face service

public/                       # Frontend (HTML/CSS/JS)
  index.html, face.html, etc.

characters/                   # FBX Models (auto-served)
  frank/, mirror/

nvidia/
  configs/                    # YAML configs (mark, claire, james)
  protos/                     # gRPC Proto definitions

deno.json                     # Deno configuration
```

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
