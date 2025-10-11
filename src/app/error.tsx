'use client'

export const dynamic = 'force-dynamic'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#000',
      color: '#ff5555',
      fontFamily: 'monospace'
    }}>
      <h1>Something went wrong!</h1>
      <p>{error.message || 'An error occurred'}</p>
      <button
        onClick={reset}
        style={{
          marginTop: 20,
          padding: '10px 20px',
          background: '#003300',
          color: '#00ff00',
          border: '1px solid #00ff00',
          cursor: 'pointer'
        }}
      >
        Try again
      </button>
    </div>
  )
}
