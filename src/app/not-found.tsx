'use client'

export const dynamic = 'force-dynamic'

export default function NotFound() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#000',
      color: '#00ff00',
      fontFamily: 'monospace'
    }}>
      <h1>404 - Page Not Found</h1>
      <p>The page you are looking for does not exist.</p>
      <a href="/" style={{ color: '#00ff00', marginTop: 20 }}>Go back home</a>
    </div>
  )
}
