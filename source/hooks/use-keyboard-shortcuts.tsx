import React, { createContext, useContext } from 'react';
import { useInput } from 'ink';
import {
	actions,
	defaultKeybindings,
	matchesKey,
	type Action,
	type ResolvedKeybindings,
} from '../keybindings.js';

export type ShortcutHandlers = Partial<Record<Action, () => void>>;

const KeybindingsContext = createContext<ResolvedKeybindings | undefined>(
	undefined,
);

type ProviderProps = {
	readonly keybindings: ResolvedKeybindings;
	readonly children: React.ReactNode;
};

/** Makes the resolved key bindings available to every shortcut hook below. */
export function KeyboardProvider({ keybindings, children }: ProviderProps) {
	return (
		<KeybindingsContext.Provider value={keybindings}>
			{children}
		</KeybindingsContext.Provider>
	);
}

export type ShortcutOptions = {
	/** When false the handlers are ignored, e.g. while an overlay owns input. */
	readonly isActive?: boolean;
};

/**
 * Bind the given handlers to their configured keys.
 *
 * Each call installs its own input listener; handlers for different actions
 * can therefore live next to the component they belong to while the key
 * definitions stay centralised in `keybindings.ts`.
 */
export const useKeyboardShortcuts = (
	handlers: ShortcutHandlers,
	options: ShortcutOptions = {},
): void => {
	const keybindings = useContext(KeybindingsContext) ?? defaultKeybindings;

	useInput(
		(input, key) => {
			for (const action of actions) {
				const handler = handlers[action];
				if (handler === undefined) {
					continue;
				}

				const bound = keybindings[action];
				if (bound.some(descriptor => matchesKey(descriptor, input, key))) {
					handler();
					return;
				}
			}
		},
		{ isActive: options.isActive },
	);
};
