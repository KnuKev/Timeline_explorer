import type { SVGProps } from 'react'

/** A small full moon, drawn without shared SVG definitions or external assets. */
export default function MoonIllustration({ className = '', ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      x="94"
      y="40"
      width="72"
      height="72"
      viewBox="0 0 64 64"
      fill="none"
      stroke="none"
      className={`statistics-power-moon ${className}`.trim()}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <circle cx="32" cy="32" r="28" fill="#D9DBDF" />
      <path d="M32 4a28 28 0 0 0-19.8 47.8A30 30 0 0 1 49.5 10.1 27.9 27.9 0 0 0 32 4Z" fill="#F5F5F6" opacity=".48" />
      <path d="M48 9A28 28 0 1 1 9 48Q31 65 50 41Q61 25 48 9Z" fill="#8B919A" opacity=".16" />

      <path d="M18.7 13.8c-4.6.5-8.3 4.8-7.5 8.4.6 2.6 3.1 2.9 3.8 5.4.7 2.6 3.7 3.5 6 2.2 2-1.1 1.8-4 4-5.1 3.2-1.6 3.8-4.3 1.6-6.7-2.2-2.4-4.1-4.6-7.9-4.2Z" fill="#B2B6BE" />
      <path d="M40.1 22.5c-3.6-.5-6.4 2-6.8 5.1-.3 2.5 1.7 3.4 2 5.6.4 3.2 4.7 5 7.9 3.4 2.5-1.3 2.5-4.1 4.1-5.8 1.6-1.8 1.2-4.2-1-5.1-2-.9-3.7-2.9-6.2-3.2Z" fill="#BDC0C7" />
      <path d="M20.1 38.4c-3.7-.3-6.3 2.1-6.5 5.1-.2 3.4 3 5.8 6.1 5.7 2.3 0 3.2-1.6 5.3-2.4 2.7-1.1 3.3-3.7 1.4-5.6-1.7-1.8-3.9-2.6-6.3-2.8Z" fill="#BEC1C8" />

      <ellipse cx="35.5" cy="13.6" rx="3.2" ry="2.6" fill="#F1F1F3" opacity=".65" />
      <ellipse cx="35.5" cy="12.9" rx="3.2" ry="2.6" fill="#BEC2C9" />
      <ellipse cx="38.7" cy="47.5" rx="4.7" ry="4" fill="#ECEDEF" opacity=".65" />
      <ellipse cx="38.7" cy="46.7" rx="4.7" ry="4" fill="#ADB3BC" />
      <ellipse cx="48.1" cy="39.6" rx="2" ry="2.3" fill="#B6BBC3" />
      <circle cx="28.4" cy="33.8" r="1.6" fill="#AEB5BE" />
      <circle cx="27.7" cy="52" r="1.2" fill="#B7BDC5" />
    </svg>
  )
}
