# 🔧 Troubleshooting Guide

Quick fix guide for common issues in Magic Mirror.

## 🚀 Server Issues

### ❌ "Address already in use" / Port Conflict

**Error:**
```
error: listen tcp :1234: bind: Address already in use
```

**Solution:**

**macOS/Linux:**
```bash
# Find process using port
lsof -ti:1234

# Kill it forcefully
lsof -ti:1234 | xargs kill -9

# Start server again
deno task dev
```

**Windows:**
```bash
# Find process using port
netstat -ano | findstr :1234

# Kill by PID
taskkill /PID <PID> /F

# Start server again
deno task dev
```

### ❌ "OpenAI API key not configured"

**Error:**
```
[VoiceConversation] Error: OpenAI API key not configured
```

**Solution:**

1. **Check .env file exists:**
   ```bash
   cat .env | grep OPENAI_API_KEY
   ```

2. **Add key if missing:**
   ```bash
   echo "OPENAI_API_KEY=sk-..." >> .env
   ```

3. **Verify key format:**
   - Must start with `sk-`
   - Should be 40+ characters
   - Get from: https://platform.openai.com/api-keys

4. **Restart server:**
   ```bash
   deno task dev
   ```

### ❌ "Cannot find module" Error

**Error:**
```
error: Unable to load the remote module: https://deno.land/...
```

**Solution:**

1. **Check internet connection**
   ```bash
   curl https://deno.land
   ```

2. **Clear cache:**
   ```bash
   deno cache --reload src/server.ts
   ```

3. **Install dependencies again:**
   ```bash
   rm -rf ~/Library/Caches/deno  # macOS
   deno cache src/server.ts
   ```

### ❌ Server Starts but Page Doesn't Load

**Error:**
```
localhost:1234 refused to connect
```

**Check:**

1. **Server actually running?**
   ```bash
   # Terminal should show:
   # 🚀 Oak server running at http://localhost:1234
   ```

2. **Try different port:**
   ```bash
   PORT=3000 deno task dev
   ```

3. **Check firewall:**
   - macOS: System Preferences → Security & Privacy → Firewall
   - Windows: Windows Defender Firewall → Allow through firewall

4. **Try localhost vs 127.0.0.1:**
   ```
   http://127.0.0.1:1234/talk
   ```

### ❌ "No such file or directory" for Characters

**Error:**
```
error: Failed to find character files
```

**Solution:**

1. **Check characters folder exists:**
   ```bash
   ls -la characters/
   ```

   Should show:
   ```
   frank/
   mirror/
   lynq/
   ```

2. **Check FBX files inside:**
   ```bash
   ls -la characters/lynq/
   # Should show: lynx_bobcat_01.fbx
   ```

3. **If missing, restore from git:**
   ```bash
   git checkout characters/
   ```

### ❌ "NVIDIA A2F endpoint unreachable"

**Error:**
```
Failed to connect to Audio2Face service
```

**Solution:**

1. **Check endpoint is set:**
   ```bash
   echo $NVIDIA_A2F_ENDPOINT
   # Should show: grpc.nvcf.nvidia.com:443
   ```

2. **Test connectivity:**
   ```bash
   curl -I https://grpc.nvcf.nvidia.com:443
   ```

3. **Check firewall allows outbound gRPC**
   - gRPC typically uses port 443 (HTTPS)
   - Some corporate firewalls block it

