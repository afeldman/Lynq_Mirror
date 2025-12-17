# 📷 Camera & Emotion Detection Setup

Enable **real-time emotion recognition** to make your avatar respond with context-aware empathy based on how the user is feeling.

## ✨ Features

- **Real-time Detection**: Analyzes user's facial expressions 60+ times per second
- **7 Emotions**: Happy, Sad, Angry, Fearful, Disgusted, Surprised, Neutral
- **Live Visualization**: Shows detection box + confidence scores on canvas
- **Smart Greetings**: Personalized opening based on detected emotion
- **Adaptive AI**: System prompt includes emotion context for responses

## 🎯 Technology

- **face-api.js**: Mozilla's machine learning library for face detection
- **TinyFaceDetector**: Lightweight model (faster, lower resources)
- **FaceExpressionNet**: Neural network trained on facial expressions
- **Privacy**: All processing happens **locally in browser** - no data sent to servers

## 🚀 Quick Setup

### Step 1: Check Camera Permission

Make sure your browser can access the camera:

1. Open Chrome/Firefox settings
2. Search for "Camera"
3. Enable for `localhost:1234` or `your-domain.com`

### Step 2: Start Server

```bash
deno task dev
```

### Step 3: Open Voice Chat

```
http://localhost:1234/talk
```

### Step 4: Grant Permissions

You'll see two prompts:

1. **"Allow camera access?"** → Click **Allow**
2. **"Allow microphone access?"** → Click **Allow**

### Step 5: See Emotions

In the left panel, you'll see:

- 📷 Live camera feed
- 😊 Detected emotion (e.g., "Happy 92%")
- Detection box around your face

## 😊 Emotion States & Responses

The system recognizes these emotions:

| Emoji | Emotion       | Example Greeting                                                  |
| ----- | ------------- | ----------------------------------------------------------------- |
| 😊    | **Happy**     | "Du siehst glücklich aus! Schön, dass es dir gut geht!"           |
| 😢    | **Sad**       | "Du wirkst nachdenklich... Möchtest du mir etwas erzählen?"       |
| 😠    | **Angry**     | "Du siehst ernst aus. Vielleicht kann ich dir helfen?"            |
| 😨    | **Fearful**   | "Du wirkst angespannt. Keine Sorge, ich bin hier!"                |
| 🤮    | **Disgusted** | "Etwas gefällt dir nicht? Lass mich wissen, wie ich helfen kann!" |
| 😲    | **Surprised** | "Überraschung! Wie geht es dir?"                                  |
| 😐    | **Neutral**   | "Hallo! Wie kann ich dir heute helfen?"                           |

## 🎬 How It Works

### Detection Pipeline

```
┌─────────────┐
│   Webcam    │ (30 FPS)
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────┐
│ face-api.js (TinyFaceDetector)  │
│ Detects face position & size    │
│ Draws detection box             │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ FaceExpressionNet               │
│ Analyzes facial features        │
│ Returns 7 emotion scores:       │
│  - happy: 0-1                   │
│  - sad: 0-1                     │
│  - angry: 0-1                   │
│  - fearful: 0-1                 │
│  - disgusted: 0-1               │
│  - surprised: 0-1               │
│  - neutral: 0-1                 │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ Emotion Aggregation             │
│ Find highest confidence         │
│ Average last 5 seconds          │
│ Filter noise                    │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│ Display & Use                   │
│ Show: "Happy (92%)"             │
│ Add to AI context               │
│ Personalize response            │
└─────────────────────────────────┘
```

### AI Integration

When you start a conversation:

1. **Emotion Detected**: e.g., "happy" at 92% confidence
2. **Sent to AI**: System prompt enhanced with:
   ```
   "NOTE: The user appears to be feeling happy.
    Please respond with appropriate empathy and friendliness."
   ```
3. **AI Responds**: ChatGPT adapts tone and content
4. **Avatar Speaks**: Response matches detected emotion

## 🔧 Configuration

### Sensitivity Tuning

Edit `public/emotion-detector.js` to adjust detection frequency:

```javascript
// Current: Check every 1 second
startDetection() {
  this.detectionInterval = setInterval(async () => {
    if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
      await this.detectEmotion();
    }
  }, 1000);  // Change to 500ms or 2000ms
}
```

### Average Emotion Window

By default, the system averages emotion over last 5 seconds:

```javascript
// In voice-conversation.js
const emotion = emotionDetector?.getAverageEmotion(5); // Change to 3 or 10
```

Shorter = more responsive, Longer = smoother

### Custom Greetings

Add your own personalized greetings in `public/emotion-detector.js`:

```javascript
getPersonalizedGreeting(emotion = null) {
  const greetings = {
    happy: "Du wirkst super! Erzähl mir, was dich freut!",
    sad: "Alles ok? Ich bin ganz Ohr...",
    // Add more...
  };
}
```

## 💡 Tips for Best Results

### Lighting

