import { useEffect, useState } from 'react'

type FlagSet = Record<string, string>

// The flags are one lazy chunk, fetched the first time a country is shown and shared by every row after that.
let flags: FlagSet | undefined
let loading: Promise<FlagSet | undefined> | undefined

function loadFlags(): Promise<FlagSet | undefined> {
  // A failed load is remembered, so rows show their code instead of retrying on every render.
  loading ??= import('./flags-data').then(
    (module) => (flags = module.default),
    () => undefined,
  )
  return loading
}

/** The country's flag, a round SVG from the Circle Flags set; its code in a neutral circle when there is none. */
export function Flag({ code }: { code: string }) {
  const [set, setSet] = useState(flags)
  useEffect(() => {
    if (!set) void loadFlags().then(setSet)
  }, [set])
  const markup = set?.[code.toUpperCase()]
  if (!markup) {
    return (
      <span className="analytik-flag" data-fallback="" aria-hidden="true">
        {set ? code.slice(0, 2).toUpperCase() : ''}
      </span>
    )
  }
  return (
    <svg
      className="analytik-flag"
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
