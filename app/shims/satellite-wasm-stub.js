/**
 * Stub para el runtime WASM opcional de satellite.js 7.
 *
 * satellite.js expone, además del SGP4 en JavaScript puro, un propagador en
 * lote compilado a WebAssembly que se carga con import() dinámico de
 * '#wasm-single-thread' / '#wasm-multi-thread'. Ese código depende de
 * 'node:module' y de WebAssembly, que Hermes (el motor JS de React Native)
 * no provee. La app usa exclusivamente la API JS (json2satrec, propagate,
 * eciToGeodetic, ecfToLookAngles…), así que reemplazamos esos módulos por este
 * stub y fallamos con un mensaje claro si alguien intentara usarlos.
 */
module.exports = function createWasmModuleUnavailable() {
  return Promise.reject(new Error('El runtime WASM de satellite.js no está disponible en React Native'));
};
module.exports.default = module.exports;
