
const $ = id => document.getElementById(id);

let peer = null;
let localStream = null;
let currentCall = null;
let dataConn = null;
let screenStream = null;
let originalVideoTrack = null;
let originalAudioTrack = null;
let screenAudioContext = null;
let mixedAudioTrack = null;
let isScreenSharing = false;
let theatreCameraState = null;

let micOn = true;
let cameraOn = true;
let busy = false;

function setStatus(message, connected = false) {
  $("statusText").textContent = message;
  document.querySelector(".status-dot").style.background =
    connected ? "#7ee0b0" : "#d3a6b8";
}

function setCallState(message) {
  $("callState").textContent = message;
}

function showLocalVideo() {
  $("localVideo").srcObject = localStream;
  $("localPlaceholder").style.display = "none";
}

function setTheatreMode(active, source = "remote") {
  const card = $("callCard");
  if (!card) return;

  if (active) {
    if (!card.classList.contains("theatre-mode")) {
      const videoTracks = localStream?.getVideoTracks() || [];
      theatreCameraState = videoTracks.length
        ? videoTracks.some(track => track.enabled)
        : cameraOn;
    }

    card.classList.add("theatre-mode");
    card.classList.toggle("local-sharing", source === "local");

    // Movie night is voice-only: stop the local camera track on both sides.
    if (localStream) {
      localStream.getVideoTracks().forEach(track => { track.enabled = false; });
    }
    cameraOn = false;
    $("cameraBtn").classList.add("active");
    $("cameraBtn").querySelector("small").textContent = "Camera on";

    const viewingVideo = source === "local" ? $("localVideo") : $("remoteVideo");
    if (viewingVideo?.srcObject) viewingVideo.play().catch(() => {});
    setCallState("MOVIE NIGHT • VOICE ON");
    $("statusText").textContent = "Movie night — voice chat is on";
  } else {
    card.classList.remove("theatre-mode", "local-sharing");

    if (localStream && theatreCameraState !== null) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = theatreCameraState;
      });
      cameraOn = theatreCameraState;
    }
    theatreCameraState = null;
    $("cameraBtn").classList.toggle("active", !cameraOn);
    $("cameraBtn").querySelector("small").textContent =
      cameraOn ? "Camera off" : "Camera on";

    if (document.fullscreenElement === card) {
      document.exitFullscreen?.().catch(() => {});
    }
    setCallState(currentCall ? "YOU ARE TOGETHER ♡" : "WAITING TO CONNECT");
  }
}

async function toggleTheatreFullscreen() {
  const card = $("callCard");
  const activeVideo = card.classList.contains("local-sharing")
    ? $("localVideo")
    : $("remoteVideo");

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (card.requestFullscreen) {
      try {
        await card.requestFullscreen({ navigationUI: "hide" });
      } catch (_) {
        await card.requestFullscreen();
      }
    } else if (activeVideo.webkitEnterFullscreen) {
      // iOS Safari fallback: enter native video fullscreen.
      activeVideo.webkitEnterFullscreen();
    } else {
      throw new Error("Fullscreen is not supported by this browser.");
    }
  } catch (error) {
    console.warn("Fullscreen:", error);
    setRoleStatus("Full screen မရသေးပါ။ Browser ကို update လုပ်ပြီး ထပ်စမ်းပါ။");
  }
}

$("theatreFullscreenBtn").addEventListener("click", toggleTheatreFullscreen);
document.addEventListener("fullscreenchange", () => {
  const isFullscreen = document.fullscreenElement === $("callCard");
  $("theatreFullscreenBtn").querySelector("small").textContent =
    isFullscreen ? "Exit full screen" : "Full screen";
});

function addMessage(text, mine, name = "Partner") {
  const box = $("messages");
  const empty = box.querySelector(".empty-chat");

  if (empty) empty.remove();

  const msg = document.createElement("div");
  msg.className = "msg" + (mine ? " mine" : "");

  const body = document.createElement("div");
  body.textContent = text;

  const meta = document.createElement("small");
  meta.textContent =
    (mine ? "You" : name) +
    " · " +
    new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

  msg.append(body, meta);
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
}

