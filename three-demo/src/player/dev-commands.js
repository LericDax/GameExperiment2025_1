export function registerDeveloperCommands({
  commandConsole,
  playerControls,
}) {
  if (!commandConsole) {
    throw new Error('registerDeveloperCommands requires a commandConsole instance.');
  }
  if (!playerControls) {
    throw new Error('registerDeveloperCommands requires playerControls.');
  }

  const { registerCommand } = commandConsole;

  registerCommand({
    name: 'godmode',
    description: 'Toggle invulnerability to damage.',
    usage: '/godmode [on|off|1|0|toggle]',
    handler: ({ args, toggle, success }) => {
      const next = toggle(args[0], playerControls.isGodModeEnabled());
      playerControls.setGodModeEnabled(next);
      success(`God mode ${next ? 'enabled' : 'disabled'}.`);
    },
  });

  registerCommand({
    name: 'fly',
    description: 'Toggle free-flight movement mode.',
    usage: '/fly [on|off|1|0|toggle]',
    handler: ({ args, toggle, success }) => {
      const next = toggle(args[0], playerControls.isFlightEnabled());
      playerControls.setFlightEnabled(next);
      success(`Flight mode ${next ? 'enabled' : 'disabled'}.`);
    },
  });

  registerCommand({
    name: 'unstuck',
    description: 'Attempt to move the player to the nearest safe location.',
    usage: '/unstuck',
    handler: ({ success, warn }) => {
      const resolved = playerControls.unstuck();
      if (resolved) {
        success('Attempted to move you to a nearby safe spot.');
      } else {
        warn('Unable to find a safe location. Try enabling flight or reloading.');
      }
    },
  });

  registerCommand({
    name: 'heal',
    description: 'Restore health to a specific value (defaults to full).',
    usage: '/heal [amount]',
    handler: ({ args, success }) => {
      const target = args.length > 0 ? args[0] : 100;
      const value = playerControls.setHealth(target);
      success(`Health set to ${Math.round(value)}.`);
    },
  });

  registerCommand({
    name: 'oxygen',
    description: 'Set the current oxygen level.',
    usage: '/oxygen [amount]',
    handler: ({ args, success }) => {
      const target =
        args.length > 0 ? args[0] : playerControls.getMaxOxygen();
      const value = playerControls.setOxygen(target);
      success(`Oxygen set to ${value.toFixed(1)}.`);
    },
  });

  registerCommand({
    name: 'whereami',
    description: 'Print the current player coordinates.',
    usage: '/whereami',
    handler: ({ success }) => {
      const position = playerControls.getPosition();
      success(
        `Position — X: ${position.x.toFixed(2)}, Y: ${position.y.toFixed(
          2,
        )}, Z: ${position.z.toFixed(2)}`,
      );
    },
  });

  registerCommand({
    name: 'status',
    description: 'Set or clear the HUD status message.',
    usage: '/status [message]',
    handler: ({ args, success }) => {
      if (args.length === 0) {
        playerControls.clearStatusMessage();
        success('Cleared status message.');
        return;
      }
      const message = args.join(' ');
      playerControls.setStatusMessage(message, 5);
      success('Updated status message.');
    },
  });
}
