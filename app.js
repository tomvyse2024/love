
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

function setupPeer() {
  return new Promise((resolve, reject) => {
    if (!window.Peer) {
      reject(new Error("PeerJS could not load."));
      return;
    }

    peer = new Peer(undefined, {
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