async function getMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera and microphone require HTTPS.");
  }

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    originalVideoTrack = localStream.getVideoTracks()[0];
    showLocalVideo();
  }

  return localStream;
}

function enableCallControls() {
  ["micBtn","cameraBtn","shareBtn","endBtn"].forEach(id => {
    $(id).disabled = false;
  });
}

function enableChatControls() {
  $("chatInput").disabled = false;
  $("sendBtn").disabled = false;
}

function enableControls() {
  enableCallControls();
  enableChatControls();
}

function attachConnection(conn) {
  dataConn = conn;

  conn.on("open", () => {
    setStatus("Connected with your person", true);
    enableChatControls();
    sendScreenShareState(isScreenSharing);
  });

  conn.on("data", data => {
    if (!data || data.type !== "chat") return;

    addMessage(
      String(data.text || ""),
      false,
      String(data.name || "Partner")
    );
  });

  conn.on("close", () => {
    dataConn = null;
    setStatus("Chat connection closed");
    $("chatInput").disabled = true;
    $("sendBtn").disabled = true;
  });

  conn.on("error", error => {
    console.error("Data connection:", error);
  });
}

function setupPeer(peerId) {
  return new Promise((resolve, reject) => {
    if (!window.Peer) {
      reject(new Error("PeerJS could not load."));
      return;
    }

    peer = new Peer(peerId || undefined, {
      debug: 1
    });

    peer.on("open", id => {
      resolve(id);
    });

    peer.on("error", error => {
      console.error("Peer error:", error);
      setStatus("Connection error: " + error.type);
      reject(error);
    });

    peer.on("connection", conn => {
      attachConnection(conn);
    });

    peer.on("call", async call => {
      try {
        setRoleStatus("Incoming call… turning on camera and microphone to answer.");
        await getMedia();

        currentCall = call;
        call.answer(localStream);

        call.on("stream", stream => {
          enableControls();
          $("remoteVideo").srcObject = stream;
          $("remotePlaceholder").style.display = "none";

          setCallState("YOU ARE TOGETHER ♡");
          setStatus("Video call connected", true);
        });

        call.on("close", () => {
          resetRemote();
        });

        call.on("error", error => {
          console.error("Call error:", error);
          resetRemote();
        });

      } catch (error) {
        console.error(error);
        alert("Please allow camera and microphone access.");
      }
    });

    peer.on("disconnected", () => {
      setStatus("Reconnecting...");
    });
  });
}

// CREATE ROOM

async function createRoom() {
  if (busy) return;
  busy = true;

  $("createBtn").disabled = true;

  try {
    setStatus("Creating your room...");

    await getMedia();

    const id = await setupPeer();

    $("myCodeLabel").textContent = "ROOM CODE: " + id;
    $("roomCode").value = id;
    $("copyBtn").disabled = false;

    setCallState("ROOM READY — WAITING FOR YOUR PERSON");
    setStatus("Your room is ready", true);

    $("createBtn").textContent = "Room created";

  } catch (error) {
    console.error(error);

    alert(
      "Could not create room. Check camera permissions and internet."
    );

    $("createBtn").disabled = false;

  } finally {
    busy = false;
  }
}

// JOIN ROOM

async function joinRoom() {
  if (busy) return;
  busy = true;

  const remoteId = $("roomCode").value.trim();

  if (!remoteId) {
    alert("Ask your partner for their room code first.");
    busy = false;
    return;
  }

  $("joinBtn").disabled = true;

  try {
    setStatus("Joining your room...");

    await getMedia();
    await setupPeer();

    const conn = peer.connect(remoteId, {
      reliable: true
    });

    attachConnection(conn);

    currentCall = peer.call(remoteId, localStream);

    if (!currentCall) {
      throw new Error("Could not start video call.");
    }

    currentCall.on("stream", stream => {
      enableControls();
      $("remoteVideo").srcObject = stream;
      $("remotePlaceholder").style.display = "none";

      setCallState("YOU ARE TOGETHER ♡");
      setStatus("Video call connected", true);
    });

    currentCall.on("close", resetRemote);

    currentCall.on("error", error => {
      console.error(error);
      resetRemote();
    });

    setCallState("CALLING YOUR PERSON...");

  } catch (error) {
    console.error(error);

    alert(
      "Could not join the room. Check the room code and try again."
    );

    $("joinBtn").disabled = false;

  } finally {
    busy = false;
  }
}

