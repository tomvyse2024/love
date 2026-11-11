
const $ = id => document.getElementById(id);

const YE_PEER_ID = "ye-tomvyse2024-love";
const MYAT_PEER_ID = "myat-tomvyse2024-love";

let peer = null;
let mySide = null;
let partnerPeerId = null;
let dataConn = null;
let dataRetryTimer = null;

let currentCall = null;
let localStream = null;       // Microphone only — never requests a camera.
let screenStream = null;      // Shared display video and optional tab audio.
let screenAudioContext = null;
let mixedAudioTrack = null;
let audioDestination = null;
let micSourceNode = null;
let movieSourceNode = null;
let audioSender = null;

let micOn = true;
let busy = false;
let movieSyncLock = false;
let incomingMovie = null;
let movieObjectUrl = null;

const MOVIE_CHUNK_SIZE = 16 * 1024;
const MOVIE_MAX_SIZE = 250 * 1024 * 1024;

function setStatus(message, connected = false) {
  $("statusText").textContent = message;
  document.querySelector(".status-dot").style.background =
    connected ? "#7ee0b0" : "#d3a6b8";
}

function setCallState(message) {
  $("callState").textContent = message;
}

function setRoleStatus(message) {
  const el = $("roleStatus");
  if (el) el.textContent = message;
}

function updateRoleButtons() {
  $("chooseYeBtn").classList.toggle("selected", mySide === "YE");
  $("chooseMyatBtn").classList.toggle("selected", mySide === "MYAT");
  $("callPartnerBtn").disabled =
    !peer || !peer.open || !partnerPeerId || !dataConn || !dataConn.open || !!currentCall;
}

function setSessionControls(active, localSharing = false) {
  $("micBtn").disabled = !active;
  $("endBtn").disabled = !active;
  $("shareBtn").disabled = !localSharing;
  $("callCard").classList.toggle("session-active", active);
  $("callCard").classList.toggle("local-sharing", active && localSharing);
  $("callPartnerBtn").disabled =
    !peer || !peer.open || !partnerPeerId || !dataConn || !dataConn.open || active;
}

function setTheatreMode(active, source = "remote") {
  const card = $("callCard");
  card.classList.toggle("theatre-mode", active);
  card.classList.toggle("local-sharing", active && source === "local");

  if (active) {
    const video = source === "local" ? $("localVideo") : $("remoteVideo");
    if (video && video.srcObject) video.play().catch(() => {});
    setCallState("LIVE MOVIE • VOICE ONLY");
    setStatus("Movie Theatre — camera off, voice only", true);
  } else {
    if (document.fullscreenElement === card ||
        document.fullscreenElement === $("remoteVideo") ||
        document.fullscreenElement === $("localVideo")) {
      document.exitFullscreen?.().catch(() => {});
    }
    if ($("remoteVideo").webkitDisplayingFullscreen) {
      $("remoteVideo").webkitExitFullscreen?.();
    }
    if ($("localVideo").webkitDisplayingFullscreen) {
      $("localVideo").webkitExitFullscreen?.();
    }
    $("remoteVideo").controls = false;
    setCallState("WAITING FOR MOVIE SHARE");
  }
}

async function toggleTheatreFullscreen() {
  const card = $("callCard");
  const isLocalSharer = card.classList.contains("local-sharing");
  const activeVideo = isLocalSharer ? $("localVideo") : $("remoteVideo");

  try {
    // A tap on this button also gives the browser a user gesture to start audio.
    activeVideo.play().catch(() => {});
    if (isLocalSharer) $("remoteAudio").play().catch(() => {});
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (activeVideo.webkitDisplayingFullscreen) {
      activeVideo.webkitExitFullscreen?.();
      return;
    }

    if (isLocalSharer) {
      if (card.requestFullscreen) {
        try {
          await card.requestFullscreen({ navigationUI: "hide" });
        } catch (_) {
          await card.requestFullscreen();
        }
      } else if (activeVideo.requestFullscreen) {
        await activeVideo.requestFullscreen();
      } else if (activeVideo.webkitEnterFullscreen) {
        activeVideo.webkitEnterFullscreen();
      } else {
        throw new Error("Fullscreen is not supported by this browser.");
      }
      return;
    }

    // On Android, fullscreen the received video element itself.
    activeVideo.controls = true;
    if (activeVideo.requestFullscreen) {
      try {
        await activeVideo.requestFullscreen({ navigationUI: "hide" });
      } catch (_) {
        await activeVideo.requestFullscreen();
      }
    } else if (activeVideo.webkitEnterFullscreen) {
      activeVideo.webkitEnterFullscreen();
    } else if (card.requestFullscreen) {
      await card.requestFullscreen();
    } else {
      throw new Error("Fullscreen is not supported by this browser.");
    }
  } catch (error) {
    activeVideo.controls = false;
    console.warn("Fullscreen:", error);
    setRoleStatus("ဒီ Browser မှာ Full screen မရသေးပါ။ Chrome နဲ့ ထပ်စမ်းပါ။");
  }
}

