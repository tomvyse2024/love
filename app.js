/* YE & MYAT — LDR Room V2
 * PeerJS provides signaling/peer connection. The fixed room ID is a convenience,
 * not strong authentication; do not use this room for sensitive conversations.
 */
const $ = id => document.getElementById(id);
const ROOM_PEER_ID = "ye-myat-ldr-v2-room";
const ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

let peer = null, localStream = null, currentCall = null, dataConn = null;
let screenStream = null, originalVideoTrack = null, mixedAudioTrack = null, audioContext = null;
let role = null, busy = false, micOn = true, cameraOn = true, movieId = null;

function status(message, connected = false) {
  $("statusText").textContent = message;
  $("statusDot").style.background = connected ? "#7ee0b0" : "#d3a6b8";
}
function callState(message) { $("callState").textContent = message; }
function send(payload) {
  if (dataConn && dataConn.open) dataConn.send(payload);
}
function setMovieButtons(enabled) {
  ["loadMovieBtn", "playMovieBtn", "pauseMovieBtn"].forEach(id => $(id).disabled = !enabled);
}
function addMessage(text, mine, name) {
  const box = $("messages"), empty = box.querySelector(".empty-chat");
  if (empty) empty.remove();
  const msg = document.createElement("div");
  msg.className = "msg" + (mine ? " mine" : "");
  const body = document.createElement("div"); body.textContent = text;
  const meta = document.createElement("small");
  meta.textContent = (mine ? "You" : name || "Partner") + " · " +
    new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
  msg.append(body, meta); box.appendChild(msg); box.scrollTop = box.scrollHeight;
}
function setButtons(connected) {
  ["micBtn","cameraBtn","shareBtn"].forEach(id => $(id).disabled = !connected);
  $("chatInput").disabled = !connected; $("sendBtn").disabled = !connected;
  $("leaveBtn").disabled = !role;
  setMovieButtons(connected);
}
async function getMedia() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera and microphone need HTTPS and a supported browser.");
  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
    originalVideoTrack = localStream.getVideoTracks()[0] || null;
    $("localVideo").srcObject = localStream;
    $("localPlaceholder").style.display = "none";
  }
  return localStream;
}
function attachData(conn) {
  dataConn = conn;
  conn.on("open", () => {
    status("Connected with " + (role === "YE" ? "MYAT" : "YE"), true);
    callState("YOU ARE TOGETHER ♡"); setButtons(true);
    if (movieId) send({type:"movie-load", id:movieId});
  });
  conn.on("data", data => {
    if (!data || typeof data !== "object") return;
    if (data.type === "chat") addMessage(String(data.text || ""), false, String(data.name || "Partner"));
    if (data.type === "movie-load") loadMovie(String(data.id || ""), false);
    if (data.type === "movie-play") movieCommand("playVideo", false);
    if (data.type === "movie-pause") movieCommand("pauseVideo", false);
  });
  conn.on("close", () => {
    dataConn = null; status("Partner disconnected"); callState("PARTNER LEFT");
    setButtons(false);
  });
  conn.on("error", err => console.warn("Data channel:", err));
}
function startPeer(asRole) {
  return new Promise((resolve, reject) => {
    if (!window.Peer) return reject(new Error("PeerJS did not load. Check your internet connection."));
    const opts = {debug:1, config:ICE_CONFIG};
    peer = asRole === "YE" ? new Peer(ROOM_PEER_ID, opts) : new Peer(undefined, opts);
    let settled = false;
    peer.on("open", id => { settled = true; resolve(id); });
    peer.on("error", err => {
      console.error("Peer error:", err);
      if (!settled) reject(err);
      else status("Connection issue: " + err.type);
    });
    peer.on("connection", conn => { attachData(conn); });
    peer.on("call", async call => {
      try {
        await getMedia(); currentCall = call; call.answer(localStream);
        watchCall(call);
      } catch (err) { console.error(err); alert("Please allow camera and microphone access, then rejoin."); }
    });
    peer.on("disconnected", () => status("Reconnecting to the call service…"));
    peer.on("close", () => status("Room connection closed"));
  });
}
function watchCall(call) {
  call.on("stream", stream => {
    $("remoteVideo").srcObject = stream; $("remotePlaceholder").style.display = "none";
    callState("YOU ARE TOGETHER ♡"); status("Video call connected", true); setButtons(true);
  });
  call.on("close", () => {
    $("remoteVideo").srcObject = null; $("remotePlaceholder").style.display = "flex";
    currentCall = null; callState("CALL ENDED");
  });
  call.on("error", err => { console.error(err); callState("CALL CONNECTION ISSUE"); });
}
async function join(asRole) {
  if (busy || role) return;
  busy = true; $("yeBtn").disabled = $("myatBtn").disabled = true;
  role = asRole; $("myRole").textContent = "Joining as " + role + "…";
  status("Preparing camera and microphone…");
  try {
    await getMedia();
    await startPeer(role);
    if (role === "YE") {
      $("myRole").textContent = "You are YE · waiting for MYAT";
      status("Room is ready — waiting for MYAT", true);
      callState("WAITING FOR MYAT");
    } else {
      $("myRole").textContent = "You are MYAT · connecting to YE";
      status("Calling YE…");
      const conn = peer.connect(ROOM_PEER_ID, {reliable:true});
      attachData(conn);
      conn.on("open", () => {
        const call = peer.call(ROOM_PEER_ID, localStream);
        if (call) { currentCall = call; watchCall(call); }
      });
      callState("CALLING YE…");
    }
    $("myRole").textContent = "You are " + role;
    $("leaveBtn").disabled = false;
  } catch (err) {
    console.error(err); role = null; status("Could not join the room");
    $("myRole").textContent = "Not connected — please try again";
    $("yeBtn").disabled = $("myatBtn").disabled = false;
    alert("Could not join: " + (err.message || "Please check your connection and camera permissions."));
    stopLocal();
  } finally { busy = false; }
}
function stopLocal() {
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  screenStream = null;
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  localStream = null; originalVideoTrack = null;
  if (audioContext) { audioContext.close().catch(()=>{}); audioContext = null; }
}
async function leave() {
  if (currentCall) currentCall.close();
  if (dataConn) dataConn.close();
  if (peer) peer.destroy();
  await stopSharing(); stopLocal();
  peer = dataConn = currentCall = null; role = null;
  $("localVideo").srcObject = $("remoteVideo").srcObject = null;
  $("localPlaceholder").style.display = $("remotePlaceholder").style.display = "flex";
  $("myRole").textContent = "Not connected yet"; callState("WAITING FOR YOU BOTH");
  status("A little room for two"); setButtons(false);
  $("yeBtn").disabled = $("myatBtn").disabled = false;
}
$("yeBtn").addEventListener("click", () => join("YE"));
$("myatBtn").addEventListener("click", () => join("MYAT"));
$("leaveBtn").addEventListener("click", leave);