// COPY ROOM CODE

$("copyBtn").addEventListener("click", async () => {
  const code = $("myCodeLabel").textContent.replace(
    "ROOM CODE: ",
    ""
  );

  try {
    await navigator.clipboard.writeText(code);

    $("copyBtn").textContent = "Copied ✓";

    setTimeout(() => {
      $("copyBtn").textContent = "Copy code";
    }, 2000);

  } catch (error) {
    alert("Please copy the room code manually.");
  }
});

// MICROPHONE

$("micBtn").addEventListener("click", () => {
  if (!localStream) return;

  micOn = !micOn;

  localStream.getAudioTracks().forEach(track => {
    track.enabled = micOn;
  });

  $("micBtn").classList.toggle("active", !micOn);

  $("micBtn").querySelector("small").textContent =
    micOn ? "Mute" : "Unmute";
});

// CAMERA

$("cameraBtn").addEventListener("click", () => {
  if (!localStream) return;

  cameraOn = !cameraOn;

  localStream.getVideoTracks().forEach(track => {
    track.enabled = cameraOn;
  });

  $("localPlaceholder").style.display =
    cameraOn ? "none" : "flex";

  $("cameraBtn").classList.toggle("active", !cameraOn);

  $("cameraBtn").querySelector("small").textContent =
    cameraOn ? "Camera off" : "Camera on";
});

// SCREEN SHARE + MOVIE THEATRE MODE
function sendScreenShareState(active) {
  if (dataConn && dataConn.open) {
    dataConn.send({ type: "screen-share-state", active: !!active });
  }
}

async function stopScreenShare() {
  if (!screenStream) return;

  const videoSender = currentCall?.peerConnection
    .getSenders()
    .find(item => item.track?.kind === "video");
  const audioSender = currentCall?.peerConnection
    .getSenders()
    .find(item => item.track?.kind === "audio");

  if (videoSender && originalVideoTrack) {
    await videoSender.replaceTrack(originalVideoTrack);
  }
  if (audioSender && originalAudioTrack) {
    await audioSender.replaceTrack(originalAudioTrack);
  }

  sendScreenShareState(false);
  isScreenSharing = false;

  screenStream.getTracks().forEach(track => track.stop());
  screenStream = null;

  if (screenAudioContext) {
    await screenAudioContext.close().catch(() => {});
    screenAudioContext = null;
  }
  if (mixedAudioTrack) {
    mixedAudioTrack.stop();
    mixedAudioTrack = null;
  }
  originalAudioTrack = null;

  $("localVideo").srcObject = localStream;
  $("shareBtn").querySelector("small").textContent = "Share screen";
  setTheatreMode(false);
}