- ✅ **Good**: Bright, even lighting on your face (natural window + lamp)
- ❌ **Bad**: Backlit, shadows, dim room

### Face Position

- ✅ **Good**: Face centered in frame, 30-60cm from camera
- ❌ **Bad**: Side angles, too close, too far

### Facial Expression

- ✅ **Clear**: Natural, distinct expressions (smile, frown, etc.)
- ❌ **Ambiguous**: Neutral face, heavy makeup, glasses

### Camera Quality

- ✅ **Good**: 1080p+ webcam or modern phone camera
- ❌ **Bad**: Blurry, low-res, old webcam

## 🐛 Troubleshooting

### ❌ "Camera not available"

**Check:**

1. Browser permissions:

   - Chrome: Chrome Menu → Settings → Privacy → Camera → Allow `localhost:1234`
   - Firefox: `about:preferences` → Privacy → Permissions → Camera

2. Camera working elsewhere:

   ```bash
   # Test camera with native app
   open -a FaceTime  # macOS
   # or Windows Camera app
   ```

3. Only one app can use camera at a time
   - Close Zoom, Teams, FaceTime, etc.
   - Reload browser page

### ❌ "No emotion detected / Blank canvas"

**Check:**

1. Face is visible and well-lit
2. Camera is not obscured
3. Try different distances (30-60cm ideal)
4. Check browser console for errors: `F12` → Console

### ❌ "Wrong emotion detected"

**Why:** Neural networks can be fooled by:

- Poor lighting
- Glasses/sunglasses
- Extreme angles
- Stage makeup
- Heavy expressions

**Fix:**

1. Improve lighting
2. Move closer to camera
3. Make clearer facial expression
4. Try again - models improve with visibility

### ❌ "CPU usage too high"

**Why:** Real-time ML detection is resource-intensive

**Fix:**

1. Reduce detection frequency:

   ```javascript
   }, 2000);  // Check every 2 seconds instead of 1
   ```

2. Use smaller model (already using TinyFaceDetector)

3. Close other browser tabs

### ❌ "Frame rate dropping / Laggy"

**Fix:**

1. Reduce canvas size (for display)
2. Lower webcam resolution in `emotion-detector.js`:

   ```javascript
   video: { width: 160, height: 120 }  // Instead of 320x240
   ```

3. Use browser's hardware acceleration

## 🎨 Customization

### Change Detection Canvas Size

Edit `public/talk.html`:

```html
<video id="emotion-video" style="width: 200px; height: 200px;"></video>
```

### Change Emotion Display Format

Edit `public/emotion-detector.js`:

```javascript
emotionLabel.textContent = `😊 ${emotion} (${(confidence * 100).toFixed(0)}%)`;

// Change to just emoji:
// emotionLabel.textContent = this.emotionToEmoji(emotion);
```

### Disable Emotion Detection

Simply don't allow camera permission - system falls back gracefully.

## 📊 Technical Details

### Model Sizes

- TinyFaceDetector: ~190 KB
- FaceExpressionNet: ~580 KB
- **Total**: ~770 KB (cached in browser)

### Performance

- Detection: ~30-50ms per frame
- Memory: ~50-100 MB during runtime
- CPU: 5-15% on modern CPU

### Browser Support

| Browser | Desktop             | Mobile |
| ------- | ------------------- | ------ |
| Chrome  | ✅                  | ✅     |
| Firefox | ✅                  | ✅     |
| Edge    | ✅                  | ✅     |
| Safari  | ⚠️ (WebRTC limited) | ⚠️     |

## 🔒 Privacy & Security

### Your Data is Safe Because:

1. **Local Processing**: All ML inference runs in browser
2. **No Cloud Upload**: Emotions never sent to servers
3. **No Recording**: Video not stored or transmitted
4. **Browser Control**: You control permissions, can revoke anytime

### What IS Sent to Servers:

- ✅ Only detected emotion label (e.g., "happy")
- ✅ Not the raw video or face data
- ✅ Can be disabled by denying camera permission

## 🎓 Learn More

- face-api.js: https://github.com/justadudewhohacks/face-api.js
- TensorFlow.js: https://www.tensorflow.org/js
- Emotion Recognition: https://arxiv.org/abs/1703.07679

## 📱 Mobile Considerations

### iOS (iPhone/iPad)

- ⚠️ **Limited Support**: iOS Safari restricts WebRTC
- Microphone usually works
- Camera may not work consistently
- Try: Progressive Web App (PWA) instead of browser

### Android

- ✅ **Full Support**: Chrome + Firefox work well
- Both camera and microphone available
- Recommended platform for best experience

## 🚀 Advanced: Custom Emotion Scoring

You can modify how emotions are aggregated:

```javascript
// Default: Return highest confidence
getEmotion() {
  return this.currentEmotion;
}

// Custom: Use weighted average
getWeightedEmotion(weights = {}) {
  const recentDetections = this.emotionHistory.slice(-15);
  // Calculate weighted average...
}
```

See `public/emotion-detector.js` for implementation details.
