import { BRIDGE_CHANNEL, BRIDGE_VERSION, isBridgeMessage, originAllowed, } from "./protocol.js";
/**
 * Wire a transport to an iframe running the agent. Safe to create before the
 * frame has loaded — it buffers nothing but starts listening immediately and
 * connects when the agent says hello.
 */
export function createFrameTransport(iframe, opts = {}) {
    const targetOrigin = opts.targetOrigin ??
        (typeof location !== "undefined" ? location.origin : "*");
    const allowed = opts.allowedOrigins ?? (targetOrigin === "*" ? "*" : [targetOrigin]);
    let targets = [];
    let path = null;
    let ready = false;
    let seq = 0;
    const pending = new Map();
    const post = (msg) => {
        const win = iframe.contentWindow;
        if (!win)
            return;
        try {
            win.postMessage(msg, targetOrigin);
        }
        catch {
            /* frame not ready / cross-origin race */
        }
    };
    const onMessage = (ev) => {
        if (ev.source !== iframe.contentWindow)
            return;
        if (!originAllowed(ev.origin, allowed))
            return;
        const data = ev.data;
        if (!isBridgeMessage(data))
            return;
        const msg = data;
        if (msg.type === "hello") {
            ready = true;
            path = msg.path;
            opts.onReady?.(msg.path);
            // Pull a fresh catalog on connect.
            requestScan();
        }
        else if (msg.type === "targets") {
            targets = msg.targets;
            path = msg.path;
            opts.onTargets?.(msg.targets, msg.path);
        }
        else if (msg.type === "result") {
            const p = pending.get(msg.id);
            if (p) {
                window.clearTimeout(p.timer);
                pending.delete(msg.id);
                p.resolve({ ok: msg.ok, message: msg.message });
            }
        }
    };
    window.addEventListener("message", onMessage);
    const requestScan = () => post({ ch: BRIDGE_CHANNEL, v: BRIDGE_VERSION, type: "scan" });
    const act = (action, data) => new Promise((resolve) => {
        const id = ++seq;
        const timer = window.setTimeout(() => {
            pending.delete(id);
            resolve({ ok: false, message: "the page didn't respond in time" });
        }, opts.actTimeoutMs ?? 8000);
        pending.set(id, { resolve, timer });
        post({
            ch: BRIDGE_CHANNEL,
            v: BRIDGE_VERSION,
            type: "act",
            id,
            action,
            target: data.target,
            ...(data.value !== undefined ? { value: data.value } : {}),
        });
    });
    return {
        act,
        requestScan,
        getTargets: () => targets,
        getPath: () => path,
        isReady: () => ready,
        destroy: () => {
            window.removeEventListener("message", onMessage);
            for (const { timer } of pending.values())
                window.clearTimeout(timer);
            pending.clear();
        },
    };
}
//# sourceMappingURL=transport.js.map