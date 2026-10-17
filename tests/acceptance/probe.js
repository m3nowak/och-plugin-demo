// Injected into every frame by the acceptance tests. Inside Rat's Rail panel it
// records what the extension asks of the browser, so the tests can tell the
// extension's own animation loop apart from the browser throttling a hidden
// frame. It changes no behaviour.
(() => {
  if (!location.pathname.startsWith('/api/guests/rat/')) return;

  const probe = {
    requested: 0,
    fired: 0,
    cancelled: 0,
    pending: new Set(),
    maxCallbacksPerFrame: 0,
    draws: 0,
    contextRequests: 0,
    imageDecodes: 0,
  };
  const callbacksAt = new Map();

  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    probe.requested += 1;
    const id = request((time) => {
      probe.pending.delete(id);
      probe.fired += 1;
      // Two loops would both run in the same frame, with the same timestamp.
      const count = (callbacksAt.get(time) ?? 0) + 1;
      callbacksAt.set(time, count);
      if (callbacksAt.size > 500) callbacksAt.clear();
      probe.maxCallbacksPerFrame = Math.max(probe.maxCallbacksPerFrame, count);
      callback(time);
    });
    probe.pending.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (probe.pending.delete(id)) probe.cancelled += 1;
    cancel(id);
  };

  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const name of ['drawArrays', 'drawElements']) {
      const original = proto[name];
      proto[name] = function (...args) {
        probe.draws += 1;
        return original.apply(this, args);
      };
    }
  }

  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    probe.contextRequests += 1;
    return getContext.apply(this, args);
  };

  const decode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () {
    probe.imageDecodes += 1;
    return decode.call(this);
  };

  window.__ratProbe = probe;
})();