$("theatreFullscreenBtn").addEventListener("click", toggleTheatreFullscreen);

function updateTheatreFullscreenLabel() {
  const card = $("callCard");
  const activeVideo = card.classList.contains("local-sharing")
    ? $("localVideo")
    : $("remoteVideo");
  const isFullscreen =
    document.fullscreenElement === card ||
    document.fullscreenElement === activeVideo ||
    !!activeVideo.webkitDisplayingFullscreen;

  $("theatreFullscreenBtn").querySelector("small").textContent =
    isFullscreen ? "Exit full screen" : "Full screen";

  if (document.fullscreenElement !== $("remoteVideo") &&
      !$("remoteVideo").webkitDisplayingFullscreen) {
    $("remoteVideo").controls = false;
  }
}

document.addEventListener("fullscreenchange", updateTheatreFullscreenLabel);
$("remoteVideo").addEventListener("webkitendfullscreen", updateTheatreFullscreenLabel);
$("remoteVideo").addEventListener("webkitbeginfullscreen", updateTheatreFullscreenLabel);

async function getMicStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access requires HTTPS.");
  }
  if (!localStream || localStream.getAudioTracks().every(track => track.readyState === "ended")) {
    // Intentionally audio-only. No video:true and no camera access anywhere.
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false
    });
  }
  return localStream;
}

