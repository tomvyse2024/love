// TOM & LOVE — Multi-device presence worker
// Cloudflare Worker bindings:
//   KV namespace: PRESENCE
//   Secret: PAIRING_CODE (use the same pairing code as the notification worker)
// Deploy as: tom-love-presence
// KV stores only device presence metadata; no Firebase tokens or private keys.

const ALLOWED_ORIGIN = "https://tomvyse2024.github.io";
const DEVICE_TTL_SECONDS = 120;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" }
  });
}

async function readBody(request) {
  try { return await request.json(); } catch (_) { return {}; }
}

function validSide(side) {
  return side === "YE" || side === "MYAT";
}

async function authenticate(body, env) {
  return !!env.PAIRING_CODE &&
    typeof body.pairingCode === "string" &&
    body.pairingCode === env.PAIRING_CODE;
}

function deviceKey(side, deviceId) {
  return `device:${side}:${deviceId}`;
}

function sideKey(side) {
  return `side:${side}`;
}

async function getSideDevices(side, env) {
  const ids = await env.PRESENCE.get(sideKey(side), "json") || [];
  const devices = [];
  const activeIds = [];

  for (const id of ids) {
    const device = await env.PRESENCE.get(deviceKey(side, id), "json");
    if (device && device.peerId) {
      devices.push(device);
      activeIds.push(id);
    }
  }

  if (activeIds.length !== ids.length) {
    await env.PRESENCE.put(sideKey(side), JSON.stringify(activeIds));
  }
  return devices;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "TOM & LOVE Multi-Device Presence", version: "1.0.0" });
    }

    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!env.PRESENCE) return json({ error: "PRESENCE KV binding is missing" }, 500);

    const body = await readBody(request);
    if (!(await authenticate(body, env))) return json({ error: "Unauthorized" }, 401);

    // Generate short-lived TURN credentials. Long-lived TURN secrets stay in Worker Secrets.
    if (url.pathname === "/ice-servers") {
      if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) {
        return json({ error: "TURN_KEY_ID and TURN_API_TOKEN Worker secrets are not configured." }, 503);
      }

      try {
        const turnResponse = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.TURN_API_TOKEN}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ ttl: 86400 })
          }
        );

        const turnData = await turnResponse.json().catch(() => ({}));
        if (!turnResponse.ok) {
          console.error("Cloudflare TURN credential error:", turnResponse.status);
          return json({ error: `Cloudflare TURN credential generation failed (HTTP ${turnResponse.status}).` }, 502);
        }

        if (!Array.isArray(turnData.iceServers) || turnData.iceServers.length === 0) {
          return json({ error: "Cloudflare returned no ICE servers." }, 502);
        }

        return json({ ok: true, iceServers: turnData.iceServers, expiresIn: 86400 });
      } catch (error) {
        console.error("TURN credential request failed:", error);
        return json({ error: "Could not generate TURN credentials." }, 502);
      }
    }

    if (url.pathname === "/register") {
      const { side, deviceId, peerId, label } = body;
      if (!validSide(side) || !deviceId || !peerId) {
        return json({ error: "side, deviceId and peerId are required" }, 400);
      }
      const device = {
        side,
        deviceId: String(deviceId).slice(0, 80),
        peerId: String(peerId).slice(0, 120),
        label: String(label || "Device").slice(0, 100),
        lastSeen: Date.now()
      };
      await env.PRESENCE.put(deviceKey(side, device.deviceId), JSON.stringify(device), {
        expirationTtl: DEVICE_TTL_SECONDS
      });
      const ids = await env.PRESENCE.get(sideKey(side), "json") || [];
      if (!ids.includes(device.deviceId)) ids.push(device.deviceId);
      await env.PRESENCE.put(sideKey(side), JSON.stringify(ids));
      return json({ ok: true, device });
    }

    if (url.pathname === "/heartbeat") {
      const { side, deviceId } = body;
      if (!validSide(side) || !deviceId) return json({ error: "side and deviceId are required" }, 400);
      const key = deviceKey(side, String(deviceId));
      const device = await env.PRESENCE.get(key, "json");
      if (!device) return json({ ok: false, expired: true }, 404);
      device.lastSeen = Date.now();
      await env.PRESENCE.put(key, JSON.stringify(device), { expirationTtl: DEVICE_TTL_SECONDS });
      return json({ ok: true });
    }

    if (url.pathname === "/devices") {
      const side = body.side;
      if (!validSide(side)) return json({ error: "A valid side is required" }, 400);
      const devices = await getSideDevices(side, env);
      return json({ ok: true, side, devices });
    }

    if (url.pathname === "/unregister") {
      const { side, deviceId } = body;
      if (!validSide(side) || !deviceId) return json({ error: "side and deviceId are required" }, 400);
      await env.PRESENCE.delete(deviceKey(side, String(deviceId)));
      const ids = await env.PRESENCE.get(sideKey(side), "json") || [];
      await env.PRESENCE.put(sideKey(side), JSON.stringify(ids.filter(id => id !== String(deviceId))));
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  }
};
