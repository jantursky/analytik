/** A public host name: not an address, not `localhost`, not a name that only resolves inside a network. */
export function publicHost(host: string): boolean {
  return (
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host) &&
    // The last label holds a letter, so decimal, octal and hex forms of an address (127.1, 0x7f.1) are no host names.
    /\.[a-z][a-z0-9-]*$/i.test(host) &&
    !/\.(local|localhost|internal|lan|home|corp|arpa)$/i.test(host)
  )
}