async function findAudioSender(call = currentCall) {
  if (call && call === currentCall && audioSender) return audioSender;

  for (let attempt = 0; attempt < 25; attempt++) {
    const pc = call && call.peerConnection;
    if (pc) {
      const senders = pc.getSenders ? pc.getSenders() : [];
      let sender = senders.find(item => item.track && item.track.kind === "audio");

      // After replaceTrack(null), use the audio transceiver's receiver track
      // to find the same sender again when the user unmutes.
      if (!sender && pc.getTransceivers) {
        const transceiver = pc.getTransceivers().find(item =>
          item.receiver && item.receiver.track &&
          item.receiver.track.kind === "audio"
        );
        if (transceiver) sender = transceiver.sender;
      }

      if (sender) {
        if (call === currentCall) audioSender = sender;
        return sender;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return null;
}

function updateMicButton() {
  $("micBtn").classList.toggle("active", !micOn);
  $("micBtn").querySelector("small").textContent = micOn ? "Mute" : "Unmute";
  $("micBtn").title = micOn
    ? "Mute and release microphone"
    : "Turn microphone on again";
}

async function toggleMicrophone() {
  if (!currentCall) return;

  const button = $("micBtn");
  button.disabled = true;

  try {
    if (micOn) {
      // Disconnect the microphone from the movie mix first, if tab audio is
      // being mixed. This keeps movie sound playing while releasing the mic.
      if (micSourceNode) {
        try { micSourceNode.disconnect(); } catch (_) {}
        micSourceNode = null;
      } else {
        const sender = await findAudioSender(currentCall);
        if (sender && sender.replaceTrack) {
          await sender.replaceTrack(null);
        }
      }

      const microphone = localStream;
      localStream = null;
      if (microphone) {
        microphone.getTracks().forEach(track => {
          try { track.stop(); } catch (_) {}
        });
      }

      micOn = false;
      updateMicButton();
      setRoleStatus("Microphone ကို လုံးဝပိတ်ပြီး စက်ထဲကလည်း ဖြုတ်ထားပါပြီ။ Movie အသံတော့ ဆက်ကြားရပါမယ်။");
    } else {
      // Ask for the microphone again only after the user explicitly unmutes.
      const microphone = await getMicStream();
      const track = microphone.getAudioTracks()[0];
      if (!track) throw new Error("No microphone track was created.");

      if (audioDestination && screenAudioContext) {
        await screenAudioContext.resume();
        micSourceNode = screenAudioContext.createMediaStreamSource(microphone);
        micSourceNode.connect(audioDestination);
      } else {
        const sender = await findAudioSender(currentCall);
        if (!sender || !sender.replaceTrack) {
          throw new Error("The voice connection is not ready yet.");
        }
        await sender.replaceTrack(track);
      }

      micOn = true;
      updateMicButton();
      setRoleStatus("Microphone ပြန်ဖွင့်ပြီးပါပြီ။ စကားပြောနိုင်ပါပြီ ♡");
    }
  } catch (error) {
    console.warn("Microphone toggle:", error);

    // If unmuting failed after permission was granted, release the new track.
    if (!micOn && localStream) {
      localStream.getTracks().forEach(track => {
        try { track.stop(); } catch (_) {}
      });
      localStream = null;
    }
    setRoleStatus(micOn
      ? "Microphone ကို ပိတ်ရာမှာ အခက်အခဲရှိပါတယ်။ ထပ်နှိပ်ကြည့်ပါ။"
      : "Microphone ပြန်ဖွင့်မရသေးပါ။ Permission ကို စစ်ပြီး Unmute ထပ်နှိပ်ပါ။");
  } finally {
    button.disabled = false;
  }
}

function addMessage(message, mine, name = "Partner") {
  const box = $("messages");
  const empty = box.querySelector(".empty-chat");
  if (empty) empty.remove();

  const msg = document.createElement("div");
  msg.className = "msg" + (mine ? " mine" : "");

  const body = document.createElement("div");
  body.textContent = message;

  const meta = document.createElement("small");
  meta.textContent = (mine ? "You" : name) + " · " +
    new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});

  msg.append(body, meta);
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
}

function enableChatControls() {
  $("chatInput").disabled = false;
  $("sendBtn").disabled = false;
}

function attachConnection(conn) {
  dataConn = conn;

  conn.on("open", () => {
    setStatus("Connected with your person", true);
    enableChatControls();
    updateRoleButtons();
    setRoleStatus("နှစ်ယောက်လုံး ချိတ်ဆက်ပြီးပါပြီ ♡ Start Movie Share ကိုနှိပ်နိုင်ပါပြီ။");
  });

  conn.on("data", data => {
    if (data && data.type === "chat") {
      addMessage(String(data.text || ""), false, String(data.name || "Partner"));
      return;
    }
    handleMovieData(data);
  });

  conn.on("close", () => {
    if (dataConn === conn) dataConn = null;
    $("chatInput").disabled = true;
    $("sendBtn").disabled = true;
    updateRoleButtons();
    setStatus("Partner connection closed");
  });

  conn.on("error", error => {
    console.warn("Data connection:", error);
  });
}

function bindCallEvents(call, direction) {
  call.on("stream", stream => {
    if (direction === "outgoing") {
      // The sharer receives the partner's microphone through this audio-only stream.
      $("remoteAudio").srcObject = stream;
      $("remoteAudio").play().catch(() => {
        setRoleStatus("Partner အသံကြားရန် Full screen ခလုတ်ကို တစ်ချက်နှိပ်ပါ။");
      });
      setRoleStatus("Movie ကို မျှဝေနေပါပြီ ♡ Voice chat လည်း ချိတ်ဆက်ပြီးပါပြီ။");
      setStatus("Sharing screen — voice connected", true);
      return;
    }

    // The viewer receives the shared screen video plus the sharer's audio.
    $("remoteVideo").srcObject = stream;
    $("remoteVideo").play().catch(() => {
      setRoleStatus("Movie အသံစဖို့ Full screen ကို တစ်ချက်နှိပ်ပါ။");
    });
    $("remotePlaceholder").style.display = "none";
    $("localVideo").srcObject = null;
    setTheatreMode(true, "remote");
    setSessionControls(true, false);
    setRoleStatus("Movie ကို Live ကြည့်ရှုနိုင်ပါပြီ ♡ Mic နဲ့ စကားပြောနိုင်ပါတယ်။");
  });

  call.on("close", () => {
    if (currentCall === call) endSession(false);
  });

  call.on("error", error => {
    console.warn("Movie media connection:", error);
    if (currentCall === call) endSession(false);
    setRoleStatus("Movie connection ပြတ်သွားပါတယ်။ နှစ်ယောက်လုံး ပြန်ချိတ်ပြီး ထပ်စမ်းပါ။");
  });
}

function setupPeer(peerId) {
  return new Promise((resolve, reject) => {
    if (!window.Peer) {
      reject(new Error("PeerJS could not load."));
      return;
    }

    peer = new Peer(peerId, {debug:1});

    peer.on("open", id => resolve(id));

    peer.on("error", error => {
      console.error("Peer error:", error);
      setStatus("Connection error: " + error.type);
      if (error.type === "peer-unavailable") {
        setRoleStatus("Partner online မဖြစ်သေးပါ။ သူ့ဘက်က Website ဖွင့်ပြီး Side ရွေးထားဖို့လိုပါတယ်။");
      }
    });

    peer.on("connection", conn => attachConnection(conn));

    peer.on("call", async call => {
      if (currentCall) {
        call.close();
        return;
      }

      try {
        setRoleStatus("Partner က Movie Share လုပ်နေပါတယ်။ Camera မဟုတ်ဘဲ Microphone permission ကို Allow လုပ်ပါ။");
        const microphone = await getMicStream();
        currentCall = call;
        audioSender = null;
        call.answer(microphone);
        findAudioSender(call).catch(error => console.warn("Audio sender:", error));
        setSessionControls(true, false);
        setCallState("CONNECTING TO MOVIE…");
        bindCallEvents(call, "incoming");
      } catch (error) {
        console.error("Microphone permission:", error);
        call.close();
        await endSession(false);
        setRoleStatus("Voice အတွက် Microphone permission ကို Allow လုပ်ပေးပါ။ Camera permission မလိုပါ။");
      }
    });

    peer.on("disconnected", () => setStatus("Reconnecting…"));
  });
}

function tryDataConnection() {
  // YE alone starts the data channel. MYAT waits for the incoming connection.
  if (mySide !== "YE" || !peer || !peer.open || !partnerPeerId) return;
  if (dataConn) return;

  const conn = peer.connect(partnerPeerId, {reliable:true});
  attachConnection(conn);
  conn.on("error", error => {
    console.warn("Auto data connection:", error);
    if (dataConn === conn) dataConn = null;
    updateRoleButtons();
  });
}

async function startMovieShare() {
  if (!peer || !peer.open || !partnerPeerId) {
    setRoleStatus("အရင်ဆုံး YE သို့မဟုတ် MYAT ကိုရွေးပါ။");
    return;
  }
  if (!dataConn || !dataConn.open) {
    setRoleStatus("Myat ဘက်ကလည်း Website ဖွင့်ပြီး သူ့ Side ကိုရွေးထားပါ။ ချိတ်ဆက်ပြီးမှ Share လုပ်နိုင်ပါမယ်။");
    return;
  }
  if (currentCall) return;

  $("callPartnerBtn").disabled = true;
  setRoleStatus("Screen ရွေးချယ်ပါ… Camera မဖွင့်ဘဲ Microphone နဲ့ Screen ကိုပဲ သုံးပါမယ်။");

  try {
    // Must be called directly from the user's button tap.
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      systemAudio: "include"
    });

    const screenTrack = screenStream.getVideoTracks()[0];
    if (!screenTrack) throw new Error("No screen video track was selected.");

    // Request microphone only. The camera is never requested.
    const microphone = await getMicStream();
    const micTrack = microphone.getAudioTracks()[0];
    const tabAudioTrack = screenStream.getAudioTracks()[0];
    let outgoingAudioTrack = micTrack;

    // Mix movie/tab sound and microphone when tab audio is available.
    // Muting later disconnects and stops only the microphone source.
    audioDestination = null;
    micSourceNode = null;
    movieSourceNode = null;
    if (tabAudioTrack && micTrack) {
      screenAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      await screenAudioContext.resume();
      audioDestination = screenAudioContext.createMediaStreamDestination();

      micSourceNode = screenAudioContext.createMediaStreamSource(microphone);
      movieSourceNode = screenAudioContext.createMediaStreamSource(new MediaStream([tabAudioTrack]));
      micSourceNode.connect(audioDestination);
      movieSourceNode.connect(audioDestination);

      mixedAudioTrack = audioDestination.stream.getAudioTracks()[0];
      outgoingAudioTrack = mixedAudioTrack;
    }

    const outgoingTracks = [screenTrack];
    if (outgoingAudioTrack) outgoingTracks.push(outgoingAudioTrack);
    const outgoingStream = new MediaStream(outgoingTracks);

    currentCall = peer.call(partnerPeerId, outgoingStream, {
      metadata: {type:"movie-screen-share"}
    });
    if (!currentCall) throw new Error("Could not start the screen stream.");
    audioSender = null;
    findAudioSender(currentCall).catch(error => console.warn("Audio sender:", error));

    $("localVideo").srcObject = screenStream;
    $("localPlaceholder").style.display = "none";
    setSessionControls(true, true);
    setTheatreMode(true, "local");
    setRoleStatus("Screen မျှဝေနေပါပြီ။ Myat က လက်ခံတာနဲ့ Movie ကို Live ကြည့်နိုင်ပါပြီ။");
    bindCallEvents(currentCall, "outgoing");

    screenTrack.onended = () => {
      if (currentCall) endSession();
    };
  } catch (error) {
    console.error("Start movie share:", error);
    await endSession();
    setRoleStatus("Screen Share မအောင်မြင်ပါ။ Chrome မှာ Screen permission နဲ့ Microphone permission ကို Allow လုပ်ပြီး ထပ်စမ်းပါ။");
  }
}

