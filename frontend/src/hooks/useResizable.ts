'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseResizableOptions {
  initialSize: number;
  minSize: number;
  maxSize: number;
  direction: 'horizontal' | 'vertical';
  /** Optional callback fired with the new size on resize end */
  onResizeEnd?: (size: number) => void;
}

interface UseResizableReturn {
  size: number;
  isDragging: boolean;
  handleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
  };
}

export function useResizable({
  initialSize,
  minSize,
  maxSize,
  direction,
  onResizeEnd,
}: UseResizableOptions): UseResizableReturn {
  const [size, setSize] = useState(initialSize);
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
      startSizeRef.current = size;
    },
    [direction, size]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - startPosRef.current;
      // For horizontal: dragging the border LEFT means the sidebar (right panel)
      // should get BIGGER. clientX decreases → delta negative → negate to add.
      // For vertical: dragging down makes top panel smaller (standard divider behavior).
      const adjustment = direction === 'horizontal' ? -delta : delta;
      const newSize = Math.max(minSize, Math.min(maxSize, startSizeRef.current + adjustment));
      setSize(newSize);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onResizeEnd?.(size);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, direction, minSize, maxSize, onResizeEnd, size]);

  // Cleanup if component unmounts while dragging
  useEffect(() => {
    return () => {
      setIsDragging(false);
    };
  }, []);

  return {
    size,
    isDragging,
    handleProps: { onMouseDown: handleMouseDown },
  };
}