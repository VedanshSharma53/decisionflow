// Web Speech API helper (SPEC §7).
// Chrome / Edge only: wraps SpeechRecognition, restarts after silence, and
 // reports interim + final results to the caller.
//
// Note: Chrome's error code "network" is misleading. It often means Google's
// cloud speech service failed (blocked, Brave, API glitch), NOT that Wi‑Fi is down.

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

/** True when this browser exposes the Speech Recognition API. */
export function isSpeechSupported() {
  return Boolean(SpeechRecognitionAPI);
}

/** Rough hint for the UI — Brave/Opera often break Chrome's cloud speech. */
export function speechBrowserHint() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Brave/i.test(ua) || navigator.brave) {
    return "Brave often blocks Google’s speech service. Please use Google Chrome.";
  }
  if (/Edg\//i.test(ua)) {
    return null; // Edge usually works
  }
  if (/Chrome\//i.test(ua)) {
    return null;
  }
  return "For best results open this app in Google Chrome.";
}

/**
 * Ask for the mic once before recognition starts.
 * This surfaces a clear permission prompt and avoids some Chrome start failures.
 */
async function askForMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot access the microphone.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // Permission is what we needed — SpeechRecognition opens its own audio path
  stream.getTracks().forEach((t) => t.stop());
}

/**
 * Create a recognizer instance.
 *
 *   const rec = createSpeechRecognizer({ lang, onInterim, onFinal, onError, onListeningChange });
 *   await rec.start();  rec.pause();  rec.resume();  rec.stop();
 */
export function createSpeechRecognizer({
  lang = "en-IN",
  onInterim,
  onFinal,
  onError,
  onListeningChange,
} = {}) {
  if (!isSpeechSupported()) {
    return {
      supported: false,
      async start() {
        onError?.("Please use Chrome or Edge for microphone input.");
      },
      pause() {},
      resume() {},
      stop() {},
      setLang() {},
      get listening() {
        return false;
      },
      get paused() {
        return false;
      },
    };
  }

  let currentLang = lang;
  let recognition = null;

  // wanted = user wants the mic on; paused = temporarily stopped by Pause
  let wanted = false;
  let paused = false;
  let listening = false;
  let restartTimer = null;
  let starting = false; // prevent overlapping async start() calls
  // After a hard failure, do not auto-restart until the user clicks Start again
  let hardStop = false;
  let networkFails = 0;

  function setListening(value) {
    listening = value;
    onListeningChange?.(value);
  }

  function clearRestart() {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function detach(rec) {
    if (!rec) return;
    // Clear handlers first so abort/stop cannot trigger a restart via onend
    rec.onstart = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
  }

  /** Chrome gets stuck after a network error if we reuse the same instance — make a new one. */
  function createInstance() {
    clearRestart();
    detach(recognition);
    const rec = new SpeechRecognitionAPI();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = currentLang;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setListening(true);
      networkFails = 0;
    };

    rec.onresult = (event) => {
      networkFails = 0;
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || "";
        if (result.isFinal) finalText += text;
        else interim += text;
      }
      if (interim) onInterim?.(interim.trim());
      if (finalText.trim()) onFinal?.(finalText.trim());
    };

    rec.onerror = (event) => {
      const code = event.error || "";
      // Normal when we stop, pause, or when silence ends a phrase
      if (code === "aborted" || code === "no-speech") return;

      if (code === "not-allowed" || code === "service-not-allowed") {
        hardStop = true;
        wanted = false;
        paused = false;
        clearRestart();
        setListening(false);
        onError?.(
          "Microphone permission denied. Click the lock icon in the address bar → allow Microphone, then try Start mic again."
        );
        return;
      }

      if (code === "audio-capture") {
        hardStop = true;
        wanted = false;
        paused = false;
        clearRestart();
        setListening(false);
        onError?.("No microphone was found. Plug one in (or check Windows sound settings) and try again.");
        return;
      }

      if (code === "network") {
        networkFails += 1;
        // One transient blip: let onend restart. Two in a row: stop and explain.
        if (networkFails >= 2) {
          hardStop = true;
          wanted = false;
          paused = false;
          clearRestart();
          setListening(false);
          const hint = speechBrowserHint();
          onError?.(
            "Chrome’s speech service failed to connect (this is often NOT your Wi‑Fi). " +
              "Try: refresh the page, use Google Chrome (not Brave), switch language to en-US, " +
              "or check that Google services aren’t blocked. Demo script mode still works." +
              (hint ? ` ${hint}` : "")
          );
        }
        return;
      }

      onError?.(`Speech error: ${code}`);
    };

    rec.onend = () => {
      setListening(false);
      clearRestart();
      if (hardStop || !wanted || paused) return;
      // Browser stops after silence — restart while the user still wants to record
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (wanted && !paused && !hardStop) safeStart();
      }, 250);
    };

    recognition = rec;
    return rec;
  }

  function safeStart() {
    try {
      if (!recognition) createInstance();
      recognition.start();
    } catch (err) {
      const msg = String(err?.message || err).toLowerCase();
      if (msg.includes("already")) return;
      // InvalidStateError after a failed session → new instance and one retry
      try {
        createInstance();
        recognition.start();
      } catch (err2) {
        onError?.(err2.message || String(err2));
      }
    }
  }

  return {
    supported: true,

    async start() {
      if (starting) return;
      starting = true;
      hardStop = false;
      wanted = true;
      paused = false;
      networkFails = 0;
      clearRestart();
      try {
        await askForMicrophone();
        createInstance();
        safeStart();
      } catch (err) {
        hardStop = true;
        wanted = false;
        setListening(false);
        const name = err?.name || "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          onError?.(
            "Microphone permission denied. Click the lock icon in the address bar → allow Microphone, then try again."
          );
        } else if (name === "NotFoundError") {
          onError?.("No microphone was found on this device.");
        } else {
          onError?.(err.message || String(err));
        }
      } finally {
        starting = false;
      }
    },

    pause() {
      if (!wanted) return;
      paused = true;
      clearRestart();
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
    },

    resume() {
      if (!wanted) {
        this.start();
        return;
      }
      hardStop = false;
      paused = false;
      clearRestart();
      createInstance();
      safeStart();
    },

    /** Fully stop — no auto-restart until start() again. */
    stop() {
      wanted = false;
      paused = false;
      hardStop = true;
      clearRestart();
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
      setListening(false);
    },

    setLang(next) {
      currentLang = next || "en-IN";
      // Restart with a fresh instance so the new language actually applies
      if (wanted && !paused && !hardStop) {
        createInstance();
        safeStart();
      } else if (recognition) {
        recognition.lang = currentLang;
      }
    },

    get listening() {
      return listening;
    },
    get paused() {
      return paused;
    },
  };
}