$("shareBtn").addEventListener("click", async () => {
  if (!currentCall) {
    alert("Connect with your partner first.");
    return;
  }

  try {
    if (screenStream) {
      await stopScreenShare();
      return;
    }

    // Request tab/system audio too, so the movie and microphone can be heard together.
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    const screenTrack = screenStream.getVideoTracks()[0];
    const videoSender = currentCall.peerConnection
      .getSenders()
      .find(item => item.track?.kind === "video");

    if (!screenTrack || !videoSender) {
      throw new Error("Could not find the screen video track.");
    }

    await videoSender.replaceTrack(screenTrack);

    // Mix captured movie/tab audio with the microphone into the existing call audio track.
    const capturedAudioTrack = screenStream.getAudioTracks()[0];
    const microphoneTrack = localStream?.getAudioTracks()[0];
    const audioSender = currentCall.peerConnection
      .getSenders()
      .find(item => item.track?.kind === "audio");

    if (capturedAudioTrack && microphoneTrack && audioSender) {
      screenAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      await screenAudioContext.resume();

      const destination = screenAudioContext.createMediaStreamDestination();
      const micSource = screenAudioContext.createMediaStreamSource(
        new MediaStream([microphoneTrack])
      );
      const movieSource = screenAudioContext.createMediaStreamSource(
        new MediaStream([capturedAudioTrack])
      );

      micSource.connect(destination);
      movieSource.connect(destination);

      originalAudioTrack = microphoneTrack;
      mixedAudioTrack = destination.stream.getAudioTracks()[0];
      await audioSender.replaceTrack(mixedAudioTrack);
    }

    $("localVideo").srcObject = screenStream;
    $("shareBtn").querySelector("small").textContent = "Stop sharing";
    isScreenSharing = true;
    setTheatreMode(true, "local");
    sendScreenShareState(true);

    screenTrack.onended = () => {
      stopScreenShare().catch(error => console.warn("Stop screen share:", error));
    };

    if (!capturedAudioTrack) {
      movieSay("Screen is shared. If you want your partner to hear the movie, share a Chrome tab and enable Share tab audio.");
    }
  } catch (error) {
    console.warn("Screen sharing:", error);
    const videoSender = currentCall?.peerConnection
      .getSenders()
      .find(item => item.track?.kind === "video");
    const audioSender = currentCall?.peerConnection
      .getSenders()
      .find(item => item.track?.kind === "audio");

    if (videoSender && originalVideoTrack) {
      await videoSender.replaceTrack(originalVideoTrack).catch(() => {});
    }
    if (audioSender && originalAudioTrack) {
      await audioSender.replaceTrack(originalAudioTrack).catch(() => {});
    }
    if (screenStream) {
      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;
    }
    if (screenAudioContext) {
      await screenAudioContext.close().catch(() => {});
      screenAudioContext = null;
    }
    if (mixedAudioTrack) {
      mixedAudioTrack.stop();
      mixedAudioTrack = null;
    }
    originalAudioTrack = null;
    isScreenSharing = false;
    $("localVideo").srcObject = localStream;
    $("shareBtn").querySelector("small").textContent = "Share screen";
    setTheatreMode(false);
    setRoleStatus("Screen share မအောင်မြင်ပါ။ Browser permission ကို Allow လုပ်ပြီး ထပ်စမ်းပါ။");
  }
});

// CHAT

$("chatForm").addEventListener("submit", event => {
  event.preventDefault();

  const input = $("chatInput");
  const text = input.value.trim();

  if (!text) return;

  if (!dataConn || !dataConn.open) {
    alert("Connect with your partner before sending a message.");
    return;
  }

  const name = $("nickname").value.trim() || "You";

  dataConn.send({
    type: "chat",
    text,
    name
  });

  addMessage(text, true);

  input.value = "";
});

// RESET REMOTE VIDEO

function resetRemote() {
  setTheatreMode(false);
  $("remoteVideo").srcObject = null;

  $("remotePlaceholder").style.display = "flex";

  setCallState("WAITING TO CONNECT");
}

// END CALL — keep the YE/MYAT identity and PeerJS registration alive.
$("endBtn").addEventListener("click", async () => {
  if (screenStream) {
    try { await stopScreenShare(); } catch (error) { console.warn(error); }
  }
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  originalVideoTrack = null;
  micOn = true;
  cameraOn = true;
  $("localVideo").srcObject = null;
  $("localPlaceholder").style.display = "flex";
  resetRemote();
  ["micBtn","cameraBtn","shareBtn","endBtn"].forEach(id => {
    $(id).disabled = true;
    $(id).classList.remove("active");
  });
  $("micBtn").querySelector("small").textContent = "Mute";
  $("cameraBtn").querySelector("small").textContent = "Camera off";
  $("shareBtn").querySelector("small").textContent = "Share screen";
  setStatus("Call ended — your side is still online");
  setRoleStatus(mySide ? mySide + " side is online ♡ Call again whenever you like." : "Choose YE or MYAT.");
});

