import { useId } from 'react'

// The analytik mark: a blue triangle with a yellow face, cut by a diagonal gap. The mask id is per instance, so two
// dashboards on one page don't share it.
export function BrandMark({ body = '#3a8dff', face = '#ffc232' }: { body?: string; face?: string }) {
  const cut = `${useId()}cut`
  return (
    <svg className="analytik-brand-mark" viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <defs>
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">
          <rect width="256" height="256" fill="#fff" />
          <path d="M0 218 L256 62" stroke="#000" strokeWidth="16" />
        </mask>
      </defs>
      <g mask={`url(#${cut})`} strokeLinejoin="round" strokeWidth="12">
        <path className="analytik-brand-body" d="M128 30 L232 224 L24 224 Z" fill={body} stroke={body} />
        <path className="analytik-brand-face" d="M128 30 L172.5 112.9 L35.3 196.5 Z" fill={face} stroke={face} />
      </g>
    </svg>
  )
}
