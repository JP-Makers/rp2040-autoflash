// src/output.js
// Shared VS Code output channel for RP2040 Auto Flash logs.

'use strict';

const vscode = require('vscode');

let _channel = null;

function showOutput() {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel('RP2040 Auto Flash');
  }
  _channel.show(true); // true = preserve focus
  return _channel;
}

function log(msg) {
  if (!_channel) showOutput();
  const ts = new Date().toLocaleTimeString();
  _channel.appendLine(`[${ts}] ${msg}`);
}

module.exports = { showOutput, log };
