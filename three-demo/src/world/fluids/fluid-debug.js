let fluidDebugEnabled = false;

const parseBoolean = (value) => {
  if (value == null || value === '') {
    return true;
  }
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'on', 'yes', 'enable', 'enabled'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'off', 'no', 'disable', 'disabled'].includes(normalized)) {
    return false;
  }
  return Boolean(value);
};

const persistPreference = (enabled) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage?.setItem('fluidDebug', enabled ? 'true' : 'false');
  } catch (error) {
    console.warn('[browser] [fluid debug] failed to persist debug flag', error);
  }
};

export const isFluidDebugEnabled = () => fluidDebugEnabled;

export const setFluidDebugEnabled = (enabled, { persist = true } = {}) => {
  fluidDebugEnabled = Boolean(enabled);
  if (persist) {
    persistPreference(fluidDebugEnabled);
  }
  return fluidDebugEnabled;
};

const readQueryPreference = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('fluidDebug')) {
      return null;
    }
    return parseBoolean(params.get('fluidDebug'));
  } catch (error) {
    console.warn('[browser] [fluid debug] failed to resolve query flag', error);
    return null;
  }
};

const readStoredPreference = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const stored = window.localStorage?.getItem('fluidDebug');
    if (stored == null) {
      return null;
    }
    return parseBoolean(stored);
  } catch (error) {
    console.warn('[browser] [fluid debug] failed to resolve stored flag', error);
    return null;
  }
};

export const initializeFluidDebug = ({
  defaultEnabled = false,
  persistDefault = false,
  forceDefault = false,
} = {}) => {
  const fromQuery = readQueryPreference();
  if (fromQuery != null) {
    return setFluidDebugEnabled(fromQuery, { persist: false });
  }

  if (!forceDefault) {
    const fromStorage = readStoredPreference();
    if (fromStorage != null) {
      return setFluidDebugEnabled(fromStorage, { persist: false });
    }
  }

  return setFluidDebugEnabled(defaultEnabled, { persist: persistDefault });
};

initializeFluidDebug();

export const enableFluidDebug = (options) =>
  setFluidDebugEnabled(true, options);

export const disableFluidDebug = (options) =>
  setFluidDebugEnabled(false, options);

export const logFluidDebug = (...args) => {
  if (!fluidDebugEnabled) {
    return;
  }
  console.log('[browser] [fluid debug]', ...args);
};
