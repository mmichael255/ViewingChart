'use client';

import React from 'react';

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical';
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  direction,
  isDragging,
  onMouseDown,
}) => {
  const isHorizontal = direction === 'horizontal';

  return (
    <div
      onMouseDown={onMouseDown}
      className={`
        relative shrink-0 z-40
        ${isHorizontal
          ? 'w-[4px] cursor-col-resize mx-0'
          : 'h-[4px] cursor-row-resize my-0'
        }
        ${isDragging ? 'bg-[#D1D5DB]' : 'bg-transparent hover:bg-[#D1D5DB]/40'}
        transition-colors duration-150
      `}
    >
      {/* Visible indicator line */}
      <div
        className={`
          absolute rounded-full
          ${isHorizontal
            ? 'left-[1px] top-0 bottom-0 w-[2px]'
            : 'top-[1px] left-0 right-0 h-[2px]'
          }
          ${isDragging
            ? 'bg-[#D1D5DB]'
            : 'bg-gray-700 group-hover:bg-[#D1D5DB]/60'
          }
          transition-colors duration-150
        `}
      />
    </div>
  );
};