// INITIAL EVENTS

$("createBtn").addEventListener("click", createRoom);
$("joinBtn").addEventListener("click", joinRoom);
$("chatInput").disabled = true;


/* =========================
   V2: MOVIE UPLOAD + WATCH TOGETHER
   Transfers a temporary video copy over the existing PeerJS data connection.
   ========================= */
const moviePlayer = $("moviePlayer");
const movieInput = $("movieFile");
const movieStatus = $("movieStatus");
const movieProgress = $("movieProgress");
const movieProgressBar = $("movieProgressBar");
let movieSyncLock = false;
let incomingMovie = null;
let movieObjectUrl = null;
const MOVIE_CHUNK_SIZE = 16 * 1024;
const MOVIE_MAX_SIZE = 250 * 1024 * 1024;

function movieSay(message) {
  if (movieStatus) movieStatus.textContent = message;
}

function movieLoad(blob, name) {
  if (movieObjectUrl) URL.revokeObjectURL(movieObjectUrl);
  movieObjectUrl = URL.createObjectURL(blob);
  moviePlayer.src = movieObjectUrl;
  $("movieFileName").textContent = name || "Shared movie";
  movieSay("Movie ready ♡ Press play when you're ready.");
}

$("movieChooseBtn").addEventListener("click", () => movieInput.click());