async function endSession(closeCall = true) {
  const call = currentCall;
  currentCall = null;

  if (closeCall && call) {
    try { call.close(); } catch (_) {}
  }

  const display = screenStream;
  screenStream = null;
  if (display) {
    display.getTracks().forEach(track => {
      track.onended = null;
      try { track.stop(); } catch (_) {}
    });
  }

  const microphone = localStream;
  localStream = null;
  if (microphone) microphone.getTracks().forEach(track => {
    try { track.stop(); } catch (_) {}
  });

  if (micSourceNode) {
    try { micSourceNode.disconnect(); } catch (_) {}
    micSourceNode = null;
  }
  if (movieSourceNode) {
    try { movieSourceNode.disconnect(); } catch (_) {}
    movieSourceNode = null;
  }
  audioDestination = null;

  if (screenAudioContext) {
    await screenAudioContext.close().catch(() => {});
    screenAudioContext = null;
  }
  if (mixedAudioTrack) {
    try { mixedAudioTrack.stop(); } catch (_) {}
    mixedAudioTrack = null;
  }
  audioSender = null;

  $("remoteAudio").srcObject = null;
  $("remoteVideo").srcObject = null;
  $("localVideo").srcObject = null;
  $("remotePlaceholder").style.display = "flex";
  $("localPlaceholder").style.display = "flex";

  setTheatreMode(false);
  setSessionControls(false, false);
  micOn = true;
  updateMicButton();
  $("shareBtn").querySelector("small").textContent = "Stop sharing";
  setStatus("Movie session ended", !!(peer && peer.open));
  setCallState("WAITING FOR MOVIE SHARE");
  updateRoleButtons();
}

