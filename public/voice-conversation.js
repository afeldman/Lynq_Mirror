/**
 * Voice Input and Conversation Interface
 * Handles microphone capture and conversation with AI character
 */

export class VoiceConversation {
  private mediaRecorder;
  private audioContext;
  private stream;
  private audioChunks = [];
  private isRecording = false;

  /**
   * Initialize microphone access
   */
  async initialize() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.mediaRecorder = new MediaRecorder(this.stream);

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      console.log("[VoiceConversation] Microphone initialized");
      return true;
    } catch (err) {
      console.error("[VoiceConversation] Failed to initialize microphone:", err);
      throw err;
    }
  }

  /**
   * Start recording audio
   */
  startRecording() {
    if (this.isRecording) return;

    this.audioChunks = [];
    this.mediaRecorder.start();
    this.isRecording = true;
    console.log("[VoiceConversation] Recording started");
  }

  /**
   * Stop recording and get audio data
   */
  async stopRecording(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isRecording) {
        reject(new Error("Not recording"));
        return;
      }

      this.mediaRecorder.onstop = async () => {
        this.isRecording = false;
        const audioBlob = new Blob(this.audioChunks, { type: "audio/webm" });

        // Convert blob to base64
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          console.log(
            `[VoiceConversation] Recording stopped (${(audioBlob.size / 1024).toFixed(1)} KB)`
          );
          resolve(base64);
        };
        reader.onerror = () => {
          reject(reader.error);
        };
        reader.readAsDataURL(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Send audio to server for conversation
   */
  async sendConversation(
    audioBase64: string,
    options?: {
      systemPrompt?: string;
      character?: string;
      onStatusChange?: (status: string) => void;
    }
  ) {
    const onStatus = options?.onStatusChange || console.log;

    try {
      onStatus("🎤 Sending audio to server...");

      const response = await fetch("/api/conversation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audio: audioBase64,
          systemPrompt: options?.systemPrompt,
          character: options?.character || "mark_v2_3",
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Server error");
      }

      const result = await response.json();

      onStatus("🎉 Response received from AI");
      console.log("[VoiceConversation] Conversation result:", result);

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      onStatus(`❌ Error: ${message}`);
      throw err;
    }
  }

  /**
   * Play audio response with animation
   */
  async playResponse(audioBase64: string, onPlaybackStart?: () => void) {
    try {
      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const audioBlob = new Blob([bytes], { type: "audio/mpeg" });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      onPlaybackStart?.();

      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = reject;
        audio.play().catch(reject);
      });

      URL.revokeObjectURL(audioUrl);
      console.log("[VoiceConversation] Audio playback completed");
    } catch (err) {
      console.error("[VoiceConversation] Failed to play audio:", err);
      throw err;
    }
  }

  /**
   * Full conversation loop: record → send → play
   */
  async conversationLoop(options?: {
    systemPrompt?: string;
    character?: string;
    onStatusChange?: (status: string) => void;
    onResponseText?: (text: string) => void;
  }) {
    try {
      const onStatus = options?.onStatusChange || console.log;

      onStatus("🎙️ Recording...");
      this.startRecording();

      // Wait for user to speak (30 seconds max)
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Auto-stop after 5s demo

      const audioBase64 = await this.stopRecording();

      const result = await this.sendConversation(audioBase64, options);

      if (options?.onResponseText) {
        options.onResponseText(result.assistantMessage);
      }

      onStatus("🔊 Playing response...");
      await this.playResponse(result.audio, () => {
        onStatus("🎬 Avatar speaking...");
      });

      return result;
    } catch (err) {
      console.error("[VoiceConversation] Conversation loop error:", err);
      throw err;
    }
  }

  /**
   * Cleanup
   */
  dispose() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    console.log("[VoiceConversation] Disposed");
  }
}

// Example usage for HTML integration
export async function initializeVoiceUI(containerId: string) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const conversation = new VoiceConversation();

  const startBtn = document.createElement("button");
  startBtn.textContent = "🎤 Start Conversation";
  startBtn.className = "voice-btn";

  const statusDiv = document.createElement("div");
  statusDiv.className = "voice-status";
  statusDiv.textContent = "Ready";

  const responseDiv = document.createElement("div");
  responseDiv.className = "voice-response";
  responseDiv.style.marginTop = "1rem";

  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    try {
      await conversation.initialize();
      await conversation.conversationLoop({
        onStatusChange: (status) => {
          statusDiv.textContent = status;
        },
        onResponseText: (text) => {
          responseDiv.textContent = `AI: ${text}`;
        },
      });
    } catch (err) {
      statusDiv.textContent = `Error: ${err instanceof Error ? err.message : "Unknown"}`;
    } finally {
      startBtn.disabled = false;
      conversation.dispose();
    }
  });

  container.appendChild(startBtn);
  container.appendChild(statusDiv);
  container.appendChild(responseDiv);
}
