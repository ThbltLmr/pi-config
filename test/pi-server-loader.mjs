const fixture = new URL("./pi-server-fixture.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@earendil-works/pi-server" || specifier === "@earendil-works/pi-server/unix") {
    return { url: fixture, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
