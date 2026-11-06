// Configuración de Metro: ver shims/satellite-wasm-stub.js para el porqué.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const WASM_STUB = path.resolve(__dirname, 'shims/satellite-wasm-stub.js');
const WASM_IMPORTS = new Set(['#wasm-single-thread', '#wasm-multi-thread']);

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (WASM_IMPORTS.has(moduleName) || /satellite\.js[\\/]wasm-build[\\/]/.test(moduleName)) {
    return { type: 'sourceFile', filePath: WASM_STUB };
  }
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
