const RENDER_MODES = {
  HYDRA: 'hydra',
  BLOCKS: 'blocks',
};

const listeners = new Set();

function clampMode(mode) {
  if (!mode) {
    return RENDER_MODES.HYDRA;
  }
  const normalized = String(mode).toLowerCase();
  return normalized === RENDER_MODES.BLOCKS ? RENDER_MODES.BLOCKS : RENDER_MODES.HYDRA;
}

function resolveInitialMode() {
  if (typeof window === 'undefined') {
    return RENDER_MODES.HYDRA;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.has('fluidBlocks')) {
    return RENDER_MODES.BLOCKS;
  }
  try {
    const stored = window.localStorage?.getItem('fluidRender');
    if (stored === RENDER_MODES.BLOCKS) {
      return RENDER_MODES.BLOCKS;
    }
  } catch (error) {
    console.warn('Failed to read fluid render preference from storage.', error);
  }
  return RENDER_MODES.HYDRA;
}

let renderMode = resolveInitialMode();

export function getFluidRenderMode() {
  return renderMode;
}

export function setFluidRenderMode(mode, { persist = true } = {}) {
  const nextMode = clampMode(mode);
  if (renderMode === nextMode) {
    return renderMode;
  }
  renderMode = nextMode;
  if (typeof window !== 'undefined' && persist) {
    try {
      window.localStorage?.setItem('fluidRender', renderMode);
    } catch (error) {
      console.warn('Failed to persist fluid render preference.', error);
    }
  }
  listeners.forEach((listener) => {
    try {
      listener(renderMode);
    } catch (error) {
      console.error('Fluid render mode listener failed:', error);
    }
  });
  return renderMode;
}

export function shouldRenderFluidsAsBlocks() {
  return renderMode === RENDER_MODES.BLOCKS;
}

export function onFluidRenderModeChange(listener) {
  if (typeof listener !== 'function') {
    throw new Error('onFluidRenderModeChange expects a function listener.');
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export { RENDER_MODES as FLUID_RENDER_MODES };
