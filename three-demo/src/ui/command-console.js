const DEFAULT_OPTIONS = {
  openKey: 'Backquote',
  commandPrefix: '/',
  historyLimit: 64,
  logLimit: 200,
  placeholder: 'Enter command…',
  onToggle: () => {},
};

const TRUE_WORDS = new Set(['on', '1', 'true', 'enable', 'enabled', 'yes']);
const FALSE_WORDS = new Set(['off', '0', 'false', 'disable', 'disabled', 'no']);

function createElement(tag, className) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  return element;
}

function tokenize(input) {
  const tokens = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuote) {
      if (char === '\\' && i + 1 < input.length) {
        current += input[i + 1];
        i += 1;
        continue;
      }
      if (char === quoteChar) {
        inQuote = false;
        quoteChar = '';
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    if (char === ' ') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (inQuote) {
    throw new Error('Unterminated quote in command input.');
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function resolveToggleValue(value, current) {
  if (value === undefined) {
    return !current;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return !current;
  }
  if (TRUE_WORDS.has(normalized)) {
    return true;
  }
  if (FALSE_WORDS.has(normalized)) {
    return false;
  }
  if (normalized === 'toggle') {
    return !current;
  }
  throw new Error('Expected ON or OFF (also accepts 1/0, true/false).');
}

export function createCommandConsole(options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const commandMap = new Map();
  const aliasMap = new Map();
  const history = [];
  let historyIndex = -1;
  let isOpen = false;

  const container = createElement('div', 'command-console hidden');
  const logElement = createElement('div', 'command-console-log');
  const form = createElement('form', 'command-console-form');
  const input = createElement('input', 'command-console-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = settings.placeholder;
  form.appendChild(input);
  container.appendChild(logElement);
  container.appendChild(form);
  document.body.appendChild(container);

  function appendLog(message, level = 'info') {
    const entry = createElement('div', `command-console-entry level-${level}`);
    entry.textContent = message;
    logElement.appendChild(entry);
    while (logElement.children.length > settings.logLimit) {
      logElement.removeChild(logElement.firstChild);
    }
    logElement.scrollTop = logElement.scrollHeight;
  }

  function clearHistoryNavigation() {
    historyIndex = -1;
  }

  function setOpen(next) {
    if (isOpen === next) {
      return;
    }
    isOpen = next;
    container.classList.toggle('hidden', !isOpen);
    container.classList.toggle('visible', isOpen);
    if (isOpen) {
      input.value = '';
      window.setTimeout(() => input.focus(), 0);
    } else {
      input.blur();
      clearHistoryNavigation();
    }
    try {
      settings.onToggle(isOpen);
    } catch (error) {
      console.error('Error while handling command console toggle:', error);
    }
  }

  function toggleOpen() {
    setOpen(!isOpen);
  }

  function normalizeCommandName(name) {
    return String(name).trim().toLowerCase();
  }

  function registerCommand(definition) {
    if (!definition || !definition.name || typeof definition.handler !== 'function') {
      throw new Error('Invalid command definition. Expected a name and handler.');
    }
    const normalized = normalizeCommandName(definition.name);
    const entry = {
      ...definition,
      name: normalized,
      description: definition.description ?? '',
      usage: definition.usage ?? `/${normalized}`,
    };
    commandMap.set(normalized, entry);
    if (Array.isArray(definition.aliases)) {
      definition.aliases.forEach((alias) => {
        const aliasName = normalizeCommandName(alias);
        aliasMap.set(aliasName, normalized);
      });
    }
    return () => {
      commandMap.delete(normalized);
      if (Array.isArray(definition.aliases)) {
        definition.aliases.forEach((alias) => {
          aliasMap.delete(normalizeCommandName(alias));
        });
      }
    };
  }

  function findCommand(name) {
    const normalized = normalizeCommandName(name);
    if (commandMap.has(normalized)) {
      return commandMap.get(normalized);
    }
    const resolved = aliasMap.get(normalized);
    if (resolved && commandMap.has(resolved)) {
      return commandMap.get(resolved);
    }
    return null;
  }

  function listCommands() {
    return Array.from(commandMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  function executeCommand(rawInput) {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return;
    }
    if (!trimmed.startsWith(settings.commandPrefix)) {
      appendLog(`Commands must start with "${settings.commandPrefix}".`, 'error');
      return;
    }

    let tokens;
    try {
      tokens = tokenize(trimmed.slice(settings.commandPrefix.length));
    } catch (error) {
      appendLog(error instanceof Error ? error.message : String(error), 'error');
      return;
    }

    if (tokens.length === 0) {
      appendLog('No command provided.', 'error');
      return;
    }

    const [commandName, ...args] = tokens;
    const command = findCommand(commandName);
    if (!command) {
      appendLog(`Unknown command: ${commandName}. Type /help for a list of commands.`, 'error');
      return;
    }

    const context = {
      args,
      rawInput: trimmed,
      command,
      toggle: (value, current) => resolveToggleValue(value, current),
      print: (message) => appendLog(message, 'info'),
      info: (message) => appendLog(message, 'info'),
      success: (message) => appendLog(message, 'success'),
      warn: (message) => appendLog(message, 'warn'),
      error: (message) => appendLog(message, 'error'),
      listCommands,
      execute: executeCommand,
    };

    try {
      const result = command.handler(context);
      if (typeof result === 'string' && result.trim()) {
        appendLog(result, 'success');
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Command execution failed.';
      appendLog(message, 'error');
      console.error(`Command "${command.name}" failed:`, error);
    }
  }

  function handleDocumentKeydown(event) {
    if (event.code === settings.openKey && !event.repeat) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {

        if (!isOpen) {
          // Allow typing the character in other fields when the console is closed.
          return;
        }
        // When the console is focused, let the key press type normally without
        // toggling the overlay.

        return;
      }
      event.preventDefault();
      toggleOpen();
      return;
    }
    if (isOpen && event.code === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    const value = input.value;
    setOpen(false);
    if (value.trim()) {
      history.unshift(value);
      if (history.length > settings.historyLimit) {
        history.length = settings.historyLimit;
      }
      executeCommand(value);
    }
    input.value = '';
  }

  function handleInputKeydown(event) {

    if (event.code === settings.openKey && !event.repeat) {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.code === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.code === 'ArrowUp') {
      event.preventDefault();
      if (history.length === 0) {
        return;
      }
      if (historyIndex + 1 < history.length) {
        historyIndex += 1;
      }
      input.value = history[historyIndex] ?? '';
      window.setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
      return;
    }
    if (event.code === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex > 0) {
        historyIndex -= 1;
      } else {
        historyIndex = -1;
      }
      input.value = historyIndex === -1 ? '' : history[historyIndex];
      window.setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
    }
  }

  document.addEventListener('keydown', handleDocumentKeydown);
  form.addEventListener('submit', handleFormSubmit);
  input.addEventListener('keydown', handleInputKeydown);

  const dispose = () => {
    document.removeEventListener('keydown', handleDocumentKeydown);
    form.removeEventListener('submit', handleFormSubmit);
    input.removeEventListener('keydown', handleInputKeydown);
    container.remove();
  };

  registerCommand({
    name: 'help',
    description: 'List available commands or get help for a specific command.',
    usage: '/help [command]',
    handler: ({ args, info }) => {
      if (args.length === 0) {
        const entries = listCommands();
        if (entries.length === 0) {
          info('No commands registered.');
          return;
        }
        info('Available commands:');
        entries.forEach((entry) => {
          info(`/${entry.name} — ${entry.description || 'No description provided.'}`);
        });
        info('Use /help <command> for details about a specific command.');
        return;
      }

      const targetName = args[0];
      const entry = findCommand(targetName);
      if (!entry) {
        throw new Error(`No command named "${targetName}".`);
      }
      info(`/${entry.name}`);
      if (entry.description) {
        info(entry.description);
      }
      if (entry.usage) {
        info(`Usage: ${entry.usage}`);
      }
    },
  });

  return {
    registerCommand,
    registerCommands: (commands) => commands.forEach(registerCommand),
    executeCommand,
    open: () => setOpen(true),
    close: () => setOpen(false),
    isOpen: () => isOpen,
    dispose,
    log: appendLog,
  };
}

export const CommandConsoleUtils = {
  tokenize,
  resolveToggleValue,
};
