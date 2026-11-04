# Toolchain (verified in the cloud container, Ubuntu 24.04)

| Item | Value |
|---|---|
| .NET SDK | 10.0.114, from `apt install dotnet-sdk-10.0` (also `dotnet-sdk-aot-10.0`) |
| WASM workload | `dotnet workload install wasm-tools` succeeded for 10.0.100 (Emscripten 3.1.56) |
| Pin | `global.json`: SDK 10.0.100, `rollForward: latestFeature` |
| Fallback | .NET 8 (8.0.133 via apt) also installs, and `wasm-tools` works there too. Spike only. |
| Microsoft download hosts | blocked by the proxy; Ubuntu archive, packages.microsoft.com and NuGet are reachable |
| Browser tests | Chromium + Playwright preinstalled in the container; node 22 |

Setup on a fresh container:

```bash
apt-get install -y dotnet-sdk-10.0
dotnet workload install wasm-tools
```
