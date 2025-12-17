class AssistantCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = Array.isArray(inputs) ? inputs[0] : null;
    if (!input || input.length === 0) {
      return true;
    }
    const channelData = input[0];
    if (!channelData || channelData.length === 0) {
      return true;
    }
    const copy = channelData.slice();
    this.port.postMessage({
      type: 'chunk',
      audio: copy,
      sampleRate
    }, [copy.buffer]);
    return true;
  }
}

registerProcessor('assistant-capture-processor', AssistantCaptureProcessor);
