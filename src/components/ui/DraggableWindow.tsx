'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Window, WindowHeader, WindowContent, Button } from 'react95'

type Pos = { x: number; y: number }

type DraggableWindowProps = {
  title: string
  children: React.ReactNode
  initialPosition?: Pos
  onClose?: () => void
  width?: number | string
  height?: number | string
  zIndex?: number // treated as initial z-index hint
  fixedZIndex?: boolean // if true, keep z-index fixed and skip bring-to-front
}

/**
 * DraggableWindow
 * - Win95 Window with draggable header and optional close button.
 * - Manages z-index stacking so focused window comes to front.
 */
let __topZ = 10000
const nextZ = () => ++__topZ

export default function DraggableWindow({
  title,
  children,
  initialPosition,
  onClose,
  width,
  height,
  zIndex,
  fixedZIndex,
}: DraggableWindowProps) {
  const [pos, setPos] = useState<Pos>(initialPosition ?? { x: 80, y: 80 })
  const [activeZ, setActiveZ] = useState<number>(() => (typeof zIndex === 'number' ? zIndex : nextZ()))
  const dragging = useRef(false)
  const offset = useRef<Pos>({ x: 0, y: 0 })

  const containerStyle: React.CSSProperties = useMemo(
    () => ({
      position: 'fixed',
      left: pos.x,
      top: pos.y,
      width,
      height,
      zIndex: activeZ,
      pointerEvents: 'none', // let clicks pass outside; only window is interactive
    }),
    [pos, width, height, activeZ]
  )

  // Bring to front on pointer down (skip if fixed)
  const bringToFront = () => {
    if (fixedZIndex) return
    setActiveZ(nextZ())
  }

  // Start dragging from header (skip if fixed z doesn't prevent dragging)
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    bringToFront()
    dragging.current = true
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current) return
    const nx = e.clientX - offset.current.x
    const ny = e.clientY - offset.current.y

    // Constrain within viewport (simple guard)
    const maxX = Math.max(0, (window.innerWidth ?? 0) - 100)
    const maxY = Math.max(0, (window.innerHeight ?? 0) - 60)
    setPos({
      x: Math.min(Math.max(0, nx), maxX),
      y: Math.min(Math.max(0, ny), maxY),
    })
  }

  const onMouseUp = () => {
    dragging.current = false
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  return (
    <div style={containerStyle}>
      <Window
        onMouseDown={bringToFront}
        style={{ width: width ?? 520, pointerEvents: 'auto' }} // only the window receives clicks
      >
        <WindowHeader
          onMouseDown={onHeaderMouseDown}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'move',
            userSelect: 'none',
          }}
        >
          <span>{title}</span>
          {onClose ? (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
              aria-label="Close"
            >
              X
            </Button>
          ) : null}
        </WindowHeader>
        <WindowContent>{children}</WindowContent>
      </Window>
    </div>
  )
}
