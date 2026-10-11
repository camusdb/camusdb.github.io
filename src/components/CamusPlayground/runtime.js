// One .NET runtime per tab, shared by the tutorial and cluster playground.
let enginePromise;
export function loadEngine(onProgress = () => {}) {
  if (!enginePromise) {
    enginePromise = (async () => {
      const module = await new Function('url', 'return import(url)')(
        '/playground-engine/_framework/dotnet.js',
      );
      const runtime = await module.dotnet
        .withModuleConfig({onDownloadResourceProgress: onProgress})
        .create();
      const exports = await runtime.getAssemblyExports(
        runtime.getConfig().mainAssemblyName,
      );
      return exports.CamusDB.Wasm.PlaygroundEngine;
    })().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}
