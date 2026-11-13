// The end-to-end servers' ports. E2E_PORT lets parallel checkouts on one
// machine use different ones: the app on it, the fake-microphone probe on
// the next.
export const appPort = Number(process.env['E2E_PORT'] ?? 4173)
export const probePort = appPort + 1
