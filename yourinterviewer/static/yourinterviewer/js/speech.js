/**
 * speech.js — yourInterviewer
 *
 * TTS  → Web Speech API SpeechSynthesis  (interviewer speaks questions aloud)
 * STT  → Web Speech API SpeechRecognition (you speak your answer)
 *
 * Works in Chrome and Edge. Firefox does not support SpeechRecognition.
 */

const Speech = (() => {

  const synth = window.speechSynthesis;
  let rec = null;    // SpeechRecognition instance
  let recording = false;
  let fullText = '';      // accumulated final transcript

  // ── TTS — Interviewer speaks ──────────────────────────────────────

  function speak(text, onEnd) {
    if (!synth) {
      onEnd?.();
      return;
    }

    // Cancel anything currently being spoken
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.93;   // slightly slower than default — clearer
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voices = synth.getVoices();

    // Debug: Log all available voices for debugging (User can check console if accent is wrong)
    // console.log("Available voices:", voices.map(v => `${v.name} (${v.lang})`));

    // Improved picker: Search for Indian English (en-IN, en_IN) or common Indian voice names
    const preferred =
      // 1. High priority: Female Indian English (any format: en-IN, en_IN)
      voices.find(v => /en[_-]IN/i.test(v.lang) && /female|priya|heera|neerja|anu|swara|kalpana|vani/i.test(v.name)) ||
      // 2. Any Indian English
      voices.find(v => /en[_-]IN/i.test(v.lang)) ||
      // 3. Indian names (not necessarily in the en-IN locale string)
      voices.find(v => /rishi|ravi|hemant|prakash|priya|heera|neerja/i.test(v.name)) ||
      // 4. Any English female fallback
      voices.find(v => /en/i.test(v.lang) && /female|samantha|victoria|susan|zira/i.test(v.name)) ||
      // 5. Any English
      voices.find(v => /en/i.test(v.lang)) ||
      voices[0];

    if (preferred) {
      utterance.voice = preferred;
      // If we got an Indian voice, tweak for more professional Indian cadence
      if (/en[_-]IN/i.test(preferred.lang) || /rishi|heera|priya|swara/i.test(preferred.name)) {
        utterance.rate = 0.92; // Slightly slower makes Indian accents much clearer and authentic
        utterance.pitch = 1.0;
      }
    }

    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();

    synth.speak(utterance);
  }

  function stopSpeaking() {
    synth?.cancel();
  }

  function isSpeaking() {
    return synth?.speaking ?? false;
  }

  // ── STT — You speak your answer ───────────────────────────────────

  function initRec() {
    const SR =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SR) return false;

    rec = new SR();
    rec.continuous = true;    // keep listening until manually stopped
    rec.interimResults = true;    // show words as you speak in real time
    rec.lang = 'en-IN';
    return true;
  }

  /**
   * Start recording the user's voice.
   *
   * @param {object} callbacks
   *   onUpdate(text, isFinal) — called on every interim/final result
   *   onEnd()                 — called when recording stops
   */
  function startRecording({ onUpdate, onEnd, initialText = '' } = {}) {
    if (!rec && !initRec()) {
      alert(
        'Speech recognition is not supported in this browser.\n' +
        'Please use Chrome or Edge, or type your answer instead.'
      );
      return false;
    }

    // Use initialText if provided, otherwise start fresh
    fullText = initialText;
    recording = true;

    rec.onresult = (event) => {
      let interim = '';
      let finalChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalChunk += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      // Append confirmed words to fullText
      fullText += finalChunk;

      // Show full confirmed + live interim together
      const display = fullText + (interim ? ' ' + interim : '');
      onUpdate?.(display, false);
    };

    rec.onend = () => {
      // If recording was supposed to be active, restart it (handles Chrome timeout)
      if (recording) {
        try {
          rec.start();
          return; // DON'T call onEnd yet
        } catch (e) { }
      }

      recording = false;
      // Fire final confirmed text
      onUpdate?.(fullText, true);
      onEnd?.();
    };

    rec.onerror = (event) => {
      // Ignore 'no-speech' — it might just mean a pause, but Chrome might stop
      if (event.error === 'no-speech') {
        // onend will handle restart if recording is true
        return;
      }

      console.warn('Speech recognition error:', event.error);
      if (['audio-capture', 'not-allowed'].includes(event.error)) {
        recording = false;
        onEnd?.();
      }
    };

    try {
      rec.start();
    } catch (e) {
      // Already started — safe to ignore
    }

    return true;
  }

  function stopRecording() {
    recording = false;
    try {
      rec?.stop();
    } catch (e) {
      // Already stopped — safe to ignore
    }
  }

  function getTranscript() { return fullText.trim(); }
  function clearTranscript() { fullText = ''; }
  function isRecording() { return recording; }

  // Pre-load voices — Chrome loads them asynchronously
  if (synth) {
    synth.onvoiceschanged = () => synth.getVoices();
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    speak,
    stopSpeaking,
    isSpeaking,
    startRecording,
    stopRecording,
    getTranscript,
    clearTranscript,
    isRecording,
  };

})();