$("callPartnerBtn").addEventListener("click", startMovieShare);
$("shareBtn").addEventListener("click", () => endSession());
$("endBtn").addEventListener("click", () => endSession());

$("micBtn").addEventListener("click", toggleMicrophone);

$("chatForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("chatInput");
  const message = input.value.trim();
  if (!message) return;

  if (!dataConn || !dataConn.open) {
    alert("Partner နဲ့ ချိတ်ဆက်ပြီးမှ Message ပို့နိုင်ပါတယ်။");
    return;
  }

  dataConn.send({type:"chat", text:message, name:mySide || "You"});
  addMessage(message, true);
  input.value = "";
});

async function selectSide(side) {
  if (busy) return;
  if (peer && peer.open && mySide === side) {
    setRoleStatus(side + " side is ready. Partner ကို စောင့်နေပါတယ်…");
    return;
  }

  busy = true;
  try {
    await endSession();
    if (dataRetryTimer) clearInterval(dataRetryTimer);
    if (dataConn) {
      try { dataConn.close(); } catch (_) {}
      dataConn = null;
    }
    if (peer) {
      try { peer.destroy(); } catch (_) {}
      peer = null;
    }

    mySide = side;
    partnerPeerId = side === "YE" ? MYAT_PEER_ID : YE_PEER_ID;
    localStorage.setItem("ldr-side", side);
    setRoleStatus("Starting " + side + " side… Camera နဲ့ Microphone မဖွင့်သေးပါ။");
    setStatus("Connecting your room…");

    await setupPeer(side === "YE" ? YE_PEER_ID : MYAT_PEER_ID);
    setRoleStatus(side + " side is online ♡ Partner ကို စောင့်နေပါတယ်။");
    setStatus("Your side is online", true);
    updateRoleButtons();

    dataRetryTimer = setInterval(tryDataConnection, 5000);
    tryDataConnection();
  } catch (error) {
    console.error(error);
    setRoleStatus("Room မချိတ်ဆက်နိုင်ပါ။ ခဏစောင့်ပြီး ထပ်စမ်းပါ။");
    if (peer) {
      peer.destroy();
      peer = null;
    }
    updateRoleButtons();
  } finally {
    busy = false;
  }
}