4. **Try without A2F first** (avatar won't animate):
   - Remove `NVIDIA_A2F_ENDPOINT` from .env
   - Blendshapes will still be calculated locally

---

## 🎤 Voice Conversation Issues

### ❌ "Microphone access denied"

**Error:**
```
User denied microphone access
```

**Solution:**

1. **Check browser permissions:**
   - **Chrome**: Top-left lock icon → Site settings → Microphone → Allow
   - **Firefox**: about:preferences → Privacy → Permissions → Microphone
   - **Safari**: System Preferences → Security & Privacy → Microphone

2. **Reload page:**
   ```
   Cmd+R (macOS) or Ctrl+R (Windows)
   ```

3. **Clear site data:**
   - Chrome: Settings → Privacy → Clear browsing data → Cookies and other site data
   - Reload page

4. **Try different browser:**
   - Chrome and Firefox are most reliable
   - Safari has limited WebRTC support

### ❌ "No audio response"

**Error:**
```
Audio buffer is empty or undefined
```

**Causes & Solutions:**

1. **Whisper failed to transcribe:**
   - Check audio quality (quiet, echo, background noise?)
   - Try speaking louder and clearer
   - Test microphone with other app (Zoom, Teams, etc)

2. **ChatGPT didn't respond:**
   - Check if API key is valid:
     ```bash
     curl https://api.openai.com/v1/models \
       -H "Authorization: Bearer $OPENAI_API_KEY"
     ```
   - Check OpenAI rate limits: https://platform.openai.com/account/rate-limits
   - Try again in 30 seconds

3. **TTS failed:**
   - Verify API key again
   - Check response object in browser console (F12)

4. **Check console for errors:**
   ```
   Press F12 → Console tab → Look for red errors
   ```

### ❌ "Audio is too quiet or distorted"

**Solution:**

1. **Adjust microphone input level:**
   - macOS: System Settings → Sound → Input → Input Volume slider
   - Windows: Settings → Sound → Input volume
   - Browser: May have own mic control

2. **Reduce system noise:**
   - Close background apps
   - Mute other audio sources
   - Use headset instead of laptop mic

3. **Change TTS voice:**
   ```
   Edit src/openai.ts → voice: "nova"  // Try different voices
   ```

### ❌ "Chat response doesn't match emotion"

**Solution:**

1. **Emotion detection might be wrong:**
   - Check detected emotion in left panel
   - Try more exaggerated expression
   - Improve lighting

2. **System prompt override:**
   - Edit system prompt in UI to explicitly set tone:
     ```
     "Respond as if the user is happy. Be enthusiastic!"
     ```

3. **Check emotion context sent to server:**
   - Open browser console: F12 → Network tab
   - Click Start → Look at `/api/conversation` request
   - Check if `emotion` field is present

---

## 📷 Emotion Detection Issues

### ❌ "Camera not available"

**Error:**
```
Camera access denied or unavailable
```

**Solution:**

1. **Grant camera permission:**
   - Browser prompt appears → Click Allow
   - If missed, go to Site Settings → Camera → Allow

2. **Check only one app using camera:**
   - Close Zoom, Teams, FaceTime, OBS, etc.
   - Reload browser page
   - Try again

3. **Verify camera works:**
   ```bash
   # macOS - open Photo Booth or Facetime
   open -a "Photo Booth"
   
   # Windows - open Camera app
   ```

   If camera doesn't work there, it's a system issue (restart, check device drivers)

4. **Try different browser:**
   - Chrome and Firefox most reliable
   - Safari has limited support on iOS

### ❌ "Emotion detection says 'initializing camera...'"

**Solution:**

1. **Wait longer** - models loading from CDN (first time: 2-5 seconds)

2. **Check browser console:** F12 → Console tab
   - Look for face-api.js errors
   - Check network tab → Models download status

3. **Disable and enable camera:**
   ```bash
   # Refresh page
   Cmd+R or Ctrl+R
   ```

4. **Hardwire models locally** (if slow CDN):
   - Download models: https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/models/
   - Save to `public/models/`
   - Update emotion-detector.js URL

### ❌ "Wrong emotion detected"

**Causes:**

- **Poor lighting**: Face not well visible
- **Glasses/sunglasses**: Obscures eyes
- **Heavy makeup**: Confuses neural network
- **Extreme angles**: Side profile, looking down
- **Distance**: Too far or too close

**Solutions:**

1. **Improve conditions:**
   - Position face straight-on, 30-60cm from camera
   - Bright, even lighting (window + lamp)
   - Remove glasses if possible
   - Make clear, exaggerated expression

2. **Give it more time:**
   - System averages 5 seconds of detections
   - Hold expression steadily
   - Wait for it to stabilize

3. **Check confidence score:**
   - If says "Happy (45%)" - confidence is low, might be wrong
   - Wait for 80%+ confidence for accurate emotion

### ❌ "CPU/GPU usage too high"

**Solution:**

1. **Reduce detection frequency:**
   - Edit `public/emotion-detector.js`
   - Change: `}, 1000);` to `}, 2000);` (check every 2 seconds instead)

2. **Lower camera resolution:**
   ```javascript
   // In emotion-detector.js initialize()
   video: { width: 160, height: 120 }  // Instead of 320x240
   ```

3. **Close other browser tabs**
   - ML inference shares CPU with browser

4. **Use hardware acceleration:**
   - Enable in browser settings (usually automatic)

---

## 🌐 Network & Connectivity

### ❌ "Network request failed" / CORS error

**Error:**
```
Access to XMLHttpRequest blocked by CORS policy
```

**Solution:**

1. **Server CORS is enabled** - Should work by default
   - Check `src/server.ts` has CORS middleware

2. **Try different URL format:**
   ```
   http://localhost:1234  → works
   http://127.0.0.1:1234  → try this
   http://[yourip]:1234   → only if accessing from another machine
   ```

3. **Check API endpoint:**
   - Should be: `http://localhost:1234/api/conversation`
   - Not: `http://localhost:1234/conversation`

### ❌ "Slow response times"

**Causes & Solutions:**

1. **OpenAI rate limiting:**
   - Check: https://platform.openai.com/account/rate-limits
   - Wait 60 seconds before retrying
   - Upgrade plan if consistently hitting limits

2. **Network latency:**
   ```bash
   # Test latency to OpenAI
   ping api.openai.com
   ```

3. **Server CPU overloaded:**
   - Check: `top` command
   - Close other Deno processes
   - Reduce number of concurrent conversations

4. **Try faster model:**
   ```
   Edit src/openai.ts
   model: "gpt-3.5-turbo"  // Faster but less accurate
   ```

### ❌ "Connection refused"

**Error:**
```
Connection refused - Cannot reach server
```

**Solution:**

1. **Server is running?**
   ```bash
   deno task dev
   # Should show: 🚀 Oak server running...
   ```

2. **Correct port?**
   ```bash
   # Check .env
   cat .env | grep PORT
   # If PORT=3000, use http://localhost:3000/talk
   ```

3. **Firewall blocking?**
   - Check local firewall settings
   - Try `127.0.0.1` instead of `localhost`
   - Add Deno to firewall exceptions

---

## 🎨 Frontend Issues

### ❌ "Avatar doesn't load"

**Error:**
```
Failed to load character model
```

**Solution:**

1. **FBX file exists?**
   ```bash
   ls characters/lynq/
   # Must contain: lynx_bobcat_01.fbx
   ```

2. **Character selected in UI?**
   - Dropdown should show character names
   - Click one to load

3. **Check browser console:**
   - F12 → Console tab
   - Look for 3D loader errors
   - Check Network tab for 404s

4. **Try different avatar:**
   - If Lynx fails, try Frank
   - May be FBX file corruption

### ❌ "Mouth doesn't sync with audio"

**Causes:**

1. **Audio2Face disabled:**
   - If NVIDIA_A2F_ENDPOINT missing, A2F disabled
   - Add to .env: `NVIDIA_A2F_ENDPOINT=grpc.nvcf.nvidia.com:443`

2. **Blendshape data not received:**
   - Check server logs for A2F errors
   - Verify Audio2Face is responding

3. **Playback sync issues:**
   - Browser audio timing can drift
   - Refresh page and try again

### ❌ "Page is blank / 404 error"

**Error:**
```
Cannot GET /talk
```

**Solution:**

1. **Check route exists in server:**
   ```bash
   grep -n "get.*talk" src/server.ts
   ```

2. **Correct URL?**
   ```
   http://localhost:1234/talk     → ✅ Correct
   http://localhost:1234/talk.html → ❌ Wrong
   http://localhost:1234/           → Home page
   ```

3. **Server restarted after code change?**
   ```bash
   # Stop: Ctrl+C
   # Start: deno task dev
   ```

### ❌ "CSS/Styling looks broken"

**Solution:**

1. **Clear browser cache:**
   - F12 → Application → Clear Storage
   - Or Ctrl+Shift+R (hard refresh)

2. **Check styles.css loaded:**
   - F12 → Network tab
   - Look for `styles.css` - should be 200 OK
   - Not 404

3. **Browser support:**
   - Use modern browser (Chrome, Firefox, Edge)
   - Safari may have CSS compatibility issues

---

## 🧪 Debug Mode

### Enable Verbose Logging

**Server-side:**
```typescript
// In src/server.ts, add:
console.log("[DEBUG] Request received:", req.method, req.url);
```

Then check console output when running `deno task dev`

**Client-side:**
```javascript
// In browser console (F12):
localStorage.debug = '*';  // Enable all debug logs
localStorage.debug = 'VoiceConversation';  // Specific module
```

### Check Server Health

```bash
# Test server is responding
curl http://localhost:1234/

# Test API endpoint
curl -X POST http://localhost:1234/api/characters

# Check environment variables
curl http://localhost:1234/api/config  # (if exposed in debug mode)
```

### Browser Console Commands

```javascript
// Check microphone access
navigator.mediaDevices.enumerateDevices()
  .then(devices => console.log(devices))

// Check camera access
navigator.mediaDevices.getUserMedia({ video: true })
  .then(stream => console.log("Camera OK", stream))
  .catch(err => console.error("Camera FAILED", err))

// Check emotion detector status
console.log(emotionDetector);
console.log(emotionDetector.currentEmotion);
```

---

## 📞 Getting Help

If issue persists:

1. **Check these files:**
   - Server logs: Terminal running `deno task dev`
   - Browser console: F12 key
   - Network tab: F12 → Network

2. **Collect diagnostics:**
   ```bash
   # Save server info
   deno --version > diagnostics.txt
   cat .env | grep -v KEY >> diagnostics.txt  # Don't include keys!
   ```

3. **Try minimal reproduction:**
   - Can you reproduce with default settings?
   - Does it work with simple text (no emotion, no avatar)?

4. **Restart everything:**
   ```bash
   # Kill server
   lsof -ti:1234 | xargs kill -9
   
   # Clear browser cache
   # Open DevTools → Application → Clear Storage
   
   # Restart
   deno task dev
   
   # Open fresh incognito window
   # Visit http://localhost:1234/talk
   ```

---

**For more help:** See [README.md](./README.md), [VOICE_SETUP.md](./VOICE_SETUP.md), [CAMERA_SETUP.md](./CAMERA_SETUP.md), or [ARCHITECTURE.md](./ARCHITECTURE.md)
