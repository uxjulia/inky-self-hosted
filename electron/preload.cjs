const { contextBridge, ipcRenderer } = require("electron");

function apiBaseUrl() {
  const prefix = "--inky-api-base-url=";
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : "";
}

contextBridge.exposeInMainWorld("inkyDesktop", {
  apiBaseUrl: apiBaseUrl(),
  selectLibraryFolder: () => ipcRenderer.invoke("select-library-folder")
});
