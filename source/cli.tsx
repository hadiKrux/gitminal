#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import App from './app.js';
import { loadKeybindings } from './keybindings.js';

render(<App keybindings={loadKeybindings()} />);
