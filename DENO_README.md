# Magic Mirror - Deno/TypeScript Edition

Moderne Avatar-Animation mit NVIDIA Audio2Face und Three.js WebGL.

## 🚀 Features

- **Audio2Face Integration**: Echtzeitanimation von Avataren basierend auf Audio-Input
- **Blendshape-Visualisierung**: Interaktive 3D-Darstellung von FBX-Modellen
- **Unterstützung mehrerer Modelle**: Mark, Claire, James mit vordefinierten Konfigurationen
- **Konfigurierbare Parameter**: YAML-basierte Einstellungen für Blendshapes und Emotionen
- **REST API**: HTTP-Endpoints für Audio-Verarbeitung und Modell-Management

## 📋 Voraussetzungen

- **Deno** >= 1.40.0
- **Node.js** (optional, für gRPC-Unterstützung)
- **NVIDIA Audio2Face** Zugang (gRPC Service)

## 🛠️ Installation & Start

```bash
# Project clone
cd Magic_Mirror

# Abhängigkeiten herunterladen (Deno macht das automatisch)
deno run --allow-net --allow-read --allow-env src/server.ts

# Oder mit dev task:
deno task dev
```

Server läuft unter `http://localhost:1234`

## 📁 Projektstruktur

```
├── src/
│   ├── server.ts                 # Main HTTP Server (Oak)
│   └── nvidia/
│       └── audio2face.ts         # Audio2Face Integration
├── public/                       # Frontend (HTML/CSS/JS)
│   ├── index.html
│   ├── face.html
│   ├── face.js
│   └── ...
├── characters/                   # FBX Models
│   ├── frank/
│   ├── mirror/
│   └── ...
├── nvidia/
│   ├── configs/                  # YAML Konfigurationen
│   │   ├── claire_v2.3.yml
│   │   ├── james_v2.3.yml
│   │   └── mark_v2.3.yml
│   └── protos/                   # gRPC Proto Definitionen
├── deno.json                     # Deno Konfiguration
└── README.md
```

## 🌐 API Endpoints

### GET `/api/characters`

Liste verfügbarer Characters

```json
[
  {
    "name": "frank / character.fbx",
    "url": "/characters/frank/character.fbx"
  }
]
```

### GET `/api/models`

Liste unterstützter Audio2Face Modelle

```json
["mark_v2_3", "claire_v2_3", "james_v2_3"]
```

### POST `/api/process-audio`

Verarbeitet Audio mit Audio2Face

```json
{
  "audio": "base64_encoded_pcm16_audio",
  "model": "mark_v2_3",
  "functionId": "optional_custom_function_id"
}
```

## 🔧 Konfiguration

### Modelle anpassen

Bearbeite die YAML-Dateien in `nvidia/configs/`:

- Blendshape-Parameter (Multipliers/Offsets)
- Emotionen und deren Gewichtungen
- Face/Lip-Opening-Werte

Beispiel:

```yaml
blendshape_parameters:
  multipliers:
    JawOpen: 1.0
    MouthSmileLeft: 0.8
  offsets:
    EyeBlinkLeft: 0.0
```

## 🎨 Frontend

Das Frontend bleibt TypeScript/JavaScript und lädt Three.js:

- `public/face.html` - Haupt-Avatar-Viewer
- `public/debug.html` - Debug-Interface
- `public/settings.html` - Konfiguration

## 🔐 Permissions

Deno benötigt folgende Permissions:

```bash
--allow-net     # HTTP Server & gRPC
--allow-read    # Dateien lesen
--allow-env     # Umgebungsvariablen
```

## 📝 Umgebungsvariablen

```bash
PORT=1234              # Server Port (default: 1234)
A2F_SERVICE_URL=...    # Audio2Face Service Endpoint
A2F_FUNCTION_ID=...    # Default Function ID
```

## 🧪 Entwicklung

```bash
# Type checking
deno check src/server.ts

# Formatting
deno fmt src/

# Linting
deno lint src/
```

## 📦 Abhängigkeiten

- **oak** - HTTP Server Framework
- **yaml** - YAML Parser
- **@grpc/grpc-js** - gRPC Client
- **protobufjs** - Protocol Buffers

Alle Imports sind in `deno.json` definiert.

## 🤝 Lizenz

SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES.
SPDX-License-Identifier: Apache-2.0
