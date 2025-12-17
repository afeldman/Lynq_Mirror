const MS_PER_SEC = 1000;
const REPORT_INTERVAL_SEC = 0.1;
const DEFAULT_TARGET_MS = 250;
const DEFAULT_MAX_MS = 700;
const DEFAULT_MIN_MS = 120;
const MAX_ALLOWED_MS = 2000;

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return Number.isFinite(min) ? min : 0;
  }
  if (Number.isFinite(min) && numeric < min) {
    return min;
  }
  if (Number.isFinite(max) && numeric > max) {
    return max;
  }
  return numeric;
}

class PlayoutBufferProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options?.processorOptions || {};
    this.sampleRate = sampleRate;
    this.targetMs = clampNumber(processorOptions.targetMs, 0, MAX_ALLOWED_MS) || DEFAULT_TARGET_MS;
    this.maxMs = clampNumber(processorOptions.maxMs, this.targetMs, MAX_ALLOWED_MS) || DEFAULT_MAX_MS;
    this.minMs = clampNumber(processorOptions.minMs, 0, this.targetMs) || DEFAULT_MIN_MS;
    this.holdSilence = Boolean(processorOptions.holdSilence);
    this.startedAt = null;
    this.targetFrames = this.msToFrames(this.targetMs);
    this.maxFrames = this.msToFrames(this.maxMs);
    this.minFrames = this.msToFrames(this.minMs);
    const capacityFrames = Math.max(this.maxFrames + 2048, this.msToFrames(MAX_ALLOWED_MS));
    this.buffer = new Float32Array(capacityFrames);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.size = 0;
    this.lastSample = 0;
    this.lastReportTime = typeof currentTime === 'number' ? currentTime : 0;
    this.fallbackTime = 0;

    this.port.onmessage = (event) => {
      const msg = event?.data || {};
      if (msg.type === 'config') {
        this.applyConfig(msg);
      } else if (msg.type === 'setTargetMs') {
        this.applyConfig({ targetBufferMs: msg.ms });
      } else if (msg.type === 'startAt') {
        if (Number.isFinite(msg.time)) {
          this.startedAt = msg.time;
          this.holdSilence = false;
        } else {
          this.startedAt = null;
          this.holdSilence = true;
        }
      }
    };
  }

  msToFrames(ms) {
    return Math.max(0, Math.round((Number(ms) || 0) / MS_PER_SEC * this.sampleRate));
  }

  applyConfig(config = {}) {
    const nextTarget = config.targetBufferMs ?? config.targetMs;
    const nextMax = config.maxBufferMs ?? config.maxMs;
    const nextMin = config.minBufferMs ?? config.minMs;
    if (nextMax !== undefined) {
      const clampedMax = clampNumber(nextMax, 0, MAX_ALLOWED_MS);
      if (clampedMax > 0) {
        this.maxMs = clampedMax;
        this.maxFrames = this.msToFrames(this.maxMs);
      }
    }
    if (nextTarget !== undefined) {
      const clampedTarget = clampNumber(nextTarget, 0, this.maxMs);
      this.targetMs = clampedTarget;
      this.targetFrames = this.msToFrames(this.targetMs);
    }
    if (nextMin !== undefined) {
      const clampedMin = clampNumber(nextMin, 0, this.targetMs);
      this.minMs = clampedMin;
      this.minFrames = this.msToFrames(this.minMs);
    }
    if (config.holdSilence !== undefined) {
      this.holdSilence = Boolean(config.holdSilence);
    }
  }

  writeSamples(channelData) {
    if (!channelData) {
      return;
    }
    for (let i = 0; i < channelData.length; i += 1) {
      const sample = channelData[i] || 0;
      this.buffer[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
      if (this.size < this.buffer.length) {
        this.size += 1;
      } else {
        this.readIndex = (this.readIndex + 1) % this.buffer.length;
      }
    }
  }

  outputSilence(outputChannels) {
    for (let channel = 0; channel < outputChannels.length; channel += 1) {
      outputChannels[channel].fill(0);
    }
  }

  maybeReport(now) {
    if (!Number.isFinite(now)) {
      return;
    }
    if (!Number.isFinite(this.lastReportTime) || now - this.lastReportTime >= REPORT_INTERVAL_SEC) {
      this.lastReportTime = now;
      const bufferedMs = (this.size / this.sampleRate) * MS_PER_SEC;
      this.port.postMessage({
        type: 'buffer',
        bufferMs: bufferedMs,
        targetMs: this.targetMs,
        maxMs: this.maxMs
      });
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const primaryOut = output[0];
    if (!primaryOut) {
      return true;
    }

    const inputChannel = input[0] || null;
    this.writeSamples(inputChannel);

    const now = typeof currentTime === 'number' ? currentTime : this.fallbackTime;
    const blockDuration = primaryOut.length / this.sampleRate;
    if (typeof currentTime !== 'number') {
      this.fallbackTime += blockDuration;
    }

    const framesUntilStart = Number.isFinite(this.startedAt) && !this.holdSilence
      ? Math.max(0, Math.round((this.startedAt - now) * this.sampleRate))
      : 0;
    const needHold = this.holdSilence || (framesUntilStart >= primaryOut.length);
    if (needHold || this.size < this.minFrames) {
      this.outputSilence(output);
      this.maybeReport(now);
      return true;
    }

    const duplicateIndex = this.size < this.targetFrames ? Math.floor(primaryOut.length / 2) : -1;
    let framesToDrop = 0;
    if (this.size > this.maxFrames) {
      framesToDrop = Math.min(this.size - this.maxFrames, primaryOut.length);
    } else if (this.size > this.targetFrames + 1) {
      framesToDrop = 1;
    }

    for (let i = 0; i < primaryOut.length; i += 1) {
      if (framesUntilStart > 0 && i < framesUntilStart) {
        for (let channel = 0; channel < output.length; channel += 1) {
          output[channel][i] = 0;
        }
        continue;
      }
      let sample = 0;
      if (this.size > 0) {
        sample = this.buffer[this.readIndex];
        if (duplicateIndex >= 0 && i === duplicateIndex) {
          // repeat this sample once by not advancing the read index
        } else {
          this.readIndex = (this.readIndex + 1) % this.buffer.length;
          this.size -= 1;
        }
        this.lastSample = sample;
      } else {
        sample = this.lastSample;
      }
      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel][i] = sample;
      }
    }

    if (framesToDrop > 0) {
      const dropCount = Math.min(framesToDrop, this.size);
      if (dropCount > 0) {
        this.readIndex = (this.readIndex + dropCount) % this.buffer.length;
        this.size -= dropCount;
      }
    }

    this.maybeReport(now + blockDuration);
    return true;
  }
}

registerProcessor('plbuffer', PlayoutBufferProcessor);
