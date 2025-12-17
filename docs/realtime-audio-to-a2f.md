# Wiring OpenAI Realtime Audio to NVIDIA Audio2Face

This guide turns the high-level debug notes into an actionable task list for integrating live audio from the OpenAI Realtime API with NVIDIA Audio2Face (A2F). Follow the sections in order and tick off each checklist as you go.

## 1. Decide how you ingest the assistant audio

Pick one path first, make it reliable, then optionally add the other.

### Option A – Data channel audio deltas (preferred)
- Configure the session to stream PCM16 audio over the data channel as soon as the WebRTC peer connection is established.
- Request audio output whenever you create a response.
- Consume only `response.output_audio.delta` (or `*.audio.delta`) messages; ignore every `response.audio_transcript.*` event when feeding A2F.

### Option B – Remote audio track tap
- Use the `pc.ontrack` callback to attach the remote **assistant** audio stream to an `<audio>` element and an `AudioWorklet`.
- Ensure autoplay is unlocked with a user gesture (`audioEl.play()` and `audioCtx.resume()`). A muted or paused audio element produces silent buffers.
- Feed the `MediaStreamAudioSourceNode` created from the remote track into your worklet and pull PCM frames from there (not from the microphone stream).

## 2. Enable audio output from the OpenAI session

Send a `session.update` control message once the data channel is open:

```js
pc.dc.send(JSON.stringify({
  type: "session.update",
  session: {
    voice: "alloy",               // any voice supported by your model
    response: {
      modalities: ["audio"],
      audio_format: "pcm16"
    },
    input_audio_format: "pcm16"    // if you are also streaming mic input
  }
}));
```

When you need a reply, request audio explicitly:

```js
pc.dc.send(JSON.stringify({
  type: "response.create",
  response: {
    instructions: "Speak out loud your reply.",
    modalities: ["audio"],
    audio_format: "pcm16"
  }
}));
```

## 3. Gate and buffer assistant events correctly

```js
function isAudioDelta(evt) {
  return evt?.type === "response.output_audio.delta" || evt?.type?.endsWith("audio.delta");
}

function handleRealtimeEvent(evt) {
  if (evt.type?.startsWith("response.audio_transcript")) {
    return; // never forward transcripts to A2F
  }

  if (evt.type === "output_audio_buffer.started" || evt.type === "response.output_audio.started") {
    beginRealtimeCapture(evt.response_id);
    return;
  }

  if (evt.type === "output_audio_buffer.stopped") {
    finalizeRealtimeCapture(evt.response_id);
    return;
  }

  if (isAudioDelta(evt)) {
    const base64 = evt.delta || evt.audio || evt.chunk;
    const pcmBytes = base64ToUint8Array(base64); // PCM16LE at evt.sample_rate
    queueRealtimeChunk(evt.response_id, pcmBytes, evt.sample_rate || 24000);
  }

  if (evt.type === "response.output_audio.done") {
    scheduleFallbackFinalize(evt.response_id); // only clears after >500 ms of silence
  }
}
```

Assign `activeResponseId` as soon as you see `output_audio_buffer.started`, `response.output_audio.started`, or the first audio delta so queued chunks are flushed to the correct session.

## 4. Resample and format audio for A2F

A2F expects mono PCM16 at 16,000 Hz, chunked into 20 ms packets (640 bytes each).

1. Convert PCM16LE from OpenAI into Float32 samples.
2. Downmix to mono if needed.
3. Resample to 16 kHz (use an `OfflineAudioContext` in the browser or a DSP routine in Node).
4. Convert the Float32 samples back to PCM16LE.

```js
async function resamplePcm16(pcmBytes, srcHz, dstHz = 16000) {
  if (srcHz === dstHz) return pcmBytes;

  const int16 = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = Math.max(-1, Math.min(1, int16[i] / 32768));
  }

  const duration = float32.length / srcHz;
  const oac = new OfflineAudioContext(1, Math.round(duration * dstHz), dstHz);
  const buffer = oac.createBuffer(1, float32.length, srcHz);
  buffer.copyToChannel(float32, 0);

  const source = oac.createBufferSource();
  source.buffer = buffer;
  source.connect(oac.destination);
  source.start(0);

  const rendered = await oac.startRendering();
  const mono = rendered.getChannelData(0);
  const out = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    const clamped = Math.max(-1, Math.min(1, mono[i]));
    out[i] = (clamped < 0 ? clamped * 32768 : clamped * 32767) | 0;
  }

  return new Uint8Array(out.buffer);
}
```

After resampling, split the bytes into 640-byte blocks and queue them for A2F:

```js
function chunkForA2F(pcm16k) {
  const CHUNK = 640; // 20 ms @ 16 kHz mono PCM16
  const chunks = [];
  for (let offset = 0; offset < pcm16k.length; offset += CHUNK) {
    chunks.push(pcm16k.subarray(offset, Math.min(offset + CHUNK, pcm16k.length)));
  }
  return chunks;
}
```

## 5. Stream audio to A2F

For every `response_id`:

1. Call your A2F gRPC `StreamAudio` (or equivalent) endpoint once per response to send the header.
2. Write each 640-byte chunk.
3. End the stream after the last chunk.
4. Only finalize after you receive `response.output_audio.done` **and** you have flushed the buffered audio chunks.

```js
async function queueRealtimeChunk(responseId, pcmBytes, srcHz) {
  const session = ensureA2FSession(responseId);
  const pcm16k = await resamplePcm16(pcmBytes, srcHz);
  meterChunk(pcm16k, session.telemetry); // log RMS / peak for debugging
  session.buffers.push(pcm16k);
}

function finalizeRealtimeCapture(responseId) {
  const session = sessions.get(responseId);
  if (!session) return;
  const merged = concatBuffers(session.buffers);
  const chunks = chunkForA2F(merged);
  startA2FStreamIfNeeded(session);
  for (const chunk of chunks) {
    session.stream.write({ audioChunk: { data: chunk } });
  }
  session.stream.end();
  sessions.delete(responseId);
}
```

## 6. Instrumentation (make silence obvious)

Add lightweight metrics so debugging is easy:

- **Realtime ingest** – track `audioBytesIn`, `rms`, and `peak`. Flag chunks where both `rms < 1e-5` and `peak < 1e-4` as silence.
- **A2F upload** – track total bytes sent; expect ~640 bytes per 20 ms of speech. If the counter stays at zero, nothing reached A2F.
- **A2F response** – log frame count and total timeline duration. For example, 3 seconds of speech should return ~90 frames at 30 fps.

```js
function meterChunk(pcm16, telemetry) {
  const samples = new Int16Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength / 2);
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] / 32768;
    sumSq += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rms = Math.sqrt(sumSq / samples.length);
  telemetry.push({ rms, peak });
  if (peak < 1e-4 && rms < 1e-5) {
    console.warn("A2F: silence chunk detected");
  }
}
```

## 7. Verification checklist

- [ ] `response.output_audio.delta` events arrive for each response.
- [ ] Audio buffers show non-zero RMS/peak while the assistant is speaking.
- [ ] Resampled PCM is 16 kHz mono and chunked to 640 bytes.
- [ ] Total bytes sent to A2F grow during playback.
- [ ] A2F returns blendshape frames with timelines matching speech duration.

When all boxes are ticked, the avatar should animate in sync with the assistant’s speech.
