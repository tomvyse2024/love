
const $ = id => document.getElementById(id);

let peer = null;
let localStream = null;
let currentCall = null;
let dataConn = null;
let screenStream = null;
let originalVideoTrack = null;

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

function enableControls() {
  [
    "micBtn",
    "cameraBtn",
    "shareBtn",
    "endBtn"
  ].forEach(id => {
    $(id).disabled = false;
  });

  $("chatInput").disabled = false;
  $("sendBtn").disabled = false;
}

function attachConnection(conn) {
  dataConn = conn;

  conn.on("open", () => {
    setStatus("Connected with your person", true);
    enableControls();
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
        await getMedia();

        currentCall = call;
        call.answer(localStream);

        call.on("stream", stream => {
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

// SCREEN SHARE

$("shareBtn").addEventListener("click", async () => {
  if (!currentCall) {
    alert("Connect with your partner first.");
    return;
  }

  try {
    const sender = currentCall.peerConnection
      .getSenders()
      .find(item => item.track?.kind === "video");

    if (screenStream) {
      if (sender && originalVideoTrack) {
        await sender.replaceTrack(originalVideoTrack);
      }

      screenStream.getTracks().forEach(track => track.stop());
      screenStream = null;

      $("localVideo").srcObject = localStream;
      $("shareBtn").querySelector("small").textContent = "Share screen";

      return;
    }

    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false
    });

    const screenTrack = screenStream.getVideoTracks()[0];

    if (sender) {
      await sender.replaceTrack(screenTrack);
    }

    $("localVideo").srcObject = screenStream;

    $("shareBtn").querySelector("small").textContent =
      "Stop sharing";

    screenTrack.onended = async () => {
      if (!screenStream) return;

      const videoSender = currentCall?.peerConnection
        .getSenders()
        .find(item => item.track?.kind === "video");

      if (videoSender && originalVideoTrack) {
        await videoSender.replaceTrack(originalVideoTrack);
      }

      screenStream.getTracks().forEach(track => track.stop());

      screenStream = null;

      $("localVideo").srcObject = localStream;

      $("shareBtn").querySelector("small").textContent =
        "Share screen";
    };

  } catch (error) {
    console.warn("Screen sharing:", error);
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
  $("remoteVideo").srcObject = null;

  $("remotePlaceholder").style.display = "flex";

  setCallState("WAITING TO CONNECT");
}

// LEAVE ROOM

$("endBtn").addEventListener("click", () => {
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }

  if (dataConn) {
    dataConn.close();
    dataConn = null;
  }

  if (peer) {
    peer.destroy();
    peer = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }

  originalVideoTrack = null;
  micOn = true;
  cameraOn = true;

  $("localVideo").srcObject = null;
  $("localPlaceholder").style.display = "flex";

  resetRemote();

  [
    "micBtn",
    "cameraBtn",
    "shareBtn",
    "endBtn"
  ].forEach(id => {
    $(id).disabled = true;
    $(id).classList.remove("active");
  });

  $("micBtn").querySelector("small").textContent = "Mute";
  $("cameraBtn").querySelector("small").textContent = "Camera off";
  $("shareBtn").querySelector("small").textContent = "Share screen";

  $("createBtn").disabled = false;
  $("joinBtn").disabled = false;
  $("createBtn").textContent = "Create a room";

  $("myCodeLabel").textContent =
    "Your room code will appear here.";

  $("copyBtn").disabled = true;

  $("chatInput").disabled = true;
  $("sendBtn").disabled = true;

  setStatus("You left the room");
  setCallState("WAITING TO CONNECT");
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
const MOVIE_CHUNK_SIZE = 64 * 1024;
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
      const chunk = file.slice(i*MOVIE_CHUNK_SIZE, Math.min(file.size,(i+1)*MOVIE_CHUNK_SIZE));
      dataConn.send(chunk);
      movieProgressBar.style.width = Math.round(((i+1)/total)*100)+"%";
      if (i % 8 === 0) await new Promise(resolve => setTimeout(resolve, 12));
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
  if (!peer || !peer.open || !partnerPeerId) return;
  if (dataConn) return;
  const conn = peer.connect(partnerPeerId, {reliable:true});
  attachConnection(conn);
  conn.on("open", () => setRoleStatus("Partner connected ♡ You can chat and share a movie."));
  conn.on("error", err => console.warn("Auto data connection:", err));
}

async function selectSide(side) {
  if (busy) return;
  if (peer && peer.open && mySide === side) {
    setRoleStatus(side + " side is ready. Waiting for your partner…");
    return;
  }
  if (peer) {
    try { peer.destroy(); } catch (_) {}
    peer = null;
  }
  if (dataRetryTimer) clearInterval(dataRetryTimer);
  dataConn = null;
  currentCall = null;
  mySide = side;
  partnerPeerId = side === "YE" ? MYAT_PEER_ID : YE_PEER_ID;
  localStorage.setItem("ldr-side", side);
  updateRoleButtons();
  setRoleStatus("Starting " + side + " side… allow camera and microphone if asked.");
  busy = true;
  try {
    await getMedia();
    const myPeerId = side === "YE" ? YE_PEER_ID : MYAT_PEER_ID;
    await setupPeer(myPeerId);
    setRoleStatus(side + " side is online ♡ Waiting for your partner…");
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
    if (currentCall && currentCall.open) currentCall.close();
    currentCall = peer.call(partnerPeerId, localStream);
    if (!currentCall) throw new Error("Call could not be started.");
    setCallState("CALLING YOUR PERSON…");
    setRoleStatus("Calling " + (mySide === "YE" ? "MYAT" : "YE") + "…");
    currentCall.on("stream", stream => {
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
