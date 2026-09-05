export class ServerError extends Error {}
export class SessionAmbiguousError extends Error {}
export class SessionNotFoundError extends Error {}
export function createUnixServer() { throw new Error("test fixture only"); }
export function getUnixSocketPath() { return ""; }