$("chooseYeBtn").addEventListener("click", () => selectSide("YE"));
$("chooseMyatBtn").addEventListener("click", () => selectSide("MYAT"));

$("changeSideBtn").addEventListener("click", async () => {
  await endSession();
  if (dataRetryTimer) clearInterval(dataRetryTimer);
  if (dataConn) {
    try { dataConn.close(); } catch (_) {}
    dataConn = null;
  }
  if (peer) {
    try { peer.destroy(); } catch (_) {}
    peer = null;
  }
  mySide = null;
  partnerPeerId = null;
  localStorage.removeItem("ldr-side");
  setRoleStatus("Choose YE or MYAT to connect to your own side.");
  setStatus("Ready for love");
  updateRoleButtons();
});

function movieSay(message) {
  $("movieStatus").textContent = message;
}

function movieLoad(blob, name) {
  if (movieObjectUrl) URL.revokeObjectURL(movieObjectUrl);
  movieObjectUrl = URL.createObjectURL(blob);
  $("moviePlayer").src = movieObjectUrl;
  $("movieFileName").textContent = name || "Shared movie";
  movieSay("Movie ready ♡ Press play when you're ready.");
}

$("movieChooseBtn").addEventListener("click", () => $("movieFile").click());

$("movieFile").addEventListener("change", async () => {
  const file = $("movieFile").files && $("movieFile").files[0];
  if (!file) return;

  if (!(file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name))) {
    movieSay("Please choose a supported video file (MP4, WebM, MOV or M4V).");
    $("movieFile").value = "";
    return;
  }
  if (file.size > MOVIE_MAX_SIZE) {
    movieSay("This version supports files up to 250 MB.");
    $("movieFile").value = "";
    return;
  }

  movieLoad(file, file.name);
  if (!dataConn || !dataConn.open) {
    movieSay("Movie loaded on this device. Connect with your partner to send it.");
    return;
  }

  try {
    $("movieChooseBtn").disabled = true;
    $("movieProgress").hidden = false;
    $("movieProgressBar").style.width = "0%";

    const total = Math.ceil(file.size / MOVIE_CHUNK_SIZE);
    dataConn.send({
      type:"movie-start", name:file.name, mime:file.type || "video/mp4",
      size:file.size, total
    });

    for (let i = 0; i < total; i++) {
      if (!dataConn || !dataConn.open) throw new Error("Connection closed during transfer.");
      while (dataConn && dataConn.open && dataConn.dataChannel &&
             dataConn.dataChannel.bufferedAmount > 512 * 1024) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!dataConn || !dataConn.open) throw new Error("Connection closed during transfer.");

      const chunk = file.slice(i * MOVIE_CHUNK_SIZE, Math.min(file.size, (i + 1) * MOVIE_CHUNK_SIZE));
      dataConn.send(chunk);
      $("movieProgressBar").style.width = Math.round(((i + 1) / total) * 100) + "%";
      if (i % 4 === 0) await new Promise(resolve => setTimeout(resolve, 8));
    }

    dataConn.send({type:"movie-end", name:file.name});
    movieSay("Movie sent to your partner ♡");
  } catch (error) {
    console.error("Movie transfer:", error);
    movieSay("Movie transfer stopped. Check the connection and try again.");
  } finally {
    $("movieChooseBtn").disabled = false;
  }
});