$("micBtn").addEventListener("click", () => {
  if (!localStream) return;
  micOn = !micOn; localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  $("micBtn").classList.toggle("active", !micOn);
  $("micBtn").querySelector("small").textContent = micOn ? "Mute" : "Unmute";
});
$("cameraBtn").addEventListener("click", () => {
  if (!localStream) return;
  cameraOn = !cameraOn; localStream.getVideoTracks().forEach(t => t.enabled = cameraOn);
  $("localPlaceholder").style.display = cameraOn ? "none" : "flex";
  $("cameraBtn").classList.toggle("active", !cameraOn);
  $("cameraBtn").querySelector("small").textContent = cameraOn ? "Camera off" : "Camera on";
});

async function stopSharing() {
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  screenStream = null;
  if (currentCall?.peerConnection) {
    const senders = currentCall.peerConnection.getSenders();
    const videoSender = senders.find(s => s.track?.kind === "video");
    const audioSender = senders.find(s => s.track?.kind === "audio");
    if (videoSender && originalVideoTrack) await videoSender.replaceTrack(originalVideoTrack).catch(()=>{});
    if (audioSender && localStream?.getAudioTracks()[0]) await audioSender.replaceTrack(localStream.getAudioTracks()[0]).catch(()=>{});
  }
  if (audioContext) { await audioContext.close().catch(()=>{}); audioContext = null; }
  mixedAudioTrack = null;
  if (localStream) $("localVideo").srcObject = localStream;
  $("shareBtn").querySelector("small").textContent = "Share screen";
}
$("shareBtn").addEventListener("click", async () => {
  if (!currentCall || !navigator.mediaDevices?.getDisplayMedia) {
    alert("Screen sharing is available in supported desktop browsers. Connect to your partner first."); return;
  }
  if (screenStream) { await stopSharing(); return; }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({video:true, audio:true});
    const screenVideo = screenStream.getVideoTracks()[0];
    const pc = currentCall.peerConnection;
    const videoSender = pc.getSenders().find(s => s.track?.kind === "video");
    const audioSender = pc.getSenders().find(s => s.track?.kind === "audio");
    if (videoSender && screenVideo) await videoSender.replaceTrack(screenVideo);
    const screenAudio = screenStream.getAudioTracks()[0];
    if (screenAudio && audioSender && localStream.getAudioTracks()[0]) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const destination = audioContext.createMediaStreamDestination();
      const micSource = audioContext.createMediaStreamSource(new MediaStream([localStream.getAudioTracks()[0]]));
      const screenSource = audioContext.createMediaStreamSource(new MediaStream([screenAudio]));
      micSource.connect(destination); screenSource.connect(destination);
      mixedAudioTrack = destination.stream.getAudioTracks()[0];
      await audioSender.replaceTrack(mixedAudioTrack);
      $("shareNote").textContent = "Screen and tab audio are being shared. Choose a Chrome tab and enable Share tab audio.";
    } else {
      $("shareNote").textContent = "Screen is shared. No tab/system audio track was provided by the browser — choose a Chrome tab and enable Share tab audio.";
    }
    $("localVideo").srcObject = screenStream;
    $("shareBtn").querySelector("small").textContent = "Stop sharing";
    screenVideo.onended = () => stopSharing();
  } catch (err) {
    console.warn("Screen share:", err);
    if (screenStream) await stopSharing();
    if (err.name !== "NotAllowedError") alert("Screen sharing could not start: " + err.message);
  }
});