movieInput.addEventListener("change", async () => {
  const file = movieInput.files && movieInput.files[0];
  if (!file) return;
  if (!(file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name))) {
    movieSay("Please choose a supported video file (MP4, WebM, MOV or M4V).");
    movieInput.value = "";
    return;
  }
  if (file.size > MOVIE_MAX_SIZE) {
    movieSay("This V2 version supports files up to 250 MB.");
    movieInput.value = "";
    return;
  }
  movieLoad(file, file.name);
  if (!dataConn || !dataConn.open) {
    movieSay("Movie loaded on this device. Connect to your partner to send it to them.");
    return;
  }
  try {
    $("movieChooseBtn").disabled = true;
    movieProgress.hidden = false;
    movieProgressBar.style.width = "0%";
    const total = Math.ceil(file.size / MOVIE_CHUNK_SIZE);
    dataConn.send({type:"movie-start", name:file.name, mime:file.type || "video/mp4", size:file.size, total});
    for (let i=0;i<total;i++) {
      if (!dataConn || !dataConn.open) throw new Error("Connection closed during transfer.");
      // Backpressure prevents queuing the entire movie in browser memory.
      while (dataConn && dataConn.open && dataConn.dataChannel &&
             dataConn.dataChannel.bufferedAmount > 512 * 1024) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!dataConn || !dataConn.open) throw new Error("Connection closed during transfer.");
      const chunk = file.slice(i*MOVIE_CHUNK_SIZE, Math.min(file.size,(i+1)*MOVIE_CHUNK_SIZE));
      dataConn.send(chunk);
      movieProgressBar.style.width = Math.round(((i+1)/total)*100)+"%";
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
  if (data && typeof data === "object" && data.type === "screen-share-state") {
    setTheatreMode(!!data.active, "remote");
    return;
  }
  if (data && typeof data === "object" && data.type === "movie-start") {
    incomingMovie = {name:data.name || "Shared movie", mime:data.mime || "video/mp4", size:data.size, total:data.total, chunks:[], received:0};
    movieProgress.hidden = false;
    movieProgressBar.style.width = "0%";
    movieSay("Receiving " + incomingMovie.name + "…");
    return;
  }
  if (data && typeof data === "object" && data.type === "movie-end") {
    if (!incomingMovie) return;
    const movie = incomingMovie;
    incomingMovie = null;
    const blob = new Blob(movie.chunks, {type:movie.mime});
    movieLoad(blob, movie.name);
    movieProgressBar.style.width = "100%";
    movieSay("Movie received successfully ♡ Press play to watch together.");
    return;
  }
  if (data && typeof data === "object" && data.type === "movie-sync") {
    if (!moviePlayer.src) return;
    movieSyncLock = true;
    if (Number.isFinite(data.time)) {
      const drift = Math.abs((moviePlayer.currentTime || 0) - data.time);
      if (drift > 0.8) moviePlayer.currentTime = data.time;
    }
    if (data.action === "play") moviePlayer.play().catch(() => movieSay("Tap play once to allow movie playback."));
    if (data.action === "pause") moviePlayer.pause();
    setTimeout(() => { movieSyncLock = false; }, 250);
    return;
  }
  if (data instanceof Blob || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    if (!incomingMovie) return;
    const part = data instanceof Blob ? data : new Blob([data]);
    incomingMovie.chunks.push(part);
    incomingMovie.received += part.size;
    movieProgressBar.style.width = Math.min(99,Math.round(incomingMovie.received/incomingMovie.size*100))+"%";
  }
}

// Add a second data listener without disturbing the existing chat listener.
const attachConnectionV2 = attachConnection;
attachConnection = function(conn) {
  attachConnectionV2(conn);
  conn.on("data", handleMovieData);
};

function sendMovieSync(action) {
  if (movieSyncLock || !dataConn || !dataConn.open || !moviePlayer.src) return;
  dataConn.send({type:"movie-sync", action, time:moviePlayer.currentTime || 0});
}
moviePlayer.addEventListener("play", () => sendMovieSync("play"));
moviePlayer.addEventListener("pause", () => sendMovieSync("pause"));
moviePlayer.addEventListener("seeked", () => sendMovieSync("seek"));


/* V2.1 — Fixed YE / MYAT identities; no room code */
const YE_PEER_ID = "ye-tomvyse2024-love";
const MYAT_PEER_ID = "myat-tomvyse2024-love";
let mySide = null;
let partnerPeerId = null;
let dataRetryTimer = null;

function setRoleStatus(message) {
  const el = $("roleStatus");
  if (el) el.textContent = message;
}

function updateRoleButtons() {
  $("chooseYeBtn").classList.toggle("selected", mySide === "YE");
  $("chooseMyatBtn").classList.toggle("selected", mySide === "MYAT");
  $("callPartnerBtn").disabled = !peer || !peer.open || !partnerPeerId;
}

function tryDataConnection() {
  // YE alone initiates the data channel; MYAT waits for the incoming connection.
  if (mySide !== "YE" || !peer || !peer.open || !partnerPeerId) return;
  if (dataConn) return;
  const conn = peer.connect(partnerPeerId, {reliable:true});
  attachConnection(conn);
  conn.on("open", () => setRoleStatus("Partner connected ♡ You can chat and share a movie."));
  conn.on("error", err => {
    console.warn("Auto data connection:", err);
    if (dataConn === conn) dataConn = null;
  });
}

async function selectSide(side) {
  if (busy) return;
  if (peer && peer.open && mySide === side) {
    setRoleStatus(side + " side is ready. Waiting for your partner…");
    return;
  }
  if (currentCall) {
    try { currentCall.close(); } catch (_) {}
    currentCall = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }
  if (dataConn) {
    try { dataConn.close(); } catch (_) {}
    dataConn = null;
  }
  if (peer) {
    try { peer.destroy(); } catch (_) {}
    peer = null;
  }
  if (dataRetryTimer) clearInterval(dataRetryTimer);
  mySide = side;
  partnerPeerId = side === "YE" ? MYAT_PEER_ID : YE_PEER_ID;
  localStorage.setItem("ldr-side", side);
  updateRoleButtons();
  setRoleStatus("Starting " + side + " side… camera and microphone will stay off until a call.");
  busy = true;
  try {
    const myPeerId = side === "YE" ? YE_PEER_ID : MYAT_PEER_ID;
    await setupPeer(myPeerId);
    setRoleStatus(side + " side is online ♡ Camera and microphone are off until you call.");
    updateRoleButtons();
    // Re-attempt the data channel when the other person comes online.
    dataRetryTimer = setInterval(tryDataConnection, 5000);
    tryDataConnection();
    $("createBtn").disabled = true;
    $("joinBtn").disabled = true;
  } catch (err) {
    console.error(err);
    setRoleStatus("Could not start. This fixed ID may be busy, or camera/mic permission was denied. Try again.");
    if (peer) { peer.destroy(); peer = null; }
    $("callPartnerBtn").disabled = true;
  } finally {
    busy = false;
  }
}

$("chooseYeBtn").addEventListener("click", () => selectSide("YE"));
$("chooseMyatBtn").addEventListener("click", () => selectSide("MYAT"));
$("changeSideBtn").addEventListener("click", () => {
  if (currentCall) currentCall.close();
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  if (screenStream) screenStream.getTracks().forEach(track => track.stop());
  screenStream = null;
  if (screenAudioContext) {
    screenAudioContext.close().catch(() => {});
    screenAudioContext = null;
  }
  if (mixedAudioTrack) {
    mixedAudioTrack.stop();
    mixedAudioTrack = null;
  }
  originalAudioTrack = null;
  isScreenSharing = false;
  setTheatreMode(false);
  if (dataConn) dataConn.close();
  if (peer) peer.destroy();
  if (dataRetryTimer) clearInterval(dataRetryTimer);
  peer = null; currentCall = null; dataConn = null; mySide = null; partnerPeerId = null;
  localStorage.removeItem("ldr-side");
  $("callPartnerBtn").disabled = true;
  setRoleStatus("Choose YE or MYAT to connect to your own side.");
  updateRoleButtons();
});
$("callPartnerBtn").addEventListener("click", async () => {
  if (!peer || !peer.open || !partnerPeerId) {
    setRoleStatus("Choose your side first.");
    return;
  }
  try {
    setRoleStatus("Turning on camera and microphone for your call…");
    const stream = await getMedia();
    if (currentCall && currentCall.open) currentCall.close();
    currentCall = peer.call(partnerPeerId, stream);
    if (!currentCall) throw new Error("Call could not be started.");
    setCallState("CALLING YOUR PERSON…");
    setRoleStatus("Calling " + (mySide === "YE" ? "MYAT" : "YE") + "…");
    currentCall.on("stream", stream => {
      enableControls();
      $("remoteVideo").srcObject = stream;
      $("remotePlaceholder").style.display = "none";
      setCallState("YOU ARE TOGETHER ♡");
      setStatus("Video call connected", true);
      setRoleStatus("Connected with your person ♡");
    });
    currentCall.on("close", resetRemote);
    currentCall.on("error", err => { console.warn(err); resetRemote(); setRoleStatus("Call ended. You can call again."); });
  } catch (err) {
    console.error(err);
    setRoleStatus("Partner may be offline. Ask them to open the website and choose their side.");
  }
});

// Restore the selected identity on the next visit, but always require a user tap
// to re-enable camera/microphone and register the browser with PeerJS.
const savedSide = localStorage.getItem("ldr-side");
if (savedSide === "YE" || savedSide === "MYAT") {
  mySide = savedSide;
  partnerPeerId = savedSide === "YE" ? MYAT_PEER_ID : YE_PEER_ID;
  setRoleStatus("Restoring your " + savedSide + " side automatically…");
  updateRoleButtons();
  // Re-register the saved identity on page load. Camera/mic are requested
  // only when a call arrives or the user starts a call.
  setupPeer(savedSide === "YE" ? YE_PEER_ID : MYAT_PEER_ID).then(() => {
    setRoleStatus(savedSide + " side is online ♡ Waiting for your person…");
    updateRoleButtons();
    dataRetryTimer = setInterval(tryDataConnection, 5000);
    tryDataConnection();
  }).catch(err => {
    console.warn("Could not restore saved side:", err);
    setRoleStatus("Tap your " + savedSide + " button to reconnect.");
  });
}