function handleMovieData(data) {
  if (data && typeof data === "object" && data.type === "movie-start") {
    incomingMovie = {
      name:data.name || "Shared movie",
      mime:data.mime || "video/mp4",
      size:data.size,
      total:data.total,
      chunks:[],
      received:0
    };
    $("movieProgress").hidden = false;
    $("movieProgressBar").style.width = "0%";
    movieSay("Receiving " + incomingMovie.name + "…");
    return;
  }

  if (data && typeof data === "object" && data.type === "movie-end") {
    if (!incomingMovie) return;
    const movie = incomingMovie;
    incomingMovie = null;
    movieLoad(new Blob(movie.chunks, {type:movie.mime}), movie.name);
    $("movieProgressBar").style.width = "100%";
    movieSay("Movie received successfully ♡ Press play to watch together.");
    return;
  }

  if (data && typeof data === "object" && data.type === "movie-sync") {
    if (!$("moviePlayer").src) return;
    movieSyncLock = true;
    if (Number.isFinite(data.time)) {
      const drift = Math.abs(($("moviePlayer").currentTime || 0) - data.time);
      if (drift > 0.8) $("moviePlayer").currentTime = data.time;
    }
    if (data.action === "play") $("moviePlayer").play().catch(() => movieSay("Tap play once to allow movie playback."));
    if (data.action === "pause") $("moviePlayer").pause();
    setTimeout(() => { movieSyncLock = false; }, 250);
    return;
  }

  if (data instanceof Blob || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    if (!incomingMovie) return;
    const part = data instanceof Blob ? data : new Blob([data]);
    incomingMovie.chunks.push(part);
    incomingMovie.received += part.size;
    $("movieProgressBar").style.width =
      Math.min(99, Math.round(incomingMovie.received / incomingMovie.size * 100)) + "%";
  }
}

function sendMovieSync(action) {
  const player = $("moviePlayer");
  if (movieSyncLock || !dataConn || !dataConn.open || !player.src) return;
  dataConn.send({type:"movie-sync", action, time:player.currentTime || 0});
}

$("moviePlayer").addEventListener("play", () => sendMovieSync("play"));
$("moviePlayer").addEventListener("pause", () => sendMovieSync("pause"));
$("moviePlayer").addEventListener("seeked", () => sendMovieSync("seeked"));

$("chatInput").disabled = true;
$("sendBtn").disabled = true;
setSessionControls(false, false);

// Restore the saved identity without requesting camera or microphone access.
const savedSide = localStorage.getItem("ldr-side");
if (savedSide === "YE" || savedSide === "MYAT") {
  mySide = savedSide;
  partnerPeerId = savedSide === "YE" ? MYAT_PEER_ID : YE_PEER_ID;
  setRoleStatus("Restoring your " + savedSide + " side…");
  updateRoleButtons();

  setupPeer(savedSide === "YE" ? YE_PEER_ID : MYAT_PEER_ID).then(() => {
    setRoleStatus(savedSide + " side is online ♡ Partner ကို စောင့်နေပါတယ်။");
    setStatus("Your side is online", true);
    updateRoleButtons();
    dataRetryTimer = setInterval(tryDataConnection, 5000);
    tryDataConnection();
  }).catch(error => {
    console.warn("Could not restore saved side:", error);
    setRoleStatus("Tap your " + savedSide + " button to reconnect.");
  });
}