function youtubeId(value) {
  try {
    const url = new URL(value);
    if (url.hostname.endsWith("youtu.be")) return url.pathname.slice(1).split("/")[0];
    if (url.hostname.includes("youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      if (["embed","shorts","live"].includes(parts[0])) return parts[1] || null;
    }
  } catch {}
  return null;
}
function loadMovie(id, broadcast = true) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) return;
  movieId = id;
  $("moviePlaceholder").style.display = "none";
  $("movieFrame").src = "https://www.youtube.com/embed/" + encodeURIComponent(id) +
    "?enablejsapi=1&playsinline=1&origin=" + encodeURIComponent(location.origin);
  if (broadcast) send({type:"movie-load", id});
}
$("movieForm").addEventListener("submit", event => {
  event.preventDefault();
  const id = youtubeId($("movieUrl").value.trim());
  if (!id) { alert("Please paste a valid YouTube video link."); return; }
  loadMovie(id);
});
function movieCommand(command, broadcast = true) {
  if (!movieId) return;
  $("movieFrame").contentWindow?.postMessage(JSON.stringify({event:"command",func:command,args:[]}), "https://www.youtube.com");
  if (broadcast) send({type: command === "playVideo" ? "movie-play" : "movie-pause"});
}
$("playMovieBtn").addEventListener("click", () => movieCommand("playVideo"));
$("pauseMovieBtn").addEventListener("click", () => movieCommand("pauseVideo"));

$("chatForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("chatInput"), text = input.value.trim();
  if (!text) return;
  if (!dataConn?.open) { alert("Connect with your partner before sending a message."); return; }
  send({type:"chat", text, name:role || "Partner"});
  addMessage(text, true, role); input.value = "";
});
window.addEventListener("beforeunload", () => {
  if (peer) peer.destroy();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
});
setButtons(false);
